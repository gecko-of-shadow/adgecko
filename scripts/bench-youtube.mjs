#!/usr/bin/env node
// YouTube page-load benchmark for the unpacked extension.
//
//   node scripts/bench-youtube.mjs --puppeteer <dir containing node_modules/puppeteer> \
//     --chrome <Chrome for Testing chrome.exe> --variant none --variant before=<ext dir> \
//     --variant after=. [--runs 5] [--out bench.json] [--headful]
//
// Branded Chrome 137+ ignores --load-extension, so point --chrome at Chrome for Testing
// (npx @puppeteer/browsers install chrome@stable). Each variant gets its own profile; run 0
// warms the HTTP cache and is discarded. Variants are interleaved per run to spread drift.
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const argv = process.argv.slice(2);
const opt = { variants: [], runs: 5, out: "", headful: false, puppeteer: "", chrome: "" };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--variant") {
    const [label, dir] = argv[++i].split(/=(.*)/s);
    opt.variants.push({ label, dir: dir ? path.resolve(dir) : null });
  } else if (a === "--opts") {
    const [label, list] = argv[++i].split(/=(.*)/s);
    const v = opt.variants.find((x) => x.label === label);
    if (!v) throw new Error(`--opts before --variant ${label}`);
    v.opts = Object.fromEntries(list.split(",").map((kv) => { const [k, b] = kv.split(":"); return [k, b === "1"]; }));
  } else if (a === "--runs") opt.runs = Number(argv[++i]);
  else if (a === "--out") opt.out = argv[++i];
  else if (a === "--puppeteer") opt.puppeteer = argv[++i];
  else if (a === "--chrome") opt.chrome = argv[++i];
  else if (a === "--headful") opt.headful = true;
  else throw new Error(`unknown arg ${a}`);
}
if (!opt.variants.length || !opt.puppeteer || !opt.chrome) {
  console.error("need --puppeteer, --chrome and at least one --variant");
  process.exit(2);
}
const puppeteer = createRequire(path.join(path.resolve(opt.puppeteer), "package.json"))("puppeteer");

const VIDEOS = ["aqz-KE-bpKQ", "9bZkp7q19f0", "kJQP7kiw5Fk", "jNQXAC9IVRw", "dQw4w9WgXcQ", "YQHsXMglC9A"];
const SETTLE_MS = 3000;
const TIMEOUT_MS = 45000;
const TRACE_CATEGORIES = [
  "devtools.timeline", "v8.execute", "loading", "blink.user_timing", "toplevel",
  "disabled-by-default-v8.cpu_profiler",
];

const INIT = () => {
  const b = (window.__bench = { lt: [], wait: [] });
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) b.lt.push(e.duration); })
      .observe({ type: "longtask", buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.name.includes("/videoplayback") && e.encodedBodySize >= 100 && e.encodedBodySize <= 110) b.wait.push(e.responseEnd);
      }
    }).observe({ type: "resource", buffered: true });
  } catch {}
};

const contentPlaying = (id) => {
  const p = document.getElementById("movie_player");
  const v = p && p.querySelector("video");
  if (!v || typeof p.getVideoData !== "function") return false;
  if (p.classList.contains("ad-showing") || p.classList.contains("ad-interrupting")) {
    window.__benchAd = true;
    return false;
  }
  if (p.getVideoData()?.video_id !== id) return false;
  return v.currentTime > 0.3 && !v.paused ? performance.now() : false;
};

const homeReady = () => {
  const tiles = document.querySelectorAll("ytd-rich-item-renderer img[src^='https']").length;
  return tiles >= 6 || document.querySelector("ytd-feed-nudge-renderer") ? performance.now() : false;
};

// Inline <script> code carries the document URL; on YouTube that is mostly the
// rpnt payload uBO splices into the page (Map/Array/Promise traps, its observer).
function analyzeTrace(buf, docUrl) {
  const events = JSON.parse(new TextDecoder().decode(buf)).traceEvents ?? [];
  let navStart = null, fcp = null, frame = null;
  for (const e of events) {
    if (e.name === "navigationStart" && e.args?.data?.isLoadingMainFrame &&
        /^https:\/\/www\.youtube\.com\//.test(e.args.data.documentLoaderURL ?? "")) {
      if (navStart === null || e.ts > navStart) { navStart = e.ts; frame = e.args.frame; }
    }
  }
  for (const e of events) {
    if (e.name === "firstContentfulPaint" && e.args?.frame === frame && e.ts >= navStart) {
      if (fcp === null || e.ts < fcp) fcp = e.ts;
    }
  }
  const isExt = (u) => typeof u === "string" && u.startsWith("chrome-extension://");
  const r = { fcpMs: fcp !== null ? (fcp - navStart) / 1000 : null, extEvalMs: 0, extEvalBeforeFcpMs: 0,
    extCallbackMs: 0, extCssParseMs: 0, styleMs: 0, extSelfMs: 0, extSelfBeforeFcpMs: 0, inlineSelfMs: 0, scripts: {} };
  const profiles = new Map();
  for (const e of events) {
    if (navStart !== null && e.ts < navStart) continue;
    const d = (e.dur ?? 0) / 1000;
    const data = e.args?.data;
    if (e.name === "EvaluateScript" && isExt(data?.url)) {
      r.extEvalMs += d;
      if (fcp === null || e.ts < fcp) r.extEvalBeforeFcpMs += d;
      const s = data.url.replace(/^chrome-extension:\/\/[^/]+\//, "");
      r.scripts[s] = (r.scripts[s] ?? 0) + d;
    } else if (e.name === "FunctionCall" && isExt(data?.url)) r.extCallbackMs += d;
    else if (e.name === "ParseAuthorStyleSheet" && isExt(data?.styleSheetUrl)) r.extCssParseMs += d;
    else if (e.name === "UpdateLayoutTree") r.styleMs += d;
  }
  for (const e of events) {
    const key = `${e.pid}:${e.id}`;
    if (e.name === "Profile") profiles.set(key, { start: e.args.data.startTime, nodes: new Map(), samples: [], deltas: [] });
    else if (e.name === "ProfileChunk" && profiles.has(key)) {
      const p = profiles.get(key);
      const cp = e.args.data.cpuProfile ?? {};
      for (const n of cp.nodes ?? []) {
        const f = n.callFrame ?? {};
        p.nodes.set(n.id, f.url ?? "");
        p.names ??= new Map();
        p.names.set(n.id, `${(f.url ?? "").replace(/^chrome-extension:\/\/[^/]+\//, "").replace(/^https:\/\/www\.youtube\.com\/.*/, "inline")}:${(f.lineNumber ?? 0) + 1}:${f.functionName || "(anon)"}`);
      }
      p.samples.push(...(cp.samples ?? []));
      p.deltas.push(...(e.args.data.timeDeltas ?? []));
    }
  }
  const fns = new Map();
  for (const p of profiles.values()) {
    let t = p.start;
    const ts = p.deltas.map((d) => (t += d));
    for (let i = 0; i + 1 < p.samples.length; i++) {
      if (navStart !== null && ts[i] < navStart) continue;
      const url = p.nodes.get(p.samples[i]);
      const d = Math.min(ts[i + 1] - ts[i], 5000) / 1000;
      const own = url === docUrl || isExt(url);
      if (own) { const k = p.names?.get(p.samples[i]) ?? "?"; fns.set(k, (fns.get(k) ?? 0) + d); }
      if (url === docUrl) { r.inlineSelfMs += d; continue; }
      if (!isExt(url)) continue;
      r.extSelfMs += d;
      if (fcp === null || ts[i] < fcp) r.extSelfBeforeFcpMs += d;
    }
  }
  r.topFns = [...fns].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k} ${v.toFixed(1)}`);
  return r;
}

async function metrics(page) {
  const { metrics: m } = await page.__cdp.send("Performance.getMetrics");
  const get = (n) => m.find((x) => x.name === n)?.value ?? 0;
  return { scriptMs: get("ScriptDuration") * 1000, taskMs: get("TaskDuration") * 1000, styleMs: get("RecalcStyleDuration") * 1000 };
}

async function longTasks(page) {
  const lt = await page.evaluate(() => window.__bench?.lt ?? []);
  return { longTaskCount: lt.length, longTaskMs: lt.reduce((a, b) => a + b, 0), longTaskMaxMs: lt.length ? Math.max(...lt) : 0 };
}

async function newPage(browser) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(INIT);
  page.__cdp = await page.createCDPSession();
  await page.__cdp.send("Performance.enable");
  page.__log = [];
  page.on("console", (m) => { if (m.text().startsWith("twitch-adblock")) page.__log.push(m.text()); });
  page.__errors = [];
  page.on("pageerror", (e) => page.__errors.push(String(e.message).slice(0, 160)));
  return page;
}

async function loadScenario(browser, url, ready, arg) {
  const page = await newPage(browser);
  await page.tracing.start({ categories: TRACE_CATEGORIES });
  const t0 = Date.now();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
  let readyMs = null;
  try {
    const h = await page.waitForFunction(ready, { polling: 50, timeout: TIMEOUT_MS }, arg);
    readyMs = await h.jsonValue();
  } catch {}
  await new Promise((r) => setTimeout(r, SETTLE_MS));
  const trace = analyzeTrace(await page.tracing.stop(), url);
  page.__docUrl = url;
  const res = { readyMs, ...trace, ...(await metrics(page)), ...(await longTasks(page)), wallMs: Date.now() - t0,
    sawAd: await page.evaluate(() => !!window.__benchAd), log: page.__log.splice(0),
    waitReplies: await page.evaluate(() => window.__bench.wait.length), pageErrors: page.__errors.splice(0) };
  return { page, res };
}

async function spaScenario(page) {
  const before = await metrics(page);
  const ltBefore = (await page.evaluate(() => window.__bench?.lt.length ?? 0));
  const waitBefore = (await page.evaluate(() => window.__bench?.wait.length ?? 0));
  await page.tracing.start({ categories: TRACE_CATEGORIES });
  const target = await page.evaluate(() => {
    const cur = new URLSearchParams(location.search).get("v");
    for (const a of document.querySelectorAll("#secondary a[href^='/watch?v=']")) {
      const id = new URLSearchParams(a.getAttribute("href").split("?")[1]).get("v");
      if (id && id !== cur && a.offsetParent !== null) {
        a.scrollIntoView({ block: "center" });
        window.__benchAd = false;
        window.__benchClick = performance.now();
        a.click();
        return id;
      }
    }
    return null;
  });
  if (!target) {
    await page.tracing.stop();
    return { readyMs: null, error: "no related link" };
  }
  let readyMs = null;
  try {
    const h = await page.waitForFunction(contentPlaying, { polling: 50, timeout: TIMEOUT_MS }, target);
    readyMs = (await h.jsonValue()) - (await page.evaluate(() => window.__benchClick));
  } catch {}
  await new Promise((r) => setTimeout(r, SETTLE_MS));
  const { extSelfMs, extCallbackMs, inlineSelfMs, topFns, styleMs: traceStyleMs } = analyzeTrace(await page.tracing.stop(), page.__docUrl);
  const after = await metrics(page);
  const lt = (await page.evaluate((n) => window.__bench.lt.slice(n), ltBefore));
  return {
    readyMs,
    sawAd: await page.evaluate(() => !!window.__benchAd),
    log: page.__log.splice(0),
    pageErrors: page.__errors.splice(0),
    waitReplies: (await page.evaluate(() => window.__bench.wait.length)) - waitBefore,
    extSelfMs, extCallbackMs, inlineSelfMs, traceStyleMs, topFns,
    scriptMs: after.scriptMs - before.scriptMs,
    taskMs: after.taskMs - before.taskMs,
    styleMs: after.styleMs - before.styleMs,
    longTaskCount: lt.length,
    longTaskMs: lt.reduce((a, b) => a + b, 0),
    longTaskMaxMs: lt.length ? Math.max(...lt) : 0,
  };
}

async function acceptConsent(page) {
  if (!/consent\./.test(page.url())) return;
  await page.evaluate(() => document.querySelector("form[action*='consent'] button")?.click());
  await page.waitForNavigation({ timeout: 15000 }).catch(() => {});
}

async function runOnce(variant, run) {
  const userDataDir = path.join(os.tmpdir(), `yt-bench-${variant.label}`);
  const browser = await puppeteer.launch({
    executablePath: opt.chrome,
    headless: !opt.headful,
    userDataDir,
    enableExtensions: variant.dir ? [variant.dir] : false,
    defaultViewport: { width: 1366, height: 860 },
    args: [
      "--autoplay-policy=no-user-gesture-required",
      "--window-size=1366,960",
      "--no-first-run",
      "--mute-audio",
      `--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36`,
    ],
  });
  try {
    await new Promise((r) => setTimeout(r, 1500));
    {
      const p = await browser.newPage();
      await p.goto("https://www.youtube.com/robots.txt");
      await p.evaluate((o) => {
        if (o) localStorage.setItem("twitch-adblock-ubo-opts", JSON.stringify(o));
        else localStorage.removeItem("twitch-adblock-ubo-opts");
      }, variant.opts ?? null);
      await p.close();
    }
    const home = await loadScenario(browser, "https://www.youtube.com/", homeReady);
    await acceptConsent(home.page);
    await home.page.close();
    const id = VIDEOS[run % VIDEOS.length];
    const watch = await loadScenario(browser, `https://www.youtube.com/watch?v=${id}`, contentPlaying, id);
    const spa = await spaScenario(watch.page);
    return { home: home.res, watch: watch.res, spa };
  } finally {
    await browser.close();
  }
}

const median = (xs) => {
  const v = xs.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

const results = Object.fromEntries(opt.variants.map((v) => [v.label, []]));
for (let run = 0; run <= opt.runs; run++) {
  for (const v of opt.variants) {
    process.stderr.write(`run ${run}${run === 0 ? " (warm-up)" : ""} ${v.label}... `);
    try {
      const r = await runOnce(v, run);
      process.stderr.write(`home ${r.home.readyMs?.toFixed(0)} watch ${r.watch.readyMs?.toFixed(0)} spa ${r.spa.readyMs?.toFixed(0)}\n`);
      if (run > 0) results[v.label].push(r);
    } catch (e) {
      process.stderr.write(`failed: ${e.message}\n`);
    }
  }
}

const KEYS = ["readyMs", "waitReplies", "fcpMs", "extEvalMs", "extEvalBeforeFcpMs", "extSelfMs", "extSelfBeforeFcpMs",
  "extCallbackMs", "extCssParseMs", "inlineSelfMs", "traceStyleMs", "scriptMs", "taskMs", "styleMs", "longTaskCount", "longTaskMs", "longTaskMaxMs"];
const summary = {};
for (const [label, runs] of Object.entries(results)) {
  summary[label] = {};
  for (const sc of ["home", "watch", "spa"]) {
    summary[label][sc] = {};
    for (const k of KEYS) {
      const m = median(runs.map((r) => r[sc]?.[k]));
      if (m !== null) summary[label][sc][k] = Math.round(m * 10) / 10;
    }
    summary[label][sc].n = runs.filter((r) => typeof r[sc]?.readyMs === "number").length;
    summary[label][sc].pageErrors = runs.reduce((a, r) => a + (r[sc]?.pageErrors?.length ?? 0), 0);
  }
}
for (const sc of ["home", "watch", "spa"]) {
  console.log(`\n== ${sc} (medians, ms) ==`);
  console.table(Object.fromEntries(Object.entries(summary).map(([l, s]) => [l, s[sc]])));
}
if (opt.out) fs.writeFileSync(opt.out, JSON.stringify({ opt, summary, results }, null, 2));
