import source from "../src/playlist.js" with { type: "text" };

const playlist = new Function(`${source}\nreturn TwitchAdblockPlaylist;`)();

function assertEquals(actual, expected, label) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${label || "expected equal values"}\n${left}\n${right}`);
}

const master = [
  "#EXTM3U",
  '#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,FRAME-RATE=60.000,CODECS="hev1.1.6.L93.B0"',
  "https://video.example/1080.m3u8",
  '#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=640x360,FRAME-RATE=30.000,CODECS="avc1.4D401E"',
  "https://video.example/360.m3u8",
].join("\n");

Deno.test("live playlist urls include media playlists that have no m3u8 suffix", () => {
  assertEquals(playlist.isLivePlaylistUrl("https://video-weaver.pop02.hls.ttvnw.net/v1/playlist/abc"), true);
  assertEquals(playlist.isLivePlaylistUrl("https://usher.ttvnw.net/api/v2/channel/hls/name.m3u8"), true);
  assertEquals(playlist.isLivePlaylistUrl("https://usher.ttvnw.net/vod/v2/123.m3u8"), false);
  assertEquals(playlist.isLivePlaylistUrl("https://gql.twitch.tv/gql"), false);
  assertEquals(playlist.isLivePlaylistUrl("https://clips-media-assets2.twitch.tv/AT-cm/abc.m3u8"), false);
  assertEquals(playlist.isLivePlaylistUrl("https://d2e2de1etea730.cloudfront.net/video/hls/index.m3u8"), false);
});

Deno.test("channel names come from live usher paths", () => {
  assertEquals(
    playlist.channelFromPlaylistUrl("https://usher.ttvnw.net/api/v2/channel/hls/Some_Channel.m3u8?token=1"),
    "Some_Channel",
  );
  assertEquals(playlist.channelFromPlaylistUrl("https://usher.ttvnw.net/vod/v2/123.m3u8"), null);
});

Deno.test("stitched ads and midrolls are labeled from the playlist text", () => {
  assertEquals(playlist.hasStitchedAd('#EXT-X-DATERANGE:ID="stitched-ad-1",CLASS="twitch-stitched-ad"'), true);
  assertEquals(playlist.hasStitchedAd('#EXT-X-DATERANGE:CLASS="twitch-maf-ad"'), true);
  assertEquals(playlist.hasStitchedAd('#EXT-X-DATERANGE:CLASS="twitch-trigger"'), true);
  assertEquals(playlist.hasStitchedAd("#EXT-X-CUE-OUT:0"), true);
  assertEquals(playlist.hasStitchedAd("#EXTINF:2.0,live"), false);
  assertEquals(playlist.isMidroll('{"ad":"MIDROLL"}'), true);
  assertEquals(playlist.isMasterPlaylist(master), true);
});

Deno.test("server time is read and written for both playlist shapes", () => {
  const legacy = '#EXT-X-TWITCH-INFO:SERVER-TIME="10.5"';
  assertEquals(playlist.readServerTime(legacy), "10.5");
  assertEquals(playlist.writeServerTime(legacy, "12"), '#EXT-X-TWITCH-INFO:SERVER-TIME="12"');
  const session = '#EXT-X-SESSION-DATA:DATA-ID="SERVER-TIME",VALUE="10.5"';
  assertEquals(playlist.readServerTime(session), "10.5");
  assertEquals(playlist.writeServerTime(session, "12"), '#EXT-X-SESSION-DATA:DATA-ID="SERVER-TIME",VALUE="12"');
  assertEquals(playlist.writeServerTime(legacy, ""), legacy);
});

Deno.test("variant pick prefers the same resolution and frame rate", () => {
  assertEquals(playlist.pickVariant(master, { resolution: "640x360", frameRate: "30.000" }), "https://video.example/360.m3u8");
  assertEquals(playlist.pickVariant(master, { resolution: "1280x720", frameRate: "30.000" }), "https://video.example/1080.m3u8");
  assertEquals(playlist.pickVariant(master, null), "https://video.example/1080.m3u8");
});

Deno.test("backup master keeps the quality list and points each rung at a backup url", () => {
  const backup = [
    "#EXTM3U",
    '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.64001F"',
    "https://backup.example/720.m3u8",
    '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4D401E"',
    "https://backup.example/360.m3u8",
  ].join("\n");
  const mapped = playlist.mapVariantsToBackup(master, backup, "https://backup.example/master.m3u8");
  const variants = playlist.listVariants(mapped);
  assertEquals(variants[0].url, "https://backup.example/720.m3u8#tab2");
  assertEquals(variants[0].codecs, "avc1.64001F");
  assertEquals(variants[1].url, "https://backup.example/360.m3u8#tab4");
  assertEquals(variants[1].codecs, "avc1.4D401E");
});

Deno.test("audio-only rungs stay on the backup audio playlist", () => {
  const main = [
    "#EXTM3U",
    '#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,CODECS="avc1.64002A,mp4a.40.2",VIDEO="chunked",FRAME-RATE=60.000',
    "https://live.example/1080.m3u8",
    '#EXT-X-STREAM-INF:BANDWIDTH=160000,CODECS="mp4a.40.2",VIDEO="audio_only"',
    "https://live.example/audio.m3u8",
  ].join("\n");
  const backup = [
    "#EXTM3U",
    '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.64002A,mp4a.40.2",VIDEO="chunked",FRAME-RATE=60.000',
    "https://backup.example/1080.m3u8",
    '#EXT-X-STREAM-INF:BANDWIDTH=160000,CODECS="mp4a.40.2",VIDEO="audio_only"',
    "https://backup.example/audio.m3u8",
  ].join("\n");
  const mapped = playlist.mapVariantsToBackup(main, backup, "https://backup.example/master.m3u8");
  const variants = playlist.listVariants(mapped);
  assertEquals(variants[0].url, "https://backup.example/1080.m3u8#tab2");
  assertEquals(variants[1].url, "https://backup.example/audio.m3u8#tab4");
  assertEquals(variants[1].codecs, "mp4a.40.2");
});

Deno.test("ad playlists repeat the live segment and drop stitched metadata", () => {
  const playlistText = [
    "#EXTM3U",
    '#EXT-X-DATERANGE:ID="stitched-ad-1",CLASS="twitch-stitched-ad",X-TV-TWITCH-AD-URL="https://ads.example/click"',
    "#EXTINF:2.0,",
    "https://ads.example/seg1.ts",
    "#EXTINF:2.0,live",
    "https://video.example/live1.ts",
    "#EXT-X-TWITCH-PREFETCH:https://video.example/next.ts",
  ].join("\n");
  const stripped = playlist.stripAds(playlistText);
  assertEquals(stripped.stripped, true);
  assertEquals(stripped.adUrls, []);
  assertEquals(stripped.text.includes("stitched-ad"), false);
  assertEquals(stripped.text.includes("PREFETCH"), false);
  assertEquals(stripped.text.includes("https://ads.example/seg1.ts"), false);
  assertEquals(stripped.text.includes("https://video.example/live1.ts"), true);
});

Deno.test("an all-ad playlist records the segment urls when no live segment exists", () => {
  const playlistText = [
    "#EXTM3U",
    '#EXT-X-DATERANGE:ID="stitched-ad-1"',
    "#EXTINF:2.0,Amazon",
    "https://ads.example/only.ts",
  ].join("\n");
  const stripped = playlist.stripAds(playlistText);
  assertEquals(stripped.adUrls, ["https://ads.example/only.ts"]);
  assertEquals(stripped.text.includes("#EXTINF:2.0,live"), true);
  assertEquals(stripped.text.includes("https://ads.example/only.ts"), true);
});

Deno.test("an ad between live segments repeats the newest preceding segment", () => {
  const playlistText = [
    "#EXTM3U",
    "#EXTINF:2.0,live",
    "https://video.example/live1.ts",
    "#EXTINF:2.0,live",
    "https://video.example/live2.ts",
    '#EXT-X-DATERANGE:ID="stitched-ad-1",CLASS="twitch-stitched-ad"',
    "#EXTINF:2.0,",
    "https://ads.example/ad.ts",
    "#EXTINF:2.0,",
    "https://ads.example/ad2.ts",
    "#EXTINF:2.0,live",
    "https://video.example/live3.ts",
    "#EXTINF:2.0,",
    "https://ads.example/ad3.ts",
  ].join("\n");
  const stripped = playlist.stripAds(playlistText);
  assertEquals(stripped.adUrls, []);
  assertEquals(stripped.text.includes("https://ads.example/"), false);
  const urls = stripped.text.split("\n").filter((line) => line.startsWith("https://"));
  assertEquals(urls, [
    "https://video.example/live1.ts",
    "https://video.example/live2.ts",
    "https://video.example/live2.ts",
    "https://video.example/live2.ts",
    "https://video.example/live3.ts",
    "https://video.example/live3.ts",
  ]);
});

Deno.test("an ad path marked live is not reused as the clean segment", () => {
  const onlyAd = "#EXTM3U\n#EXTINF:2.0,live\nhttps://video.example/adsquared/only.ts";
  const stripped = playlist.stripAds(onlyAd);
  assertEquals(stripped.stripped, true);
  assertEquals(stripped.adUrls, ["https://video.example/adsquared/only.ts"]);

  const mixed = [
    "#EXTM3U",
    "#EXTINF:2.0,live",
    "https://video.example/_404/ad.ts",
    "#EXTINF:2.0,live",
    "https://video.example/real.ts",
  ].join("\n");
  const replaced = playlist.stripAds(mixed);
  assertEquals(replaced.adUrls, []);
  assertEquals(replaced.text.includes("https://video.example/_404/ad.ts"), false);
  assertEquals(replaced.text.includes("https://video.example/real.ts"), true);
});

Deno.test("a stitched range covers live-titled segments inside its window", () => {
  const playlistText = [
    "#EXTM3U",
    '#EXT-X-DATERANGE:ID="stitched-ad-1704658240",CLASS="twitch-stitched-ad",START-DATE="2024-01-07T20:10:40.960Z",DURATION=15.050',
    "#EXT-X-PROGRAM-DATE-TIME:2024-01-07T20:10:40.960Z",
    "#EXTINF:2.002,live",
    "https://video.example/ad.ts",
    "#EXT-X-PROGRAM-DATE-TIME:2024-01-07T20:10:56.010Z",
    "#EXTINF:2.002,live",
    "https://video.example/live.ts",
  ].join("\n");
  assertEquals(playlist.hasAdBreak(playlistText), true);
  const stripped = playlist.stripAds(playlistText);
  assertEquals(stripped.stripped, true);
  assertEquals(stripped.adUrls, []);
  assertEquals(stripped.text.includes("https://video.example/ad.ts"), false);
  assertEquals(stripped.text.includes("https://video.example/live.ts"), true);
  assertEquals(stripped.text.includes("stitched-ad"), false);
});

Deno.test("a stitched range that already ended is not an ad break", () => {
  const playlistText = [
    "#EXTM3U",
    '#EXT-X-DATERANGE:ID="stitched-ad-old",CLASS="twitch-stitched-ad",START-DATE="2024-01-07T20:00:00.000Z",DURATION=15',
    "#EXT-X-PROGRAM-DATE-TIME:2024-01-07T20:10:40.960Z",
    "#EXTINF:2.002,live",
    "https://video.example/live.ts",
  ].join("\n");
  assertEquals(playlist.hasAdBreak(playlistText), false);
  assertEquals(playlist.stripAds(playlistText).stripped, false);
});

Deno.test("a leftover ad tag with only live segments does not count as an ad break", () => {
  const playlistText = [
    "#EXTM3U",
    '#EXT-X-DATERANGE:ID="stitched-ad-old",CLASS="twitch-stitched-ad"',
    "#EXTINF:2.0,live",
    "https://video.example/live1.ts",
    "#EXT-X-TWITCH-PREFETCH:https://video.example/next.ts",
  ].join("\n");
  assertEquals(playlist.hasAdBreak(playlistText), false);
  const stripped = playlist.stripAds(playlistText);
  assertEquals(stripped.stripped, false);
  assertEquals(stripped.text.includes("https://video.example/live1.ts"), true);
  assertEquals(stripped.text.includes("#EXT-X-TWITCH-PREFETCH:"), true);
});

Deno.test("a normal live playlist is left unchanged", () => {
  const playlistText = "#EXTM3U\n#EXTINF:2.0,live\nhttps://video.example/live1.ts";
  const stripped = playlist.stripAds(playlistText);
  assertEquals(stripped.stripped, false);
  assertEquals(stripped.text, playlistText);
});

Deno.test("the first non-live segment is the preroll fetched beside the backup stream", () => {
  const playlistText = [
    "#EXTM3U",
    "#EXTINF:2.0,live",
    "https://video.example/live.ts",
    "#EXTINF:2.0,",
    "https://ads.example/ad.ts",
    "#EXTINF:2.0,",
    "https://ads.example/ad2.ts",
  ].join("\n");
  assertEquals(playlist.firstAdSegmentUrl(playlistText), "https://ads.example/ad.ts");
  assertEquals(playlist.firstAdSegmentUrl("#EXTM3U\n#EXTINF:2.0,live\nhttps://video.example/live.ts"), "");
});

Deno.test("blank segment is a short mpeg-ts with a pat, pmt, and pts", () => {
  const bytes = playlist.blankSegmentBytes();
  assertEquals(bytes.length, 188 * 3);
  assertEquals(bytes[0], 0x47);
  assertEquals(bytes[1] & 0x1f, 0x00);
  assertEquals(bytes[188], 0x47);
  assertEquals(bytes[189], 0x41);
  assertEquals(bytes[376], 0x47);
  assertEquals(bytes[bytes.length - 15], 0x00);
  assertEquals(bytes[bytes.length - 14], 0x00);
  assertEquals(bytes[bytes.length - 13], 0x01);
  assertEquals(bytes[bytes.length - 12], 0xe0);
  assertEquals(bytes[bytes.length - 6], 0x21);
});
