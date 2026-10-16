// Build src/rules/cosmetic-rules.json (bundled cosmetic snapshot) from local
// copies of EasyList / EasyPrivacy, plus the hand-picked extras already in
// src/cosmetic-hide.css. Usage: node scripts/pack-cosmetic.mjs easylist.txt easyprivacy.txt
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await import(path.join(root, "src/general/cosmetic-parse.js"));
const P = globalThis.GeneralCosmeticParse;
const parts = process.argv.slice(2).map((f) => P.parseCosmetic(fs.readFileSync(f, "utf8")));
const merged = P.mergeCosmetic(parts);
const sheet = fs.readFileSync(path.join(root, "src/cosmetic-hide.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const extras = [];
const have = new Set(merged.generic);
for (const block of sheet.split(/\{[^}]*\}/)) {
  for (const raw of block.split(/,\s*\n/)) {
    const sel = P.sanitizeSelector(raw);
    if (sel && !have.has(sel)) { have.add(sel); extras.push(sel); }
  }
}
const out = { format: 1, packed_at_utc: new Date().toISOString(), extras, ...merged };
fs.writeFileSync(path.join(root, "src/rules/cosmetic-rules.json"), JSON.stringify(out));
console.log({ generic: merged.generic.length, sites: Object.keys(merged.sites).length, exceptions: Object.keys(merged.exceptions).length, extras: extras.length, bytes: JSON.stringify(out).length });
