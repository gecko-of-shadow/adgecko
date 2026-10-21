// Runs the whole src/youtube.js on a virtual clock (fake Date, timers and
// performance) with the uBO marker set before load, then drives two watch navigations and records reload times.
// SCENARIO: "prev-reply" (105B SABR wait reply during video A, video B stalls),
// "own-reply" (the reply comes during video B), "no-reply". YT_SRC overrides the
// youtube.js path. Used by test/youtube-decoy-nav.test.js. All urls are synthetic.
const SCENARIO = Deno.env.get("SCENARIO") || "prev-reply";
const source = await Deno.readTextFile(Deno.env.get("YT_SRC") || new URL("../../src/youtube.js", import.meta.url));
const RealDate = Date;
const BASE = 1792548600000;
let now = BASE;
class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(now); } static now() { return now; } }
const performance = { now: () => now - BASE, timeOrigin: BASE };
let seq = 0;
const timers = [];
const setT = (fn, ms = 0, ...args) => { const t = { id: ++seq, at: now + Math.max(0, ms | 0), fn: () => fn(...args) }; timers.push(t); return t.id; };
const clearT = (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); };
const setI = (fn, ms) => { const id = ++seq; const tick = () => timers.push({ id, at: now + ms, fn: () => { fn(); tick(); } }); tick(); return id; };
const lines = [];
const fakeConsole = { log: (...a) => lines.push(a.map(String).join(" ")), warn() {}, error() {}, info() {}, debug() {} };
const listeners = {};
const video = { tagName: "VIDEO", currentTime: 0, readyState: 1, paused: true, buffered: { length: 0, end: () => 0 }, src: "", currentSrc: "", play: () => Promise.resolve() };
const reloads = [];
const player = { id: "movie_player", className: "unstarted-mode", querySelector: (s) => (s === "video" ? video : null), loadVideoById: () => reloads.push(now - BASE), getVideoData: () => ({ video_id: "abcdefghijk" }), getPlayerState: () => -1, getCurrentTime: () => video.currentTime, playVideo() {} };
const docEl = { setAttribute() {}, removeAttribute() {}, appendChild() {}, querySelector: () => null };
const document = {
  readyState: "complete", hidden: false, documentElement: docEl, head: docEl, body: docEl,
  addEventListener: (type, fn) => (listeners[type] ||= []).push(fn), removeEventListener() {},
  querySelector: (s) => (s === "#movie_player" ? player : null), querySelectorAll: () => [],
  getElementById: (id) => (id === "movie_player" ? player : null),
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, remove() {} }),
};
const fire = (type, detail) => { for (const fn of listeners[type] || []) fn({ type, target: document, detail }); };
const location = { pathname: "/watch", href: "https://www.youtube.com/watch?v=abcdefghijk", search: "?v=abcdefghijk" };
const store = {};
const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
const perfObs = [];
class PO { constructor(cb) { this.cb = cb; } observe() { perfObs.push(this); } disconnect() {} }
function XHR() {}
for (const m of ["open", "send", "addEventListener", "setRequestHeader"]) XHR.prototype[m] = function () {};
const fetchStub = () => Promise.resolve(new Response("{}", { status: 200 }));
const window = { fetch: fetchStub, addEventListener() {}, location, document };
class MO { observe() {} disconnect() {} }
globalThis[Symbol.for("twitch-adblock.ubo")] = true;
const run = new Function("window", "document", "location", "localStorage", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance", "console", "XMLHttpRequest", "MutationObserver", "PerformanceObserver", "requestAnimationFrame", "requestIdleCallback", "fetch", source);
run(window, document, location, localStorage, setT, clearT, setI, clearT, FakeDate, performance, fakeConsole, XHR, MO, PO, (f) => setT(f, 16), (f) => setT(f, 1), fetchStub);

// ms since the first navigation. The entry reports when its request started.
const WAIT = "https://rr1---sn-test.googlevideo.com/videoplayback?expire=" + Math.floor(BASE / 1000 + 21600) + "&sabr=1&rn=w";
const waitReply = (startedAt) => () => { for (const o of perfObs) o.cb({ getEntries: () => [{ name: WAIT, encodedBodySize: 105, entryType: "resource", startTime: startedAt }] }); };
const ev = [];
const at = (t, fn) => ev.push({ t, fn });
at(0, () => fire("yt-navigate-start", { url: "/watch?v=abcdefghijk" }));
if (SCENARIO === "prev-reply") at(1000, waitReply(990));
at(3000, () => fire("yt-navigate-start", { url: "/watch?v=abcdefghijk" }));
at(3600, () => fire("yt-navigate-finish", {}));
if (SCENARIO === "own-reply") at(4000, waitReply(3990));
for (; now - BASE <= 25000; now += 1) {
  while (ev.length && ev[0].t <= now - BASE) ev.shift().fn();
  for (;;) {
    const due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at || a.id - b.id)[0];
    if (!due) break;
    timers.splice(timers.indexOf(due), 1);
    due.fn();
  }
  await Promise.resolve();
}
console.log(JSON.stringify({ scenario: SCENARIO, reloads, lines: lines.filter((l) => /stall|reload|SABR|gentle/.test(l)) }));
