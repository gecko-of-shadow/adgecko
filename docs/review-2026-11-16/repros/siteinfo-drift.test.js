// Scratch: compare the real worker's siteInfo answer with the hand-written
// fake siteInfo copied into test/popup-allow-page.test.js (and
// test/nightly-ui-3-*.test.js, test/final-upgrade-4-*.test.js,
// test/nightly-ui-2-*.test.js). The popup tests run popup.js against the fake.
import "src/settings/features.js";
import { loadWorker, settle } from "test/fixtures/fake-chrome-worker.js";

const F = globalThis.GeckoFeatures;
// Verbatim logic of the fake in test/popup-allow-page.test.js:99-108 (non-limited path).
function fakeSiteInfo(storage, origin) {
  const host = new URL(origin).hostname;
  const o = storage.siteOverrides || {};
  const stream = F.isStreamHost(host);
  const features = F.FEATURES.filter((f) => f.sites.includes("all") || (f.sites.includes("ordinary") ? !stream : f.sites.some((d) => host === d || host.endsWith("." + d))))
    .map((f) => ({ id: f.id, perSite: f.perSite, apply: f.apply, available: f.id !== "guardMiners" }));
  return { ok: true, host, overrideHost: host, stream, siteEnabled: !(o[host] && o[host].enabled === false), enabled: true, features };
}

Deno.test({ name: "drift: subdomain of an allowed parent", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const store = { settings: { v: 1, enabled: true, features: {} }, siteOverrides: { "example.com": { enabled: false } } };
  const w = loadWorker({ store });
  await settle(300);
  const real = await w.send({ source: "adgecko-general", type: "siteInfo", origin: "https://shop.example.com" });
  const fake = fakeSiteInfo(store, "https://shop.example.com");
  console.log("real:", JSON.stringify({ overrideHost: real.overrideHost, siteEnabled: real.siteEnabled, featureKeys: Object.keys(real.features[0]) }));
  console.log("fake:", JSON.stringify({ overrideHost: fake.overrideHost, siteEnabled: fake.siteEnabled, featureKeys: Object.keys(fake.features[0]) }));
  const gm = (x) => (x.features.find((f) => f.id === "guardMiners") || {}).available;
  console.log("guardMiners.available real/fake:", gm(real), gm(fake));
}});
