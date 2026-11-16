import { U, FO } from "./load.mjs";
import "src/threat/compile.js";
const TC = globalThis.GeckoThreatCompile;
const p = JSON.parse(Deno.readTextFileSync("docs/review-2026-11-16/repros/payloads.json"));
const cross = U.crossListRules(p, [], {lists:{}});
for (const n of TC.THREAT_LISTS) {
  const hosts = TC.threatHostsFromEntries(p[n]);
  for (const h of hosts) {
    const inWhole = p[n].domains.includes(h);
    if (inWhole && !cross.keepWhole(h)) console.log(n, h, "threat-blocked but cancelled/allowed cross-list (whole)");
    if (!inWhole && cross.scopeOf(h, FO.DOCUMENT_KEY) === null) console.log(n, h, "threat-blocked but cancelled cross-list (doc)");
  }
}
