import vendorSource from "../src/vendor/video-swap-new.user.js" with { type: "text" };
import youtubeSource from "../src/youtube.js" with { type: "text" };
import stitchedAd from "./fixtures/twitch-stitched-ad.m3u8" with { type: "text" };
import midrollCue from "./fixtures/twitch-midroll-cue.m3u8" with { type: "text" };
import liveMaster from "./fixtures/twitch-live-master.m3u8" with { type: "text" };
import mafAd from "./fixtures/twitch-maf-ad.m3u8" with { type: "text" };
import playerAd from "./fixtures/youtube-player-ad.json" with { type: "text" };
import homeSponsored from "./fixtures/youtube-home-sponsored.json" with { type: "text" };

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

Deno.test("stitched-ad fixture matches upstream AD_SIGNIFIER", () => {
  assert(stitchedAd.includes("twitch-stitched-ad") || stitchedAd.includes("stitched-ad"), "fixture has stitched-ad marker");
  assert(vendorSource.includes("AD_SIGNIFIER = 'stitched-ad'"), "upstream keys off stitched-ad");
  assert(stitchedAd.includes("#EXTM3U"), "fixture is a playlist");
});

Deno.test("midroll cue fixture still documents CUE-OUT style breaks", () => {
  assert(midrollCue.includes("#EXT-X-CUE-OUT"), "cue-out marker is present");
  assert(midrollCue.includes("#EXTM3U"), "fixture is a playlist");
});

Deno.test("live master fixture lists quality rungs", () => {
  assert(liveMaster.includes("#EXT-X-STREAM-INF"), "master fixture has stream-inf");
  assert((liveMaster.match(/#EXT-X-STREAM-INF/g) || []).length >= 3, "at least three rungs");
});

Deno.test("youtube player-ad fixture matches strip fields", () => {
  const parsed = JSON.parse(playerAd);
  assert(Array.isArray(parsed.adPlacements) && parsed.adPlacements.length > 0, "fixture has ad placements");
  assert(parsed.playerAds && parsed.adSlots, "fixture has player ad shells");
  assert(parsed.videoDetails.videoId, "fixture keeps a video id");
  assert(youtubeSource.includes('"adPlacements"'), "extension strips adPlacements");
  assert(youtubeSource.includes('"playerAds"'), "extension strips playerAds");
  assert(youtubeSource.includes('"adSlots"'), "extension strips adSlots");
  assert(playerAd.includes("AD_PLACEMENT_KIND_START"), "pre-roll kind is present");
  assert(playerAd.includes("AD_PLACEMENT_KIND_MILLISECONDS"), "mid-roll kind is present");
});

Deno.test("youtube home sponsored fixture keeps organic rows", () => {
  const parsed = JSON.parse(homeSponsored);
  const contents = parsed.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.richGridRenderer.contents;
  assert(contents.some((item) => item.richItemRenderer?.content?.videoRenderer), "organic video stays");
  assert(contents.some((item) => JSON.stringify(item).includes("promotedVideoRenderer")), "sponsored card is present before strip");
  assert(contents.some((item) => item.continuationItemRenderer), "continuation token stays");
  assert(youtubeSource.includes("promotedVideoRenderer"), "home strip knows promotedVideoRenderer");
});

Deno.test("fixture files stay redacted", () => {
  const blobs = [stitchedAd, midrollCue, liveMaster, mafAd, playerAd, homeSponsored];
  for (const blob of blobs) {
    assert(!/oauth|Bearer |client_secret|password=/i.test(blob), "no credentials in fixtures");
  }
});

Deno.test("maf fixture is all-live; upstream only keys off stitched-ad", () => {
  assert(mafAd.includes("twitch-maf-ad"), "maf tag present in fixture");
  assert(mafAd.includes(",live"), "segments stay live");
  assert(vendorSource.includes("AD_SIGNIFIER = 'stitched-ad'"), "upstream does not treat maf as AD_SIGNIFIER");
  assert(!vendorSource.includes("twitch-maf-ad"), "unmodified upstream has no maf special-case");
});
