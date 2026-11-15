// Verifier repro: the PSL subset (scripts/build-psl-subset.mjs) keeps only
// two-label ICANN rules, so plain 3-label ICANN suffixes (act.edu.au,
// k12.ca.us, aisai.aichi.jp) and children of non-TLD ICANN wildcard rules
// (*.kawasaki.jp -> nakahara.kawasaki.jp) are treated as ordinary sites.
import "../src/general/filter-options.js";
import "../src/threat/psl.js";
import "../src/general/never-block-captcha.js";
import "../src/threat/protected-hosts.js";
import "../src/threat/compile.js";
function assert(c, l) { if (!c) throw new Error(l); }
const PS = globalThis.GeckoPublicSuffix;
const PH = globalThis.GeckoProtectedHosts;
const TC = globalThis.GeckoThreatCompile;

const THREE_LABEL_ICANN = ["act.edu.au", "k12.ca.us", "aisai.aichi.jp", "nakahara.kawasaki.jp"];

Deno.test("psl: 3-label ICANN suffixes and ICANN wildcard children are public suffixes", () => {
  for (const h of THREE_LABEL_ICANN) {
    assert(PS.isIcannSuffix(h), "isIcannSuffix(" + h + ") should be true");
    assert(PH.protectedReason(h), "threat check should refuse " + h + " but returned " + PH.protectedReason(h));
  }
});

Deno.test("psl: threat compile does not emit a block rule for a 3-label ICANN suffix", () => {
  const c = TC.compileThreatRules(["k12.ca.us", "bad.example"], { idBase: 1 });
  const blocked = c.rules.flatMap((r) => r.condition.requestDomains);
  assert(JSON.stringify(blocked) === JSON.stringify(["bad.example"]), "compileThreatRules blocks the public suffix k12.ca.us: " + JSON.stringify(blocked));
});
