// Nightly verification: switching the threat tier off and on (removeThreatRules
// then rebuildThreatRules) must restore a refreshed threat set that was already
// accepted after a confirmed jump, not hold it again against the packed set.
import "../src/general/filter-options.js";
import "../src/threat/psl.js";
import "../src/general/never-block-captcha.js";
import "../src/threat/protected-hosts.js";
import "../src/threat/compile.js";
import updateSource from "../src/general/update.js" with { type: "text" };
function assert(c, l) { if (!c) throw new Error(l); }
const U = {};
new Function(`${updateSource}\nreturn installGeneralAdblockUpdate;`)()(U);

const hostsN = (n, tag) => Array.from({ length: n }, (_, i) => `h${i}-${tag}.example`);

Deno.test("threat tier off/on keeps an accepted refreshed threat set", async () => {
  const packed = hostsN(1000, "a");
  const refreshed = packed.concat(hostsN(400, "b"));
  let dynamic = [];
  const state = {};
  const listData = {};
  let clock = 0;
  const d = {
    getDynamicRules: async () => dynamic.slice(),
    updateDynamicRules: async ({ removeRuleIds, addRules }) => { dynamic = dynamic.filter((r) => !removeRuleIds.includes(r.id)).concat(addRules); },
    getState: async () => structuredClone(state),
    setState: async (p) => Object.assign(state, structuredClone(p)),
    getListData: async (names) => Object.fromEntries(names.filter((n) => listData[n]).map((n) => [n, structuredClone(listData[n])])),
    threatEnabled: () => true,
    loadPackedThreatRules: async () => [{ id: 1, condition: { requestDomains: packed } }],
    now: () => ++clock,
  };
  const threatHosts = () => dynamic.filter((r) => U.isThreatRule(r.id)).flatMap((r) => r.condition.requestDomains);
  const payload = { domains: refreshed, scoped: [], parser: U.PARSER_VERSION };
  listData.urlhaus_hosts = payload;
  state.lists = { urlhaus_hosts: { parser: U.PARSER_VERSION, count: refreshed.length, fetchedAt: 1 } };

  let r = await U.applyThreatRules(d, { urlhaus_hosts: payload }, d.now(), { downloaded: true });
  assert(r.held, "first refresh held: " + JSON.stringify(r));
  r = await U.applyThreatRules(d, { urlhaus_hosts: payload }, d.now(), { downloaded: true });
  assert(r.ok && threatHosts().length === 1400, "second download confirms: " + JSON.stringify(r));

  // Threat tier (or master switch) off, then on.
  await U.removeThreatRules(d);
  r = await U.rebuildThreatRules(d);
  assert(r.ok && threatHosts().length === 1400,
    "accepted refreshed threat set lost after off/on: " + JSON.stringify(r) + " dynamic threat hosts=" + threatHosts().length);
});
