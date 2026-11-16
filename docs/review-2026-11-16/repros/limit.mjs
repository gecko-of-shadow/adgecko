import { U, FO } from "./load.mjs";
const dir = "docs/review-2026-11-16/repros/lists/";
const map = {peter_lowe:"peter", urlhaus_hosts:"urlhaus", easylist:"easylist", easyprivacy:"easyprivacy", hagezi_pro_mini:"hagezi", ublock_badware:"badware", dandelion_antimalware:"dandelion", adguard_base:"adguard_base"};
const COS = /\$(?:.*,)?(generichide|elemhide|ghide|ehide|specifichide|shide|content|jsinject|extension|stealth|urlblock|genericblock)(?:,|$)/;
function run(strip) {
  const payloads = {};
  for (const [n,f] of Object.entries(map)) {
    let t = Deno.readTextFileSync(dir+f+".txt");
    if (strip) t = t.split("\n").filter(l => !(l.startsWith("@@") && COS.test(l))).join("\n");
    payloads[n] = U.parseEntriesFull(t);
  }
  const cross = U.crossListRules(payloads, [], {lists:{}});
  const kept = new Set();
  for (const [n,p] of Object.entries(payloads)) for (const e of U.crossScoped(cross, p.scoped)) kept.add(e[0]+"\t"+e[1]);
  return kept;
}
const a = run(false), b = run(true);
const lost = [...b].filter(x => !a.has(x));
console.log("kept with cosmetic-only exceptions:", a.size, "without:", b.size, "lost:", lost.length);
console.log(lost.slice(0,40).join("\n"));
