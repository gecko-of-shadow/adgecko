// Finder claim: with the ad-lists switch off (deps.enabled() false) a list
// refresh still downloads and stores the threat lists, but returns
// "lists off; cached" before swap(), the only refresh path that calls
// applyThreatRules. The refreshed threat rules (600000 range) are never
// rebuilt. docs/threat-tier.md "Switches": the lists switch does not touch
// the threat tier, so a refresh must still install refreshed threat rules.
import "../src/general/filter-options.js";
import "../src/threat/psl.js";
import "../src/general/never-block-captcha.js";
import "../src/threat/protected-hosts.js";
import "../src/threat/compile.js";
import updateSource from "../src/general/update.js" with { type: "text" };
import bundled from "../src/rules/general-network.json" with { type: "json" };
import mergeMeta from "../src/rules/dnr-merge-meta.json" with { type: "json" };
import packedThreat from "../src/rules/threat-network.json" with { type: "json" };
function assert(c, l) { if (!c) throw new Error(l); }

const U = {};
new Function(`${updateSource}\nreturn installGeneralAdblockUpdate;`)()(U);

// Threat list bodies use hosts the packed threat ruleset already holds, so the
// per-refresh cap on new threat hosts never holds the rebuild.
const packedThreatHosts = packedThreat.flatMap((r) => r.condition.requestDomains || []);
const THREAT_BODY = {
  urlhaus_hosts: packedThreatHosts.slice(0, 600),
  ublock_badware: packedThreatHosts.slice(600, 1800),
  dandelion_antimalware: packedThreatHosts.slice(1800, 3800),
};
function bodyFor(url) {
  const src = U.SOURCES.find((s) => s.url === url || (s.mirrors || []).includes(url));
  const hosts = src && THREAT_BODY[src.name];
  if (hosts) return "! Expires: 4 days\n" + hosts.map((h) => "||" + h + "^").join("\n");
  const tag = new URL(url).pathname.replace(/[^a-z0-9]/gi, "").slice(-12);
  return "! Expires: 4 days\n" + Array.from({ length: 30000 }, (_, i) => `||${tag}${i}.example.com^`).join("\n");
}

function deps({ listsOn }) {
  const state = {};
  const data = {};
  let dynamic = [];
  return {
    get dynamic() { return dynamic; },
    data,
    exclusive: async (fn) => fn(),
    fetch: async (url) => new Response(bodyFor(url), { headers: { ETag: '"e"' } }),
    now: () => 1e12,
    getState: async () => structuredClone(state),
    setState: async (p) => Object.assign(state, structuredClone(p)),
    getListData: async (names) => Object.fromEntries(names.filter((n) => data[n]).map((n) => [n, structuredClone(data[n])])),
    setListData: async (name, payload) => { data[name] = structuredClone(payload); },
    removeListData: async (names) => { for (const n of names) delete data[n]; },
    getDynamicRules: async () => dynamic.slice(),
    updateDynamicRules: async ({ removeRuleIds, addRules }) => {
      dynamic = dynamic.filter((r) => !removeRuleIds.includes(r.id)).concat(addRules);
    },
    setStaticEnabled: async () => {},
    loadBundled: async () => ({ rules: bundled, extraIds: [mergeMeta.extra_tracker_rule_id] }),
    loadPackedThreatRules: async () => packedThreat,
    enabled: () => listsOn,
    threatEnabled: () => true,
  };
}

Deno.test("control: with the lists on, a refresh installs refreshed threat rules", async () => {
  const d = deps({ listsOn: true });
  const r = await U.refresh(d, { manual: true });
  assert(r.ok, JSON.stringify(r));
  const threat = d.dynamic.filter((x) => U.isThreatRule(x.id));
  assert(threat.length > 0, "lists on: threat rules " + threat.length);
});

Deno.test("lists switch off, threat tier on: a refresh still rebuilds the refreshed threat rules", async () => {
  const d = deps({ listsOn: false });
  const r = await U.refresh(d, { manual: true });
  assert(r.ok, JSON.stringify(r));
  assert(d.data.urlhaus_hosts && d.data.urlhaus_hosts.domains.length > 0, "threat list downloaded and stored");
  // Lists off: no ad-list rules are added.
  const listRules = d.dynamic.filter((x) => U.isOurRule(x.id));
  assert(listRules.length === 0, "list rules added with the lists off: " + listRules.length);
  const threat = d.dynamic.filter((x) => U.isThreatRule(x.id));
  assert(threat.length > 0, `lists off: refresh returned ${JSON.stringify(r)} but installed ${threat.length} refreshed threat rules (urlhaus_hosts stored with ${d.data.urlhaus_hosts.domains.length} hosts)`);
});
