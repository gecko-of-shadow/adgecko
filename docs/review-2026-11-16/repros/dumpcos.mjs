import { CP } from "./load.mjs";
import "src/settings/features.js";
const dir = "docs/review-2026-11-16/repros/lists/";
const all = new Set();
for (const n of ["easylist","easyprivacy","adguard_base"]) {
  const r = CP.parseCosmetic(Deno.readTextFileSync(dir + n + ".txt"), {sitesOnly: n==="adguard_base"});
  console.log(n, r.stats, "generic", r.generic.length);
  for (const s of r.generic) all.add(s);
  for (const v of Object.values(r.sites)) for (const s of v) all.add(s);
}
const bundled = JSON.parse(Deno.readTextFileSync("src/rules/cosmetic-rules.json"));
console.log(Object.keys(bundled));
Deno.writeTextFileSync(dir + "../selectors.json", JSON.stringify([...all]));
console.log(all.size);
