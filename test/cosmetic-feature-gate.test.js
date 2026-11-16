// "Hide leftover ad boxes" (feature cosmetic) and "Block ads and trackers"
// (feature network) are separate switches. The content script must decide
// from the settings (F.resolve) when they exist, not from the legacy
// generalEnabled / generalAllowedOrigins mirrors of the network feature.
import "../src/settings/features.js";
import "../src/general/cosmetic-parse.js";
import source from "../src/cosmetic.js" with { type: "text" };

function assert(c, l) { if (!c) throw new Error(l); }
const F = globalThis.GeckoFeatures;
const P = globalThis.GeneralCosmeticParse;
const install = new Function(`${source}\nreturn installCosmeticHide;`)();

// The worker writes the mirrors from the settings (legacyMirror), so the
// stored data here is what a real profile holds.
async function run(settings, overrides, host) {
  const mirror = F.legacyMirror(settings, overrides);
  const stored = {
    settings, siteOverrides: overrides, ...mirror,
    cosMeta: { source: "refresh" }, cosG: ".ad-box", ["cosS:" + host]: [".site-ad"],
  };
  const writes = [];
  const prevDoc = globalThis.document;
  let el = null;
  globalThis.document = {
    documentElement: { appendChild(n) { el = n; n.isConnected = true; } },
    createElement() { return { id: "", isConnected: false, set textContent(t) { writes.push(t); }, remove() { this.isConnected = false; el = null; } }; },
    getElementById() { return el; },
  };
  try {
    const api = { hostname: host, href: "https://" + host + "/", isTop: true, parse: P };
    install(api);
    const applied = await api.applyState({ stored, enabled: stored.generalEnabled, allowedOrigins: stored.generalAllowedOrigins });
    return { applied, hasStyle: !!el, css: writes[writes.length - 1] || "" };
  } finally {
    globalThis.document = prevDoc;
  }
}

Deno.test("cosmetic gate: lists off globally, hide ad boxes on -> the style is injected", async () => {
  const r = await run({ v: 1, enabled: true, features: { network: false, cosmetic: true } }, {}, "news.example");
  assert(r.applied === true && r.hasStyle, "cosmetic is on but the style was removed: " + JSON.stringify(r));
  assert(r.css.includes(".ad-box") && r.css.includes(".site-ad"), "generic and site rules apply");
});

Deno.test("cosmetic gate: a site override with network off keeps the style", async () => {
  const r = await run({ v: 1, enabled: true, features: {} }, { "shop.example": { features: { network: false } } }, "shop.example");
  assert(r.applied === true && r.hasStyle, "per-site lists off must not stop hiding: " + JSON.stringify(r));
});

Deno.test("cosmetic gate: a site override enabled:false (Allow this site) removes the style", async () => {
  const r = await run({ v: 1, enabled: true, features: {} }, { "shop.example": { enabled: false } }, "shop.example");
  assert(r.applied === false && !r.hasStyle, "Allow this site must stop hiding: " + JSON.stringify(r));
});

Deno.test("cosmetic gate: the master switch off removes the style", async () => {
  const r = await run({ v: 1, enabled: false, features: {} }, {}, "news.example");
  assert(r.applied === false && !r.hasStyle, "master off must stop hiding: " + JSON.stringify(r));
});

Deno.test("cosmetic gate: the cosmetic feature off removes the style, lists stay on", async () => {
  const r = await run({ v: 1, enabled: true, features: { cosmetic: false } }, {}, "news.example");
  assert(r.applied === false && !r.hasStyle, "cosmetic off must stop hiding: " + JSON.stringify(r));
});

Deno.test("cosmetic gate: before migration (no settings key) the legacy keys still decide", async () => {
  const api = { hostname: "old.example", href: "https://old.example/", isTop: true, parse: P };
  install(api);
  const off = await api.applyState({ stored: { cosMeta: {}, cosG: ".a" }, enabled: false, allowedOrigins: [] });
  assert(off === false, "generalEnabled:false without settings must stop hiding");
  const allowed = await api.applyState({ stored: { cosMeta: {}, cosG: ".a" }, enabled: true, allowedOrigins: ["https://old.example"] });
  assert(allowed === false, "an allowed origin without settings must stop hiding");
});
