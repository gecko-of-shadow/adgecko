import { CP } from "./load.mjs";
import "src/settings/features.js";
const dir = "docs/review-2026-11-16/repros/lists/";
let t = performance.now();
const parts = ["easylist","easyprivacy"].map(n => CP.parseCosmetic(Deno.readTextFileSync(dir+n+".txt")));
console.log("parse ms", Math.round(performance.now()-t), "exclusions", parts.map(p=>Object.values(p.exclusions).flat().length));
t = performance.now(); CP.mergeCosmetic(parts); console.log("merge ms", Math.round(performance.now()-t));
