// Twitch playlist harness (review 2026-11-16, WP-25): runs the vendored
// stripAdSegments and processM3U8 on the m3u8 fixtures. The vendor file is
// frozen and is not changed: the functions are cut out of its text with
// indexOf slices (as swap.test.js does) and run with stub worker globals.
import source from "../src/vendor/video-swap-new.user.js" with { type: "text" };
import stitchedAd from "./fixtures/twitch-stitched-ad.m3u8" with { type: "text" };
import midrollCue from "./fixtures/twitch-midroll-cue.m3u8" with { type: "text" };
import mafAd from "./fixtures/twitch-maf-ad.m3u8" with { type: "text" };

function assert(c, l) { if (!c) throw new Error(l || "assertion failed"); }

function slice(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert(start !== -1 && end > start, "vendor slice " + startMarker + " .. " + endMarker);
  return source.slice(start, end);
}

// declareOptions(scope) gives the worker globals (AD_SIGNIFIER, AdSegmentCache,
// ...). The two playlist functions run with those globals as parameters.
const DECLARE = slice("function declareOptions(scope)", "    let twitchPlayerAndState");
const PLAYLIST = slice("    function stripAdSegments(", "    function hookWorkerFetch(");
const GLOBALS = ["AD_SIGNIFIER", "LIVE_SIGNIFIER", "StreamInfosByUrl", "SimulatedAdsDepth", "IsAdStrippingEnabled", "AdSegmentCache", "AllSegmentsAreAdSegments"];

function worker() {
  const scope = {};
  new Function(DECLARE + "\nreturn declareOptions;")()(scope);
  const calls = { onFoundAd: 0, banner: 0 };
  const stubs = {
    onFoundAd: async (_info, text) => { calls.onFoundAd++; return text; },
    updateAdblockBannerForStream: () => { calls.banner++; },
    postMessage: () => {},
    fetch: () => Promise.resolve({ blob() {} }),
  };
  const names = [...GLOBALS, ...Object.keys(stubs)];
  const make = new Function(...names, PLAYLIST + "\nreturn { stripAdSegments, processM3U8 };");
  const fns = make(...GLOBALS.map((g) => scope[g]), ...Object.values(stubs));
  return { scope, calls, ...fns };
}
const streamInfo = () => ({ NumStrippedAdSegments: 0, IsStrippingAdSegments: false, Urls: new Map(), BackupEncodings: null, IsMovingOffBackupEncodings: false });
const segments = (m3u8, live) => {
  const lines = m3u8.replace(/\r/g, "").split("\n");
  const out = [];
  // By host, not by the ",live" tag the vendor code reads: the redacted
  // fixtures put ad segments on ads.example and stream segments on video.example.
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].startsWith("#EXTINF") && lines[i + 1].startsWith(live ? "https://video.example/" : "https://ads.example/")) out.push(lines[i + 1]);
  }
  return out;
};

function checkStrip(m3u8, label) {
  const w = worker();
  assert(w.scope.AD_SIGNIFIER === "stitched-ad", "AD_SIGNIFIER from the vendor text");
  const info = streamInfo();
  const out = w.stripAdSegments(m3u8, false, info);
  const ads = segments(m3u8, false);
  const live = segments(m3u8, true);
  assert(ads.length === 2 && live.length === 2, label + ": fixture has 2 ad and 2 live segments");
  // An ad segment URL in AdSegmentCache is answered with a blank video by the
  // worker fetch hook (hookWorkerFetch), so the player never shows it.
  for (const url of ads) assert(w.scope.AdSegmentCache.has(url), label + ": ad segment is not stripped: " + url);
  for (const url of live) assert(!w.scope.AdSegmentCache.has(url), label + ": live segment was stripped: " + url);
  assert(info.NumStrippedAdSegments === 2 && info.IsStrippingAdSegments === true, label + ": stream info counts 2 stripped segments");
  for (const url of live) assert(out.includes(url), label + ": live segment kept in the playlist");
  return { w, info, out };
}

Deno.test("stripAdSegments: stitched-ad fixture, the 2 ad segments are stripped and the 2 live ones kept", () => {
  checkStrip(stitchedAd, "stitched-ad");
});

Deno.test("stripAdSegments: midroll cue fixture, the 2 ad segments are stripped and the 2 live ones kept", () => {
  checkStrip(midrollCue, "midroll");
});

Deno.test("stripAdSegments: prefetch lines are cleared while ads are stripped; the tracking-URL rewrite does not reach the output (upstream gap)", () => {
  const w = worker();
  const info = streamInfo();
  const m3u8 = stitchedAd.replace("#EXTM3U\n", '#EXTM3U\n#EXT-X-DATERANGE:ID="x",X-TV-TWITCH-AD-URL="https://ads.example/click",X-TV-TWITCH-AD-CLICK-TRACKING-URL="https://ads.example/track"\n') +
    "#EXT-X-TWITCH-PREFETCH:https://video.example/redacted/prefetch-1.ts\n";
  const out = w.stripAdSegments(m3u8, false, info);
  assert(!out.includes("#EXT-X-TWITCH-PREFETCH:"), "prefetch cleared during ads");
  // Upstream (1.55) rewrites X-TV-TWITCH-AD-URL / -CLICK-TRACKING-URL into a
  // local copy of the line and never stores it back, so the playlist keeps
  // the original URLs. If a vendor update fixes this, change this assertion.
  assert(out.includes("ads.example/click") && out.includes("ads.example/track"), "upstream now rewrites the tracking URLs: update this test");
});

Deno.test("stripAdSegments: the all-live maf fixture strips nothing and keeps its prefetch lines (known upstream gap)", () => {
  const w = worker();
  const info = streamInfo();
  const out = w.stripAdSegments(mafAd, false, info);
  assert(w.scope.AdSegmentCache.size === 0 && info.IsStrippingAdSegments === false && info.NumStrippedAdSegments === 0, "nothing stripped");
  assert((out.match(/#EXT-X-TWITCH-PREFETCH:/g) || []).length === 2, "prefetch kept");
});

Deno.test("processM3U8: a known stream with stitched-ad tags calls onFoundAd and strips; an unknown URL is returned unchanged", async () => {
  const w = worker();
  const url = "https://video.example/redacted/720p.m3u8";
  const info = streamInfo();
  info.Urls.set(url, { Resolution: "1280x720" });
  w.scope.StreamInfosByUrl[url] = info;
  await w.processM3U8(url, stitchedAd, () => Promise.reject(new Error("no fetch expected")));
  assert(w.calls.onFoundAd === 1 && w.calls.banner === 1, "onFoundAd and banner called once");
  for (const ad of segments(stitchedAd, false)) assert(w.scope.AdSegmentCache.has(ad), "ad segment stripped via processM3U8");
  const other = await w.processM3U8("https://video.example/other.m3u8", stitchedAd, () => {});
  assert(other === stitchedAd && w.calls.onFoundAd === 1, "unknown playlist untouched");
});
