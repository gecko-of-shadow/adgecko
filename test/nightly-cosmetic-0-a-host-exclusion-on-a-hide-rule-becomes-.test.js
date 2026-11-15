// A "~host" exclusion on a hide rule only means "this rule does not apply on
// host". It must not cancel a separate unconditional generic rule, or a
// separate site rule, that hides the same selector there (unlike "#@#").
import "../src/settings/features.js";
import cosSource from "../src/general/cosmetic-parse.js" with { type: "text" };
function assert(c, l) { if (!c) throw new Error(l); }
const P = new Function("self", `${cosSource}\nreturn self.GeneralCosmeticParse;`)({});

function pageCss(text, host) {
  const st = P.toStorage(P.parseCosmetic(text));
  const pick = Object.fromEntries(P.keysForHost(host).filter((k) => k in st).map((k) => [k, st[k]]));
  return P.buildPageCss(host, pick);
}

Deno.test("~host exclusion does not cancel an unconditional generic rule with the same selector", () => {
  const css = pageCss("##.ad-banner\nfoo.com,~shop.foo.com##.ad-banner", "shop.foo.com");
  assert(css.includes(".ad-banner{display:none!important}"), "generic .ad-banner cancelled on shop.foo.com: " + JSON.stringify(css));
});

Deno.test("generic ~host exclusion does not cancel another generic rule with the same selector", () => {
  const css = pageCss("##.sponsored\n~news.com##.sponsored", "news.com");
  assert(css.includes(".sponsored{display:none!important}"), "generic .sponsored cancelled on news.com: " + JSON.stringify(css));
});

Deno.test("~host exclusion does not cancel a site rule for that host", () => {
  const css = pageCss("shop.foo.com##.ad-banner\nfoo.com,~shop.foo.com##.ad-banner", "shop.foo.com");
  assert(css.includes(".ad-banner{display:none!important}"), "site rule cancelled on shop.foo.com: " + JSON.stringify(css));
});

Deno.test("control: the excluded rule alone still does not apply on the excluded host", () => {
  assert(!pageCss("~news.com##.sponsored", "news.com").includes(".sponsored{"), "exclusion not honoured");
  assert(pageCss("~news.com##.sponsored", "other.com").includes(".sponsored{"), "generic rule missing elsewhere");
});
