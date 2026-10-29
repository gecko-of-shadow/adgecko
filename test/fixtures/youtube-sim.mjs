// Loads the real src/youtube.js (whole script) in-process with injected globals on a
// virtual clock, like youtube-clock-run.mjs. Used by test/youtube-sim.test.js.
const SRC = new URL("../../src/youtube.js", import.meta.url);
export const source = await Deno.readTextFile(SRC);

export function load({ ubo = false, fetchImpl, XHR, pathname = "/watch", opts } = {}) {
  const RealDate = Date;
  const BASE = 1792548600000;
  const clock = { now: BASE };
  class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(clock.now); } static now() { return clock.now; } }
  const performance = { now: () => clock.now - BASE, timeOrigin: BASE };
  let seq = 0;
  const timers = [];
  const setT = (fn, ms = 0, ...args) => { const t = { id: ++seq, at: clock.now + Math.max(0, ms | 0), fn: () => fn(...args) }; timers.push(t); return t.id; };
  const clearT = (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); };
  const setI = (fn, ms) => { const id = ++seq; const tick = () => timers.push({ id, at: clock.now + ms, fn: () => { fn(); tick(); } }); tick(); return id; };
  const clearI = (id) => { for (let i = timers.length - 1; i >= 0; i--) if (timers[i].id === id) timers.splice(i, 1); };
  const lines = [];
  const fakeConsole = { log: (...a) => lines.push(a.map(String).join(" ")), warn() {}, error() {}, info() {}, debug() {} };
  const listeners = {};
  const video = { tagName: "VIDEO", currentTime: 0, readyState: 1, paused: true, buffered: { length: 0, end: () => 0 }, src: "", currentSrc: "", play: () => Promise.resolve() };
  const reloads = [];
  const state = { videoId: "AAAAAAAAAAA" };
  const player = { id: "movie_player", className: "unstarted-mode", querySelector: (s) => (s === "video" ? video : null), loadVideoById: (id) => reloads.push({ t: clock.now - BASE, id }), getVideoData: () => ({ video_id: state.videoId }), getPlayerState: () => -1, getCurrentTime: () => video.currentTime, playVideo() {} };
  const docEl = { setAttribute() {}, removeAttribute() {}, appendChild() {}, querySelector: () => null };
  const nodes = new Map();
  const document = {
    readyState: "complete", hidden: false, documentElement: docEl, head: docEl, body: docEl,
    addEventListener: (type, fn) => (listeners[type] ||= []).push(fn), removeEventListener() {},
    querySelector: (s) => (s === "#movie_player" ? player : null), querySelectorAll: () => [],
    getElementById: (id) => (id === "movie_player" ? player : nodes.get(id) || null),
    createElement: () => { const el = { style: {}, setAttribute() {}, appendChild() {}, remove() { nodes.delete(el.id); } }; return el; },
  };
  player.appendChild = (el) => { el.parentElement = player; if (el.id) nodes.set(el.id, el); };
  const fire = (type, detail, target = document) => { for (const fn of listeners[type] || []) fn({ type, target, detail }); };
  const location = { pathname, href: "https://www.youtube.com" + pathname, search: "" };
  const store = {};
  if (opts) store["twitch-adblock-yt-opts"] = JSON.stringify(opts);
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const perfObs = [];
  class PO { constructor(cb) { this.cb = cb; } observe() { perfObs.push(this); } disconnect() {} }
  if (!XHR) { XHR = function () {}; for (const m of ["open", "send", "addEventListener", "setRequestHeader"]) XHR.prototype[m] = function () {}; }
  const fetchStub = fetchImpl || (() => Promise.resolve(new Response("{}", { status: 200 })));
  const window = { fetch: fetchStub, addEventListener() {}, location, document };
  class MO { observe() {} disconnect() {} }
  const UBO = Symbol.for("twitch-adblock.ubo");
  const GUARD = Symbol.for("twitch-adblock.yt");
  delete globalThis[GUARD];
  if (ubo) globalThis[UBO] = true; else delete globalThis[UBO];
  const saved = { parse: JSON.parse, toString: Function.prototype.toString };
  const run = new Function("window", "document", "location", "localStorage", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance", "console", "XMLHttpRequest", "MutationObserver", "PerformanceObserver", "requestAnimationFrame", "requestIdleCallback", "fetch", source);
  run(window, document, location, localStorage, setT, clearT, setI, clearI, FakeDate, performance, fakeConsole, XHR, MO, PO, (f) => setT(f, 16), (f) => setT(f, 1), fetchStub);
  const restore = () => { JSON.parse = saved.parse; Function.prototype.toString = saved.toString; delete globalThis[GUARD]; delete globalThis[UBO]; };
  async function advanceTo(t) {
    while (clock.now - BASE < t) {
      clock.now += 1;
      for (;;) {
        const due = timers.filter((x) => x.at <= clock.now).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) break;
        timers.splice(timers.indexOf(due), 1);
        due.fn();
      }
      if (clock.now % 50 === 0) await Promise.resolve();
    }
  }
  return { window, document, location, video, player, state, reloads, lines, fire, advanceTo, restore, timers, nodes, perfObs, clock, BASE };
}
