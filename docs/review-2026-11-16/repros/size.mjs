import "src/settings/features.js";
import "src/general/cosmetic-parse.js";
const P = globalThis.GeneralCosmeticParse;
const b = JSON.parse(await Deno.readTextFile("src/rules/cosmetic-rules.json"));
console.log(Object.keys(b));
const items = P.toStorage(P.mergeCosmetic([b, {generic: b.extras||[]}]), {source:"bundled"});
const sz = (v)=>JSON.stringify(v).length;
console.log("keys", Object.keys(items).length, "cosG", sz(items.cosG), "cosKeys", sz(items.cosKeys), "total", sz(items));
