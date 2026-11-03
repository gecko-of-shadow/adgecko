// Block K: Twitch directory sweep throttled and limited to directory pages
// (M-5); Kick MediaTailor listener wrapper supports removeEventListener (M-16).
import directorySource from "../src/twitch-directory-ads.js" with { type: "text" };
import kickSource from "../src/kick.js" with { type: "text" };
import { unwrapMain } from "./fixtures/main-source.mjs";
function assert(c, l) { if (!c) throw new Error(l); }

function loadDirectory() {
  const api = {};
  new Function(`${directorySource}\nreturn installTwitchDirectoryAds;`)()(api);
  return api;
}

Deno.test("directory sweep runs only on directory/home pages", () => {
  const api = loadDirectory();
  for (const p of ["/", "/directory", "/directory/category/just-chatting", "/directory/following"]) assert(api.isDirectoryPage(p), p);
  for (const p of ["/somechannel", "/videos/123", "/somechannel/clip/x", "/directoryx", "/settings"]) assert(!api.isDirectoryPage(p), p);
});

Deno.test("directory sweep is throttled: a burst of mutations runs at most one sweep per 250 ms, none on channel pages or when off", () => {
  const api = loadDirectory();
  let now = 0;
  const timers = [];
  let sweeps = 0;
  let path = "/directory";
  let on = true;
  const root = { querySelectorAll: () => { sweeps++; return []; } };
  const schedule = api.makeScheduler({
    on: () => on, pathname: () => path, now: () => now,
    setTimeout: (fn, ms) => { timers.push({ at: now + ms, fn }); return timers.length; },
    root: () => root,
  });
  const run = (until) => {
    while (now < until) {
      now += 10;
      for (const t of timers.filter((x) => x.at <= now)) { timers.splice(timers.indexOf(t), 1); t.fn(); }
    }
  };
  for (let i = 0; i < 100; i++) { schedule(); run(now + 10); } // a mutation batch every 10 ms for 1 s
  run(now + 300);
  const passes = sweeps / 3; // one sweep = three querySelectorAll calls
  assert(passes >= 3 && passes <= 6, "throttled passes: " + passes);
  sweeps = 0;
  path = "/somechannel";
  for (let i = 0; i < 50; i++) { schedule(); run(now + 10); }
  run(now + 300);
  assert(sweeps === 0, "no sweep on a channel page: " + sweeps);
  path = "/directory";
  on = false;
  for (let i = 0; i < 50; i++) { schedule(); run(now + 10); }
  run(now + 300);
  assert(sweeps === 0, "no sweep when switched off");
});

Deno.test("kick MediaTailor session: listeners can be removed again, and adding the same one twice fires once", async () => {
  const api = {};
  new Function(`${unwrapMain(kickSource)}\nreturn installKickAdblock;`)()(api);
  const listeners = new Map();
  const session = {
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { if (listeners.has(type)) listeners.get(type).delete(fn); },
    dispatch(type, ev) { for (const fn of listeners.get(type) || []) fn.call(session, ev); },
  };
  const media = { createSession: () => Promise.resolve(session) };
  const details = [];
  api.wrapMediaTailor(media, (d) => details.push(d));
  const s = await media.createSession({});
  let calls = 0;
  const listener = () => { calls++; };
  s.addEventListener("ad", listener);
  s.addEventListener("ad", listener);
  s.dispatch("ad", { detail: { x: 1 } });
  assert(calls === 1 && details.length === 1, "added twice fires once: " + calls);
  s.removeEventListener("ad", listener);
  s.dispatch("ad", { detail: { x: 2 } });
  assert(calls === 1 && (listeners.get("ad") || new Set()).size === 0, "removed: " + calls + " left " + (listeners.get("ad") || new Set()).size);
});

// Security review L-14: Kick's post-roll cover handling obeys the "kick" switch.
Deno.test("kick covers: nothing is touched while the kick switch is off; handled again when it is on", () => {
  let queries = 0;
  let observerCb = null;
  const document = { documentElement: {}, querySelectorAll: () => { queries++; return []; } };
  class MO { constructor(cb) { observerCb = cb; } observe() {} }
  const raf = (fn) => fn();
  const api = {};
  new Function("document", "MutationObserver", "requestAnimationFrame", `${unwrapMain(kickSource)}\nreturn installKickAdblock;`)(document, MO, raf)(api);
  let on = false;
  api.watchCovers(() => on);
  const mutation = [{ addedNodes: [{ nodeType: 1, tagName: "IFRAME" }] }];
  observerCb(mutation);
  assert(queries === 0, "touched covers while off: " + queries);
  on = true;
  observerCb(mutation);
  assert(queries > 0, "covers handled again when on");
});

// Security review L-14, second half: a post-roll cover that may hold the live
// player is never hidden and nothing in it is muted or paused. The live-player
// signals (blob: source, srcObject, endless duration) are UNVERIFIED on live
// Kick; these tests pin the logic with fake elements.
function fakeEl(tag, props, children) {
  const style = {
    props: {},
    setProperty(k, v, p) { this.props[k] = { v, p: p || "" }; },
    getPropertyValue(k) { return this.props[k] ? this.props[k].v : ""; },
    getPropertyPriority(k) { return this.props[k] ? this.props[k].p : ""; },
    removeProperty(k) { delete this.props[k]; },
  };
  const el = Object.assign({ tagName: tag, children: children || [], parentElement: null, style, attrs: {}, getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; } }, props || {});
  for (const c of el.children) c.parentElement = el;
  return el;
}
function fakeVideo({ src = "", srcObject = null, duration = NaN } = {}) {
  const v = fakeEl("VIDEO", { src, currentSrc: src, srcObject, duration, muted: false, paused: false, pause() { this.paused = true; } });
  if (src) v.attrs.src = src;
  return v;
}
// DIV > [VIDEO-PLAYER > videos, controls]; returns the parts.
function fakeCover(videos) {
  const player = fakeEl("VIDEO-PLAYER", {}, videos);
  const controls = fakeEl("DIV");
  const overlay = fakeEl("DIV", {}, [player, controls]);
  return { overlay, player, controls };
}
function kickWithCovers(covers) {
  let observerCb = null;
  const document = {
    documentElement: {},
    querySelectorAll: (sel) => sel.includes("ima-ad-controls") ? covers.map((c) => c.controls) : [],
  };
  class MO { constructor(cb) { observerCb = cb; } observe() {} }
  const api = {};
  new Function("document", "MutationObserver", "requestAnimationFrame", `${unwrapMain(kickSource)}\nreturn installKickAdblock;`)(document, MO, (fn) => fn())(api);
  api.watchCovers(() => true);
  return { api, pass: () => observerCb([{ addedNodes: [{ nodeType: 1, tagName: "VIDEO" }] }]) };
}
const hidden = (c) => c.overlay.style.getPropertyValue("display") === "none";

Deno.test("kick covers: a cover with only an ad clip is hidden and the clip paused", () => {
  const clip = fakeVideo({ src: "https://ads.example/clip.mp4", duration: 15 });
  const cover = fakeCover([clip]);
  kickWithCovers([cover]);
  assert(hidden(cover), "ad-clip cover hidden");
  assert(clip.muted && clip.paused, "ad clip quieted");
});

Deno.test("kick covers: a cover that holds the live player is left alone (blob source, srcObject, endless duration)", () => {
  const cases = [
    ["blob: source", fakeVideo({ src: "blob:https://kick.com/0000", duration: 3600 })],
    ["srcObject", fakeVideo({ srcObject: {} })],
    ["endless duration", fakeVideo({ src: "https://cdn.example/live.m3u8", duration: Infinity })],
  ];
  for (const [label, live] of cases) {
    const clip = fakeVideo({ src: "https://ads.example/clip.mp4", duration: 15 });
    const cover = fakeCover([live, clip]);
    kickWithCovers([cover]);
    assert(!hidden(cover), label + ": cover with the live player hidden");
    assert(!live.muted && !live.paused, label + ": live video muted or paused");
    assert(!clip.muted && !clip.paused, label + ": nothing in a live cover is touched");
  }
});

Deno.test("kick covers: a video without a source, or one that cannot be read, keeps the cover visible", () => {
  const empty = fakeVideo();
  const cover = fakeCover([empty]);
  kickWithCovers([cover]);
  assert(!hidden(cover) && !empty.muted && !empty.paused, "sourceless video: cover left alone");
  const broken = fakeVideo({ src: "https://ads.example/clip.mp4" });
  Object.defineProperty(broken, "srcObject", { get() { throw new Error("detached"); } });
  const cover2 = fakeCover([broken]);
  kickWithCovers([cover2]);
  assert(!hidden(cover2) && !broken.muted, "unreadable video: cover left alone");
});

Deno.test("kick covers: a cover hidden before the live player arrived is shown again, with its old display", () => {
  const clip = fakeVideo({ src: "https://ads.example/clip.mp4", duration: 15 });
  const cover = fakeCover([clip]);
  cover.overlay.style.setProperty("display", "flex");
  const kick = kickWithCovers([cover]);
  assert(hidden(cover), "precondition: hidden while it held only the clip");
  const live = fakeVideo({ src: "blob:https://kick.com/0001" });
  live.parentElement = cover.player;
  cover.player.children.push(live);
  kick.pass();
  assert(cover.overlay.style.getPropertyValue("display") === "flex" && cover.overlay.style.getPropertyPriority("display") === "", "old display restored: " + JSON.stringify(cover.overlay.style.props));
  assert(!live.muted && !live.paused, "live video untouched");
});

Deno.test("kick covers: the CSS rule skips covers with a blob: or src-less video", () => {
  const api = {};
  new Function(`${unwrapMain(kickSource)}\nreturn installKickAdblock;`)()(api);
  const css = api.chromeCss();
  assert(css.includes('div:has(> video-player):has([data-testid="ima-ad-controls"]):not(:has(video[src^="blob:"])):not(:has(video:not([src])))'), "guarded post-roll selector");
  assert(api.videoKind(fakeVideo({ src: "blob:https://kick.com/2" })) === "live" && api.videoKind(fakeVideo({ src: "https://ads.example/a.mp4" })) === "clip" && api.videoKind(fakeVideo()) === "unknown", "video kinds");
});
