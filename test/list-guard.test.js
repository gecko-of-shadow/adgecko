// Block E: a downloaded list is checked before it replaces the last good copy
// (size change bound, protected stream hosts, abnormal hide lists), and
// "Revert lists" goes back to the packed rules.
import "../src/general/filter-options.js";
import "../src/threat/psl.js";
import "../src/general/never-block-captcha.js";
import "../src/threat/protected-hosts.js";
import "../src/threat/compile.js";
import updateSource from "../src/general/update.js" with { type: "text" };
import cosSource from "../src/general/cosmetic-parse.js" with { type: "text" };
import bundled from "../src/rules/general-network.json" with { type: "json" };
import mergeMeta from "../src/rules/dnr-merge-meta.json" with { type: "json" };
import { loadWorker, settle } from "./fixtures/fake-chrome-worker.js";
function assert(c, l) { if (!c) throw new Error(l); }
const U = {};
new Function(`${updateSource}\nreturn installGeneralAdblockUpdate;`)()(U);
const CP = new Function("self", `${cosSource}\nreturn self.GeneralCosmeticParse;`)({});

function fakeDeps(responses) {
  const state = {}; let dynamic = []; let staticOn = true; const data = {}; const cosmetic = [];
  const deps = {
    state, data, cosmetic, get dynamic() { return dynamic; }, get staticOn() { return staticOn; }, t: 1e12,
    fetch: async (url) => { const r = responses(url); if (r instanceof Error) throw r; return r; },
    now: () => deps.t,
    getState: async () => structuredClone(state),
    setState: async (p) => Object.assign(state, structuredClone(p)),
    getListData: async (names) => Object.fromEntries(names.filter((n) => data[n]).map((n) => [n, structuredClone(data[n])])),
    setListData: async (n, p) => { data[n] = structuredClone(p); },
    removeListData: async (names) => { for (const n of names) delete data[n]; },
    getDynamicRules: async () => dynamic.slice(),
    updateDynamicRules: async ({ removeRuleIds, addRules }) => { dynamic = dynamic.filter((r) => !removeRuleIds.includes(r.id)).concat(addRules); },
    setStaticEnabled: async (on) => { staticOn = on; },
    loadBundled: async () => ({ rules: bundled, extraIds: [mergeMeta.extra_tracker_rule_id] }),
    enabled: () => true,
    cosmeticParse: CP,
    writeCosmetic: async (d) => { cosmetic.push(d); },
  };
  return deps;
}
const res = (text) => ({ ok: true, status: 200, headers: new Headers({ ETag: '"e"' }), text: async () => text });
const tagOf = (url) => new URL(url).pathname.replace(/[^a-z0-9]/gi, "").slice(-10);
const listText = (tag, n, extra = []) => "! Expires: 4 days\nexample.com##.promo-" + tag + "\n##.generic-" + tag + "\n" + Array.from({ length: n }, (_, i) => `||${tag}${i}.example.com^`).concat(extra).join("\n");

async function primed() {
  const d = fakeDeps((url) => res(listText(tagOf(url), 20000)));
  const r = await U.refresh(d, {});
  assert(r.ok, "first load " + JSON.stringify(r));
  return d;
}

Deno.test("first load has no size bound; a later +100% (huge growth) refresh is rejected and the last good copy stays", async () => {
  const d = await primed();
  const before = structuredClone(d.data.easylist);
  const rulesBefore = JSON.stringify(d.dynamic);
  d.fetch = async (url) => res(listText(tagOf(url) + "x", url.includes("easylist.txt") ? 40000 : 20000));
  const r = await U.refresh(d, { manual: true });
  assert(r.ok, "other lists still apply " + JSON.stringify(r));
  assert(JSON.stringify(d.data.easylist) === JSON.stringify(before), "easylist payload replaced");
  assert(/rejected, kept the last good copy: size changed by 100%/.test(d.state.lastErrors.easylist), JSON.stringify(d.state.lastErrors));
  assert(d.state.lastRejected.easylist && /20000 -> 40000/.test(d.state.lastRejected.easylist.reason), JSON.stringify(d.state.lastRejected));
  assert(d.state.lists.easylist.count === 20000, "meta kept");
  assert(rulesBefore !== JSON.stringify(d.dynamic), "the accepted lists did update");
});

Deno.test("a size change that persists is accepted on the next download (no list frozen forever); a one-off spike stays rejected", async () => {
  const d = await primed();
  const sizes = { now: 28000 }; // +40% for peter_lowe
  d.fetch = async (url) => res(listText(tagOf(url), url.includes("pgl.yoyo") ? sizes.now : 20000));
  await U.refresh(d, { manual: true });
  assert(/size changed by 40%/.test(d.state.lastErrors.peter_lowe || ""), "first time rejected " + JSON.stringify(d.state.lastErrors));
  assert(d.state.lists.peter_lowe.count === 20000 && d.state.lists.peter_lowe.rejectedCount === 28000, JSON.stringify(d.state.lists.peter_lowe));
  sizes.now = 28500; // the same new size again (within 10%)
  await U.refresh(d, { manual: true });
  assert(!d.state.lastErrors.peter_lowe && d.state.lists.peter_lowe.count === 28500 && !d.state.lists.peter_lowe.rejectedCount, "accepted on repeat " + JSON.stringify(d.state.lists.peter_lowe));
  // A one-off spike, then back to normal: the spike is rejected, normal accepted,
  // and a different spike later is rejected again.
  sizes.now = 60000;
  await U.refresh(d, { manual: true });
  assert(/size changed/.test(d.state.lastErrors.peter_lowe || ""), "spike rejected");
  sizes.now = 29000;
  await U.refresh(d, { manual: true });
  assert(!d.state.lastErrors.peter_lowe && d.state.lists.peter_lowe.count === 29000, "back to normal accepted");
  sizes.now = 9000;
  await U.refresh(d, { manual: true });
  assert(/size changed/.test(d.state.lastErrors.peter_lowe || "") && d.state.lists.peter_lowe.count === 29000, "new spike rejected again");
});

Deno.test("a list that shrinks by more than 25% is rejected; a 10% change is accepted", async () => {
  const d = await primed();
  d.fetch = async (url) => res(listText(tagOf(url), url.includes("pro.mini") ? 12000 : 18000));
  await U.refresh(d, { manual: true });
  assert(/size changed by 40%/.test(d.state.lastErrors.hagezi_pro_mini || ""), JSON.stringify(d.state.lastErrors));
  assert(d.state.lists.hagezi_pro_mini.count === 20000 && d.data.hagezi_pro_mini.domains.length === 20000, "hagezi kept");
  assert(!d.state.lastErrors.peter_lowe && d.state.lists.peter_lowe.count === 18000, "10% shrink accepted");
});

// ---- adaptive HaGeZi protected-host cap (0.3.3) ----
// cap = last accepted hit count + PROTECTED_HITS_MARGIN, never above
// PROTECTED_HITS_SPIKE x that count (when it is at least 1); seed 64 with no
// stored count; every other list keeps the fixed PROTECTED_HITS_MAX.
const HZ = "hagezi_pro_mini";
const apiHosts = (n) => Array.from({ length: n }, (_, i) => `||api${i}.googleapis.com^`);
const hagezi = (url) => url.includes("pro.mini");
async function primedWithHits(n) {
  const d = fakeDeps((url) => res(listText(tagOf(url), 20000, hagezi(url) ? apiHosts(n) : [])));
  const r = await U.refresh(d, {});
  assert(r.ok && !d.state.lastErrors[HZ], "prime with " + n + " hits: " + JSON.stringify(d.state.lastErrors));
  assert(d.state.lists[HZ].protectedHits === n, "stored hit count: " + d.state.lists[HZ].protectedHits);
  return d;
}
const hageziRefresh = async (d, n) => {
  d.fetch = async (url) => res(listText(tagOf(url), 20000, hagezi(url) ? apiHosts(n) : []));
  await U.refresh(d, { manual: true });
};

Deno.test("adaptive cap: the constants and the formula", () => {
  assert(U.PROTECTED_HITS_MAX === 25 && U.PROTECTED_HITS_SEED_BY_LIST[HZ] === 64 && U.PROTECTED_HITS_MARGIN === 10 && U.PROTECTED_HITS_SPIKE === 2, "constants");
  assert(U.protectedHitsCap(HZ, undefined) === 64 && U.protectedHitsCap(HZ, {}) === 64 && U.protectedHitsCap(HZ, { count: 5 }) === 64, "seed without a stored count");
  assert(U.protectedHitsCap(HZ, { protectedHits: 30 }) === 40, "30 + 10");
  assert(U.protectedHitsCap(HZ, { protectedHits: 4 }) === 8, "2 x 4 wins over 4 + 10");
  assert(U.protectedHitsCap(HZ, { protectedHits: 0 }) === 10, "0 + 10, no 2x rule at 0");
  assert(U.protectedHitsCap("peter_lowe", { protectedHits: 20 }) === 25 && U.protectedHitsCap("easylist", undefined) === 25, "other lists fixed at 25");
});

Deno.test("adaptive cap: a sane next HaGeZi count within the margin is accepted and becomes the new baseline", async () => {
  const d = await primedWithHits(30);
  await hageziRefresh(d, 40);
  assert(!d.state.lastErrors[HZ], "40 after 30 rejected: " + JSON.stringify(d.state.lastErrors[HZ]));
  assert(d.state.lists[HZ].protectedHits === 40, "baseline moved to 40: " + d.state.lists[HZ].protectedHits);
});

Deno.test("adaptive cap: a count above the last accepted count + margin is rejected", async () => {
  const d = await primedWithHits(30);
  await hageziRefresh(d, 41);
  assert(/names 41 protected stream hosts/.test(d.state.lastErrors[HZ] || ""), "41 after 30 accepted: " + JSON.stringify(d.state.lastErrors[HZ]));
});

Deno.test("adaptive cap: a spike above 2x the last accepted count is rejected even inside the margin", async () => {
  const d = await primedWithHits(4);
  await hageziRefresh(d, 9);
  assert(/names 9 protected stream hosts/.test(d.state.lastErrors[HZ] || ""), "9 after 4 accepted: " + JSON.stringify(d.state.lastErrors[HZ]));
  await hageziRefresh(d, 8);
  assert(!d.state.lastErrors[HZ], "8 after 4 (exactly 2x) rejected: " + JSON.stringify(d.state.lastErrors[HZ]));
});

Deno.test("adaptive cap: with no stored count the cap is the seed 64 (an upgrade from 0.3.2 or a first load)", async () => {
  const ok = fakeDeps((url) => res(listText(tagOf(url), 20000, hagezi(url) ? apiHosts(64) : [])));
  await U.refresh(ok, {});
  assert(!ok.state.lastErrors[HZ] && ok.state.lists[HZ].protectedHits === 64, "64 on first load: " + JSON.stringify(ok.state.lastErrors[HZ]));
  const over = fakeDeps((url) => res(listText(tagOf(url), 20000, hagezi(url) ? apiHosts(65) : [])));
  await U.refresh(over, {});
  assert(/names 65 protected stream hosts/.test(over.state.lastErrors[HZ] || ""), "65 on first load accepted: " + JSON.stringify(over.state.lastErrors[HZ]));
  // A 0.3.2 install has HaGeZi meta without protectedHits: the seed applies once, then the count is stored.
  const d = await primedWithHits(30);
  delete d.state.lists[HZ].protectedHits;
  await hageziRefresh(d, 60);
  assert(!d.state.lastErrors[HZ] && d.state.lists[HZ].protectedHits === 60, "upgrade path: " + JSON.stringify(d.state.lastErrors[HZ]));
});

Deno.test("adaptive cap: a rejected refresh leaves the stored count unchanged; the next sane copy is judged against it", async () => {
  const d = await primedWithHits(30);
  const payload = JSON.stringify(d.data[HZ]);
  await hageziRefresh(d, 41);
  assert(d.state.lastErrors[HZ] && d.state.lists[HZ].protectedHits === 30, "stored count after a rejection: " + d.state.lists[HZ].protectedHits);
  assert(JSON.stringify(d.data[HZ]) === payload, "last good copy kept");
  await hageziRefresh(d, 40);
  assert(!d.state.lastErrors[HZ] && d.state.lists[HZ].protectedHits === 40, "40 judged against 30: " + JSON.stringify(d.state.lastErrors[HZ]));
});

Deno.test("adaptive cap: every other list still rejects above 25 protected hosts, whatever it carried before", async () => {
  const d = fakeDeps((url) => res(listText(tagOf(url), 20000, url.includes("pgl.yoyo") ? apiHosts(20) : [])));
  await U.refresh(d, {});
  assert(!d.state.lastErrors.peter_lowe && d.state.lists.peter_lowe.protectedHits === 20, "20 accepted for another list");
  d.fetch = async (url) => res(listText(tagOf(url), 20000, url.includes("pgl.yoyo") ? apiHosts(26) : hagezi(url) ? apiHosts(40) : []));
  await U.refresh(d, { manual: true });
  assert(/names 26 protected stream hosts/.test(d.state.lastErrors.peter_lowe || ""), "26 for another list accepted: " + JSON.stringify(d.state.lastErrors.peter_lowe));
  assert(/names 40 protected stream hosts/.test(d.state.lastErrors[HZ] || ""), "HaGeZi at 40 from a 0 baseline is above 0 + 10: " + JSON.stringify(d.state.lastErrors[HZ]));
});

Deno.test("a list naming many protected stream hosts is rejected as poisoned; a few are tolerated and never blocked", async () => {
  const d = await primed();
  const poison = Array.from({ length: 30 }, (_, i) => `||edge${i}.ttvnw.net^`);
  d.fetch = async (url) => res(listText(tagOf(url), 20000, url.includes("pgl.yoyo") ? poison : url.includes("adtidy") ? ["||ads.youtube.com^", "||googlevideo.com^", "||youtubei.googleapis.com^"] : []));
  await U.refresh(d, { manual: true });
  assert(/names 30 protected stream hosts/.test(d.state.lastErrors.peter_lowe || ""), JSON.stringify(d.state.lastErrors));
  assert(!d.state.lastErrors.adguard_base, "a few protected names are tolerated");
  const blocked = d.dynamic.filter((r) => r.priority === 1).flatMap((r) => r.condition.requestDomains);
  for (const h of ["ads.youtube.com", "googlevideo.com", "youtubei.googleapis.com", "edge0.ttvnw.net"]) assert(!blocked.includes(h), h + " blocked");
});

Deno.test("hide lists: '*' and 'body' generic selectors are dropped; an abnormal hide list is rejected and the previous one kept", async () => {
  const parsed = CP.parseCosmetic(["##*", "##body", "##div", "##html *", "##*:not(.x)", "##.ad", "##[id^=\"ad-\"]", "##ad-slot", "##.box > img", "news.example##body"].join("\n"));
  assert(JSON.stringify(parsed.generic) === JSON.stringify([".ad", "[id^=\"ad-\"]", "ad-slot", ".box > img"]), JSON.stringify(parsed.generic));
  assert(parsed.sites["news.example"][0] === "body" && parsed.stats.pageRootSite === 1 && parsed.stats.unscopedGeneric === 5, JSON.stringify(parsed.stats));
  const d = await primed();
  assert(d.cosmetic.length === 1, "first hide list written");
  const roots = Array.from({ length: 150 }, (_, i) => `site${i}.example##html`).join("\n");
  d.fetch = async (url) => res(listText(tagOf(url), 20000) + (url.includes("easylist.txt") ? "\n" + roots : ""));
  await U.refresh(d, { manual: true });
  assert(/too many whole-page hide rules \(150\)/.test(d.state.lastErrors.easylist || ""), JSON.stringify(d.state.lastErrors));
  // EasyPrivacy changed, so the hide list is rebuilt: from EasyList's last good
  // copy, without the rejected whole-page rules.
  const last = d.cosmetic[d.cosmetic.length - 1];
  assert(!last.sites["site0.example"] && last.sites["example.com"].length === 2, "rebuilt from the last good EasyList copy: " + Object.keys(last.sites).slice(0, 5));
  const many = Array.from({ length: 31000 }, (_, i) => `##.g${i}`).join("\n");
  assert(/too many generic hide rules/.test(U.checkListChange(null, { domains: [], scoped: [] }, CP.parseCosmetic(many)) || ""), "generic cap");
});

Deno.test("Revert lists drops refreshed payloads and dynamic list/threat rules, keeps packed rules on, and holds the auto refresh for 12 h", async () => {
  const d = await primed();
  d.dynamic.push({ id: U.THREAT_RULE_ID_BASE, priority: 2000010, action: { type: "block" }, condition: { requestDomains: ["t.example"] } });
  d.dynamic.push({ id: U.ALLOW_RULE_ID_BASE, priority: 10000, action: { type: "allow" }, condition: { initiatorDomains: ["a.example"] } });
  let restored = 0;
  d.revertCosmetic = async () => { restored++; };
  const r = await U.revertLists(d);
  assert(r.ok && Object.keys(d.data).length === 0, "payloads removed " + Object.keys(d.data));
  assert(d.dynamic.length === 1 && d.dynamic[0].id === U.ALLOW_RULE_ID_BASE, "only the user's allow rule stays: " + d.dynamic.map((x) => x.id));
  assert(d.staticOn && !d.state.dynamicActive && Object.keys(d.state.lists).length === 0 && restored === 1, "packed rules on, hide list restored");
  d.t += 60 * 60 * 1000;
  assert((await U.refresh(d, {})).reason === "throttled", "automatic refresh waits");
  const m = await U.refresh(d, { manual: true });
  assert(m.ok && Object.keys(d.data).length > 0, "Update lists refetches at once");
});

Deno.test("worker: the popup's revertLists message reverts and writes a status line", async () => {
  const w = loadWorker({ store: { generalEnabled: true, generalAllowedOrigins: [], listState: { schema: 2, dynamicActive: true, lists: {} }, "listData:easylist": { domains: ["x.example"], parser: 2 } } });
  await settle(50);
  const r = await w.send({ source: "adgecko-general", type: "revertLists" });
  assert(r && r.ok, JSON.stringify(r));
  assert(!("listData:easylist" in w.store) && w.store.listState.revertedAt > 0, "reverted");
  assert(/Reverted to the packed lists/.test(w.store.generalListStatus), w.store.generalListStatus);
});
