const R="";
const text=Deno.readTextFileSync("docs/review-2026-11-16/repros/lists/public_suffix_list.dat");
const rules=[];let sec=null;
for (const raw of text.split(/\r?\n/)){const l=raw.trim(); if(l.includes("BEGIN ICANN"))sec="icann"; if(l.includes("BEGIN PRIVATE"))sec="private"; if(!l||l.startsWith("//")||!sec)continue;
 let r=l; let pre=""; if(r.startsWith("!")){pre="!";r=r.slice(1);} if(r.startsWith("*.")){pre+="*.";r=r.slice(2);}
 const a=r.split(".").map(x=>/[^\x00-\x7f]/.test(x)? new URL("http://"+x+".x").hostname.slice(0,-2):x).join(".");
 rules.push([pre,a,sec]);}
const plain=new Map(), wild=new Map();
for(const [p,a,s] of rules){ if(p==="")plain.set(a,s); else if(p==="*.")wild.set(a,s);}
const psl=(h)=>{ if(plain.has(h)) return "rule "+h+" ("+plain.get(h)+")"; const i=h.indexOf("."); if(i>0&&wild.has(h.slice(i+1))) return "wild *."+h.slice(i+1); return null;};
// parents: h is ancestor of any rule
const anc=new Map();
for (const a of [...plain.keys(),...wild.keys()]){ const L=a.split("."); for(let i=1;i<L.length-1;i++){const p=L.slice(i).join("."); if(!anc.has(p)) anc.set(p,a);} }
for (const a of wild.keys()) if(!anc.has(a)&&!plain.has(a)) anc.set(a,"*."+a);
const hosts=JSON.parse(Deno.readTextFileSync(R+"src/rules/threat-network.json")).flatMap(r=>r.condition.requestDomains);
let n=0;
for (const h of hosts){ const r=psl(h); const a=anc.get(h); if(r||a){n++; console.log(h, "|", r||"", "|", a? "ancestor of "+a:"");}}
console.log("count",n);
// IDN suffix count
console.log("IDN ICANN rules:", rules.filter(([p,a,s])=>a.includes("xn--")&&s==="icann").length, "private 4+ :", rules.filter(([p,a,s])=>s==="private"&&a.split(".").length>=4).length);
