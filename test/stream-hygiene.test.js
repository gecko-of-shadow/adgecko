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
// A <video> stand-in: duration NaN until "metadata" is set, media events by fire().
function fakeVideo({ src = "", srcObject = null, duration = NaN } = {}) {
  const listeners = {};
  const v = fakeEl("VIDEO", {
    src, currentSrc: src, srcObject, duration, muted: false, paused: false,
    pause() { this.paused = true; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    fire(type) { for (const fn of listeners[type] || []) fn(); },
    setSource(s, d = NaN) {
      this.src = s;
      this.currentSrc = s;
      if (s) this.attrs.src = s;
      else delete this.attrs.src;
      this.duration = d;
    },
  });
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
    // cover.gone: its ad controls left the page.
    querySelectorAll: (sel) => sel.includes("ima-ad-controls") ? covers.filter((c) => !c.gone).map((c) => c.controls) : [],
  };
  class MO { constructor(cb) { observerCb = cb; } observe() {} }
  const api = {};
  new Function("document", "MutationObserver", "requestAnimationFrame", `${unwrapMain(kickSource)}\nreturn installKickAdblock;`)(document, MO, (fn) => fn())(api);
  const sw = { on: true };
  api.watchCovers(() => sw.on);
  return { api, sw, observe: (m) => observerCb(m), pass: () => observerCb([{ addedNodes: [{ nodeType: 1, tagName: "VIDEO" }] }]) };
}
const addVideo = (cover, video) => {
  video.parentElement = cover.player;
  cover.player.children.push(video);
  return video;
};
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
    ["srcObject next to a leftover src attribute", fakeVideo({ src: "https://cdn.example/old.mp4", srcObject: {}, duration: 30 })],
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
  // A plain URL before its metadata: it could still be a stream.
  const early = fakeVideo({ src: "https://cdn.example/stream.m3u8" });
  const cover3 = fakeCover([early]);
  kickWithCovers([cover3]);
  assert(!hidden(cover3) && !early.muted && !early.paused, "plain source without metadata: cover left alone");
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

Deno.test("kick covers: the stylesheet never hides a post-roll cover (only settleCovers decides), and video kinds", () => {
  const api = {};
  new Function(`${unwrapMain(kickSource)}\nreturn installKickAdblock;`)()(api);
  const css = api.chromeCss();
  assert(!css.includes(":has(") && !css.includes("video-player"), "no post-roll rule in the stylesheet: " + css);
  assert(css.includes("#native_feed_ad") && css.includes('[data-testid="ima-ad-controls"]'), "banner and ad-chrome hides kept");
  const kinds = [
    [fakeVideo({ src: "blob:https://kick.com/2" }), "live"],
    [fakeVideo({ src: "https://ads.example/a.mp4", duration: 12 }), "clip"],
    [fakeVideo({ src: "https://ads.example/a.mp4" }), "unknown"],
    [fakeVideo({ src: "https://cdn.example/live.m3u8", duration: Infinity }), "live"],
    [fakeVideo(), "unknown"],
  ];
  for (const [v, want] of kinds) assert(api.videoKind(v) === want, v.src + " -> " + api.videoKind(v) + ", want " + want);
});

Deno.test("kick covers: a sourceless video joining a hidden cover shows it again, and it stays shown when it turns live", () => {
  const clip = fakeVideo({ src: "https://ads.example/clip.mp4", duration: 15 });
  const cover = fakeCover([clip]);
  cover.overlay.style.setProperty("display", "flex");
  const kick = kickWithCovers([cover]);
  assert(hidden(cover), "precondition: hidden while it held only the clip");
  const next = addVideo(cover, fakeVideo());
  kick.pass();
  assert(cover.overlay.style.getPropertyValue("display") === "flex", "sourceless video: our hide undone: " + JSON.stringify(cover.overlay.style.props));
  // The player attaches its stream: only an attribute change, no DOM mutation.
  next.setSource("blob:https://kick.com/0002");
  next.fire("loadstart");
  assert(!hidden(cover) && !next.muted && !next.paused, "live video hidden or quieted after it attached");
});

Deno.test("kick covers: an ad clip that gets its source later is quieted once its metadata says it ends", () => {
  const video = fakeVideo();
  const cover = fakeCover([video]);
  kickWithCovers([cover]);
  assert(!hidden(cover) && !video.muted, "sourceless: left alone");
  video.setSource("https://ads.example/late.mp4");
  video.fire("loadstart");
  assert(!hidden(cover) && !video.muted, "no metadata yet: left alone");
  video.duration = 20;
  video.fire("durationchange");
  assert(hidden(cover) && video.muted && video.paused, "clip with metadata: cover hidden, clip quieted");
});

Deno.test("kick covers: a plain-URL stream whose duration turns out endless is never quieted", () => {
  const video = fakeVideo({ src: "https://cdn.example/live.m3u8" });
  const cover = fakeCover([video]);
  kickWithCovers([cover]);
  video.duration = Infinity;
  video.fire("durationchange");
  assert(!hidden(cover) && !video.muted && !video.paused, "endless stream hidden or quieted");
});

Deno.test("kick covers: a quieted clip element reused for the live stream gets its sound back", () => {
  const video = fakeVideo({ src: "https://ads.example/clip.mp4", duration: 15 });
  const cover = fakeCover([video]);
  kickWithCovers([cover]);
  assert(hidden(cover) && video.muted, "precondition: clip quieted");
  video.setSource("blob:https://kick.com/0003");
  video.fire("loadstart");
  assert(!hidden(cover) && !video.muted, "reused element still hidden or muted");
  // Already playing when its new source loads (the player called play()):
  // left muted, since Chrome would pause it on an unmute without a gesture.
  const playing = fakeVideo({ src: "https://ads.example/clip3.mp4", duration: 15 });
  const cover3 = fakeCover([playing]);
  kickWithCovers([cover3]);
  playing.setSource("blob:https://kick.com/0007");
  playing.paused = false;
  playing.fire("loadstart");
  assert(!hidden(cover3) && playing.muted && !playing.paused, "a playing reused element was unmuted or paused");
  // A clip that was muted before we touched it stays muted.
  const muted = fakeVideo({ src: "https://ads.example/clip2.mp4", duration: 15 });
  muted.muted = true;
  const cover2 = fakeCover([muted]);
  kickWithCovers([cover2]);
  muted.setSource("blob:https://kick.com/0004");
  muted.fire("loadstart");
  assert(muted.muted, "a video muted before our pass was unmuted");
});

Deno.test("kick covers: undoing our hide keeps a display value the page set after it", () => {
  const clip = fakeVideo({ src: "https://ads.example/clip.mp4", duration: 15 });
  const cover = fakeCover([clip]);
  cover.overlay.style.setProperty("display", "none");
  const kick = kickWithCovers([cover]);
  assert(hidden(cover), "precondition: hidden by us");
  cover.overlay.style.setProperty("display", "block"); // the page re-renders the cover
  addVideo(cover, fakeVideo({ src: "blob:https://kick.com/0005" }));
  kick.pass();
  assert(cover.overlay.style.getPropertyValue("display") === "block", "page's newer display overwritten: " + JSON.stringify(cover.overlay.style.props));
});

Deno.test("kick covers: the kick switch going off shows every cover we hid and gives sound back; on hides again", () => {
  const clip = fakeVideo({ src: "https://ads.example/clip.mp4", duration: 15 });
  const cover = fakeCover([clip]);
  cover.overlay.style.setProperty("display", "grid");
  const kick = kickWithCovers([cover]);
  assert(hidden(cover) && clip.muted, "precondition: hidden and quieted");
  kick.sw.on = false;
  kick.api.coversSwitched(false);
  assert(cover.overlay.style.getPropertyValue("display") === "grid", "cover still hidden after the switch went off");
  assert(!clip.muted, "paused clip still muted after the switch went off");
  clip.fire("durationchange");
  assert(!hidden(cover), "a media event re-hid a cover while the switch is off");
  kick.sw.on = true;
  kick.api.coversSwitched(true);
  assert(hidden(cover) && clip.muted, "switch back on: the clip cover is not hidden again at once");
  assert(/coversSwitched\(kickOn\)/.test(kickSource), "the switch's port handler calls coversSwitched");
});

Deno.test("kick covers: a hidden cover whose ad controls are gone is shown again (the stream may be in it now)", () => {
  const clip = fakeVideo({ src: "https://ads.example/clip.mp4", duration: 15 });
  const cover = fakeCover([clip]);
  const kick = kickWithCovers([cover]);
  assert(hidden(cover), "precondition: hidden");
  cover.gone = true; // the ad ended; IMA removed its controls
  clip.setSource("blob:https://kick.com/0008");
  clip.fire("loadstart");
  assert(!hidden(cover) && !clip.muted, "cover without controls still hidden or muted");
  assert(kick, "harness");
});

Deno.test("kick covers: a hidden cover moved out of the page and back keeps its old display for the undo", () => {
  const clip = fakeVideo({ src: "https://ads.example/clip.mp4", duration: 15 });
  const cover = fakeCover([clip]);
  cover.overlay.style.setProperty("display", "flex");
  const kick = kickWithCovers([cover]);
  cover.overlay.isConnected = false;
  kick.pass(); // drops it from the hidden set while it is out of the page
  cover.overlay.isConnected = true;
  addVideo(cover, fakeVideo({ src: "blob:https://kick.com/0009" }));
  kick.pass();
  assert(cover.overlay.style.getPropertyValue("display") === "flex", "old display lost: " + JSON.stringify(cover.overlay.style.props));
});

Deno.test("kick covers: added ad controls trigger a pass; a video in an open shadow root is seen", () => {
  const live = fakeVideo({ src: "blob:https://kick.com/0006" });
  const player = fakeEl("VIDEO-PLAYER", { shadowRoot: { children: [live] } });
  const controls = fakeEl("DIV");
  const overlay = fakeEl("DIV", {}, [player, controls]);
  const cover = { overlay, player, controls };
  const kick = kickWithCovers([cover]);
  assert(!hidden(cover) && !live.muted, "live video in an open shadow root: cover hidden or muted");
  let ran = 0;
  const api = {};
  const document = { documentElement: {}, querySelectorAll: () => { ran++; return []; } };
  let cb = null;
  class MO { constructor(f) { cb = f; } observe() {} }
  new Function("document", "MutationObserver", "requestAnimationFrame", `${unwrapMain(kickSource)}\nreturn installKickAdblock;`)(document, MO, (fn) => fn())(api);
  api.watchCovers(() => true);
  const before = ran;
  cb([{ addedNodes: [{ nodeType: 1, tagName: "DIV", matches: (s) => s.includes("ima-ad-controls"), querySelector: () => null }] }]);
  assert(ran > before, "an added ad-controls node did not trigger a pass");
  // A wrapper holding a <video> (exact "video" selector, not "video-player").
  const has = (s, tag) => s.split(",").map((x) => x.trim()).includes(tag);
  const mid = ran;
  cb([{ addedNodes: [{ nodeType: 1, tagName: "DIV", matches: () => false, querySelector: (s) => has(s, "video") ? {} : null }] }]);
  assert(ran > mid, "a wrapper holding a <video> did not trigger a pass");
  assert(kick, "harness");
});
