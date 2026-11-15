// Settings page "Allow this domain" (src/settings.js:190) passes the raw input to
// TC.userDomainReason. A Unicode (IDN) domain must be accepted and stored as
// the punycode form that URL.hostname / DNR requestDomains use.
import "../src/general/filter-options.js";
import "../src/threat/psl.js";
import "../src/general/never-block-captcha.js";
import "../src/threat/protected-hosts.js";
import "../src/threat/compile.js";
function assert(c, l) { if (!c) throw new Error(l); }
const TC = globalThis.GeckoThreatCompile;

Deno.test("settings allow-add: Unicode domain is accepted as punycode", () => {
  assert(TC.userDomainReason("xn--mnchen-3ya.de").domain === "xn--mnchen-3ya.de", "control: punycode accepted");
  const expected = new URL("https://münchen.de/").hostname;
  const r = TC.userDomainReason("münchen.de");
  assert(r.domain === expected, "münchen.de -> " + JSON.stringify(r) + " (want " + expected + ")");
  const u = TC.userDomainReason("https://bücher.example/");
  assert(u.reason !== "not a domain name", "https://bücher.example/ -> " + JSON.stringify(u));
});
