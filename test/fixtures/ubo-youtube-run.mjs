// Runs the generated uBO MAIN-world bundle under a minimal www.youtube.com shim
// and prints what the ported prune paths did. Used by test/ubo-youtube.test.js.
globalThis.window = globalThis;
globalThis.self = globalThis;
const listeners = [];
globalThis.document = {
  readyState: "loading", currentScript: null,
  addEventListener: (t, f) => listeners.push([t, f]), removeEventListener() {},
  querySelectorAll: () => [], querySelector: () => null, getElementById: () => null,
  createElement: () => ({ style: {} }), documentElement: {}, head: null,
};
const served = {
  "https://www.youtube.com/youtubei/v1/player?prettyPrint=false": { playabilityStatus: { status: "OK" }, streamingData: {}, adPlacements: [{ a: 1 }], adSlots: [{ b: 1 }], playerAds: [{ c: 1 }] },
  "https://www.youtube.com/youtubei/v1/reel/reel_watch_sequence?x=1": { entries: [{ command: { reelWatchEndpoint: { videoId: "v1" } } }, { command: { reelWatchEndpoint: { videoId: "ad", adClientParams: { isAd: true } } } }] },
  "https://www.youtube.com/youtubei/v1/next": { adPlacements: [1], contents: {} },
};
globalThis.fetch = async (input) => {
  const url = typeof input === "string" ? input : input.url;
  return new Response(JSON.stringify(served[url] || {}), { headers: { "content-type": "application/json" } });
};
const src = await Deno.readTextFile(new URL("../../src/vendor/ubo-youtube.js", import.meta.url));
(0, eval)(src);
const out = {};
out.marker = globalThis[Symbol.for("twitch-adblock.ubo")] === true;
out.player = await (await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", { method: "POST" })).json();
out.reel = await (await fetch("https://www.youtube.com/youtubei/v1/reel/reel_watch_sequence?x=1")).json();
out.next = await (await fetch("https://www.youtube.com/youtubei/v1/next")).json();
out.parsedEntries = JSON.parse(JSON.stringify(served["https://www.youtube.com/youtubei/v1/reel/reel_watch_sequence?x=1"])).entries.length;
globalThis.ytInitialPlayerResponse = { adPlacements: [1], adSlots: [2], playerAds: [3], videoDetails: { videoId: "x" } };
out.initial = { adPlacements: ytInitialPlayerResponse.adPlacements, adSlots: ytInitialPlayerResponse.adSlots, playerAds: ytInitialPlayerResponse.playerAds, videoId: ytInitialPlayerResponse.videoDetails.videoId };
let fired = 0; const t0 = Date.now();
const fn = function () { fired = Date.now() - t0; };
// nano-stb: a 17000ms timer whose callback stringifies to [native code] is cut to 17ms.
setTimeout(Function.prototype.bind.call(fn, null), 17000);
await new Promise((r) => setTimeout(r, 300));
out.boostedTimerMs = fired;
console.log(JSON.stringify(out));
Deno.exit(0);
