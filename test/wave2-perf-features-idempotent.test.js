// Wave 2 / perf: the manifest injects src/settings/features.js twice into
// ordinary-site frames (cosmetic entry and flags entry). A second run must keep
// the first registry, and a page-made GeckoFeatures (a named DOM element) must
// never make the real run skip.
import featuresSource from "../src/settings/features.js" with { type: "text" };
function assert(c, l) { if (!c) throw new Error(l); }
const run = (root) => new Function("self", featuresSource)(root);

Deno.test("features.js twice in one frame keeps the same registry", () => {
  const root = {};
  run(root);
  const first = root.GeckoFeatures;
  assert(first && Object.isFrozen(first) && typeof first.resolve === "function", "registry installed");
  run(root);
  assert(root.GeckoFeatures === first, "second run replaced the registry");
});

Deno.test("a page-made GeckoFeatures (DOM named property) is replaced by the real registry", () => {
  for (const junk of [
    { tagName: "HTML", id: "GeckoFeatures" },
    Object.freeze({ resolve: "x", FEATURES: [], STREAM_SITES: [] }),
    { resolve() { return {}; }, FEATURES: [], STREAM_SITES: [] },
    Object.freeze({ resolve() { return {}; }, FEATURES: {}, STREAM_SITES: [] }),
    true,
  ]) {
    const root = { GeckoFeatures: junk };
    run(root);
    const F = root.GeckoFeatures;
    assert(F !== junk && Object.isFrozen(F) && Array.isArray(F.FEATURES) && F.FEATURES.length > 3 && F.isStreamHost("twitch.tv"), "junk kept: " + JSON.stringify(junk));
  }
});
