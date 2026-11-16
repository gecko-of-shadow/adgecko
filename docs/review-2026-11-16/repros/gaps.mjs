const R="";
await import(R+"src/threat/psl.js");await import(R+"src/general/never-block-captcha.js");await import(R+"src/threat/protected-hosts.js");
const PH=globalThis.GeckoProtectedHosts;
const text=Deno.readTextFileSync("docs/review-2026-11-16/repros/lists/public_suffix_list.dat");
let sec=null; const miss={icann:[],private:[]};
const puny=(r)=>r.split(".").map(x=>/[^\x00-\x7f]/.test(x)? new URL("http://"+x+".x").hostname.slice(0,-2):x).join(".");
for (const raw of text.split(/\r?\n/)){const l=raw.trim(); if(l.includes("BEGIN ICANN"))sec="icann"; if(l.includes("BEGIN PRIVATE"))sec="private"; if(!l||l.startsWith("//")||!sec||l.startsWith("!"))continue;
  let r=l.startsWith("*.")?l.slice(2):l; r=puny(r); if(!r.includes("."))continue;
  if(PH.protectedReason(r)===null) miss[sec].push(r);}
console.log("ICANN non-IDN:",miss.icann.filter(x=>!x.includes("xn--")).join(" "));
const p3=miss.private.filter(x=>x.split(".").length<=3); console.log("PRIVATE <=3 labels:",p3.length,p3.join(" ")); console.log("private 4+:",miss.private.length-p3.length, [...new Set(miss.private.filter(x=>x.split(".").length>3).map(x=>x.split(".").slice(-2).join(".")))].join(" "));
