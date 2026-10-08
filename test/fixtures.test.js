import playlistSource from "../src/playlist.js" with { type: "text" };
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

const playlist = new Function(`${playlistSource}\nreturn TwitchAdblockPlaylist;`)();

Deno.test("stitched-ad fixture is detected and stripped", () => {
  assert(playlist.hasAdBreak(stitchedAd), "stitched-ad cue is an ad break");
  assert(!playlist.isMidroll(stitchedAd), "pod without midroll filler is not midroll");
  // The stitched range still covers the newest segment: the break is running, so
  // it passes through rather than starving the player.
  const running = playlist.stripAds(stitchedAd);
  assert(!running.stripped && running.passed, "a running break passes through");
  assert(running.text === stitchedAd.replaceAll("\r", ""), "a running break is unmodified");
  const ended = playlist.stripAds(stitchedAd.trimEnd() + "\n#EXT-X-PROGRAM-DATE-TIME:2024-06-15T12:00:16.000Z\n#EXTINF:2.000,live\nhttps://video.example/redacted/live-seg-102.ts\n");
  assert(ended.stripped, "ad segments are removed once live video follows");
  assert(!ended.text.includes("ads.example"), "ad URLs leave the playlist");
  assert(ended.text.includes("live-seg-100.ts") && ended.text.includes("live-seg-102.ts"), "live segments stay");
  assert(!ended.text.includes("adsquared"), "adsquared segments are not served");
  assert(ended.text.includes("#EXT-X-MEDIA-SEQUENCE:100"), "the first live segment keeps its number");
});

Deno.test("midroll cue fixture is detected as midroll", () => {
  assert(playlist.hasAdBreak(midrollCue), "midroll cue is an ad break");
  assert(playlist.isMidroll(midrollCue), "midroll filler type is recognized");
  assert(midrollCue.includes("#EXT-X-CUE-OUT"), "cue-out marker is present");
  assert(playlist.stripAds(midrollCue).passed, "a running midroll passes through");
  const stripped = playlist.stripAds(midrollCue.trimEnd() + "\n#EXT-X-PROGRAM-DATE-TIME:2024-06-15T13:30:31.000Z\n#EXTINF:2.000,live\nhttps://video.example/redacted/live-seg-202.ts\n");
  assert(stripped.stripped, "midroll segments are removed once live video follows");
  assert(!stripped.text.includes("/processing/"), "processing ad urls leave");
  assert(!stripped.text.includes("/_404/"), "404 ad urls leave");
  assert(stripped.text.includes("live-seg-200.ts"), "live segments stay");
  assert(!stripped.text.includes("#EXT-X-CUE-OUT"), "cue markers leave with the dropped slots");
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

Deno.test("a maf ad break is not an ad break and only its tag is removed", () => {
  // Every segment stays live: swapping to a backup here would reload for nothing.
  assert(!playlist.hasAdBreak(mafAd), "an all-live maf break never starts a backup swap");
  assert(!playlist.stripAds(mafAd).stripped, "stripAds leaves the maf playlist alone");
  const result = playlist.removeMafAds(mafAd);
  assert(result.removed === 1, "the single maf DATERANGE line is removed");
  assert(!result.text.includes("twitch-maf-ad"), "the player never sees the maf tag");
  const expected = mafAd.split("\n").filter((line) => !line.includes('CLASS="twitch-maf-ad"')).join("\n");
  assert(result.text === expected, "segments, prefetch lines, and numbering are untouched");
  assert(playlist.removeMafAds(result.text).removed === 0, "a second pass changes nothing");
});
