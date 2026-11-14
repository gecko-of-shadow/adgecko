// Final review #2 (0.3.5): AdGuard Base became a REQUIRED hide-rule source
// (cosmetic: "sites"), so when filters.adtidy.org was unreachable (or its
// first copy was rejected) after the 0.3.4 -> 0.3.5 upgrade, writeCosmetic
// never ran and the install kept the hide sheet the 0.3.4 parser built.
// Fix (update.js refresh): only `cosmetic: true` sources (EasyList,
// EasyPrivacy) are required; a "sites" source without a current parsed copy
// adds an empty part, and its stored part is used when it has one.
import "../src/general/filter-options.js";
import "../src/general/never-block-captcha.js";
import source from "../src/general/update.js" with { type: "text" };
import cosSource from "../src/general/cosmetic-parse.js" with { type: "text" };
import bundled from "../src/rules/general-network.json" with { type: "json" };
import mergeMeta from "../src/rules/dnr-merge-meta.json" with { type: "json" };

function assert(c, l) { if (!c) throw new Error(l); }
const U = {};
new Function(`${source}\nreturn installGeneralAdblockUpdate;`)()(U);
const CP = new Function("self", `${cosSource}\nreturn self.GeneralCosmeticParse;`)({});

function makeDeps(bodies, seedState) {
  const state = seedState || {}; let dynamic = []; const cosmetic = []; const data = {};
  return {
    cosmetic, data, state, t: 1e12,
    now() { return this.t; },
    getState: async () => JSON.parse(JSON.stringify(state)),
    setState: async (p) => Object.assign(state, p),
    fetch: async (url) => {
      const body = bodies(url);
      if (body === null) throw new TypeError("Failed to fetch");
      return { ok: true, status: 200, headers: { get: () => "" }, text: async () => body };
    },
    loadBundled: async () => ({ rules: bundled, extraIds: [mergeMeta.extra_tracker_rule_id] }),
    getDynamicRules: async () => dynamic,
    updateDynamicRules: async ({ removeRuleIds, addRules }) => {
      dynamic = dynamic.filter((r) => !removeRuleIds.includes(r.id)).concat(addRules);
    },
    setStaticEnabled: async () => {},
    getListData: async (names) => Object.fromEntries(names.filter((n) => data[n]).map((n) => [n, data[n]])),
    setListData: async (n, p) => { data[n] = p; },
    removeListData: async (names) => { for (const n of names) delete data[n]; },
    enabled: () => true,
    cosmeticParse: CP,
    writeCosmetic: async (d, meta) => { cosmetic.push({ d, meta }); },
  };
}

function bigList(prefix, extra) {
  const lines = [];
  for (let i = 0; i < 30000; i++) lines.push("||" + prefix + i + ".example^");
  return lines.concat(extra || []).join("\n");
}
const BODIES = {
  easylist: bigList("el", ["example.com##.from-easylist"]),
  easyprivacy: bigList("ep", ["example.com##.from-easyprivacy"]),
  adguard_base: bigList("ag", ["example.com##.from-adguard"]),
};
const bodyFor = (offline) => (url) => {
  for (const [name, body] of Object.entries(BODIES)) {
    const src = U.SOURCES.find((s) => s.name === name);
    if (url === src.url || (src.mirrors || []).includes(url)) return offline.includes(name) ? null : body;
  }
  return bigList("other" + url.length);
};

Deno.test("#2: upgrade from 0.3.4 with filters.adtidy.org unreachable still writes the new hide sheet", async () => {
  // 0.3.4-like state: parser-3 metas for every list (all refetched).
  const lists = {};
  for (const s of U.SOURCES) lists[s.name] = { url: s.url, fetchedAt: 1, expiresMs: 86400000, count: 2, parser: 3, cosmetic: !!s.cosmetic };
  const d = makeDeps(bodyFor(["adguard_base"]), { lists, dynamicActive: true });
  for (const s of U.SOURCES) d.data[s.name] = { domains: ["old.example"], scoped: [], parser: 3 };
  const r = await U.refresh(d, { manual: true });
  assert(r.ok, JSON.stringify(r));
  assert(d.state.lastErrors && d.state.lastErrors.adguard_base, "AdGuard error recorded: " + JSON.stringify(d.state.lastErrors));
  assert(d.cosmetic.length === 1, "hide sheet written without AdGuard: " + d.cosmetic.length);
  const site = d.cosmetic[0].d.sites["example.com"] || [];
  assert(site.includes(".from-easylist") && site.includes(".from-easyprivacy"), JSON.stringify(site));
  assert(!site.includes(".from-adguard"), "no AdGuard part: " + JSON.stringify(site));
  assert(d.cosmetic[0].meta && d.cosmetic[0].meta.source === "refresh", "refresh sheet");
});

Deno.test("#2: a later AdGuard failure keeps its stored part in the sheet", async () => {
  let offline = [];
  const d = makeDeps((url) => bodyFor(offline)(url));
  assert((await U.refresh(d, { manual: true })).ok, "first run");
  assert(d.cosmetic.length === 1, "first sheet");
  offline = ["adguard_base"];
  d.t += 1;
  assert((await U.refresh(d, { manual: true })).ok, "second run");
  assert(d.cosmetic.length === 2, "second sheet: " + d.cosmetic.length);
  const site = d.cosmetic[1].d.sites["example.com"] || [];
  for (const s of [".from-easylist", ".from-easyprivacy", ".from-adguard"]) assert(site.includes(s), s + " missing: " + JSON.stringify(site));
});

Deno.test("#2: EasyList is still required (no sheet from EasyPrivacy alone)", async () => {
  const d = makeDeps(bodyFor(["easylist"]));
  assert((await U.refresh(d, { manual: true })).ok, "run");
  assert(d.cosmetic.length === 0, "a sheet without EasyList: " + d.cosmetic.length);
});
