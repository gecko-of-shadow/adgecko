// Finding 3 (final review): overrideFor merged a parent's feature switches into
// a child that has its own entry. After the upgrade from 0.3.4, a kept Fix on
// example.com turned the clipboard guard off on shop.example.com, which has its
// own entry. Feature ids now follow 0.3.4: the most specific existing entry
// wins as a whole. Only enabled:false and network:false reach down from a
// parent (the DNR allow rule for a parent covers every subdomain).
import "../src/settings/features.js";
function assert(c, l) { if (!c) throw new Error(l); }
const F = globalThis.GeckoFeatures;
const settings = { v: 1, enabled: true, features: {} };
// 0.3.4-shaped storage: a kept popup Fix on the parent entry.
const parentFix = { cosmetic: false, guardClipboard: false, guardPopups: false };

Deno.test("upgrade: a parent Fix does not reach a child with its own feature entry", () => {
  const overrides = { "example.com": { features: parentFix }, "shop.example.com": { features: { cosmetic: true } } };
  const r = F.resolve(settings, overrides, "shop.example.com");
  assert(r.guardClipboard === true, "guardClipboard=" + r.guardClipboard);
  assert(r.cosmetic === true, "cosmetic=" + r.cosmetic);
  // The parent itself keeps its Fix.
  const p = F.resolve(settings, overrides, "example.com");
  assert(p.guardClipboard === false && p.cosmetic === false, "parent keeps its Fix: " + JSON.stringify(p));
});

Deno.test("upgrade: an allowed child keeps the guards on under a parent Fix", () => {
  const overrides = { "example.com": { features: parentFix }, "shop.example.com": { enabled: false } };
  const r = F.resolve(settings, overrides, "shop.example.com");
  assert(r.guardClipboard === true, "guardClipboard=" + r.guardClipboard + " (keepOnAllow)");
  assert(r.network === false, "network=" + r.network + " (Allow)");
});

Deno.test("a subdomain without its own entry still uses the parent entry", () => {
  const overrides = { "example.com": { features: parentFix } };
  const r = F.resolve(settings, overrides, "www.example.com");
  assert(r.guardClipboard === false && r.cosmetic === false, JSON.stringify(r));
  assert(F.overrideFor(F.normalizeOverrides(overrides), "www.example.com").host === "example.com", "host is the parent");
});

Deno.test("a parent Allow and a parent network:false still reach a child with its own Fix", () => {
  const allow = { "example.com": { enabled: false }, "shop.example.com": { features: { cosmetic: false } } };
  const a = F.overrideFor(F.normalizeOverrides(allow), "shop.example.com");
  assert(a.host === "example.com" && a.entry.enabled === false, JSON.stringify(a));
  assert(F.resolve(settings, allow, "shop.example.com").network === false, "Allow on parent");
  const net = { "example.com": { features: { network: false, guardClipboard: false } }, "shop.example.com": { features: { cosmetic: false } } };
  const r = F.resolve(settings, net, "shop.example.com");
  assert(r.network === false, "network:false from the parent");
  assert(r.guardClipboard === true, "other parent switches do not reach the child");
  assert(r.cosmetic === false, "child's own switch");
});
