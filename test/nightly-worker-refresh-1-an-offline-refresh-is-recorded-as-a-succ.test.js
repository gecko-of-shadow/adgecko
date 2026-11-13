import "../src/general/filter-options.js";
import "../src/general/never-block-captcha.js";
import source from "../src/general/update.js" with { type: "text" };
import cosSource from "../src/general/cosmetic-parse.js" with { type: "text" };
import bundled from "../src/rules/general-network.json" with { type: "json" };
import mergeMeta from "../src/rules/dnr-merge-meta.json" with { type: "json" };
const EXTRA_ID = mergeMeta.extra_tracker_rule_id;
function assert(c, l) { if (!c) throw new Error(l); }
const U = {};
new Function(`${source}\nreturn installGeneralAdblockUpdate;`)()(U);
const CP = new Function("self", `${cosSource}\nreturn self.GeneralCosmeticParse;`)({});

function fakeDeps({ responses, enabled = true, failUpdate = false }) {
  const state = {}; let dynamic = []; const calls = []; let staticOn = true; const cosmetic = []; const data = {};
  const deps = {
    calls, cosmetic, data, get staticOn() { return staticOn; }, get dynamic() { return dynamic; }, t: 1e12,
    fetch: async (url, init) => { calls.push({ url, headers: init.headers, redirect: init.redirect }); const r = responses(url, init); if (r instanceof Error) throw r; return r; },
    now: () => deps.t,
    getState: async () => structuredClone(state),
    setState: async (p) => Object.assign(state, structuredClone(p)),
    getListData: async (names) => Object.fromEntries(names.filter((n) => data[n]).map((n) => [n, structuredClone(data[n])])),
    setListData: async (name, payload) => { data[name] = structuredClone(payload); },
    removeListData: async (names) => { for (const n of names) delete data[n]; },
    getDynamicRules: async () => dynamic.slice(),
    updateDynamicRules: async ({ removeRuleIds, addRules }) => {
      if (failUpdate && addRules.length) throw new Error("quota");
      dynamic = dynamic.filter((r) => !removeRuleIds.includes(r.id)).concat(addRules);
    },
    setStaticEnabled: async (on) => { staticOn = on; },
    loadBundled: async () => ({ rules: bundled, extraIds: [EXTRA_ID] }),
    enabled: () => enabled,
    cosmeticParse: CP,
    writeCosmetic: async (data) => { cosmetic.push(data); },
  };
  return deps;
}
const big = (tag) => "! Expires: 4 days\nexample.com##.promo-" + tag + "\n" + Array.from({ length: 30000 }, (_, i) => `||${tag}${i}.example.com^`).join("\n");
const ok = (url) => ({ ok: true, status: 200, headers: new Headers({ ETag: '"e"' }), text: async () => big(new URL(url).pathname.replace(/[^a-z0-9]/gi, "")) });

Deno.test("an offline manual refresh after a good one is not recorded as a success", async () => {
  const d = fakeDeps({ responses: ok });
  const first = await U.refresh(d, {});
  assert(first.ok, "first refresh ok " + JSON.stringify(first));
  const goodRunAt = (await d.getState()).lastRunAt;
  d.t += 13 * 60 * 60 * 1000;
  const offlineAt = d.t;
  d.fetch = async () => { throw new TypeError("Failed to fetch"); };
  const r = await U.refresh(d, { manual: true });
  const st = await d.getState();
  assert(Object.keys(st.lastErrors).length === U.SOURCES.length, "every list failed: " + JSON.stringify(st.lastErrors));
  assert(st.lastRunAt === goodRunAt, "lastRunAt must not advance on a fully failed run (M-2): lastRunAt=" + st.lastRunAt + " offlineAt=" + offlineAt + " good=" + goodRunAt);
  assert(!r.ok, "a run where every download failed must not report ok: " + JSON.stringify(r));
  // Network back: the automatic run 3 h later must retry (30 min retry window), not wait 12 h.
  d.fetch = async (url, init) => ok(url);
  d.t += 3 * 60 * 60 * 1000;
  const auto = await U.refresh(d, {});
  assert(auto.reason !== "throttled", "automatic retry after a failed run is throttled for 12 h: " + JSON.stringify(auto));
});
