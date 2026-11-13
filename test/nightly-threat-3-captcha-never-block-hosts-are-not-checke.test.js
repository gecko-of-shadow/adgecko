// Verifier repro: a multi-label captcha never-block entry must also reject its
// ancestors in protectedReason, because DNR requestDomains matches subdomains
// (same rule the header comment states for every protected entry).
import "../src/threat/psl.js";
import pslSource from "../src/threat/psl.js" with { type: "text" };
import phSource from "../src/threat/protected-hosts.js" with { type: "text" };

function loadProtectedHosts(captchaSuffixes) {
  const root = {};
  new Function("self", pslSource)(root);
  root.GeckoNeverBlockCaptcha = Object.freeze({ SUFFIXES: Object.freeze(captchaSuffixes) });
  new Function("self", phSource)(root);
  return root.GeckoProtectedHosts;
}

Deno.test("an ancestor of a multi-label captcha never-block entry is rejected as a threat host", () => {
  const PH = loadProtectedHosts(["hcaptcha.com", "assets.captcha-vendor.com"]);
  // Sanity: the entry itself and its subdomains are protected.
  if (PH.protectedReason("assets.captcha-vendor.com") === null) throw new Error("entry itself not protected");
  if (PH.protectedReason("x.assets.captcha-vendor.com") === null) throw new Error("subdomain not protected");
  // Sanity: an unrelated host is still allowed (the loader works).
  if (PH.protectedReason("evil-malware-example.com") !== null) throw new Error("harness: unrelated host rejected: " + PH.protectedReason("evil-malware-example.com"));
  // A DNR rule for "captcha-vendor.com" would match assets.captcha-vendor.com.
  const why = PH.protectedReason("captcha-vendor.com");
  if (why === null) {
    throw new Error("protectedReason('captcha-vendor.com') is null: a threat rule for it would block the protected captcha host assets.captcha-vendor.com");
  }
});

Deno.test("stream hosts already reject ancestors (contrast)", () => {
  const PH = loadProtectedHosts(["hcaptcha.com"]);
  if (PH.protectedReason("googleapis.com") === null) throw new Error("ancestor of stream host allowed");
  if (PH.protectedReason("gstatic.com") === null) throw new Error("ancestor of stream host allowed");
});
