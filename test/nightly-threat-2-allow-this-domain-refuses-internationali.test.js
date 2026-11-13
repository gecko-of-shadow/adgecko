// "Allow this domain" must accept internationalized (Unicode) domain names and
// store them in the punycode form DNR requestDomains needs.
import "../src/general/filter-options.js";
import "../src/threat/psl.js";
import "../src/general/never-block-captcha.js";
import "../src/threat/protected-hosts.js";
import "../src/threat/compile.js";
function assert(c, l) { if (!c) throw new Error(l); }
const TC = globalThis.GeckoThreatCompile;

Deno.test("allow-this-domain: a Unicode domain is accepted as its punycode form", () => {
  assert(TC.userDomainReason("xn--bcher-kva.de").domain === "xn--bcher-kva.de", "control: punycode form is accepted");
  const r = TC.userDomainReason("bücher.de");
  assert(r.domain === "xn--bcher-kva.de", "bücher.de -> " + JSON.stringify(r));
  const u = TC.userDomainReason("https://bücher.de/shop");
  assert(u.domain === "xn--bcher-kva.de", "https://bücher.de/shop -> " + JSON.stringify(u));
  const rules = TC.buildUserAllowRules(["bücher.de"], 1, 10);
  assert(rules.length === 1 && rules[0].condition.requestDomains[0] === "xn--bcher-kva.de", "allow rule built: " + JSON.stringify(rules));
});
