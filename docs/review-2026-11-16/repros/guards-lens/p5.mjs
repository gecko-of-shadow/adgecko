import { start } from "docs/review-2026-11-16/repros/guards-lens/harness.mjs";
const page0 = `<!doctype html><body><form id=f onsubmit="return false"><input id=q placeholder="Search"></form><p id=content style="font-size:30px">Article text</p><button id=btn>Sign in</button></body>`;
const { ctx, port, base, close } = await start({ "/": page0, "/ad": "<p>dest</p>" }, { settings: { guardPopups: true } });
const page = await ctx.newPage();
await page.goto(base + "/");
await page.waitForTimeout(500);
const AJ = JSON.stringify(`http://localhost:${port}/ad`);
async function check(name, fn) {
  const before = ctx.pages().length;
  await fn();
  await page.waitForTimeout(1200);
  const after = ctx.pages();
  console.log(name.padEnd(70), after.length > before ? "opened" : "BLOCKED");
  for (const p of after.slice(before)) await p.close();
}
await page.evaluate(`document.getElementById('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') window.open(${AJ}); }); 0`);
await check("click in search box, type, press Enter (keydown -> window.open)", async () => { await page.click("#q"); await page.keyboard.type("abc"); await page.keyboard.press("Enter"); });
await page.waitForTimeout(5500);
await check("same, but Enter pressed 5.5 s after the click", async () => { await page.click("#q"); await page.waitForTimeout(5200); await page.keyboard.press("Enter"); });
await page.evaluate(`document.getElementById('btn').onclick = () => window.open(${AJ}); document.getElementById('btn').addEventListener('keydown', ()=>{}); 0`);
await page.waitForTimeout(5500);
await check("control: click Sign in button", async () => { await page.click("#btn"); });
await close();
