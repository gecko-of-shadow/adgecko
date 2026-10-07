import playlistSource from "../src/playlist.js" with { type: "text" };
import youtubeSource from "../src/youtube.js" with { type: "text" };
import stitchedAd from "./fixtures/twitch-stitched-ad.m3u8" with { type: "text" };
import midrollCue from "./fixtures/twitch-midroll-cue.m3u8" with { type: "text" };
import liveMaster from "./fixtures/twitch-live-master.m3u8" with { type: "text" };
import playerAd from "./fixtures/youtube-player-ad.json" with { type: "text" };
import homeSponsored from "./fixtures/youtube-home-sponsored.json" with { type: "text" };

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

const playlist = new Function(`${playlistSource}\nreturn TwitchAdblockPlaylist;`)();

Deno.test("stitched-ad fixture is detected and stripped", () => {
  assert(playlist.hasAdBreak(stitchedAd), "stitched-ad cue is an ad break");
  assert(!playlist.isMidroll(stitchedAd), "pod without midroll filler is not midroll");
  const stripped = playlist.stripAds(stitchedAd);
  assert(stripped.stripped, "ad segments are removed");
  assert(!stripped.text.includes("ads.example"), "ad URLs leave the playlist");
  assert(stripped.text.includes("live-seg-100.ts"), "live segments stay");
  assert(!stripped.text.includes("adsquared"), "adsquared segments are not served");
});

Deno.test("midroll cue fixture is detected as midroll", () => {
  assert(playlist.hasAdBreak(midrollCue), "midroll cue is an ad break");
  assert(playlist.isMidroll(midrollCue), "midroll filler type is recognized");
  assert(midrollCue.includes("#EXT-X-CUE-OUT"), "cue-out marker is present");
  const stripped = playlist.stripAds(midrollCue);
  assert(stripped.stripped, "midroll segments are removed");
  assert(!stripped.text.includes("/processing/"), "processing ad urls leave");
  assert(!stripped.text.includes("/_404/"), "404 ad urls leave");
  assert(stripped.text.includes("live-seg-200.ts"), "live segments stay");
});

Deno.test("live master fixture lists quality rungs", () => {
  assert(playlist.isMasterPlaylist(liveMaster), "master fixture has stream-inf");
  const variants = playlist.listVariants(liveMaster);
  assert(variants.length === 3, "three redacted rungs");
  assert(playlist.pickVariant(liveMaster, { resolution: "1280x720", frameRate: "30.000" }).includes("720p"), "720p pick");
  assert(playlist.readServerTime(liveMaster) === "1718452800.000", "server time survives redaction");
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
  const blobs = [stitchedAd, midrollCue, liveMaster, playerAd, homeSponsored];
  for (const blob of blobs) {
    assert(!/oauth|Bearer |client_secret|password=/i.test(blob), "no credentials in fixtures");
    assert(!blob.includes("kimne78kx3ncx6brgo4mv6wki5h1ko"), "no live client secret material");
  }
});
