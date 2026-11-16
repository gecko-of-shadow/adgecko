import { CP } from "./load.mjs";
import "src/settings/features.js";
const r0 = CP.parseCosmetic("~a.com##.x\nshop.a.com##.x");
const st0 = CP.toStorage(CP.mergeCosmetic([r0]), {});
console.log("repro exceptions:", JSON.stringify(r0.exceptions), "css on shop.a.com:", JSON.stringify(CP.buildPageCss("shop.a.com", st0)));
const dir = "docs/review-2026-11-16/repros/lists/";
const parts = ["easylist","easyprivacy"].map(n => CP.parseCosmetic(Deno.readTextFileSync(dir+n+".txt")));
const m = CP.mergeCosmetic(parts);
let n = 0;
for (const [h, sels] of Object.entries(m.exclusions)) {
  for (const s of sels) {
    for (const [sh, ss] of Object.entries(m.sites)) {
      if (sh !== h && CP.candidateHosts(sh).includes(h) && ss.includes(s)) { n++; if (n < 15) console.log("killed:", sh + "##" + s, "by exception on", h); }
    }
  }
}
console.log("total killed site rules:", n);
