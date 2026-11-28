// YouTube start times (opt-in diagnostics). The record logic in src/youtube.js
// (createStartTimer), the checks and the store format in
// src/settings/features.js (GeckoFeatures.startTimes), the bridge
// youtube.js -> flags.js -> chrome.storage.local, and the settings page
// summary, Copy as text, Download and Clear. Privacy rule: no video id, URL,
// title, channel or account in any stored or exported field.
import "../src/settings/features.js";
import youtubeSource from "../src/youtube.js" with { type: "text" };
import flagsSource from "../src/settings/flags.js" with { type: "text" };
import settingsHtml from "../src/settings.html" with { type: "text" };
import settingsSource from "../src/settings.js" with { type: "text" };
import { unwrapMain } from "./fixtures/main-source.mjs";
import { withYtOpts } from "./fixtures/source-opts.mjs";

function assert(c, l) { if (!c) throw new Error(l); }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const tick = () => new Promise((r) => setTimeout(r, 5));
const F = globalThis.GeckoFeatures;
const ST = F.startTimes;
const FIELDS = ["time", "version", "kind", "waitMs", "ad", "toast", "timeout"];

const api = {};
new Function(`${unwrapMain(youtubeSource)}\nreturn installYoutubeAdblock;`)()(api);

function timer(giveUpMs = 60000, skipGiveUp) {
  const clock = { t: 0 };
  const out = [];
  const t = api.createStartTimer({ now: () => clock.t, giveUpMs, emit: (r) => out.push(r), skipGiveUp });
  return { t, clock, out };
}
const playing = (played, extra = {}) => Object.assign({ played, paused: false, adShowing: false, toast: false, hidden: false }, extra);

// ---- record logic (createStartTimer) ----

Deno.test("start timer: wait from navigation start to the first 0.5 s of play", () => {
  const { t, clock, out } = timer();
  t.begin("first-load", 0);
  clock.t = 1500;
  assert(t.sample(playing(0.2)) === null, "0.2 s is not a start");
  assert(t.sample(playing(0.9, { paused: true })) === null, "paused is not a start");
  clock.t = 4321.4;
  const rec = t.sample(playing(0.6));
  assert(eq(rec, { kind: "first-load", waitMs: 4321, ad: false, toast: false, timeout: false }), JSON.stringify(rec));
  assert(out.length === 1 && !t.active(), "emitted once, then idle");
  assert(t.sample(playing(5)) === null && out.length === 1, "no second record for the same start");
});

Deno.test("start timer: in-page start counts from yt-navigate-start (t0)", () => {
  const { t, clock } = timer();
  clock.t = 10000;
  t.begin("in-page", 9000);
  clock.t = 12500;
  const rec = t.sample(playing(1));
  assert(rec.kind === "in-page" && rec.waitMs === 3500, JSON.stringify(rec));
});

Deno.test("start timer: an ad first sets ad and keeps waiting for the main video", () => {
  const { t, clock } = timer();
  t.begin("in-page", 0);
  clock.t = 2000;
  assert(t.sample(playing(3, { adShowing: true })) === null, "the ad playing is not the start");
  clock.t = 17000;
  const rec = t.sample(playing(0.7));
  assert(rec.ad === true && rec.waitMs === 17000 && rec.timeout === false, JSON.stringify(rec));
});

Deno.test("start timer: the interruptions toast seen at any poll is recorded", () => {
  const { t, clock } = timer();
  t.begin("first-load", 0);
  clock.t = 3000;
  t.tick({ toast: true, hidden: false, adShowing: false });
  clock.t = 8000;
  const rec = t.sample(playing(0.6));
  assert(rec.toast === true && rec.ad === false, JSON.stringify(rec));
});

Deno.test("start timer: gives up after 60 s with a timeout record", () => {
  const { t, clock, out } = timer();
  t.begin("in-page", 1000);
  clock.t = 60999;
  assert(t.tick({}) === null, "not yet");
  clock.t = 61000;
  const rec = t.tick({});
  assert(eq(rec, { kind: "in-page", waitMs: 60000, ad: false, toast: false, timeout: true }), JSON.stringify(rec));
  assert(out.length === 1 && !t.active(), "one timeout record");
});

Deno.test("start timer: at the give-up time, skipGiveUp true drops the start (tick and sample); it is asked only then", () => {
  let asked = 0;
  let skip = true;
  const { t, clock, out } = timer(60000, () => { asked++; return skip; });
  t.begin("first-load", 0);
  clock.t = 30000;
  assert(t.tick({}) === null && asked === 0, "not asked before the give-up time");
  clock.t = 60000;
  assert(t.tick({}) === null && out.length === 0 && !t.active() && asked === 1, "tick: dropped, no timeout record");
  t.begin("in-page", 0);
  clock.t = 120000;
  assert(t.sample(playing(0)) === null && out.length === 0 && !t.active(), "sample: dropped too");
  skip = false;
  t.begin("in-page", 120000);
  clock.t = 180000;
  const rec = t.tick({});
  assert(rec && rec.timeout === true && out.length === 1, "skipGiveUp false: the timeout record");
});

Deno.test("start timer: a hidden tab, a cancel or a new start drops the pending start", () => {
  const a = timer();
  a.t.begin("first-load", 0, true);
  a.clock.t = 2000;
  assert(a.t.sample(playing(1)) === null && a.out.length === 0, "started hidden: dropped");
  const b = timer();
  b.t.begin("first-load", 0);
  b.t.tick({ hidden: true });
  b.clock.t = 61000;
  assert(b.t.tick({}) === null && b.out.length === 0, "hidden during the wait: no false timeout");
  const c = timer();
  c.t.begin("in-page", 0);
  c.t.cancel();
  c.clock.t = 70000;
  assert(c.t.tick({}) === null && c.out.length === 0 && !c.t.active(), "cancel: nothing");
  const d = timer();
  d.t.begin("in-page", 0);
  d.clock.t = 5000;
  d.t.begin("in-page", 5000);
  d.clock.t = 6000;
  const rec = d.t.sample(playing(1));
  assert(d.out.length === 1 && rec.waitMs === 1000, "a new navigation replaces the old start, which is not a timeout");
});

// ---- checks and store format (GeckoFeatures.startTimes) ----

Deno.test("start-time entry: only the allowed fields; URL, id or title from the page never stored", () => {
  const now = Date.UTC(2026, 10, 28, 14, 5, 42, 123);
  const e = ST.entry({ kind: "in-page", waitMs: 4321.6, ad: true, toast: false, timeout: false, url: "https://www.youtube.com/watch?v=AAAAAAAAAAA", videoId: "AAAAAAAAAAA", title: "x" }, now, "0.3.7");
  assert(eq(Object.keys(e), FIELDS), JSON.stringify(e));
  assert(eq(e, { time: "2026-11-28T14:05Z", version: "0.3.7", kind: "in-page", waitMs: 4322, ad: true, toast: false, timeout: false }), JSON.stringify(e));
  assert(!JSON.stringify(e).includes("AAAAAAAAAAA") && !JSON.stringify(e).includes("youtube"), "no id or URL");
  assert(ST.entry({ kind: "first-load", waitMs: 99999, ad: false, toast: false, timeout: true }, now, "0.3.7").waitMs === 60000, "clamped to 60 s");
  for (const bad of [null, "x", { kind: "other", waitMs: 1, ad: false, toast: false, timeout: false }, { kind: "in-page", waitMs: "1", ad: false, toast: false, timeout: false },
    { kind: "in-page", waitMs: -1, ad: false, toast: false, timeout: false }, { kind: "in-page", waitMs: 1, ad: 1, toast: false, timeout: false }, { kind: "in-page", waitMs: NaN, ad: false, toast: false, timeout: false }]) {
    assert(ST.entry(bad, now, "0.3.7") === null, "rejected: " + JSON.stringify(bad));
  }
  assert(ST.entry({ kind: "in-page", waitMs: 1, ad: false, toast: false, timeout: false }, now, "<b>").version === "", "odd version text dropped");
});

Deno.test("start-time store: off by default, at most 300 entries, the oldest go first", () => {
  assert(eq(ST.normalize(undefined), { v: 1, on: false, log: [] }), "default off and empty");
  assert(ST.KEY === "ytStartTimes" && ST.MAX === 300, "one key, cap 300");
  let s = { v: 1, on: true, log: [] };
  for (let i = 0; i < 305; i++) s = ST.append(s, ST.entry({ kind: "in-page", waitMs: i, ad: false, toast: false, timeout: false }, Date.UTC(2026, 10, 28), "0.3.7"));
  assert(s.log.length === 300 && s.log[0].waitMs === 5 && s.log.at(-1).waitMs === 304 && s.on === true, "kept the newest 300");
  const dirty = ST.normalize({ on: "yes", log: [{ ...s.log[0], url: "https://x.example/" }, { time: "bad" }, 7] });
  assert(dirty.on === false && dirty.log.length === 1 && eq(Object.keys(dirty.log[0]), FIELDS), "stored rows checked again: " + JSON.stringify(dirty));
});

Deno.test("start-time stats: nearest-rank median and 90th percentile over played starts; timeouts counted apart", () => {
  const mk = (waitMs, o = {}) => ({ time: "2026-11-28T14:05Z", version: "0.3.7", kind: "in-page", waitMs, ad: false, toast: false, timeout: false, ...o });
  const log = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000].map((w) => mk(w));
  log.push(mk(60000, { timeout: true }), mk(4500, { ad: true, toast: true }));
  const s = ST.stats(log);
  // played waits sorted: 1000..4000, 4500, 5000..10000 (n = 11): rank ceil(5.5)=6 -> 5000, rank ceil(9.9)=10 -> 9000
  assert(eq(s, { count: 12, played: 11, timeouts: 1, ads: 1, toasts: 1, median: 5000, p90: 9000 }), JSON.stringify(s));
  assert(eq(ST.stats([]), { count: 0, played: 0, timeouts: 0, ads: 0, toasts: 0, median: null, p90: null }), "empty");
  assert(ST.summary([]) === "No video starts recorded.", "empty summary");
  const text = ST.text(log);
  const lines = text.trimEnd().split("\n");
  assert(lines[0] === "Adgecko YouTube start times" && lines[1].startsWith("12 video starts recorded (1 gave up after 60 s). Median wait 5.0 s, 90th percentile 9.0 s."), lines.slice(0, 2).join("|"));
  assert(/^time \(UTC\)\s+version\s+kind\s+wait_s\s+ad\s+toast\s+timeout$/.test(lines[3]), lines[3]);
  assert(lines.length === 4 + 12 && /^2026-11-28T14:05Z\s+0\.3\.7\s+in-page\s+>60\.0\s+no\s+no\s+yes$/.test(lines[14]), lines[14]);
});

// ---- the bridge: real youtube.js (MAIN) and flags.js (ISOLATED) on one fake window ----

function page({ on = true, href = "https://www.youtube.com/watch?v=AAAAAAAAAAA", hostname = "www.youtube.com", top = true } = {}) {
  const store = { settings: { v: 1, enabled: true, features: {} }, siteOverrides: {}, ytStartTimes: { v: 1, on, log: [] } };
  const changed = [];
  const chrome = {
    runtime: { lastError: undefined, onMessage: { addListener() {} }, getManifest: () => ({ version: "0.3.7" }) },
    storage: {
      local: {
        get(keys, cb) { const out = {}; for (const k of [].concat(keys)) if (k in store) out[k] = structuredClone(store[k]); cb(out); },
        set(patch, cb) { Object.assign(store, structuredClone(patch)); if (cb) cb(); },
      },
      onChanged: { addListener(f) { changed.push(f); } },
    },
  };
  const win = new EventTarget();
  win.top = top ? win : {};
  win.fetch = () => Promise.resolve(new Response("{}"));
  const clock = { t: 0 };
  const performance = { now: () => clock.t };
  const polls = []; // the 1 s start-time polls; other intervals of youtube.js are not run
  const others = [];
  const listeners = {};
  const classes = new Set();
  const video = { tagName: "VIDEO", currentTime: 0, paused: true, readyState: 1, buffered: { length: 0, end: () => 0 }, src: "", currentSrc: "" };
  const overlays = {}; // ".ytp-error" or ".ytp-offline-slate" -> a fake element
  const player = { id: "movie_player", className: "", classList: { contains: (c) => classes.has(c) }, contains: (n) => n === video, querySelector: (s) => (s === "video" ? video : overlays[s] || null), getVideoData: () => ({ video_id: "" }), getPlayerState: () => -1 };
  const docEl = { setAttribute() {}, removeAttribute() {}, appendChild() {}, querySelector: () => null };
  let toastText = "";
  const document = {
    readyState: "complete", hidden: false, documentElement: docEl, head: docEl, body: docEl,
    addEventListener: (type, fn) => { const l = (listeners[type] ||= []); if (!l.includes(fn)) l.push(fn); },
    removeEventListener: (type, fn) => { const l = listeners[type] || []; if (l.includes(fn)) l.splice(l.indexOf(fn), 1); },
    querySelector: (s) => (s === "#movie_player" ? player : s === "snackbar-container" && toastText ? { textContent: toastText } : null),
    querySelectorAll: () => [],
    getElementById: (id) => (id === "movie_player" ? player : null),
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, remove() {} }),
  };
  const fire = (type, detail, target = document) => { for (const fn of listeners[type] || []) fn({ type, target, detail }); };
  const u = new URL(href);
  const location = { hostname, origin: u.origin, pathname: u.pathname, search: u.search, href };
  const XHR = function () {};
  for (const m of ["open", "send", "addEventListener", "setRequestHeader"]) XHR.prototype[m] = function () {};
  class MO { observe() {} disconnect() {} }
  const noop = () => 0;
  const setI = (fn, ms) => { polls.push(ms === 1000 ? fn : null); others.push(fn); return polls.length; };
  const clearI = (id) => { polls[id - 1] = null; };
  const saved = { parse: JSON.parse, toString: Function.prototype.toString };
  delete globalThis[Symbol.for("gk.y")];
  globalThis[Symbol.for("gk.u")] = true;
  const yt = new Function("window", "document", "location", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "XMLHttpRequest", "MutationObserver", "PerformanceObserver", "requestAnimationFrame", "requestIdleCallback", "fetch",
    withYtOpts(youtubeSource, { diag: false }));
  // Manifest: src/youtube.js (MAIN) is listed before flags.js (ISOLATED).
  yt(win, document, location, noop, noop, setI, clearI, performance, XHR, MO, class { observe() {} disconnect() {} }, noop, noop, win.fetch);
  new Function("chrome", "window", "location", "globalThis", flagsSource)(chrome, win, location, globalThis);
  const restore = () => { JSON.parse = saved.parse; Function.prototype.toString = saved.toString; delete globalThis[Symbol.for("gk.y")]; delete globalThis[Symbol.for("gk.u")]; };
  const poll = () => { for (const p of polls) if (p) p(); };
  const play = (t) => { video.currentTime = t; video.paused = false; fire("timeupdate", {}, video); };
  const MEDIA = ["timeupdate", "playing", "loadstart", "emptied", "seeked"];
  // The start-time listener is the one function on all five events (other
  // youtube.js listeners, such as the stall watchdog, use fewer of them).
  const mediaListeners = () => {
    const all = (listeners[MEDIA[0]] || []).filter((fn) => MEDIA.every((t) => (listeners[t] || []).includes(fn)));
    return all.length * MEDIA.length;
  };
  return { store, changed, clock, fire, video, classes, overlays, play, poll, restore, location, setToast: (t) => { toastText = t; }, livePolls: () => polls.filter(Boolean).length, mediaListeners };
}

Deno.test({
  name: "bridge: a first load and an in-page start reach ytStartTimes with only the allowed fields",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const p = page();
    try {
      await tick(); // flags (ytTiming on) arrive over the port
      p.clock.t = 2000;
      p.play(0.1); // the start position
      p.clock.t = 2300;
      p.play(0.4);
      p.clock.t = 2500;
      p.play(0.7); // 0.6 s of play
      await tick();
      // In-page click to another video. The old video keeps playing for a
      // moment: its time updates must not end the new start.
      p.clock.t = 10000;
      p.fire("yt-navigate-start", { url: "/watch?v=BBBBBBBBBBB" });
      for (const t of [95, 95.25, 95.5, 95.75, 96]) p.play(t);
      p.fire("loadstart", {}, p.video); // the new video loads; an ad first, with the toast
      p.classes.add("ad-showing");
      p.clock.t = 11000;
      p.play(0.5);
      p.play(2);
      p.setToast("Experiencing interruptions? Find out why");
      p.poll();
      p.classes.delete("ad-showing");
      p.fire("loadstart", {}, p.video); // the main video after the ad
      await tick(); // flags.js allows one record per second (real clock)
      await new Promise((r) => setTimeout(r, 1000));
      p.clock.t = 15600;
      p.play(0);
      p.clock.t = 16000;
      p.play(0.6);
      await tick();
      const log = p.store.ytStartTimes.log;
      assert(log.length === 2, JSON.stringify(log));
      for (const e of log) assert(eq(Object.keys(e), FIELDS) && /^\d{4}-\d\d-\d\dT\d\d:\d\dZ$/.test(e.time) && e.version === "0.3.7", JSON.stringify(e));
      assert(log[0].kind === "first-load" && log[0].waitMs === 2500 && !log[0].ad && !log[0].timeout, JSON.stringify(log[0]));
      assert(log[1].kind === "in-page" && log[1].waitMs === 6000 && log[1].ad && log[1].toast, JSON.stringify(log[1]));
      const raw = JSON.stringify(p.store.ytStartTimes);
      assert(!raw.includes("AAAAAAAAAAA") && !raw.includes("BBBBBBBBBBB") && !raw.includes("youtube"), "no id or URL stored");
      assert(p.livePolls() === 0 && p.mediaListeners() === 0, "no poll and no media listener left after the start");
    } finally {
      p.restore();
    }
  },
});

Deno.test({
  name: "bridge: a t= link or resumed video counts 0.5 s of play from its start position; a preview video outside the player is ignored",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const p = page();
    try {
      await tick();
      p.clock.t = 3000;
      p.play(120); // the player jumped to 2:00 but has not moved yet
      p.clock.t = 7000;
      p.play(120.2);
      assert(p.store.ytStartTimes.log.length === 0 && p.livePolls() === 1, "not a start yet");
      const preview = { tagName: "VIDEO", currentTime: 5, paused: false };
      p.fire("timeupdate", {}, preview);
      p.clock.t = 7400;
      p.play(120.7);
      await tick();
      const log = p.store.ytStartTimes.log;
      assert(log.length === 1 && log[0].waitMs === 7400, JSON.stringify(log));
    } finally {
      p.restore();
    }
  },
});

Deno.test({
  name: "bridge: a resume or t= seek after a first sample at 0:00 is not play; the start ends at the first 0.5 s after the jump",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const p = page();
    try {
      await tick();
      p.clock.t = 1000;
      p.play(0); // one time update at 0:00
      p.clock.t = 2000;
      p.play(120); // the resume or t= jump to 2:00, still buffering (not paused)
      assert(p.store.ytStartTimes.log.length === 0, "a 120 s jump is not play");
      p.clock.t = 4000;
      p.video.seeking = true;
      p.play(300); // a seek in progress is not play either
      p.video.seeking = false;
      p.fire("seeked", {}, p.video); // the first sample after the seek sets the base
      p.clock.t = 5000;
      p.play(300.2);
      assert(p.store.ytStartTimes.log.length === 0, "the seek is not a start");
      p.clock.t = 9000;
      p.play(300.6);
      await tick();
      const log = p.store.ytStartTimes.log;
      assert(log.length === 1 && log[0].waitMs === 9000 && log[0].timeout === false, JSON.stringify(log));
    } finally {
      p.restore();
    }
  },
});

Deno.test({
  name: "bridge: play(0), play(120) unpaused, then the start ends only at play(120.6)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const p = page();
    try {
      await tick();
      p.clock.t = 1000;
      p.play(0);
      p.clock.t = 3000;
      p.play(120);
      await tick();
      assert(p.store.ytStartTimes.log.length === 0, "no record at the jump");
      p.clock.t = 7000;
      p.play(120.6);
      await tick();
      const log = p.store.ytStartTimes.log;
      assert(log.length === 1 && log[0].waitMs === 7000, JSON.stringify(log));
    } finally {
      p.restore();
    }
  },
});

Deno.test({
  name: "bridge: off by default; switched off, nothing is measured or stored; on a non-watch page nothing starts",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const off = page({ on: false });
    try {
      await tick();
      assert(off.livePolls() === 0 && off.mediaListeners() === 0, "the flag off stops the first-load measurement and its listeners");
      off.clock.t = 2000;
      off.play(1);
      off.fire("yt-navigate-start", { url: "/watch?v=BBBBBBBBBBB" });
      assert(off.livePolls() === 0, "no in-page measurement while off");
      await tick();
      assert(off.store.ytStartTimes.log.length === 0, "nothing stored while off");
    } finally {
      off.restore();
    }
    const home = page({ href: "https://www.youtube.com/" });
    try {
      assert(home.livePolls() === 0 && home.mediaListeners() === 0, "home page: nothing starts, no media listener");
      await tick();
      home.fire("yt-navigate-start", { url: "/shorts/CCCCCCCCCCC" });
      assert(home.livePolls() === 0 && home.mediaListeners() === 0, "Shorts: nothing starts");
      home.fire("yt-navigate-start", { url: "/watch?v=CCCCCCCCCCC" });
      assert(home.livePolls() === 1 && home.mediaListeners() === 5, "a watch page starts one measurement with one set of media listeners");
      home.location.href = "https://www.youtube.com/watch?v=CCCCCCCCCCC";
      home.fire("yt-navigate-start", { url: "/watch?v=DDDDDDDDDDD" });
      assert(home.livePolls() === 1 && home.mediaListeners() === 5, "a new start does not add the listeners twice");
      home.fire("yt-navigate-start", { url: "/feed/subscriptions" });
      assert(home.livePolls() === 0 && home.mediaListeners() === 0, "leaving before play drops it and its listeners");
    } finally {
      home.restore();
    }
  },
});

Deno.test({
  name: "bridge: a timeout is stored as one record; flags.js ignores records off YouTube and in child frames",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const p = page();
    try {
      await tick();
      p.clock.t = 60000;
      p.poll();
      await tick();
      const log = p.store.ytStartTimes.log;
      assert(log.length === 1 && log[0].timeout === true && log[0].waitMs === 60000, JSON.stringify(log));
      assert(p.livePolls() === 0 && p.mediaListeners() === 0, "no poll and no listener after the timeout");
    } finally {
      p.restore();
    }
    // flags.js alone, as on an ordinary site and in a YouTube child frame.
    for (const [hostname, top] of [["news.example", true], ["www.youtube.com", false]]) {
      const store = { ytStartTimes: { v: 1, on: true, log: [] } };
      let reads = 0;
      const chrome = {
        runtime: { lastError: undefined, onMessage: { addListener() {} }, getManifest: () => ({ version: "0.3.7" }) },
        storage: { local: { get(keys, cb) { if ([].concat(keys).includes("ytStartTimes")) reads++; cb(structuredClone(store)); }, set(patch, cb) { Object.assign(store, patch); if (cb) cb(); } }, onChanged: { addListener() {} } },
      };
      const win = new EventTarget();
      win.top = top ? win : {};
      let port = null;
      win.addEventListener("gk-p1", (e) => { port = port || e.ports[0]; }, true);
      new Function("chrome", "window", "location", "globalThis", flagsSource)(chrome, win, { hostname, origin: "https://" + hostname }, globalThis);
      const got = [];
      port.onmessage = (m) => got.push(m.data);
      port.postMessage({ y: { kind: "in-page", waitMs: 1000, ad: false, toast: false, timeout: false } });
      await tick();
      assert(store.ytStartTimes.log.length === 0 && reads === 0, hostname + " top=" + top + ": no read, no write");
      assert(got.length && !("ytTiming" in got[0].f), "no ytTiming flag there: " + JSON.stringify(got));
      port.close();
    }
  },
});

Deno.test({
  name: "bridge: no timeout record for a waiting room, an error overlay, a paused start with data, or a video with no media",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const shown = { offsetWidth: 640, offsetHeight: 360 };
    const cases = [
      ["offline slate (premiere or upcoming live)", (p) => { p.overlays[".ytp-offline-slate"] = shown; }],
      ["error overlay (members-only, age gate, removed)", (p) => { p.overlays[".ytp-error"] = shown; }],
      ["paused with data (autoplay blocked, no click yet)", (p) => { p.video.readyState = 4; p.video.paused = true; }],
      ["no media after it was armed", (p) => { p.video.readyState = 0; }],
    ];
    for (const [label, setUp] of cases) {
      const p = page();
      try {
        setUp(p);
        await tick();
        p.clock.t = 30000;
        p.poll();
        p.clock.t = 61000;
        p.poll();
        await tick();
        assert(p.store.ytStartTimes.log.length === 0, label + ": " + JSON.stringify(p.store.ytStartTimes.log));
        assert(p.livePolls() === 0 && p.mediaListeners() === 0, label + ": dropped, no poll or listener left");
      } finally {
        p.restore();
      }
    }
    // An overlay element that is present but not shown does not drop a real stall.
    const p = page();
    try {
      p.overlays[".ytp-error"] = { offsetWidth: 0, offsetHeight: 0 };
      await tick();
      p.clock.t = 61000;
      p.poll();
      await tick();
      const log = p.store.ytStartTimes.log;
      assert(log.length === 1 && log[0].timeout === true, "hidden overlay: still a timeout: " + JSON.stringify(log));
    } finally {
      p.restore();
    }
  },
});

Deno.test({
  name: "bridge: real stalls stay timeouts: the paused black stall with a spinner, an in-page start with media that never plays, an in-page start the player never takes",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const spinning = { offsetWidth: 64, offsetHeight: 64 };
    const cases = [
      ["first load, paused with data, spinner shown (the black stall)", false, (p) => { p.video.readyState = 4; p.video.paused = true; p.overlays[".ytp-spinner"] = spinning; }],
      ["first load, paused with data, buffering-mode", false, (p) => { p.video.readyState = 3; p.video.paused = true; p.classes.add("buffering-mode"); }],
      ["in-page, loadstart then metadata, never plays", true, (p) => {
        p.video.readyState = 0;
        p.fire("loadstart", {}, p.video);
        p.video.readyState = 1;
      }],
      ["in-page, no media event, no overlay", true, () => {}],
    ];
    for (const [label, inPage, setUp] of cases) {
      const p = page();
      try {
        await tick();
        if (inPage) {
          p.clock.t = 1000;
          p.fire("yt-navigate-start", { url: "/watch?v=BBBBBBBBBBB" });
        }
        setUp(p);
        p.clock.t = 30000;
        p.poll();
        p.clock.t = 62000;
        p.poll();
        await tick();
        const log = p.store.ytStartTimes.log;
        assert(log.length === 1 && log[0].timeout === true && log[0].kind === (inPage ? "in-page" : "first-load"), label + ": " + JSON.stringify(log));
      } finally {
        p.restore();
      }
    }
  },
});

// ---- settings page ----

function fakeElement(tag) {
  const listeners = {};
  return {
    tag, textContent: "", className: "", type: "", value: "", checked: false, disabled: false, dataset: {}, children: [],
    get firstChild() { return this.children[0] || null; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children.splice(this.children.indexOf(c), 1); return c; },
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    async fire(t) { let r; for (const fn of listeners[t] || []) r = await fn({ type: t }); return r; },
    querySelectorAll() { return []; },
    setAttribute() {},
    click() { this.clicked = true; },
  };
}

async function openSettings(stored) {
  const storage = structuredClone(stored);
  const changed = [];
  const chrome = {
    runtime: { lastError: undefined, sendMessage(_m, cb) { cb({ ok: true }); } },
    storage: {
      local: {
        get(keys, cb) { const out = {}; for (const k of keys) if (k in storage) out[k] = structuredClone(storage[k]); cb(out); },
        set(patch, cb) { Object.assign(storage, structuredClone(patch)); cb(); for (const fn of changed) fn(Object.fromEntries(Object.keys(patch).map((k) => [k, {}])), "local"); },
      },
      onChanged: { addListener(fn) { changed.push(fn); } },
    },
  };
  const elements = {};
  for (const m of settingsHtml.matchAll(/\bid="([^"]+)"/g)) elements[m[1]] = fakeElement("page");
  const made = [];
  const document = {
    getElementById: (id) => elements[id] || null,
    createElement: (tag) => { const e = fakeElement(tag); made.push(e); return e; },
    documentElement: { setAttribute() {}, removeAttribute() {} },
  };
  const copied = [];
  const navigator = { clipboard: { writeText: (t) => { copied.push(t); return Promise.resolve(); } } };
  const blobs = [];
  const URLx = { createObjectURL: (b) => { blobs.push(b); return "blob:test"; }, revokeObjectURL() {} };
  globalThis.GeckoThreatCompile = { userDomainReason: (v) => ({ domain: v }) };
  new Function("document", "chrome", "navigator", "URL", "setTimeout", settingsSource)(document, chrome, navigator, URLx, () => 0);
  for (let i = 0; i < 5; i++) await tick();
  return { storage, elements, copied, blobs, made };
}

Deno.test({
  name: "settings page: switch, summary, Copy as text, Download (JSON blob) and Clear",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    assert(/<h2 id="h-ytstart">YouTube start times<\/h2>/.test(settingsHtml) && /id="yt-start-on" type="checkbox">/.test(settingsHtml) && !/id="yt-start-on"[^>]*checked/.test(settingsHtml), "section, unchecked box");
    const mk = (waitMs, o = {}) => ({ time: "2026-11-28T14:05Z", version: "0.3.7", kind: "in-page", waitMs, ad: false, toast: false, timeout: false, ...o });
    const s = await openSettings({ ytStartTimes: { v: 1, on: false, log: [mk(2000), mk(4000), mk(60000, { timeout: true })] } });
    const E = s.elements;
    assert(E["yt-start-on"].checked === false, "box off");
    assert(E["yt-start-summary"].textContent.startsWith("Not recording. 3 video starts recorded (1 gave up after 60 s). Median wait 2.0 s"), E["yt-start-summary"].textContent);
    E["yt-start-on"].checked = true;
    await E["yt-start-on"].fire("change");
    assert(s.storage.ytStartTimes.on === true && s.storage.ytStartTimes.log.length === 3, "switch saved, log kept");
    assert(E["yt-start-summary"].textContent.startsWith("Recording. "), E["yt-start-summary"].textContent);
    const topBefore = E.status.textContent;
    await E["yt-start-copy"].fire("click");
    assert(s.copied.length === 1 && s.copied[0] === ST.text(s.storage.ytStartTimes.log) && E["yt-start-status"].textContent === "Copied 3 video starts as text.", E["yt-start-status"].textContent);
    const json = await E["yt-start-download"].fire("click");
    const a = s.made.find((e) => e.tag === "a");
    assert(a && a.clicked && a.download === "adgecko-youtube-start-times.json" && a.href === "blob:test" && s.blobs.length === 1, "blob link clicked");
    assert(E["yt-start-status"].textContent === "Downloaded 3 video starts.", E["yt-start-status"].textContent);
    const parsed = JSON.parse(json);
    assert(parsed.starts.length === 3 && parsed.summary.median === 2000 && eq(Object.keys(parsed.starts[0]), FIELDS), json);
    await E["yt-start-clear"].fire("click");
    assert(eq(s.storage.ytStartTimes, { v: 1, on: true, log: [] }), "cleared, switch kept: " + JSON.stringify(s.storage.ytStartTimes));
    assert(E["yt-start-status"].textContent === "Cleared the YouTube start times.", E["yt-start-status"].textContent);
    const start = settingsHtml.indexOf('<section aria-labelledby="h-ytstart">');
    const section = settingsHtml.slice(start, settingsHtml.indexOf("</section>", start));
    assert(start >= 0 && section.includes('<p id="yt-start-status" role="status"></p>'), "the result line is inside the YouTube start times section");
    assert(E.status.textContent === topBefore, "Copy, Download and Clear leave the top status line alone: " + E.status.textContent);
    assert(E["yt-start-summary"].textContent === "Recording. No video starts recorded.", E["yt-start-summary"].textContent);
    assert(!/\.innerHTML\s*=/.test(settingsSource), "text only");
  },
});

Deno.test("storage key: ytStartTimes is documented in ARCHITECTURE.md section 9 and the privacy page", () => {
  const arch = Deno.readTextFileSync(new URL("../.planning/codebase/ARCHITECTURE.md", import.meta.url));
  const sec9 = arch.slice(arch.indexOf("## 9. Storage keys"), arch.indexOf("## 10."));
  assert(/\| `ytStartTimes` \|/.test(sec9), "key table row");
  const priv = Deno.readTextFileSync(new URL("../docs/permissions-and-privacy.md", import.meta.url));
  assert(priv.includes("`ytStartTimes`") && /off by default/i.test(priv), "privacy page names the key and the default");
  assert(F.startTimes.KEY === "ytStartTimes", "one key");
});
