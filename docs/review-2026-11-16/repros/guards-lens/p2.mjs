import { start } from "docs/review-2026-11-16/repros/guards-lens/harness.mjs";
const page0 = `<!doctype html><body><p id=content style="font-size:40px">Plain article text</p></body>`;
const { ctx, sw, port, base, close } = await start({ "/": page0, "/ad": "<p>ad</p>" }, { settings: { guardPopups: true } });
const page = await ctx.newPage();
page.on("console", (m) => console.log("   console:", m.text()));
await page.goto(base + "/");
await page.waitForTimeout(500);
await page.evaluate(`document.getElementById('content').onclick = () => {
  const f=document.createElement('iframe'); document.body.appendChild(f);
  const w = f.contentWindow;
  console.log('top open:', Function.prototype.toString.call(window.open));
  console.log('frame open:', Function.prototype.toString.call(w.open));
  console.log('frame isActive:', w.navigator.userActivation.isActive, 'top isActive:', navigator.userActivation.isActive);
  console.log('frame writeText:', Function.prototype.toString.call(w.navigator.clipboard.writeText));
}; 0`);
await page.click("#content");
await page.waitForTimeout(800);
await close();
