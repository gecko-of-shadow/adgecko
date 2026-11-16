import "src/settings/features.js";
import "src/general/cosmetic-parse.js";
import source from "src/cosmetic.js" with { type: "text" };
const F = globalThis.GeckoFeatures;
const P = globalThis.GeneralCosmeticParse;
const install = new Function(`${source}\nreturn installCosmeticHide;`)();
function run(settings, overrides, host) {
  const mirror = F.legacyMirror(settings, overrides);
  const stored = { settings, siteOverrides: overrides, ...mirror, cosMeta: { source: "refresh" }, cosG: ".ad-box", ["cosS:" + host]: [".site-ad"] };
  const api = { hostname: host, href: "https://" + host + "/", isTop: true, parse: P };
  install(api);
  return api.applyState({ stored, enabled: stored.generalEnabled, allowedOrigins: stored.generalAllowedOrigins }).then((r) => ({ applied: r, resolvedCosmetic: F.resolve(settings, overrides, host).cosmetic }));
}
Deno.test("global: lists off, hide ad boxes on", async () => {
  const r = await run({ v: 1, enabled: true, features: { network: false, cosmetic: true } }, {}, "news.example");
  console.log("global network off:", r);
  if (r.resolvedCosmetic && !r.applied) throw new Error("cosmetic feature is ON but the content script hides nothing");
});
Deno.test("site: network off for one site, cosmetic left on", async () => {
  const r = await run({ v: 1, enabled: true, features: {} }, { "shop.example": { features: { network: false, cosmetic: true } } }, "shop.example");
  console.log("site network off:", r);
  if (r.resolvedCosmetic && !r.applied) throw new Error("per-site: cosmetic resolves ON but hides nothing");
});
