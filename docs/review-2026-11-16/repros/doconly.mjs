const R="";
await import(R+"src/threat/psl.js");
await import(R+"src/general/filter-options.js");
await import(R+"src/general/never-block-captcha.js");
await import(R+"src/general/update.js");
await import(R+"src/threat/protected-hosts.js");
await import(R+"src/threat/compile.js");
const U=globalThis.GeneralAdblockUpdate, TC=globalThis.GeckoThreatCompile;
const L="docs/review-2026-11-16/repros/lists/";
const whole=new Set(), doc=new Set();
for (const f of ["urlhaus.txt","badware.txt","dandelion.txt"]) {
  const p=U.parseEntries(Deno.readTextFileSync(L+f).replace(/\r\n/g,"\n"));
  for (const d of p.domains) whole.add(d);
  for (const [d,k] of p.scoped) if (k==="p=|t=main_frame|x=") doc.add(d);
}
const docOnly=[...doc].filter(d=>!whole.has(d));
const packed=new Set(JSON.parse(Deno.readTextFileSync(R+"src/rules/threat-network.json")).flatMap(r=>r.condition.requestDomains));
const inPacked=docOnly.filter(d=>packed.has(d));
console.log("doc-only hosts:",docOnly.length,"in packed full-type threat rules:",inPacked.length);
console.log(inPacked.filter(d=>/cdn|static|img|api|myqcloud|aliyun|cloud|amazonaws|github|google|microsoft|azure|storage|blob/.test(d)).slice(0,60).join("\n"));
Deno.writeTextFileSync("docs/review-2026-11-16/repros/doconly.txt", inPacked.join("\n"));
