// Generic (all-sites) hide rules that can hide <html>/<body>/:root or every
// element must be dropped, even when written as a selector list or with a
// class hidden inside :has()/:is() or a hyphen inside :lang().
import cosSource from "../src/general/cosmetic-parse.js" with { type: "text" };
function assert(c, l) { if (!c) throw new Error(l); }
const CP = new Function("self", `${cosSource}\nreturn self.GeneralCosmeticParse;`)({});

Deno.test("generic unscoped guard: selector lists and :has/:is/:lang forms do not bypass it", () => {
  const bad = ["##.ad, body", "##*:lang(en-us)", "##:root:not(.x), .y", "##body:has(.x)", "##html:is(.a, html)"];
  const parsed = CP.parseCosmetic(["##.ad", ...bad].join("\n"));
  const leaked = parsed.generic.filter((s) => s !== ".ad");
  assert(leaked.length === 0, "page-hiding generic selectors kept: " + JSON.stringify(leaked));
  assert(parsed.generic.includes(".ad"), "scoped generic rule must stay");
});

Deno.test("generic unscoped guard: scoped :is/:where lists and quoted attribute values are kept", () => {
  const good = ["div:is(.ad,.banner)", ":is(.ad-a,.ad-b)", ":where(.ad)", "div:where(#ad)", "a:matches([href*=ads])",
    "div:-webkit-any(.ad)", 'a[title="x :root"]', 'a[href*="a, body"]'];
  const parsed = CP.parseCosmetic(good.map((s) => "##" + s).join("\n"));
  const lost = good.filter((s) => !parsed.generic.includes(s));
  assert(lost.length === 0, "scoped generic selectors dropped: " + JSON.stringify(lost));
  const bad = ["div:is(.ad, span)", ":where(html)", "div:not(.ad)"];
  for (const s of bad) assert(CP.isUnscopedSelector(s), "unscoped selector kept: " + s);
});
