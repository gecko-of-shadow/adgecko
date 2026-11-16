// A generic hide rule that starts at html, :root, body or "&" (the nesting
// selector, :root at the top level) and whose later parts have no own class,
// id or attribute hides the whole page on every site that has the class.
// Namespace prefixes ("*|html") must not hide the type either.
import cosSource from "../src/general/cosmetic-parse.js" with { type: "text" };
function assert(c, l) { if (!c) throw new Error(l); }
const CP = new Function("self", `${cosSource}\nreturn self.GeneralCosmeticParse;`)({});

Deno.test("unscoped guard: page-hiding forms with html, :root, & or a namespace are dropped", () => {
  const bad = [
    "html:has(.adsbygoogle) > *",
    ":root:has(.adsbygoogle) > *",
    "&:has(.adsbygoogle)",
    "*|html:has(.adsbygoogle)",
    "*|body:has(.adsbygoogle)",
    "body:has(.adsbygoogle) > *",
    "html:has(.x) *",
    "svg|html:has(.x)",
  ];
  const parsed = CP.parseCosmetic(["##.ad", ...bad.map((s) => "##" + s)].join("\n"));
  const leaked = parsed.generic.filter((s) => s !== ".ad");
  assert(leaked.length === 0, "page-hiding generic selectors kept: " + JSON.stringify(leaked));
});

Deno.test("unscoped guard: scoped forms stay", () => {
  const good = [".ad *", "div:has(.x) > *", "html .ad-slot", "html:has(.x) > .ad", ":root .banner > *", "body > div.ad", "a[href*=\"a|b\"]", "html.x-page .ad"];
  const parsed = CP.parseCosmetic(good.map((s) => "##" + s).join("\n"));
  const lost = good.filter((s) => !parsed.generic.includes(s));
  assert(lost.length === 0, "scoped generic selectors dropped: " + JSON.stringify(lost));
});
