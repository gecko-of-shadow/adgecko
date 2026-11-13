import "../src/settings/features.js";
import cosSource from "../src/general/cosmetic-parse.js" with { type: "text" };

const P = new Function("self", `${cosSource}\nreturn self.GeneralCosmeticParse;`)({});

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

Deno.test("one Unicode host on a line does not drop the rule for the ASCII hosts", () => {
  const parsed = P.parseCosmetic("news.com,bücher.de##.promo");
  const stored = P.toStorage(parsed, {});
  const css = P.buildPageCss("news.com", stored, "");
  assert(css.includes(".promo{display:none!important}"),
    `news.com lost its .promo hide; stats=${JSON.stringify(parsed.stats)} sites=${JSON.stringify(parsed.sites)}`);
});

Deno.test("a Unicode host rule applies on the punycode page host", () => {
  const parsed = P.parseCosmetic("bücher.de##.ad");
  const stored = P.toStorage(parsed, {});
  // location.hostname for https://bücher.de/ is the punycode form.
  const pageHost = new URL("https://bücher.de/").hostname;
  assert(pageHost === "xn--bcher-kva.de", `unexpected page host ${pageHost}`);
  const css = P.buildPageCss(pageHost, stored, "");
  assert(css.includes(".ad{display:none!important}"),
    `bücher.de rule not applied on ${pageHost}; stats=${JSON.stringify(parsed.stats)} sites=${JSON.stringify(parsed.sites)}`);
});
