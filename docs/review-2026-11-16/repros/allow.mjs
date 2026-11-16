import { U, FO } from "./load.mjs";
const dir = "docs/review-2026-11-16/repros/lists/";
const map = {peter_lowe:"peter", urlhaus_hosts:"urlhaus", easylist:"easylist", easyprivacy:"easyprivacy", hagezi_pro_mini:"hagezi", ublock_badware:"badware", dandelion_antimalware:"dandelion", adguard_base:"adguard_base"};
const payloads = {};
for (const [n,f] of Object.entries(map)) payloads[n] = U.parseEntriesFull(Deno.readTextFileSync(dir+f+".txt"));
const cross = U.crossListRules(payloads, [], {lists:{}});
const allow = new Set(); for (const p of Object.values(payloads)) for (const a of p.allow||[]) allow.add(a);
const important = new Set(); for (const p of Object.values(payloads)) for (const a of p.important||[]) important.add(a);
const wholeAll = new Map(); for (const [n,p] of Object.entries(payloads)) for (const d of p.domains) if (cross.keepWhole(d)) wholeAll.set(d, n);
console.log("allow hosts", allow.size);
for (const a of allow) {
  if (important.has(a)) continue;
  const labels = a.split(".");
  for (let i=1;i<labels.length-1;i++){ const par = labels.slice(i).join("."); if (wholeAll.has(par) && !U.isNeverBlock(par)) console.log("ALLOW", a, "but parent whole-blocked", par, "by", wholeAll.get(par)); }
  for (const [n,p] of Object.entries(payloads)) for (const [d,k] of p.scoped) if (d===a && cross.scopeOf(d,k)!==null) console.log("ALLOW", a, "but scoped kept", n, k);
}
Deno.writeTextFileSync(dir+"../payloads.json", JSON.stringify(payloads));
console.log("--- child blocks under allow hosts");
for (const a of allow) for (const d of wholeAll.keys()) if (d.endsWith("." + a)) console.log("ALLOW", a, "child whole-blocked", d, wholeAll.get(d));
