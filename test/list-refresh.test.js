import source from "../src/general/update.js" with { type: "text" };
import cosSource from "../src/general/cosmetic-parse.js" with { type: "text" };
import bundled from "../src/rules/general-network.json" with { type: "json" };
function assert(c, l) { if (!c) throw new Error(l); }
const U = {};
new Function(`${source}\nreturn installGeneralAdblockUpdate;`)()(U);
const CP = new Function("self", `${cosSource}\nreturn self.GeneralCosmeticParse;`)({});

Deno.test("parser keeps domain rules and skips exceptions, cosmetics, scoped and junk", () => {
  const text = ["[Adblock Plus 2.0]", "! Expires: 4 days", "||ads.example.com^", "||track.example.net^$third-party",
    "||scoped.example.org^$domain=foo.com", "@@||ok.example.com^", "example.com##.ad", "/banner/*",
    "0.0.0.0 hosts.example.io", "127.0.0.1 localhost", "bare.example.co", "||bad*.example.com^", ""].join("\n");
  const d = U.parseList(text);
  assert(JSON.stringify(d) === JSON.stringify(["ads.example.com", "track.example.net", "hosts.example.io", "bare.example.co"]), JSON.stringify(d));
  assert(U.parseExpires(text) === 4 * 86400000, "4 days");
  assert(U.parseExpires("! Expires: 1 hours") === U.MIN_INTERVAL_MS, "floored to 12h");
  assert(U.parseExpires("no header") === 86400000, "default 1 day");
});

Deno.test("merge drops stream domains and dupes; 80 domains per rule", () => {
  const merged = U.mergeDomains({ peter_lowe: ["a.com", "googlevideo.com", "r1.googlevideo.com"], easylist: ["a.com", "b.com", "x.twitch.tv"] });
  assert(JSON.stringify(merged) === '["a.com","b.com"]', JSON.stringify(merged));
  const rules = U.buildListRules(Array.from({ length: 161 }, (_, i) => "d" + i + ".com"));
  assert(rules.length === 3 && rules[0].condition.requestDomains.length === 80 && rules[0].id === U.LIST_RULE_ID_BASE, "chunking");
  const kept = U.keptBundledRules(bundled, [1347]);
  assert(kept.length === 4 && kept.every((r) => r.id >= U.KEPT_RULE_ID_BASE && r.id < U.ALLOW_RULE_ID_BASE), "allows + extra tracker kept");
});

function fakeDeps({ responses, enabled = true, failUpdate = false }) {
  const state = {}; let dynamic = []; const calls = []; let staticOn = true; const cosmetic = [];
  const deps = {
    calls, cosmetic, get staticOn() { return staticOn; }, get dynamic() { return dynamic; }, t: 1e12,
    fetch: async (url, init) => { calls.push({ url, headers: init.headers }); const r = responses(url, init); if (r instanceof Error) throw r; return r; },
    now: () => deps.t,
    getState: async () => structuredClone(state),
    setState: async (p) => Object.assign(state, structuredClone(p)),
    getDynamicRules: async () => dynamic.slice(),
    updateDynamicRules: async ({ removeRuleIds, addRules }) => {
      if (failUpdate && addRules.length) throw new Error("quota");
      dynamic = dynamic.filter((r) => !removeRuleIds.includes(r.id)).concat(addRules);
    },
    setStaticEnabled: async (on) => { staticOn = on; },
    loadBundled: async () => ({ rules: bundled, extraIds: [1347] }),
    enabled: () => enabled,
    cosmeticParse: CP,
    writeCosmetic: async (data) => { cosmetic.push(data); },
  };
  return deps;
}
const big = (tag) => "! Expires: 4 days\nexample.com##.promo-" + tag + "\n" + Array.from({ length: 30000 }, (_, i) => `||${tag}${i}.example.com^`).join("\n");
const ok = (url) => ({ ok: true, status: 200, headers: new Headers({ ETag: '"e"' }), text: async () => big(new URL(url).pathname.replace(/\W/g, "")) });

Deno.test("first refresh swaps to dynamic rules, writes cosmetics; startup throttled 12h; expiry respected", async () => {
  const d = fakeDeps({ responses: ok });
  const r = await U.refresh(d, {});
  assert(r.ok && r.rules > 0, JSON.stringify(r));
  assert(d.staticOn === false, "bundle off after swap");
  assert(d.dynamic.length < 30000 && d.dynamic.some((x) => x.id >= U.KEPT_RULE_ID_BASE), "under limit, allows kept");
  assert(d.cosmetic.length === 1 && d.cosmetic[0].sites["example.com"].length === 2, "cosmetic from easylist+easyprivacy");
  d.t += 60 * 60 * 1000;
  assert((await U.refresh(d, {})).reason === "throttled", "startup throttled");
  const n = d.calls.length;
  d.t += 12 * 60 * 60 * 1000;
  await U.refresh(d, {});
  assert(d.calls.length === n, "lists not expired (4 days) are not refetched");
  await U.refresh(d, { manual: true });
  assert(d.calls.length === n + 4 && d.calls.slice(-4).every((c) => c.headers["If-None-Match"]), "manual click sends conditional requests");
});

Deno.test("304 keeps cached domains and cosmetics", async () => {
  const d = fakeDeps({ responses: ok });
  await U.refresh(d, {});
  const before = d.dynamic.length;
  d.fetch = async () => ({ ok: false, status: 304, headers: new Headers() });
  const r = await U.refresh(d, { manual: true });
  assert(r.ok && r.reason === "unchanged" && d.dynamic.length === before && !d.staticOn && d.cosmetic.length === 1, JSON.stringify(r));
});

Deno.test("errors fall back to the bundled ruleset silently", async () => {
  for (const [name, d] of [
    ["offline", fakeDeps({ responses: () => new Error("offline") })],
    ["quota", fakeDeps({ responses: ok, failUpdate: true })],
    ["tiny", fakeDeps({ responses: () => ({ ok: true, status: 200, headers: new Headers(), text: async () => "||a.com^\n" }) })],
    ["429", fakeDeps({ responses: () => ({ ok: false, status: 429, headers: new Headers() }) })],
  ]) {
    const r = await U.refresh(d, {});
    assert(!r.ok && d.staticOn && d.dynamic.filter((x) => x.id < U.ALLOW_RULE_ID_BASE).length === 0, name + " keeps bundle");
  }
});

Deno.test("a failed later refresh keeps a good earlier swap; toggling off/on works", async () => {
  const d = fakeDeps({ responses: ok });
  await U.refresh(d, {});
  const count = d.dynamic.length;
  d.fetch = async () => { throw new Error("offline"); };
  const r = await U.refresh(d, { manual: true });
  assert(d.dynamic.length === count && !d.staticOn && Object.keys((await d.getState()).lastErrors).length === 4, "keeps previous dynamic set, records errors");
  await U.applyEnabled(d, false);
  assert(!d.staticOn && d.dynamic.length === 0, "off removes list rules");
  await U.applyEnabled(d, true);
  assert(!d.staticOn && d.dynamic.length === count, "on rebuilds from cache");
});

Deno.test("one list failing keeps the others and records a readable reason", async () => {
  const d = fakeDeps({ responses: (url) => (url.includes("malware-filter") ? { ok: false, status: 403, headers: new Headers() } : url.includes("pgl.yoyo") ? new TypeError("Failed to fetch") : ok(url)) });
  const r = await U.refresh(d, {});
  const st = await d.getState();
  assert(r.ok && !d.staticOn && d.dynamic.length > 0, "partial success swaps " + JSON.stringify(r));
  assert(st.lastErrors.urlhaus_hosts === "malware-filter.gitlab.io: HTTP 403", JSON.stringify(st.lastErrors));
  assert(/pgl\.yoyo\.org: network error/.test(st.lastErrors.peter_lowe), st.lastErrors.peter_lowe);
  const abort = new Error("aborted"); abort.name = "AbortError";
  assert(U.describeError(U.SOURCES[2], abort) === "easylist.to: timeout", "timeout text");
});

Deno.test("all lists failing keeps the bundle and stores the reasons; manual click bypasses throttle", async () => {
  const d = fakeDeps({ responses: () => new TypeError("Failed to fetch") });
  const r = await U.refresh(d, {});
  const st = await d.getState();
  assert(!r.ok && d.staticOn && /network error/.test(st.lastErrors.all), JSON.stringify(st.lastErrors));
  assert((await U.refresh(d, {})).reason === "throttled", "startup throttled after a failure");
  d.fetch = async (url) => ok(url);
  const m = await U.refresh(d, { manual: true });
  assert(m.ok && !d.staticOn && Object.keys((await d.getState()).lastErrors).length === 0, "manual retry succeeds and clears errors");
});

Deno.test("easylist.to failing in Chrome falls through to a mirror; validators stay per URL", async () => {
  const d = fakeDeps({ responses: (url) => (url.includes("easylist.to") ? new TypeError("Failed to fetch") : ok(url)) });
  const r = await U.refresh(d, {});
  const st = await d.getState();
  assert(r.ok && !d.staticOn && Object.keys(st.lastErrors).length === 0, JSON.stringify(st.lastErrors));
  assert(st.lists.easylist.url.includes("ublockorigin.github.io") && /easylist\.to: network error \(Failed to fetch\)/.test(st.lastNotes.easylist), JSON.stringify(st.lastNotes));
  d.calls.length = 0;
  await U.refresh(d, { manual: true });
  const el = d.calls.filter((c) => c.url.includes("easylist.txt"));
  assert(!el[0].headers["If-None-Match"] && el[1].headers["If-None-Match"], "etag sent only to the URL that issued it");
});

Deno.test("lists failing everywhere: successes merged with packed copies, no 'too small' rejection", async () => {
  const d = fakeDeps({ responses: (url) => (/easylist|easyprivacy/.test(url) ? new TypeError("Failed to fetch") : ok(url)) });
  const r = await U.refresh(d, {});
  const st = await d.getState();
  const packed = bundled.filter((x) => x.action.type === "block" && x.id !== 1347).reduce((n, x) => n + x.condition.requestDomains.length, 0);
  assert(r.ok && !d.staticOn && st.domainCount >= packed, "partial swap keeps packed protection " + JSON.stringify(r));
  assert(/easylist\.to: network error \(Failed to fetch\).*ublockorigin\.github\.io/.test(st.lastErrors.easylist), st.lastErrors.easylist);
});
