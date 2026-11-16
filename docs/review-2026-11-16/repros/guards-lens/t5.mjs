import { start } from "docs/review-2026-11-16/repros/guards-lens/harness.mjs";
const { ctx, base, close } = await start({ "/": "<body>x</body>" });
const page = await ctx.newPage();
await page.goto(base + "/");
console.log(await page.evaluate(async () => {
  const out = [];
  for (const v of ["abc", Promise.resolve("abc"), new Blob(["abc"], {type: "text/plain"})]) {
    const it = new ClipboardItem({ "text/plain": v });
    try { const b = await it.getType("text/plain"); out.push(Object.prototype.toString.call(b) + " " + (typeof b)); } catch (e) { out.push("throw " + e.name + " " + e.message); }
  }
  return out.join(" | ");
}));
await close();
