// Repro: lists switch off -> on does not rebuild refreshed list rules when
// refreshed threat rules exist (dynamicLooksActive counts threat ids 600000+).
import "src/general/filter-options.js";
import "src/threat/psl.js";
import "src/general/never-block-captcha.js";
import "src/threat/protected-hosts.js";
import "src/threat/compile.js";
import "src/general/update.js";
import bundled from "src/rules/general-network.json" with { type: "json" };
import mergeMeta from "src/rules/dnr-merge-meta.json" with { type: "json" };
const U = globalThis.GeneralAdblockUpdate;
function assert(c, l) { if (!c) throw new Error(l); }

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

Deno.test("lists off/on with refreshed threat rules present", async () => {
  const d = fakeDeps(ok);
  const r = await U.refresh(d, {});
  assert(r.ok, JSON.stringify(r));
  const listRules = d.dynamic.filter((x) => U.isOurRule(x.id)).length;
  const threatRules = d.dynamic.filter((x) => U.isThreatRule(x.id)).length;
  console.log("after refresh: list+kept rules", listRules, "threat rules", threatRules);
  assert(threatRules > 0, "threat rules installed");
  await U.applyEnabled(d, false);
  console.log("after off: list+kept", d.dynamic.filter((x) => U.isOurRule(x.id)).length);
  const res = await U.applyEnabled(d, true);
  const after = d.dynamic.filter((x) => U.isOurRule(x.id)).length;
  console.log("after on:", JSON.stringify(res), "list+kept rules", after);
  // A later automatic refresh with lists not yet expired does not repair it:
  d.t += 13 * 3600 * 1000;
  const r2 = await U.refresh(d, {});
  console.log("next auto refresh:", JSON.stringify(r2), "list+kept rules", d.dynamic.filter((x) => U.isOurRule(x.id)).length);
  d.fetch = async (url, init) => ({ ok: false, status: 304, headers: new Headers() });
  const r3 = await U.refresh(d, { manual: true });
  console.log("manual Update lists (server 304):", JSON.stringify(r3), "list+kept rules", d.dynamic.filter((x) => U.isOurRule(x.id)).length);
  assert(after === listRules, "expected " + listRules + " list rules after on, got " + after);
});
