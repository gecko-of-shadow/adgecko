// EasyList page exceptions for element hiding: "@@||host^$generichide"
// (also $ghide), "$specifichide" ($shide) and "$elemhide" ($ehide, both).
// A listed page gets no generic hide sheet ($generichide) and, with
// $elemhide, no site hide rules either. The pages read only their own keys.
import "../src/settings/features.js";
import "../src/general/filter-options.js";
import "../src/general/never-block-captcha.js";
import "../src/general/cosmetic-parse.js";
import updateSource from "../src/general/update.js" with { type: "text" };
import bundledNet from "../src/rules/general-network.json" with { type: "json" };
import mergeMeta from "../src/rules/dnr-merge-meta.json" with { type: "json" };

function assert(c, l) { if (!c) throw new Error(l); }
const P = globalThis.GeneralCosmeticParse;
const U = {};
new Function(`${updateSource}\nreturn installGeneralAdblockUpdate;`)()(U);

// What a page gets: only the keys keysForHost names, as chrome.storage returns them.
function pageCss(stored, host, top = true) {
  const pick = {};
  for (const k of P.keysForHost(host, top)) if (k in stored) pick[k] = stored[k];
  if (!top) pick[P.KEY_GENERIC] = "";
  return P.buildPageCss(host, pick);
}

Deno.test("generichide: a listed host and its subdomains get no generic sheet", () => {
  const st = P.toStorage(P.parseCosmetic(["##.ad-banner", "@@||mail.google.com^$generichide", "@@||github.com^$ghide"].join("\n")), {});
  for (const h of ["mail.google.com", "x.mail.google.com", "github.com", "www.github.com"]) {
    assert(pageCss(st, h) === "", h + " must get no generic rules: " + JSON.stringify(pageCss(st, h)));
  }
  assert(pageCss(st, "example.com").includes(".ad-banner{display:none!important}"), "example.com keeps the generic sheet");
  assert(pageCss(st, "google.com").includes(".ad-banner"), "the parent domain keeps the generic sheet");
  assert(pageCss(st, "notgithub.com").includes(".ad-banner"), "a look-alike host keeps the generic sheet");
});

Deno.test("generichide: site rules still apply, and $elemhide removes them too", () => {
  const text = ["##.ad-banner", "github.com##.gh-ad", "docs.example##.doc-ad", "@@||github.com^$generichide", "@@||docs.example^$elemhide"].join("\n");
  const st = P.toStorage(P.parseCosmetic(text), {});
  assert(pageCss(st, "github.com") === ".gh-ad{display:none!important}\n", "generichide keeps the site rules: " + JSON.stringify(pageCss(st, "github.com")));
  assert(pageCss(st, "docs.example") === "", "elemhide removes all hide rules");
  assert(pageCss(st, "docs.example", false) === "", "elemhide also applies in a subframe");
  const sh = P.toStorage(P.parseCosmetic(["##.g", "s.example##.s", "@@||s.example^$specifichide"].join("\n")), {});
  assert(pageCss(sh, "s.example") === ".g{display:none!important}\n", "specifichide removes only the site rules");
});

Deno.test("generichide: the domain= form, localhost and private IP forms", () => {
  const text = [
    "##.ad-banner",
    "@@$generichide,domain=howtogeek.com|screenrant.com|~sub.screenrant.com",
    "@@://localhost/$generichide",
    "@@://192.168.$generichide",
    "@@||127.0.0.1^$generichide",
  ].join("\n");
  const st = P.toStorage(P.parseCosmetic(text), {});
  for (const h of ["howtogeek.com", "www.screenrant.com", "localhost", "192.168.1.1", "192.168.0.254", "127.0.0.1"]) {
    assert(pageCss(st, h) === "", h + " must get no generic rules");
  }
  for (const h of ["example.com", "192.169.1.1", "10.0.0.1", "127.0.0.2"]) { // privacy-check: allow (boundary next to the 192.168. prefix)
    assert(pageCss(st, h).includes(".ad-banner"), h + " keeps the generic sheet");
  }
});

Deno.test("generichide: forms that are not a plain page exception are ignored", () => {
  const text = [
    "##.ad-banner",
    "@@||a.example/path/page.html$generichide", // one page, not the host
    "@@||b.example^$generichide,badfilter", // an unknown option
    "@@/c\\.example/$generichide", // a regex pattern
    "@@||d.example^$generichide,domain=e.example", // pattern and domain=
    "@@*$generichide", // every site
    "@@||f.example^$document", // no hide option
    "||g.example^$generichide", // not an exception
  ].join("\n");
  const parsed = P.parseCosmetic(text);
  assert(Object.keys(parsed.noHide || {}).length === 0, "nothing listed: " + JSON.stringify(parsed.noHide));
  for (const h of ["a.example", "b.example", "c.example", "d.example", "e.example", "f.example", "g.example"]) {
    assert(pageCss(P.toStorage(parsed, {}), h).includes(".ad-banner"), h + " keeps the generic sheet");
  }
});

Deno.test("generichide: an EasyList exception also covers EasyPrivacy generic rules after the merge", () => {
  const easylist = P.parseCosmetic(["##.el-ad", "@@||mail.google.com^$generichide", "@@||x.example^$specifichide"].join("\n"));
  const easyprivacy = P.parseCosmetic(["##.ep-ad", "x.example##.x-ad", "@@||x.example^$generichide"].join("\n"));
  const merged = P.mergeCosmetic([easylist, easyprivacy]);
  // writeCosmetic merges the bundled extras again.
  const st = P.toStorage(P.mergeCosmetic([merged, { generic: [".extra-ad"] }]), {});
  assert(pageCss(st, "mail.google.com") === "", "no generic rule of any list: " + JSON.stringify(pageCss(st, "mail.google.com")));
  assert(pageCss(st, "x.example") === "", "the flags of two lists add up");
  const ex = pageCss(st, "example.com");
  assert(ex.includes(".el-ad") && ex.includes(".ep-ad") && ex.includes(".extra-ad"), "other sites keep every generic rule");
});

Deno.test("generichide: the list guard still accepts the list, and the hosts are capped", () => {
  const lines = ["##.ad-banner"];
  for (let i = 0; i < 200; i++) lines.push(`@@||site${i}.example^$generichide`);
  const parsed = P.parseCosmetic(lines.join("\n"));
  assert(Object.keys(parsed.noHide).length === 200, "200 hosts listed");
  assert(U.checkCosmeticChange(null, parsed) === null, "checkCosmeticChange accepts the list");
  assert(U.checkCosmeticChange({ parser: U.PARSER_VERSION, genericCount: 1 }, parsed) === null, "and against the previous copy");
  const many = [];
  for (let i = 0; i < P.MAX_NO_HIDE_HOSTS + 50; i++) many.push(`@@||h${i}.example^$generichide`);
  const capped = P.parseCosmetic(many.join("\n"));
  assert(Object.keys(capped.noHide).length === P.MAX_NO_HIDE_HOSTS, "the host count is capped");
});

// The upgrade from 0.3.5 (parser 4): the stored list copies have no page
// exceptions. The first refresh must parse every list again, also when the
// lists are not due yet, so the hide sheet gets the exceptions.
Deno.test("generichide: the first refresh after the upgrade writes the page exceptions", async () => {
  const big = (prefix, extra) => {
    const lines = [];
    for (let i = 0; i < 30000; i++) lines.push("||" + prefix + i + ".example^");
    return lines.concat(extra).join("\n");
  };
  const bodies = {
    easylist: big("el", ["##.ad-banner", "@@||mail.google.com^$generichide"]),
    easyprivacy: big("ep", ["##.track-px"]),
  };
  const nameOf = (url) => (U.SOURCES.find((s) => url === s.url || (s.mirrors || []).includes(url)) || {}).name;
  const state = { dynamicActive: true, lists: {} };
  const data = {};
  const written = [];
  for (const s of U.SOURCES) {
    // 0.3.5 state: parser 4, fetched just now, so no list is due by age.
    state.lists[s.name] = { url: s.url, etag: '"' + s.name + '"', fetchedAt: 1e12, expiresMs: 4 * 86400000, count: 30000, parser: 4, cosmetic: !!s.cosmetic, protectedHits: 0, genericCount: 1 };
    data[s.name] = { domains: [s.name + ".example"], scoped: [], parser: 4 };
    if (s.cosmetic) data[s.name].cosmetic = P.parseCosmetic("##.ad-banner");
  }
  let dynamic = [];
  const deps = {
    t: 1e12 + 1000,
    now() { return this.t; },
    getState: async () => JSON.parse(JSON.stringify(state)),
    setState: async (p) => Object.assign(state, p),
    fetch: async (url) => {
      const body = bodies[nameOf(url)] || big("other" + url.length, []);
      return { ok: true, status: 200, headers: { get: () => "" }, text: async () => body };
    },
    loadBundled: async () => ({ rules: bundledNet, extraIds: [mergeMeta.extra_tracker_rule_id] }),
    getDynamicRules: async () => dynamic,
    updateDynamicRules: async ({ removeRuleIds, addRules }) => {
      dynamic = dynamic.filter((r) => !removeRuleIds.includes(r.id)).concat(addRules);
    },
    setStaticEnabled: async () => {},
    getListData: async (names) => Object.fromEntries(names.filter((n) => data[n]).map((n) => [n, data[n]])),
    setListData: async (n, p) => { data[n] = p; },
    removeListData: async (names) => { for (const n of names) delete data[n]; },
    enabled: () => true,
    cosmeticParse: P,
    writeCosmetic: async (d, meta) => { written.push({ d, meta }); },
  };
  await U.refresh(deps, { manual: false });
  assert(written.length === 1, "the hide sheet is written again: " + written.length);
  const st = P.toStorage(P.mergeCosmetic([written[0].d, { generic: [] }]), {});
  assert(st[P.PREFIX_NO_HIDE + "mail.google.com"] === P.NO_HIDE_GENERIC, "the exception is stored");
  assert(pageCss(st, "mail.google.com") === "", "Gmail gets no generic rules");
  assert(pageCss(st, "example.com").includes(".track-px"), "other sites keep the generic sheet");
});
