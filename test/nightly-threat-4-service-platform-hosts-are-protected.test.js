// Review 2026-11-16, WP-13: the threat tier protected each shared platform
// and its parents only. For a single-service site or a shared service host,
// the hosts UNDER the name are the service itself (www.facebook.com,
// login.live.com, cdn.jsdelivr.net). One list line such as
// ||www.facebook.com^ became a block rule at priority 2,000,010, above
// "Allow this page". Now:
//   - every host under a single-service platform is refused;
//   - a short list of exact shared service hosts is refused
//     (raw.githubusercontent.com, firebasestorage.googleapis.com, ...);
//   - per-customer parents keep the old rule: evil.github.io and a file host
//     under dl.dropboxusercontent.com can still be blocked.
// The "Allow this domain" box uses the same check, so it refuses these names too.
import { assert, assertEquals } from "jsr:@std/assert@1";
import "../src/general/never-block-captcha.js";
import "../src/threat/psl.js";
import "../src/threat/protected-hosts.js";
import "../src/threat/compile.js";

const PS = globalThis.GeckoPublicSuffix;
const PH = globalThis.GeckoProtectedHosts;
const TC = globalThis.GeckoThreatCompile;

// Hosts under a single-service platform.
const UNDER_SERVICE = [
  "www.facebook.com", "www.instagram.com", "www.reddit.com", "en.wikipedia.org", "www.apple.com", "www.microsoft.com",
  "login.live.com", "outlook.live.com", "www.office.com", "www.amazon.com", "web.telegram.org", "api.x.com",
  "www.dropbox.com", "cdn.jsdelivr.net", "fastly.jsdelivr.net", "cdn.discordapp.com", "media.discordapp.net",
  "www.mediafire.com", "download2390.mediafire.com", "challenges.cloudflare.com", "gist.github.com",
  "scontent-ams2-1.xx.fbcdn.net",
];
// Exact shared service hosts under a per-customer parent.
const SERVICE_HOSTS = [
  "raw.githubusercontent.com", "objects.githubusercontent.com", "dl.dropboxusercontent.com",
  "firebasestorage.googleapis.com", "lh3.googleusercontent.com", "yt3.googleusercontent.com",
  "www.recaptcha.net", "js.stripe.com",
];
// Customer hosts that must stay blockable.
const STILL_BLOCKABLE = [
  "evil.github.io", "x.pages.dev", "d123abc.cloudfront.net", "bucket.s3.amazonaws.com", "tenant.sharepoint.com",
  "evil.ngrok.io", "uc1234abcd.dl.dropboxusercontent.com", "evil-bucket.storage.googleapis.com", "malware-drop.example",
];

Deno.test("WP-13: hosts under a single-service platform are refused as threat hosts", () => {
  for (const h of UNDER_SERVICE) assert(PH.protectedReason(h) !== null, h + " is accepted as a threat host");
});

Deno.test("WP-13: exact shared service hosts are refused as threat hosts", () => {
  for (const h of SERVICE_HOSTS) assert(PH.protectedReason(h) !== null, h + " is accepted as a threat host");
});

Deno.test("WP-13: compileThreatRules emits no block rule for the hosts that serve a platform", () => {
  const out = TC.compileThreatRules(["www.facebook.com", "cdn.jsdelivr.net", "raw.githubusercontent.com", "login.live.com", "www.amazon.com"]);
  assertEquals(out.accepted, [], "accepted: " + JSON.stringify(out.accepted));
  assertEquals(out.rules.flatMap((r) => r.condition.requestDomains || []), []);
});

Deno.test("WP-13: customer hosts under per-customer parents can still be blocked", () => {
  for (const h of STILL_BLOCKABLE) assertEquals(PH.protectedReason(h), null, h + " is refused");
  const out = TC.compileThreatRules(["evil.github.io"]);
  assertEquals(out.accepted, ["evil.github.io"]);
});

Deno.test("WP-13: the Allow this domain box refuses the same names and gives a reason", () => {
  for (const h of ["www.facebook.com", "cdn.jsdelivr.net", "raw.githubusercontent.com", "login.live.com"]) {
    const r = TC.userDomainReason(h);
    assertEquals(r.domain, null, h + " -> " + JSON.stringify(r));
    assert(typeof r.reason === "string" && r.reason.length > 0, h + " has no reason");
  }
  assertEquals(TC.userDomainReason("me.github.io").domain, "me.github.io");
});

Deno.test("WP-13: the ordinary list tier and registrableDomain do not change", () => {
  assertEquals(PS.isIcannSuffix("www.facebook.com"), false);
  assertEquals(PS.isPublicSuffix("cdn.jsdelivr.net"), false);
  assertEquals(PS.registrableDomain("a.b.example.co.uk"), "example.co.uk");
});
