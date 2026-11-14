// Build src/rules/cosmetic-rules.json (bundled cosmetic snapshot) from local
// copies of the cosmetic lists, plus the hand-picked extras already in
// src/cosmetic-hide.css.
//
//   deno run --allow-read --allow-write scripts/pack-cosmetic.mjs [--packed-at <ISO time>] [--cache <dir>] [--out <file>] [list.txt ...]
//
// With no list files it reads the packer's cache,
// scripts/.list-cache/<name>.txt for every name in COSMETIC_LISTS (the
// `cosmetic: true` sources of src/general/update.js, in the same order, so the
// bundled sheet is the one the runtime refresh would build). Lists in
// SITES_ONLY_LISTS (`cosmetic: "sites"` in update.js) give only their
// site-scoped hide rules and site #@# exceptions, as at runtime. Offline: it
// never fetches. scripts/pack-filter-lists.py runs it after every list pack, with
// --packed-at set to that pack's time.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const COSMETIC_LISTS = ["easylist", "easyprivacy", "adguard_base"];
// Generic "##" selectors dropped (parseCosmetic sitesOnly): AdGuard's
// `$generichide` / `$elemhide` exceptions are not supported.
export const SITES_ONLY_LISTS = ["adguard_base"];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
let packedAt = "";
let cacheDir = path.join(root, "scripts", ".list-cache");
let outPath = path.join(root, "src", "rules", "cosmetic-rules.json");
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--packed-at") packedAt = args[++i] || "";
  else if (args[i] === "--cache") cacheDir = path.resolve(args[++i] || cacheDir);
  else if (args[i] === "--out") outPath = path.resolve(args[++i] || outPath);
  else files.push(args[i]);
}
if (!files.length) {
  for (const name of COSMETIC_LISTS) {
    const f = path.join(cacheDir, name + ".txt");
    if (!fs.existsSync(f)) {
      console.error(`cosmetic list ${name} missing from the cache (${f}); run scripts/pack-filter-lists.py first`);
      process.exit(2);
    }
    files.push(f);
  }
}

await import(pathToFileURL(path.join(root, "src", "general", "cosmetic-parse.js")).href);
const P = globalThis.GeneralCosmeticParse;
const listName = (f) => path.basename(f).replace(/\.txt$/i, "");
const sitesOnly = (f) => SITES_ONLY_LISTS.includes(listName(f));
const parts = files.map((f) => P.parseCosmetic(fs.readFileSync(f, "utf8"), sitesOnly(f) ? { sitesOnly: true } : undefined));

// The runtime refresh rejects a whole list (network rules too) whose hide rules
// pass these per-list limits (src/general/update.js checkListChange). A list
// over them must not ship in the bundle either: stop and write nothing.
// Exception, as at runtime: a sites-only list over a limit loses only its hide
// rules (an empty part), with a warning, and the sheet is still written.
const updateSrc = fs.readFileSync(path.join(root, "src", "general", "update.js"), "utf8");
const limit = (name) => {
  const m = new RegExp("const " + name + " = (\\d+);").exec(updateSrc);
  if (!m) { console.error(`${name} not found in src/general/update.js`); process.exit(4); }
  return Number(m[1]);
};
const MAX_GENERIC = limit("MAX_GENERIC_SELECTORS");
const MAX_ROOTS = limit("MAX_PAGE_ROOT_SITE_RULES");
const over = [];
parts.forEach((p, i) => {
  const g = (p.generic || []).length;
  const roots = p.stats ? p.stats.pageRootSite : 0;
  const why = [];
  if (g > MAX_GENERIC) why.push(`${path.basename(files[i])}: ${g} generic hide rules (limit ${MAX_GENERIC})`);
  if (roots > MAX_ROOTS) why.push(`${path.basename(files[i])}: ${roots} whole-page hide rules (limit ${MAX_ROOTS})`);
  if (why.length && sitesOnly(files[i])) {
    console.error("hide rules dropped (network rules unaffected): " + why.join("; "));
    parts[i] = { generic: [], sites: {}, exceptions: {}, genericExceptions: [], exclusions: {} };
  } else over.push(...why);
});
if (over.length) {
  console.error("the runtime refresh would reject these lists; cosmetic-rules.json not written:\n  " + over.join("\n  "));
  process.exit(4);
}
for (const p of parts) delete p.stats;
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
const out = { format: 1, packed_at_utc: packedAt || new Date().toISOString(), extras, ...merged };
fs.writeFileSync(outPath, JSON.stringify(out));
console.log(JSON.stringify({ lists: files.map((f) => path.basename(f)), generic: merged.generic.length, sites: Object.keys(merged.sites).length, exceptions: Object.keys(merged.exceptions).length, extras: extras.length, bytes: JSON.stringify(out).length }));
