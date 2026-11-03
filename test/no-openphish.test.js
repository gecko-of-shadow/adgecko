// Owner decision 2026-11-02: no OpenPhish data at all, direct or indirect.
// Curben's phishing-filter (curated from OpenPhish, IPThreat and PhishTank) is
// dropped everywhere. curbengh's urlhaus-filter is URLhaus data and stays.
// CHANGELOG and docs are not scanned: they may say the list was removed.
import updateSource from "../src/general/update.js" with { type: "text" };
import packerSource from "../scripts/pack-filter-lists.py" with { type: "text" };
import licenses from "../src/rules/LICENSES.md" with { type: "text" };
import meta from "../src/rules/meta.json" with { type: "json" };
import manifest from "../manifest.json" with { type: "json" };
function assert(c, l) { if (!c) throw new Error(l); }

const U = {};
new Function(`${updateSource}\nreturn installGeneralAdblockUpdate;`)()(U);
const BANNED = /curben_phishing|phishing-filter|openphish/i;

// The packer's SOURCES block, without the comment that explains the removal.
function packerSources() {
  const start = packerSource.indexOf("SOURCES = OrderedDict(");
  const end = packerSource.indexOf("NEVER_BLOCK_SUFFIXES");
  assert(start > 0 && end > start, "packer SOURCES block found");
  return packerSource.slice(start, end).split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
}

Deno.test("no Curben/OpenPhish source is configured anywhere", () => {
  for (const src of U.SOURCES) {
    assert(!BANNED.test(src.name) && !BANNED.test(src.url), "update.js source " + src.name);
    for (const m of src.mirrors || []) assert(!BANNED.test(m), "mirror " + m);
  }
  assert(!BANNED.test(packerSources()), "packer SOURCES");
  for (const [id, s] of Object.entries(meta.sources)) assert(!BANNED.test(id) && !BANNED.test(s.url || ""), "meta.json source " + id);
  for (const h of manifest.host_permissions) assert(!BANNED.test(h), "manifest host " + h);
  assert(!BANNED.test(licenses), "LICENSES.md");
});

Deno.test("positive control: urlhaus-filter (URLhaus data) is still configured and not caught by the pattern", () => {
  const urlhaus = U.SOURCES.find((s) => s.name === "urlhaus_hosts");
  assert(urlhaus && /urlhaus-filter/.test(urlhaus.url) && !BANNED.test(urlhaus.url), "runtime source");
  assert(meta.sources.urlhaus_hosts && !BANNED.test(meta.sources.urlhaus_hosts.url), "packed source");
  assert(/"urlhaus_hosts"/.test(packerSources()), "packer source");
  assert(manifest.host_permissions.includes("https://malware-filter.gitlab.io/*"), "its host stays");
  assert(/urlhaus/i.test(licenses), "licence entry stays");
  // The pattern itself would catch the dropped list.
  assert(BANNED.test("https://malware-filter.gitlab.io/malware-filter/phishing-filter.txt"), "pattern sanity");
});

function fakeDeps(state, data) {
  const removed = [];
  let dynamic = [{ id: U.LIST_RULE_ID_BASE, priority: 1, action: { type: "block" }, condition: { requestDomains: ["stale-phish.example"] } }];
  let staticOn = false;
  const deps = {
    removed, get dynamic() { return dynamic; }, get staticOn() { return staticOn; },
    now: () => 1e12,
    getState: async () => structuredClone(state),
    setState: async (p) => Object.assign(state, structuredClone(p)),
    getListData: async (names) => Object.fromEntries(names.filter((n) => data[n]).map((n) => [n, structuredClone(data[n])])),
    setListData: async (n, p) => { data[n] = structuredClone(p); },
    removeListData: async (names) => { for (const n of names) { removed.push(n); delete data[n]; } },
    listDataPresent: async (names) => names.filter((n) => data[n]),
    getDynamicRules: async () => dynamic.slice(),
    updateDynamicRules: async ({ removeRuleIds, addRules }) => { dynamic = dynamic.filter((r) => !removeRuleIds.includes(r.id)).concat(addRules); },
    setStaticEnabled: async (on) => { staticOn = on; },
    loadBundled: async () => ({ rules: [], extraIds: [] }),
    enabled: () => true,
  };
  return deps;
}

Deno.test("stale Curben data on an existing install is dropped and its domains stop being blocked", async () => {
  const lists = {};
  const data = {};
  for (const s of U.SOURCES) {
    lists[s.name] = { url: s.url, fetchedAt: 1, expiresMs: 86400000, count: 2, parser: U.PARSER_VERSION };
    data[s.name] = { domains: [s.name.replace(/_/g, "-") + "-a.example", s.name.replace(/_/g, "-") + "-b.example"], scoped: [], parser: U.PARSER_VERSION };
  }
  lists.curben_phishing = { url: "https://malware-filter.gitlab.io/malware-filter/phishing-filter.txt", fetchedAt: 1, count: 1 };
  data.curben_phishing = { domains: ["stale-phish.example"] };
  const state = { schema: 2, dynamicActive: true, lists };
  const d = fakeDeps(state, data);
  const r = await U.applyEnabled(d, true);
  assert(r.ok && r.mode === "dynamic", JSON.stringify(r));
  assert(!state.lists.curben_phishing && !data.curben_phishing && d.removed.includes("curben_phishing"), "metadata and payload removed");
  const blocked = d.dynamic.flatMap((x) => x.condition.requestDomains || []);
  assert(!blocked.includes("stale-phish.example"), "stale domain still blocked");
  assert(blocked.includes("urlhaus-hosts-a.example"), "other lists rebuilt");
  // Idempotent: a second run finds nothing to drop and does not error.
  assert((await U.dropRetiredLists(d, state)).length === 0, "nothing left to drop");
  const again = await U.applyEnabled(d, true);
  assert(again.ok, "second run ok");
});

Deno.test("no stale Curben data: cleanup is a no-op without errors", async () => {
  const d = fakeDeps({ schema: 2, lists: {} }, {});
  assert((await U.dropRetiredLists(d, { lists: {} })).length === 0, "nothing dropped");
  assert(d.removed.length === 0, "no removes");
  // A payload key left behind without metadata is still removed.
  const data = { curben_phishing: { domains: ["x.example"] } };
  const d2 = fakeDeps({ schema: 2, lists: {} }, data);
  assert(JSON.stringify(await U.dropRetiredLists(d2, { lists: {} })) === '["curben_phishing"]' && !data.curben_phishing, "orphan payload removed");
});
