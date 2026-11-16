// Scratch: an expired list must be refetched by an automatic (alarm) refresh.
// Runs refresh() from src/general/update.js once as shipped and once with the
// M5 mutant (listDue never true for an expired list). No repo test kills M5.
import "src/general/filter-options.js";
import "src/general/never-block-captcha.js";
import "src/threat/psl.js";
const src = Deno.readTextFileSync("src/general/update.js");
const MUT_OLD = "    return now - meta.fetchedAt >= (meta.expiresMs || DEFAULT_EXPIRES_MS);";

async function fetchesOnAlarm(source) {
  const U = {};
  new Function(`${source}\nreturn installGeneralAdblockUpdate;`)()(U);
  const now = 1e12;
  const DAY = 86400000;
  const lists = {};
  const data = {};
  for (const s of U.SOURCES) {
    lists[s.name] = { url: s.url, etag: '"x"', fetchedAt: now - 10 * DAY, expiresMs: 4 * DAY, count: 1, parser: U.PARSER_VERSION };
    data[s.name] = { domains: ["ads-" + s.name + ".example"], scoped: [], parser: U.PARSER_VERSION };
  }
  const state = { schema: 2, lists, dynamicActive: true, lastRunAt: now - 13 * 3600000, lastAttemptAt: now - 13 * 3600000 };
  const fetched = [];
  let dynamic = [];
  const deps = {
    now: () => now,
    fetch: async (url) => { fetched.push(url); return { ok: true, status: 304, headers: new Headers({}), text: async () => "" }; },
    getState: async () => structuredClone(state),
    setState: async (p) => Object.assign(state, structuredClone(p)),
    getListData: async (names) => Object.fromEntries(names.filter((n) => data[n]).map((n) => [n, structuredClone(data[n])])),
    setListData: async () => {}, removeListData: async () => {},
    getDynamicRules: async () => dynamic.slice(),
    updateDynamicRules: async ({ removeRuleIds, addRules }) => { dynamic = dynamic.filter((r) => !removeRuleIds.includes(r.id)).concat(addRules); },
    setStaticEnabled: async () => {}, loadBundled: async () => ({ rules: [], extraIds: [] }),
    enabled: () => true, cosmeticParse: null, writeCosmetic: async () => {},
  };
  const r = await U.refresh(deps, { manual: false });
  return { ran: r && r.ran, fetched: fetched.length, sources: U.SOURCES.length };
}

Deno.test({ name: "alarm refresh refetches expired lists (original vs M5 mutant)", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  if (src.split(MUT_OLD).length !== 2) throw new Error("mutation anchor not found");
  const orig = await fetchesOnAlarm(src);
  const mut = await fetchesOnAlarm(src.replace(MUT_OLD, "    return false;"));
  console.log("original:", JSON.stringify(orig));
  console.log("mutant  :", JSON.stringify(mut));
}});
