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
    getPlayerResponse: () => ({ videoDetails: { videoId: "abc" }, playabilityStatus: { status: "OK" }, playerConfig: {} }),
    getStatsForNerds: () => { calls.stats++; return state.stats ?? { debug_info: "", buffer_health_seconds: "1.00 s", resolution: "1920x1080" }; },
    getProgressState: () => progress,
    getPlayerStateObject: () => ({ isBuffering: !!state.buffering }),
    loadVideoById: () => { calls.loadVideoById++; },
    seekTo: () => { calls.seekTo++; },
  };
  const location = { href, search: new URL(href).search };
  const win = {
    location,
    ytInitialData: {},
    ytcfg: { data_: { INNERTUBE_CONTEXT: { client: { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/155" } } } },
    Map: { prototype: { has: Map.prototype.has } },
    Array: { prototype: { push: Array.prototype.push } },
    Promise: { prototype: { then: Promise.prototype.then } },
  };
  const doc = {
    getElementById: (id) => (id === "movie_player" ? player : null),
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
  ready();
  return {
    calls,
    win,
    mutate(n) { for (let i = 0; i < n; i++) observerCb([]); },
    flush() { while (timers.length) timers.shift()(); },
    push(v) { Reflect.apply(win.Array.prototype.push, [], [v]); },
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

Deno.test("rpnt payload: 105-byte wait reply reloads the same way", () => {
  const stuck = { stats: { debug_info: "", buffer_health_seconds: "0.00 s", resolution: "0x0" }, buffering: true };
  for (const payload of [upstream, shipped]) {
    const r = run(payload, "https://www.youtube.com/watch?v=abc", stuck);
    r.push({ length: 105 });
    r.push(new Uint8Array(new ArrayBuffer(200), 0, 105));
    r.mutate(1); r.flush();
    assert(r.calls.loadVideoById === 0, "no reload without a real wait reply");
    r.push(new Uint8Array(105));
    assert(r.calls.logs === 1, "wait reply logged once");
    r.mutate(5); r.flush();
    assert(r.calls.loadVideoById === 1, "one reload: " + r.calls.loadVideoById);
    assert(r.win.ytcfg.data_.INNERTUBE_CONTEXT.client.userAgent.includes("; channel"), "UA hint");
  }
});
