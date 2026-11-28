// The stored-rules hide sheet is built with up to 50 selectors per rule
// (buildPageCss group size). Chrome for Testing 155 parses the 13,635 packed
// generics in 1.7 ms that way instead of 4.8 ms (535 KB -> 214 KB of CSS).
// A selector Chrome does not know drops its whole rule, so the content script
// splits such a rule back into single-selector rules: the other 49 selectors
// keep hiding.
import "../src/settings/features.js";
import "../src/general/cosmetic-parse.js";
import source from "../src/cosmetic.js" with { type: "text" };
import bundle from "../src/rules/cosmetic-rules.json" with { type: "json" };

function assert(c, l) { if (!c) throw new Error(l); }
const P = globalThis.GeneralCosmeticParse;
const install = new Function(`${source}\nreturn installCosmeticHide;`)();
const expand = (css) => css.split(P.GROUP_SEP).join(P.HIDE + "\n");

Deno.test("grouped page CSS holds the same rules as one rule per selector, in order, with exceptions applied", () => {
  const st = P.toStorage(bundle);
  for (const host of ["xhamster.com", Object.keys(bundle.exceptions)[0], "news.example"]) {
    const pick = Object.fromEntries(P.keysForHost(host).filter((k) => k in st).map((k) => [k, st[k]]));
    const plain = P.buildPageCss(host, pick);
    const grouped = P.buildPageCss(host, pick, "", 50);
    assert(expand(grouped) === plain, host + ": grouped CSS differs from the plain CSS");
    const lines = grouped.split("\n").filter(Boolean);
    assert(lines.every((l) => l.endsWith(P.HIDE) && l.split(P.GROUP_SEP).length <= 50), host + ": a rule holds more than 50 selectors");
    assert(grouped.length < plain.length * 0.5, host + ": grouped CSS is not smaller: " + grouped.length + " vs " + plain.length);
  }
  assert(P.cssForSelectors([".a", ".b", ".c"], null, 2) === ".a,\t.b" + P.HIDE + "\n.c" + P.HIDE + "\n", "groups of 2");
  assert(P.cssForSelectors([".a", ".b"], new Set([".a", ".b"]), 2) === "", "all skipped: empty");
  assert(P.cssForSelectors([".ok", "div:unknown-pseudo"]) === ".ok" + P.HIDE + "\ndiv:unknown-pseudo" + P.HIDE + "\n", "no group: one rule per selector");
});

// A sheet that knows every selector except ones with ":bad-" (as Chrome drops
// a rule whose selector list holds one unknown selector).
class ParsingSheet {
  constructor() { this.cssRules = []; this.writes = 0; }
  replaceSync(t) { this.writes += 1; this.cssRules = t.split("\n").filter((l) => l && !l.includes(":bad-")); }
  insertRule(r, i) { if (r.includes(":bad-")) throw new SyntaxError("bad selector"); this.cssRules.splice(i, 0, r); return i; }
}

async function applyWith(stored) {
  const prev = { document: globalThis.document, window: globalThis.window, CSSStyleSheet: globalThis.CSSStyleSheet, MutationObserver: globalThis.MutationObserver };
  const doc = { readyState: "complete", adoptedStyleSheets: [], documentElement: { appendChild() {} }, getElementById: () => null, addEventListener() {} };
  globalThis.document = doc;
  globalThis.window = { addEventListener() {} };
  globalThis.CSSStyleSheet = ParsingSheet;
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  try {
    const api = { hostname: "news.example", href: "https://news.example/", isTop: true, parse: P };
    install(api);
    assert(await api.applyState({ stored, enabled: true, allowedOrigins: [] }) === true, "applied");
    return doc.adoptedStyleSheets[0];
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete globalThis[k];
      else globalThis[k] = v;
    }
  }
}

Deno.test("grouped sheet: a rule dropped for one unknown selector is split, the other selectors still hide", async () => {
  const sels = Array.from({ length: 120 }, (_, i) => ".ad-" + i);
  sels.splice(60, 0, "div:bad-pseudo");
  const sheet = await applyWith({ cosMeta: { source: "refresh" }, cosG: sels.join("\n"), "cosS:news.example": [".site-ad"] });
  const text = sheet.cssRules.join("\n");
  for (const s of [".ad-0", ".ad-49", ".ad-50", ".ad-59", ".ad-60", ".ad-98", ".ad-119", ".site-ad"]) {
    assert(new RegExp("(^|[\\s,])" + s.replace(".", "\\.") + "(,|\\{)").test(text), s + " not hidden: " + text.slice(0, 300));
  }
  assert(!text.includes(":bad-"), "the unknown selector is left out");
  // 121 generics in groups of 50, 50, 21 + 1 site rule; the middle group is
  // split into its 49 known selectors.
  assert(sheet.cssRules.length === 2 + 49 + 1, "rules: " + sheet.cssRules.length);
});

Deno.test("grouped sheet: with every selector known, one parse and one rule per group", async () => {
  const sels = Array.from({ length: 120 }, (_, i) => ".ad-" + i);
  const sheet = await applyWith({ cosMeta: { source: "refresh" }, cosG: sels.join("\n") });
  assert(sheet.writes === 1 && sheet.cssRules.length === 3, "writes " + sheet.writes + ", rules " + sheet.cssRules.length);
});
