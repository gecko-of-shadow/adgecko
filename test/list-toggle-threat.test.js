// WP-06 (review 2026-11-16, finding 0): the lists switch off and on must
// rebuild the refreshed list rules also when refreshed threat rules exist.
// The threat rule ids (600000-609999) are inside the list id range, so a
// range-only "dynamic set is active" check counted them as list rules.
// This file loads src/threat/compile.js, so the threat tier is active here
// (list-refresh.test.js runs without it).
import "../src/general/filter-options.js";
import "../src/threat/psl.js";
import "../src/general/never-block-captcha.js";
import "../src/threat/protected-hosts.js";
import "../src/threat/compile.js";
import source from "../src/general/update.js" with { type: "text" };
import bundled from "../src/rules/general-network.json" with { type: "json" };
import mergeMeta from "../src/rules/dnr-merge-meta.json" with { type: "json" };
function assert(c, l) { if (!c) throw new Error(l); }
const U = {};
new Function(`${source}\nreturn installGeneralAdblockUpdate;`)()(U);

function fakeDeps(responses) {
  const state = {}; let dynamic = []; let staticOn = true; const data = {};
  const deps = {
    get staticOn() { return staticOn; }, get dynamic() { return dynamic; }, t: 1e12,
    fetch: async (url) => responses(url), now: () => deps.t,
    getState: async () => structuredClone(state),
    setState: async (p) => Object.assign(state, structuredClone(p)),
    getListData: async (names) => Object.fromEntries(names.filter((n) => data[n]).map((n) => [n, structuredClone(data[n])])),
    setListData: async (n, p) => { data[n] = structuredClone(p); },
    removeListData: async (names) => { for (const n of names) delete data[n]; },
    getDynamicRules: async () => dynamic.slice(),
    updateDynamicRules: async ({ removeRuleIds, addRules }) => { dynamic = dynamic.filter((r) => !removeRuleIds.includes(r.id)).concat(addRules); },
    setStaticEnabled: async (on) => { staticOn = on; },
    loadBundled: async () => ({ rules: bundled, extraIds: [mergeMeta.extra_tracker_rule_id] }),
    loadPackedThreatRules: async () => [],
    enabled: () => true, threatEnabled: () => true,
  };
  return deps;
}
const big = (tag) => "! Expires: 4 days\n" + Array.from({ length: 30000 }, (_, i) => `||${tag}${i}.example.com^`).join("\n");
const ok = (url) => ({ ok: true, status: 200, headers: new Headers({ ETag: '"e"' }), text: async () => big(new URL(url).pathname.replace(/[^a-z0-9]/gi, "").slice(-12)) });
const listIds = (d) => d.dynamic.filter((x) => U.isOurRule(x.id)).map((x) => x.id).sort((a, b) => a - b);
const threatSig = (d) => JSON.stringify(d.dynamic.filter((x) => U.isThreatRule(x.id)).sort((a, b) => a.id - b.id));

Deno.test("lists off and on rebuild the list rules when refreshed threat rules exist", async () => {
  const d = fakeDeps(ok);
  const r = await U.refresh(d, {});
  assert(r.ok, JSON.stringify(r));
  const listCount = listIds(d).length;
  const threatBefore = threatSig(d);
  assert(listCount > 0, "list rules installed");
  assert(d.dynamic.some((x) => U.isThreatRule(x.id)), "threat rules installed");
  await U.applyEnabled(d, false);
  assert(listIds(d).length === 0 && !d.staticOn, "off removes the list rules and the packed lists");
  assert(threatSig(d) === threatBefore, "off does not touch the threat rules");
  const res = await U.applyEnabled(d, true);
  assert(res.ok && res.mode === "dynamic" && d.staticOn, JSON.stringify(res));
  assert(listIds(d).length === listCount, "expected " + listCount + " list rules after on, got " + listIds(d).length);
  assert(threatSig(d) === threatBefore, "on does not change the threat rules");
});

Deno.test("a refresh rebuilds a lost list set although dynamicActive is still set", async () => {
  const d = fakeDeps(ok);
  await U.refresh(d, {});
  const listCount = listIds(d).length;
  // The list rules are gone (for example an old build lost them on a
  // switch off and on), but state.dynamicActive is still true.
  const lost = listIds(d);
  await d.updateDynamicRules({ removeRuleIds: lost, addRules: [] });
  assert(listIds(d).length === 0 && (await d.getState()).dynamicActive === true, "set-up");
  // Next automatic run: no list is due (4-day expiry), so nothing is fetched.
  d.t += 13 * 3600 * 1000;
  let fetched = 0;
  d.fetch = async () => { fetched += 1; return { ok: false, status: 304, headers: new Headers() }; };
  const r = await U.refresh(d, {});
  assert(r.ok && r.ran && fetched === 0, JSON.stringify(r) + " fetched " + fetched);
  assert(listIds(d).length === listCount, "expected " + listCount + " list rules after the refresh, got " + listIds(d).length + " (" + JSON.stringify(r) + ")");
});
