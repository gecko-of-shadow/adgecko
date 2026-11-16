import { start } from "docs/review-2026-11-16/repros/guards-lens/harness.mjs";
const page0 = `<!doctype html><body><p id=content style="font-size:40px">Plain article text</p><button id=btn>Open</button></body>`;
const { ctx, sw, port, base, close } = await start({ "/": page0, "/ad": "<p>ad</p>" }, { settings: { guardPopups: true } });
const page = await ctx.newPage();
page.on("console", (m) => { if (!m.text().includes("404")) console.log("   console:", m.text()); });
await page.goto(base + "/");
await page.waitForTimeout(500);
const AJ = JSON.stringify(`http://localhost:${port}/ad`);
async function attempt(name, sel, fn) {
  await page.evaluate(`document.getElementById('content').onclick = null; document.getElementById('btn').onclick=null; document.getElementById('${sel}').onclick = ${fn}; 0`);
  const before = ctx.pages().length;
  await page.click("#" + sel);
  await page.waitForTimeout(1500);
  const after = ctx.pages();
  console.log(name.padEnd(60), after.length > before ? "OPENED" : "blocked");
  for (const p of after.slice(before)) await p.close();
}
await attempt("plain content: fresh frame, open at once", "content", `() => { const f=document.createElement('iframe'); document.body.appendChild(f); f.contentWindow.open(${AJ}); }`);
await attempt("plain content: fresh frame, open after 300 ms", "content", `() => { const f=document.createElement('iframe'); document.body.appendChild(f); setTimeout(()=>f.contentWindow.open(${AJ}), 300); }`);
await attempt("plain content: top window.open after 300 ms", "content", `() => { setTimeout(()=>window.open(${AJ}), 300); }`);
await close();
