// The rpnt payload uBO splices into YouTube's inline script, shipped (with the
// sync script's ARG_PATCHES) versus upstream: same reload decisions, less work.
const ROOT = new URL("..", import.meta.url);
const iso = await Deno.readTextFile(new URL("src/vendor/ubo-youtube-isolated.js", ROOT));
const sync = await Deno.readTextFile(new URL("scripts/sync-ubo-youtube.mjs", ROOT));

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

const call = iso.split(/\r?\n/).find((l) => l.trim().startsWith('replaceNodeText("script",'));
const args = JSON.parse("[" + call.trim().slice("replaceNodeText(".length, -2) + "]");
const shipped = args[2];
const patchSrc = sync.slice(sync.indexOf("const ARG_PATCHES = ["), sync.indexOf("const patchHits"));
const ARG_PATCHES = new Function("return " + patchSrc.slice(patchSrc.indexOf("["), patchSrc.lastIndexOf("]") + 1))();
const upstream = ARG_PATCHES.reduceRight((s, [from, to]) => s.replace(to, from), shipped);

function run(payload, href, state = {}) {
  const calls = { stats: 0, loadVideoById: 0, seekTo: 0, logs: 0 };
  const timers = [];
  let observerCb = null;
  let ready = null;
  const progress = { duration: 100, loaded: 10, current: 0 };
  const player = {
    // state.reloadxhr: the response of a video that uBO's recovery already reloaded once.
    getPlayerResponse: () => ({ videoDetails: { videoId: "abc" }, playabilityStatus: { status: "OK" }, playerConfig: {}, playbackTracking: state.reloadxhr ? { videostatsPlaybackUrl: { baseUrl: "https://s.youtube.com/api/stats/playback?referrer=x%23reloadxhr" } } : undefined }),
    getStatsForNerds: () => { calls.stats++; return state.stats ?? { debug_info: "", buffer_health_seconds: "1.00 s", resolution: "1920x1080" }; },
    getProgressState: () => progress,
    getPlayerStateObject: () => ({ isBuffering: !!state.buffering }),
    loadVideoById: () => { calls.loadVideoById++; },
    seekTo: () => { calls.seekTo++; },
  };
  const location = { href, search: new URL(href).search, pathname: new URL(href).pathname };
  const win = {
    location,
    ytInitialData: {},
    ytcfg: { data_: { INNERTUBE_CONTEXT: { client: { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/155" } } } },
    Map: { prototype: { has: Map.prototype.has } },
    Array: { prototype: { push: Array.prototype.push } },
    Promise: { prototype: { then: Promise.prototype.then } },
  };
  const doc = {
    // uAssets c7e01d3 read #masthead's logo-type without optional chaining; 1fbf62c guards it again.
    // state.masthead: undefined = a normal header, null = no header, or a stand-in element.
    getElementById: (id) => (id === "movie_player" ? player : id === "masthead" ? (state.masthead === undefined ? { attributes: { "logo-type": { value: "" } } } : state.masthead) : null),
    addEventListener: (type, fn) => { if (type === "DOMContentLoaded") ready = fn; },
    querySelector: () => null,
  };
  class MO {
    constructor(cb) { observerCb = cb; }
    observe() {}
  }
  const setTimeoutFake = (fn) => { timers.push(fn); return timers.length; };
  const consoleFake = { log: () => { calls.logs++; } };
  new Function("window", "document", "location", "MutationObserver", "setTimeout", "console", "URLSearchParams",
    payload.replace(/\$1$/, ""))(win, doc, location, MO, setTimeoutFake, consoleFake, URLSearchParams);
  // With a Premium header the payload returns before it registers anything.
  if (ready) ready();
  return {
    installed: !!ready,
    calls,
    win,
    mutate(n) { for (let i = 0; i < n; i++) observerCb([]); },
    flush() { while (timers.length) timers.shift()(); },
    push(v) { Reflect.apply(win.Array.prototype.push, [], [v]); },
    goTo(href) { const u = new URL(href); location.href = href; location.search = u.search; location.pathname = u.pathname; },
  };
}

Deno.test("rpnt payload: patches applied, upstream recoverable, uBOL guard kept", () => {
  assert(shipped !== upstream, "shipped payload carries ARG_PATCHES");
  for (const [from, to] of ARG_PATCHES) {
    assert(shipped.includes(to) && !shipped.includes(from), "patched: " + from.slice(0, 40));
    assert(upstream.includes(from), "upstream form: " + from.slice(0, 40));
  }
  assert(args.includes("excludes") && args[args.indexOf("excludes") + 1] === "MutationObserver", "excludes guard");
  assert(shipped.includes("MutationObserver"), "uBO Lite still sees MutationObserver and skips a second splice");
});

Deno.test("rpnt payload: homepage mutations make no player API calls", () => {
  const up = run(upstream, "https://www.youtube.com/");
  const ours = run(shipped, "https://www.youtube.com/");
  up.mutate(200); up.flush();
  ours.mutate(200); ours.flush();
  assert(up.calls.stats === 201, "upstream polls the player per batch: " + up.calls.stats);
  assert(ours.calls.stats === 0, "shipped: " + ours.calls.stats);
});

Deno.test("rpnt payload: a mutation burst on a watch page is one check", () => {
  const up = run(upstream, "https://www.youtube.com/watch?v=abc");
  const ours = run(shipped, "https://www.youtube.com/watch?v=abc");
  up.mutate(200); up.flush();
  ours.mutate(200);
  assert(ours.calls.stats === 1, "initial check only before the timer: " + ours.calls.stats);
  ours.flush();
  assert(up.calls.stats === 201, "upstream: " + up.calls.stats);
  assert(ours.calls.stats === 2, "shipped: " + ours.calls.stats);
  ours.mutate(3); ours.flush();
  assert(ours.calls.stats === 3, "next burst re-arms: " + ours.calls.stats);
});

Deno.test("rpnt payload: push trap never reads .length on a non-Uint8Array", () => {
  // DOM prototypes have brand-checked getters: reading .length throws "Illegal invocation".
  const proto = Object.create(null, { length: { get() { throw new TypeError("Illegal invocation"); } } });
  proto.constructor = { name: "HTMLCollection" };
  for (const payload of [upstream, shipped]) {
    const r = run(payload, "https://www.youtube.com/");
    // The wait-reply handler polls the player (getStatsForNerds); upstream no
    // longer logs, so the poll count is the sign that the trap took the value.
    const before = r.calls.stats;
    r.push(proto);
    assert(r.calls.stats === before, "not a wait reply");
    r.push(new Uint8Array(105));
    assert(r.calls.stats === before + 1, "control: a real wait reply does poll the player");
  }
});

Deno.test("rpnt payload: 105-byte wait reply reloads the same way", () => {
  const stuck = { stats: { debug_info: "", buffer_health_seconds: "0.00 s", resolution: "0x0" }, buffering: true };
  for (const payload of [upstream, shipped]) {
    const r = run(payload, "https://www.youtube.com/watch?v=abc", stuck);
    r.push({ length: 105 });
    r.push(new Uint8Array(new ArrayBuffer(200), 0, 105));
    r.mutate(1); r.flush();
    assert(r.calls.loadVideoById === 0, "no reload without a real wait reply");
    const polls = r.calls.stats;
    r.push(new Uint8Array(105));
    // uAssets 1fbf62c removed the console.log of the wait reply; the player poll shows that the trap saw it.
    assert(r.calls.stats === polls + 1 && r.calls.logs === 0, "wait reply seen once, not logged");
    r.mutate(5); r.flush();
    assert(r.calls.loadVideoById === 1, "one reload: " + r.calls.loadVideoById);
    assert(r.win.ytcfg.data_.INNERTUBE_CONTEXT.client.userAgent.includes("; channel"), "UA hint");
  }
});

Deno.test("rpnt payload: repeated wait replies after a reload use up one marker, not all of them", () => {
  // Before uAssets 1fbf62c each wait reply dropped one more marker while the
  // response carried #reloadxhr. Four replies before the next check emptied the
  // list (channel, yahi, inline, oaeb), and the recovery then gave up with no
  // second reload. The 250ms check interval (ARG_PATCHES) can widen the window for such a burst.
  const stuck = { reloadxhr: true, stats: { debug_info: "", buffer_health_seconds: "0.00 s", resolution: "0x0" }, buffering: true };
  for (const payload of [upstream, shipped]) {
    const r = run(payload, "https://www.youtube.com/watch?v=abc", stuck);
    for (let i = 0; i < 4; i++) r.push(new Uint8Array(105));
    r.mutate(5); r.flush();
    assert(r.calls.loadVideoById === 1, "one reload after the burst: " + r.calls.loadVideoById);
    const ua = r.win.ytcfg.data_.INNERTUBE_CONTEXT.client.userAgent;
    assert(ua.includes("; yahi"), "only the first marker was used up: " + ua);
  }
});

Deno.test("rpnt payload: an empty marker list starts again on the next video (upstream keeps it empty)", () => {
  // Live test 2026-11-20: all four markers failed on one video; upstream then
  // made no recovery attempt for any later video in that tab.
  const stuck = { reloadxhr: true, stats: { debug_info: "", buffer_health_seconds: "0.00 s", resolution: "0x0" }, buffering: true };
  const useUp = (r) => {
    for (let i = 0; i < 6; i++) { r.push(new Uint8Array(105)); r.mutate(1); r.flush(); }
    assert(r.calls.loadVideoById === 3, "yahi, inline and oaeb each got one reload: " + r.calls.loadVideoById);
    assert(!/; (channel|yahi|inline|oaeb)/.test(r.win.ytcfg.data_.INNERTUBE_CONTEXT.client.userAgent), "list empty: UA marker cleared");
  };
  const up = run(upstream, "https://www.youtube.com/watch?v=abc", stuck);
  useUp(up);
  up.goTo("https://www.youtube.com/watch?v=def");
  for (let i = 0; i < 3; i++) { up.push(new Uint8Array(105)); up.mutate(1); up.flush(); }
  assert(up.calls.loadVideoById === 3, "upstream: no recovery on the next video: " + up.calls.loadVideoById);

  const ours = run(shipped, "https://www.youtube.com/watch?v=abc", stuck);
  useUp(ours);
  // Same video, more page changes: the list stays empty (no reload loop on one video).
  for (let i = 0; i < 3; i++) { ours.push(new Uint8Array(105)); ours.mutate(1); ours.flush(); }
  assert(ours.calls.loadVideoById === 3, "same video: still given up: " + ours.calls.loadVideoById);
  ours.goTo("https://www.youtube.com/watch?v=def");
  ours.mutate(1); ours.flush();
  ours.push(new Uint8Array(105)); ours.mutate(1); ours.flush();
  assert(ours.calls.loadVideoById === 4, "next video: recovery runs again: " + ours.calls.loadVideoById);
  assert(/; (channel|yahi)/.test(ours.win.ytcfg.data_.INNERTUBE_CONTEXT.client.userAgent), "a marker is in use again");
});

Deno.test("rpnt payload: a list that is not empty keeps its place on the next video", () => {
  const stuck = { reloadxhr: true, stats: { debug_info: "", buffer_health_seconds: "0.00 s", resolution: "0x0" }, buffering: true };
  const r = run(shipped, "https://www.youtube.com/watch?v=abc", stuck);
  r.push(new Uint8Array(105)); r.mutate(1); r.flush();
  assert(r.win.ytcfg.data_.INNERTUBE_CONTEXT.client.userAgent.includes("; yahi"), "first video ends on yahi");
  r.goTo("https://www.youtube.com/watch?v=def");
  r.mutate(1); r.flush();
  assert(r.win.ytcfg.data_.INNERTUBE_CONTEXT.client.userAgent.includes("; yahi"), "next video keeps the working marker");
  r.push(new Uint8Array(105)); r.mutate(1); r.flush();
  assert(r.win.ytcfg.data_.INNERTUBE_CONTEXT.client.userAgent.includes("; inline"), "and goes on from there, not from the start");
});

Deno.test("rpnt payload: no #masthead, or no logo-type attribute, does not throw", () => {
  const threw = (fn) => { try { fn(); return ""; } catch (e) { return String(e && e.message); } };
  for (const masthead of [null, { attributes: {} }]) {
    for (const href of ["https://www.youtube.com/watch?v=abc", "https://www.youtube.com/", "https://www.youtube.com/embed/abc"]) {
      const label = (masthead ? "no logo-type" : "no #masthead") + " on " + href;
      for (const payload of [upstream, shipped]) {
        let r;
        assert(threw(() => { r = run(payload, href, { masthead }); }) === "", "does not throw: " + label);
        // Since uAssets 1fbf62c the recovery is also installed on an /embed/ URL.
        assert(r.installed === true, "recovery installed: " + label);
      }
    }
  }
  const stuck = { masthead: null, stats: { debug_info: "", buffer_health_seconds: "0.00 s", resolution: "0x0" }, buffering: true };
  const r = run(shipped, "https://www.youtube.com/watch?v=abc", stuck);
  r.push(new Uint8Array(105));
  r.mutate(5); r.flush();
  assert(r.calls.loadVideoById === 1, "recovery still reloads without a header: " + r.calls.loadVideoById);
  const premium = run(shipped, "https://www.youtube.com/watch?v=abc", { masthead: { attributes: { "logo-type": { value: "YOUTUBE_PREMIUM_LOGO" } } } });
  assert(premium.installed === false, "Premium header: the payload still steps aside");
});

Deno.test("rpnt payload: on an /embed/ page the embed marker list is used, and it starts again on the next embed", () => {
  // An /embed/ address has no v parameter: the next video is seen through the path.
  const marker = (r) => (r.win.ytcfg.data_.INNERTUBE_CONTEXT.client.userAgent.match(/; (channel|yahi|inline|oaeb|eafg)/) || [])[1] || "";
  const step = (r) => { r.push(new Uint8Array(105)); r.mutate(1); r.flush(); };
  const useUp = (r, state) => {
    step(r);
    assert(marker(r) === "channel" && r.calls.loadVideoById === 1, "first stall: channel, got " + marker(r));
    state.reloadxhr = true;
    step(r);
    assert(marker(r) === "eafg" && r.calls.loadVideoById === 2, "second marker of the embed list is eafg, got " + marker(r));
    step(r);
    assert(marker(r) === "" && r.calls.loadVideoById === 2, "embed list used up: marker cleared, no third reload");
  };
  const stuck = () => ({ reloadxhr: false, stats: { debug_info: "", buffer_health_seconds: "0.00 s", resolution: "0x0" }, buffering: true });

  const upState = stuck();
  const up = run(upstream, "https://www.youtube.com/embed/abc", upState);
  useUp(up, upState);
  up.goTo("https://www.youtube.com/embed/def");
  step(up); step(up);
  assert(up.calls.loadVideoById === 2, "upstream: no recovery on the next embed: " + up.calls.loadVideoById);

  const state = stuck();
  const ours = run(shipped, "https://www.youtube.com/embed/abc", state);
  useUp(ours, state);
  step(ours);
  assert(ours.calls.loadVideoById === 2, "same embed: still given up");
  ours.goTo("https://www.youtube.com/embed/def");
  ours.mutate(1); ours.flush();
  step(ours);
  assert(ours.calls.loadVideoById === 3 && marker(ours) !== "", "next embed: recovery runs again with a marker: " + marker(ours));
});
