import { CP } from "./load.mjs";
for (const d of [10, 16, 18, 20, 22, 24]) {
  const sel = ":is(".repeat(d) + ".a" + ")".repeat(d);
  const t = performance.now();
  const r = CP.parseCosmetic("##" + sel);
  console.log("depth", d, "len", sel.length, "kept", r.generic.length, "ms", Math.round(performance.now() - t));
}
const d = 118; const sel = ":is(".repeat(d) + ".a" + ")".repeat(d);
console.log("depth 118 selector length:", sel.length, "sanitize ok:", CP.sanitizeSelector(sel) === sel);
