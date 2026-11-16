// Review 2026-11-16, WP-21:
// 1. The PSL subset dropped every Unicode (IDN) rule ("Keep ASCII only"), so
//    psl.js had no xn-- name. 公司.cn (xn--55qx5d.cn) and 政府.hk
//    (xn--mxtq1m.hk) could be threat-blocked as a whole, and the
//    "Allow this domain" box accepted them. The generator now converts each
//    Unicode rule to punycode.
// 2. The children of PRIVATE wildcard rules were left out. PSL has
//    "*.compute.amazonaws.com", so us-west-1.compute.amazonaws.com is a
//    public suffix (every EC2 public DNS name in that region). The threat
//    tier and the allow box now refuse it; one EC2 host under it stays
//    blockable.
import { assert, assertEquals } from "jsr:@std/assert@1";
import "../src/general/filter-options.js";
import "../src/general/never-block-captcha.js";
import "../src/threat/psl.js";
import "../src/threat/protected-hosts.js";
import "../src/threat/compile.js";

const PS = globalThis.GeckoPublicSuffix;
const PH = globalThis.GeckoProtectedHosts;
const TC = globalThis.GeckoThreatCompile;

const IDN = [
  ["公司.cn", "xn--55qx5d.cn"],
  ["網絡.cn", "xn--od0alg.cn"],
  ["网络.cn", "xn--io0a7i.cn"],
  ["個人.hk", "xn--gmqw5a.hk"],
  ["政府.hk", "xn--mxtq1m.hk"],
  ["教育.hk", "xn--wcvs22d.hk"],
];

Deno.test("WP-21: the URL parser gives the punycode forms this test uses", () => {
  for (const [u, p] of IDN) assertEquals(new URL("http://" + u).hostname, p);
});

Deno.test("WP-21: IDN public suffixes are refused by suffixReason and the threat check", () => {
  for (const [, p] of IDN) {
    assert(PS.suffixReason(p) !== null, p + " suffixReason is null");
    assert(PH.protectedReason(p) !== null, p + " protectedReason is null");
  }
  const out = TC.compileThreatRules(["xn--55qx5d.cn", "xn--mxtq1m.hk"]);
  assertEquals(out.accepted, [], "accepted: " + JSON.stringify(out.accepted));
});

Deno.test("WP-21: IDN suffixes are ICANN suffixes for the ordinary list tier too", () => {
  assertEquals(PS.isIcannSuffix("xn--55qx5d.cn"), true);
});

Deno.test("WP-21: the Allow this domain box refuses an IDN suffix typed in Unicode", () => {
  const r = TC.userDomainReason("公司.cn");
  assertEquals(r.domain, null, "公司.cn -> " + JSON.stringify(r));
  assert(r.reason, "no reason");
});

Deno.test("WP-21: a site under an IDN suffix is still blockable and allowable", () => {
  assertEquals(PH.protectedReason("example.xn--55qx5d.cn"), null);
  assertEquals(TC.userDomainReason("例子.公司.cn").domain, new URL("http://例子.公司.cn").hostname);
  assertEquals(TC.userDomainReason("bücher.de").domain, "xn--bcher-kva.de");
});

Deno.test("WP-21: EC2 region names (children of *.compute.amazonaws.com) are refused", () => {
  for (const h of ["us-west-1.compute.amazonaws.com", "eu-west-1.compute.amazonaws.com", "cn-north-1.compute.amazonaws.com.cn"]) {
    assert(PH.protectedReason(h) !== null, h + " is accepted as a threat host");
  }
  const r = TC.userDomainReason("eu-west-1.compute.amazonaws.com");
  assertEquals(r.domain, null, "allow box: " + JSON.stringify(r));
  const out = TC.compileThreatRules(["us-west-1.compute.amazonaws.com"]);
  assertEquals(out.accepted, []);
});

Deno.test("WP-21: one EC2 host under a region stays blockable", () => {
  assertEquals(PH.protectedReason("ec2-54-177-49-112.us-west-1.compute.amazonaws.com"), null);
  const out = TC.compileThreatRules(["ec2-54-177-49-112.us-west-1.compute.amazonaws.com"]);
  assertEquals(out.accepted, ["ec2-54-177-49-112.us-west-1.compute.amazonaws.com"]);
});

Deno.test("WP-21: the base compute.amazonaws.com.cn (4 labels) is refused too", () => {
  assert(PH.protectedReason("compute.amazonaws.com.cn") !== null);
});

// PSL also has "*.compute-1.amazonaws.com", but each child there is ONE EC2
// machine. The packed threat set blocks such hosts; they must stay blockable.
Deno.test("WP-21: one us-east-1 EC2 machine (child of *.compute-1.amazonaws.com) stays blockable", () => {
  for (const h of ["ec2-23-22-126-183.compute-1.amazonaws.com", "ec2-3-238-75-201.compute-1.amazonaws.com"]) {
    assertEquals(PH.protectedReason(h), null, h + " is refused");
  }
  assert(PH.protectedReason("compute-1.amazonaws.com") !== null, "the base stays refused");
});

Deno.test("WP-21: private wildcard children stay out of the ICANN check", () => {
  assertEquals(PS.isIcannSuffix("us-west-1.compute.amazonaws.com"), false);
});
