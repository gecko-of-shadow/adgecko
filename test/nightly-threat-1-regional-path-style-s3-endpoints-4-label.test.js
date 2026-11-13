// Regional path-style S3 endpoints are PRIVATE public suffixes in the PSL
// (s3.us-east-2.amazonaws.com, s3.dualstack.<region>.amazonaws.com,
// s3-website.<region>.amazonaws.com). One list line naming one of them must
// not become a DNR requestDomains block on every bucket in that region,
// just like the 3-label legacy form s3-us-west-2.amazonaws.com is refused.
import { assert, assertEquals } from "jsr:@std/assert@1";
import "../src/general/never-block-captcha.js";
import "../src/threat/psl.js";
import "../src/threat/protected-hosts.js";
import "../src/threat/compile.js";

const ph = globalThis.GeckoProtectedHosts;
const tc = globalThis.GeckoThreatCompile;

const REGIONAL = [
  "s3.us-east-2.amazonaws.com",
  "s3.dualstack.us-east-2.amazonaws.com",
  "s3-website.us-east-2.amazonaws.com",
];

Deno.test("control: legacy 3-label S3 regional endpoint is refused", () => {
  assert(ph.protectedReason("s3-us-west-2.amazonaws.com") !== null);
});

Deno.test("regional path-style S3 endpoints (4-label PSL private suffixes) are refused", () => {
  for (const h of REGIONAL) {
    assert(ph.protectedReason(h) !== null, `${h} is accepted as a threat host`);
  }
});

Deno.test("compileThreatRules emits no block rule for a regional S3 endpoint", () => {
  const out = tc.compileThreatRules(REGIONAL);
  assertEquals(out.accepted, [], "regional S3 endpoints accepted: " + JSON.stringify(out.accepted));
  const blocked = out.rules.flatMap((r) => r.condition.requestDomains || []);
  assertEquals(blocked, []);
});

Deno.test("a bucket under a regional endpoint can still be blocked", () => {
  assertEquals(ph.protectedReason("evil-bucket.s3.us-east-2.amazonaws.com"), null);
});
