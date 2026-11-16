import { start } from "docs/review-2026-11-16/repros/guards-lens/harness.mjs";
const page0 = `<!doctype html><body><p id=content style="font-size:40px">Plain article text, click me</p><button id=btn>Sign in</button></body>`;
const { ctx, sw, port, base, close } = await start({ "/": page0, "/ad": "<p>ad</p>" }, { settings: { guardPopups: true } });
const s = await sw.evaluate(() => chrome.storage.local.get("settings"));
console.log("settings.features.guardPopups =", s.settings.features.guardPopups);
const page = await ctx.newPage();
page.on("console", (m) => { if (!m.text().includes("404")) console.log("   console:", m.text()); });
await page.goto(base + "/");
await page.waitForTimeout(500);
const AD = `http://localhost:${port}/ad`;
async function attempt(name, sel, fn) {
  await page.evaluate(`document.getElementById('content').onclick = null; document.getElementById('btn').onclick = null; document.getElementById('${sel}').onclick = ${fn}; 0`);
  const before = ctx.pages().length;
  await page.click("#" + sel);
  await page.waitForTimeout(1200);
  const after = ctx.pages();
  const opened = after.length - before;
  console.log(name.padEnd(52), opened > 0 ? `OPENED ${opened}: ${after.slice(before).map((p) => p.url()).join(", ")}` : "blocked");
  for (const p of after.slice(before)) await p.close();
}
const AJ = JSON.stringify(AD);
await attempt("control: window.open from plain content", "content", `() => window.open(${AJ})`);
await attempt("popunder via <a target=_blank>.click()", "content", `() => { const a=document.createElement('a'); a.href=${AJ}; a.target='_blank'; a.click(); }`);
await attempt("popunder via form target=_blank submit", "content", `() => { const f=document.createElement('form'); f.action=${AJ}; f.method='get'; f.target='_blank'; document.body.appendChild(f); f.submit(); }`);
await attempt("popunder via fresh iframe window.open", "content", `() => { const f=document.createElement('iframe'); document.body.appendChild(f); f.contentWindow.open(${AJ}); }`);
await attempt("control: second window.open in one click (button)", "btn", `() => { window.open(${AJ}); window.open(${AJ}); }`);
await attempt("second window via window.open + a.click (button)", "btn", `() => { window.open(${AJ}); const a=document.createElement('a'); a.href=${AJ}; a.target='_blank'; a.click(); }`);
await close();
