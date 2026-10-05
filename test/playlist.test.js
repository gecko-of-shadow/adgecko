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

Deno.test("a normal live playlist is left unchanged", () => {
  const playlistText = "#EXTM3U\n#EXTINF:2.0,live\nhttps://video.example/live1.ts";
  const stripped = playlist.stripAds(playlistText);
  assertEquals(stripped.stripped, false);
  assertEquals(stripped.text, playlistText);
});

Deno.test("blank segment is a short mpeg-ts null packet run", () => {
  const bytes = playlist.blankSegmentBytes();
  assertEquals(bytes.length, 188 * 8);
  assertEquals(bytes[0], 0x47);
  assertEquals(bytes[188], 0x47);
});
