// A child's own override (Fix this site) must not hide the parent's Allow.
// The DNR allow rule for the parent uses initiatorDomains:[parent], which
// Chrome also matches for every subdomain, so the lists are off on the child.
// The feature layer (popup, resolve, siteInfo) must agree with that.
import "../src/settings/features.js";
function assert(c, l) { if (!c) throw new Error(l); }
const F = globalThis.GeckoFeatures;

Deno.test("child with its own Fix-this-site entry under an allowed parent resolves as allowed", () => {
  const settings = { v: 1, enabled: true, features: {} };
  const overrides = {
    "shop.example.com": { features: { cosmetic: false } },
    "example.com": { enabled: false },
  };
  const mirror = F.legacyMirror(settings, overrides);
  const child = "shop.example.com";
  // Network layer: an allowed origin whose host is the child or a parent of it
  // (initiatorDomains matches subdomains) stops list blocking on the child.
  const dnrAllows = mirror.generalAllowedOrigins.some((o) => {
    const h = new URL(o).hostname;
    return child === h || child.endsWith("." + h);
  });
  assert(dnrAllows, "precondition: DNR allows the child via the parent: " + JSON.stringify(mirror));
  const r = F.resolve(settings, overrides, child);
  assert(r.network === dnrAllows ? false : true,
    "feature layer must match DNR: network should be off on " + child + " but resolve says network=" + r.network);
  assert(r.network === false, "network=" + r.network + " while DNR allows " + child);
});
