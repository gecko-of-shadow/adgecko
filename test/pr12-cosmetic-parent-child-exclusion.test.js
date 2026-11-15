// Two generic hide rules with the same selector: "~example.com##.promo" and
// "~shop.example.com##.promo". Both exclude shop.example.com ("~a.com" also
// covers its subdomains), so .promo must stay visible there. PR #12 review.
import "../src/settings/features.js";
import cosSource from "../src/general/cosmetic-parse.js" with { type: "text" };
function assert(c, l) { if (!c) throw new Error(l); }
const P = new Function("self", `${cosSource}\nreturn self.GeneralCosmeticParse;`)({});

function pageCss(text, host) {
  const st = P.toStorage(P.parseCosmetic(text));
  const pick = Object.fromEntries(P.keysForHost(host).filter((k) => k in st).map((k) => [k, st[k]]));
  return P.buildPageCss(host, pick);
}

for (const text of ["~example.com##.promo\n~shop.example.com##.promo", "~shop.example.com##.promo\n~example.com##.promo"]) {
  Deno.test(`parent + child exclusions keep .promo visible on the child (${JSON.stringify(text)})`, () => {
    assert(!pageCss(text, "shop.example.com").includes(".promo{"), "child host hidden: " + pageCss(text, "shop.example.com"));
  });
  Deno.test(`parent + child exclusions still hide .promo where only one excludes (${JSON.stringify(text)})`, () => {
    assert(pageCss(text, "www.example.com").includes(".promo{"), "www.example.com should be hidden (only ~example.com covers it)");
    assert(pageCss(text, "other.com").includes(".promo{"), "other.com should be hidden");
  });
}

Deno.test("disjoint exclusions still cancel each other", () => {
  const css = pageCss("~a.com##.promo\n~b.com##.promo", "a.com");
  assert(css.includes(".promo{"), "a.com should be hidden by the ~b.com rule");
});
