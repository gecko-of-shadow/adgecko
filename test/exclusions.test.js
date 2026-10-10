import source from "../src/general/exclusions.js" with { type: "text" };
import youtubeSource from "../src/youtube.js" with { type: "text" };
import debugSource from "../src/debug.js" with { type: "text" };
import vendorSource from "../src/vendor/video-swap-new.user.js" with { type: "text" };
import manifest from "../manifest.json" with { type: "json" };

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function assertEquals(actual, expected, label) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${label || "expected equal values"}\n${left}\n${right}`);
}

const api = {};
const install = new Function(`${source}\nreturn installGeneralAdblockExclusions;`)();
install(api);

Deno.test("hard-exclude covers Twitch, the whole YouTube family, and Kick", () => {
  for (const host of [
    "twitch.tv",
    "www.twitch.tv",
    "m.twitch.tv",
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "studio.youtube.com",
    "youtubekids.com",
    "www.youtubekids.com",
    "youtu.be",
    "kick.com",
    "www.kick.com",
    "player.kick.com",
  ]) {
    assert(api.isExcludedSiteHost(host), host);
    assert(api.isExcludedHost(host), host);
  }
});

Deno.test("video hosts for excluded players are also skipped", () => {
  for (const host of [
    "usher.ttvnw.net",
    "video-edge-abc.ttvnw.net",
    "static-cdn.jtvnw.net",
    "rr3---sn.googlevideo.com",
    "i.ytimg.com",
    "yt3.ggpht.com",
    "youtubei.googleapis.com",
    "abc.live-video.net",
  ]) {
    assert(api.isExcludedVideoHost(host), host);
    assert(api.isExcludedHost(host), host);
  }
});

Deno.test("lookalike and ordinary hosts are not excluded", () => {
  for (const host of [
    "nottwitch.tv",
    "twitch.tv.evil.test",
    "notkick.com",
    "kick.com.evil.test",
    "example.com",
    "news.example",
    "doubleclick.net",
  ]) {
    assert(!api.isExcludedHost(host), host);
  }
});

Deno.test("excluded URLs resolve from the host", () => {
  assert(api.isExcludedUrl("https://www.twitch.tv/some/channel"));
  assert(api.isExcludedUrl("https://music.youtube.com/watch?v=abc"));
  assert(api.isExcludedUrl("https://player.kick.com/embed/x"));
  assert(api.isExcludedUrl("https://rr5---sn-abc.googlevideo.com/videoplayback?id=1"));
  assert(!api.isExcludedUrl("https://example.com/ads"));
  assert(!api.isExcludedUrl(""));
});

Deno.test("DNR initiator and request domain lists include stream families", () => {
  const initiators = api.dnrExcludedInitiatorDomains();
  const requests = api.dnrExcludedRequestDomains();
  for (const need of ["twitch.tv", "www.youtube.com", "music.youtube.com", "youtu.be", "kick.com"]) {
    assert(initiators.includes(need), "initiator " + need);
  }
  for (const need of ["googlevideo.com", "ttvnw.net", "live-video.net", "ytimg.com"]) {
    assert(requests.includes(need), "request " + need);
  }
});

Deno.test("playback files are not edited by the general-adblock exclusions work", () => {
  assert(vendorSource.includes("ourTwitchAdSolutionsVersion = 23"), "vendor pin stays");
  assert(vendorSource.includes("AD_SIGNIFIER = 'stitched-ad'"), "vendor ad marker stays");
  assert(youtubeSource.includes("installYoutubeAdblock"), "youtube install stays");
  assert(youtubeSource.includes("isInlinePlaybackNoAd"), "youtube no-ad mark stays");
  assert(debugSource.includes("installTwitchAdblockDebug"), "debug install stays");
  assert(!source.includes("installYoutubeAdblock"), "exclusions do not rewrite youtube");
  assert(!source.includes("video-swap-new"), "exclusions do not touch vendor");
  assertEquals(manifest.version, "0.2.5");
});
