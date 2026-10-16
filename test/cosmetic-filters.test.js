import cosSource from "../src/general/cosmetic-parse.js" with { type: "text" };
import contentSource from "../src/cosmetic.js" with { type: "text" };
import bundle from "../src/rules/cosmetic-rules.json" with { type: "json" };
function assert(c, l) { if (!c) throw new Error(l); }
const P = new Function("self", `${cosSource}\nreturn self.GeneralCosmeticParse;`)({});

Deno.test("parses generic, site, multi-site, ~exclusions, exceptions, any-TLD", () => {
  const d = P.parseCosmetic([
    "##.ad-box", "xhamster.com##.wio-xbanner", "a.com,b.com##.sponsor", "~news.com##.banner",
    "news.com##.banner-site", "news.com#@#.ad-box", "#@#.ad-safe", "##.ad-safe", "xhamster3.*##.thumb-list__item[role=\"button\"]",
    "twitch.tv##.should-skip", "foo.com#?#div:has(> .ad)", "foo.com#?#div:has-text(Ad)", "foo.com##+js(nobab)", "foo.com##div:style(color:red)",
  ].join("\n"));
  assert(d.generic.includes(".ad-box") && d.generic.includes(".banner") && !d.generic.includes(".ad-safe"), "generic + generic exception " + d.generic);
  assert(d.sites["xhamster.com"][0] === ".wio-xbanner" && d.sites["a.com"] && d.sites["b.com"], "site rules");
  assert(d.exceptions["news.com"].includes(".ad-box") && d.exceptions["news.com"].includes(".banner"), "exceptions");
  assert(d.sites["xhamster3.*"], "any-TLD entry");
  assert(!d.sites["twitch.tv"], "stream sites skipped");
  assert(d.sites["foo.com"].length === 1 && d.sites["foo.com"][0] === "div:has(> .ad)", "only native-CSS procedural kept");
});

Deno.test("page CSS: host + parents + any-TLD, exceptions subtract from generic and site", () => {
  const d = P.parseCosmetic(["##.ad-box", "##.banner", "xhamster3.*##.x3", "news.com##.n", "news.com#@#.ad-box", "news.com#@#.n"].join("\n"));
  const st = P.toStorage(d);
  const pick = (host) => Object.fromEntries(P.keysForHost(host).filter((k) => k in st).map((k) => [k, st[k]]));
  const css = P.buildPageCss("www.news.com", pick("www.news.com"));
  assert(!css.includes(".ad-box{") && css.includes(".banner{display:none!important}") && !css.includes(".n{"), css);
  assert(P.buildPageCss("m.xhamster3.com", pick("m.xhamster3.com")).includes(".x3{"), "any-TLD match");
  assert(!P.buildPageCss("other.com", pick("other.com")).includes(".x3{"), "no leak");
});

Deno.test("security: selectors cannot break out of the rule or inject at-rules", () => {
  const evil = ["a}body{background:url(x)", ".x{color:red}", "div/*", "*/ a", "@import url(x)", "a\u0000b", "a[href=\"x\"", "a)", ":has(", "a,", "> a",
    ".a\\", "div:-abp-has(.x)", "a:has-text(x)", "+js(foo)", "x".repeat(700)];
  for (const s of evil) assert(P.sanitizeSelector(s) === "", "rejected: " + s);
  for (const s of [".ad", "#a > .b", 'a[href*="}"]'.replace("}", "x"), "div:has(> .ad)", ".\\31 23", "a[title='x,y']"]) assert(P.sanitizeSelector(s) === s, "kept: " + s);
  const d = P.parseCosmetic(["example.com##a}body{display:none", "example.com##@media print", "evil.com\u0000##.x"].join("\n"));
  assert(!Object.keys(d.sites).length, "nothing stored from bad rules");
  for (const sel of bundle.generic.concat(...Object.values(bundle.sites))) assert(!/[{}]|\/\*|@/.test(sel), "bundle clean: " + sel);
  assert(!/\beval\(|new Function|innerHTML|insertAdjacentHTML|document\.write/.test(cosSource + contentSource), "no code eval/HTML injection");
});

Deno.test("each selector is its own rule, so one invalid selector cannot hide the rest", () => {
  const css = P.cssForSelectors([".ok", "div:unknown-pseudo", ".ok2"]);
  assert(css.split("\n").filter(Boolean).length === 3 && css.split("\n").every((l) => !l || l.endsWith("{display:none!important}")), css);
});

Deno.test("bundled snapshot: xhamster promo rules present, stream sites absent", () => {
  assert(bundle.sites["xhamster.com"].includes(".wio-xbanner"), "xhamster banner");
  assert(bundle.sites["xhamster.com"].includes(".thumb-list__item[role=\"button\"]") || bundle.sites["xhamster3.*"], "promo tiles");
  for (const h of Object.keys(bundle.sites)) assert(!/(^|\.)(twitch\.tv|youtube\.com|kick\.com)$/.test(h), "stream host " + h);
});

Deno.test("perf + size numbers", () => {
  const st = P.toStorage(bundle);
  const bytes = new TextEncoder().encode(JSON.stringify(st)).length;
  const pick = (host) => Object.fromEntries(P.keysForHost(host).filter((k) => k in st).map((k) => [k, st[k]]));
  const page = pick("xhamster.com");
  let t = performance.now();
  for (let i = 0; i < 100; i++) P.buildPageCss("xhamster.com", page);
  const build = (performance.now() - t) / 100;
  const exc = Object.keys(bundle.exceptions)[0];
  const pe = pick(exc);
  t = performance.now();
  for (let i = 0; i < 20; i++) P.buildPageCss(exc, pe);
  const buildExc = (performance.now() - t) / 20;
  const readBytes = new TextEncoder().encode(JSON.stringify(page)).length;
  console.log(JSON.stringify({ storageKeys: Object.keys(st).length, storageMB: +(bytes / 1e6).toFixed(2), perPageReadKB: +(readBytes / 1e3).toFixed(0), buildMs: +build.toFixed(3), buildWithExceptionsMs: +buildExc.toFixed(2) }));
  assert(build < 5 && buildExc < 15, "fast build");
  assert(bytes < 3e6, "storage under 3 MB");
});
