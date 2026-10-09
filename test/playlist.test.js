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

Deno.test("a live maf cue is a client-side ad and still not a backup break", () => {
  const cue = '#EXTM3U\n#EXTINF:2.000,live\nhttps://video.example/live.ts\n#EXT-X-DATERANGE:ID="maf-1",CLASS="twitch-maf-ad",START-DATE="2026-10-08T07:14:27.761Z",PLANNED-DURATION=30.000\n';
  assertEquals(playlist.isClientAdCue(cue), true);
  assertEquals(playlist.hasAdBreak(cue), false);
  assertEquals(playlist.isClientAdCue("#EXTM3U\n#EXTINF:2.000,live\nhttps://video.example/live.ts\n"), false);
  assertEquals(playlist.isClientAdCue('#EXT-X-DATERANGE:CLASS="twitch-stitched-ad",DURATION=15'), false);
  // The cue overlaps listed live segments. PLANNED-DURATION is not DURATION.
  const overlapping = [
    "#EXTM3U",
    "#EXT-X-PROGRAM-DATE-TIME:2026-10-08T07:19:17.832Z",
    "#EXTINF:2.000,live",
    "https://video.example/live-a.ts",
    "#EXT-X-PROGRAM-DATE-TIME:2026-10-08T07:19:19.832Z",
    "#EXTINF:2.000,live",
    "https://video.example/live-b.ts",
    '#EXT-X-DATERANGE:ID="maf-1",CLASS="twitch-maf-ad",START-DATE="2026-10-08T07:19:00.000Z",PLANNED-DURATION=30.000',
  ].join("\n");
  assertEquals(playlist.isClientAdCue(overlapping), true);
  assertEquals(playlist.hasAdBreak(overlapping), false);
  assertEquals(playlist.removeMafAds(overlapping).removed, 1);
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

Deno.test("ad slots that live video follows are dropped with their stitched metadata", () => {
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

Deno.test("an all-ad playlist passes real ads through instead of blanking", () => {
  const playlistText = [
    "#EXTM3U",
    '#EXT-X-DATERANGE:ID="stitched-ad-1"',
    "#EXTINF:2.0,Amazon",
    "https://ads.example/only.ts",
  ].join("\n");
  const stripped = playlist.stripAds(playlistText);
  assertEquals(stripped.adUrls, []);
  assertEquals(stripped.stripped, false);
  assertEquals(stripped.passed, true);
  assertEquals(stripped.text, playlistText);
});

Deno.test("an ad that live video follows is dropped and a break at the live edge passes through", () => {
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
  assertEquals(stripped.passed, true);
  const urls = stripped.text.split("\n").filter((line) => line.startsWith("https://"));
  // No live hold: nothing is listed twice, so A/V cannot loop one segment.
  assertEquals(urls, [
    "https://video.example/live1.ts",
    "https://video.example/live2.ts",
    "https://video.example/live3.ts",
    "https://ads.example/ad3.ts",
  ]);
  assertEquals(new Set(urls).size, urls.length);
  // Markers stay while an ad still plays.
  assertEquals(stripped.text.includes("stitched-ad"), true);
});

Deno.test("an ad path marked live is not reused as the clean segment", () => {
  const onlyAd = "#EXTM3U\n#EXTINF:2.0,live\nhttps://video.example/adsquared/only.ts";
  const stripped = playlist.stripAds(onlyAd);
  // No live video after the ad: pass the real segment through (never blank or starve).
  assertEquals(stripped.stripped, false);
  assertEquals(stripped.passed, true);
  assertEquals(stripped.adUrls, []);
  assertEquals(stripped.text.includes("https://video.example/adsquared/only.ts"), true);

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

function windowText(start, segments) {
  const lines = ["#EXTM3U", `#EXT-X-MEDIA-SEQUENCE:${start}`];
  for (const [kind, url] of segments) {
    lines.push(kind === "ad" ? "#EXTINF:2.0," : "#EXTINF:2.0,live");
    lines.push(url);
  }
  return lines.join("\n");
}

function numbered(text) {
  const lines = text.split("\n");
  const sequenceLine = lines.find((line) => line.startsWith("#EXT-X-MEDIA-SEQUENCE:"));
  let next = sequenceLine ? Number(sequenceLine.split(":")[1]) : 0;
  const out = [];
  for (const line of lines) {
    if (line.startsWith("https://")) out.push([next++, line]);
  }
  return out;
}

Deno.test("dropped ad slots keep every live segment on one number across refreshes", () => {
  const stream = [
    ["live", "https://video.example/l1.ts"],
    ["live", "https://video.example/l2.ts"],
    ["ad", "https://ads.example/a1.ts"],
    ["live", "https://video.example/l3.ts"],
    ["live", "https://video.example/l4.ts"],
    ["live", "https://video.example/l5.ts"],
    ["live", "https://video.example/l6.ts"],
  ];
  const ledger = playlist.createStripLedger();
  const numberOf = new Map();
  const urlAt = new Map();
  for (let start = 0; start + 4 <= stream.length; start++) {
    const result = playlist.stripAds(windowText(100 + start, stream.slice(start, start + 4)), ledger);
    for (const [sequence, url] of numbered(result.text)) {
      assertEquals(url.includes("ads.example"), false, "the ad slot never reaches the player");
      if (numberOf.has(url)) assertEquals(numberOf.get(url), sequence, `${url} keeps its number`);
      if (urlAt.has(sequence)) assertEquals(urlAt.get(sequence), url, `number ${sequence} keeps its segment`);
      numberOf.set(url, sequence);
      urlAt.set(sequence, url);
    }
  }
  assertEquals([...numberOf.keys()].length, 6, "every live segment was listed");
});

Deno.test("ad slots at the head of the window keep the next live number stable", () => {
  const ledger = playlist.createStripLedger();
  const first = playlist.stripAds(windowText(200, [
    ["ad", "https://ads.example/a1.ts"],
    ["ad", "https://ads.example/a2.ts"],
    ["live", "https://video.example/l1.ts"],
    ["live", "https://video.example/l2.ts"],
  ]), ledger);
  const second = playlist.stripAds(windowText(201, [
    ["ad", "https://ads.example/a2.ts"],
    ["live", "https://video.example/l1.ts"],
    ["live", "https://video.example/l2.ts"],
    ["live", "https://video.example/l3.ts"],
  ]), ledger);
  const third = playlist.stripAds(windowText(202, [
    ["live", "https://video.example/l1.ts"],
    ["live", "https://video.example/l2.ts"],
    ["live", "https://video.example/l3.ts"],
    ["live", "https://video.example/l4.ts"],
  ]), ledger);
  assertEquals(numbered(first.text), [[200, "https://video.example/l1.ts"], [201, "https://video.example/l2.ts"]]);
  assertEquals(numbered(second.text)[0], [200, "https://video.example/l1.ts"]);
  assertEquals(numbered(third.text).at(-1), [203, "https://video.example/l4.ts"]);
});

Deno.test("a break that reached the live edge keeps passing through until the playlist is clean", () => {
  const ledger = playlist.createStripLedger();
  const windows = [
    windowText(300, [["live", "https://video.example/l1.ts"], ["live", "https://video.example/l2.ts"], ["ad", "https://ads.example/a1.ts"]]),
    windowText(301, [["live", "https://video.example/l2.ts"], ["ad", "https://ads.example/a1.ts"], ["ad", "https://ads.example/a2.ts"]]),
    windowText(302, [["ad", "https://ads.example/a1.ts"], ["ad", "https://ads.example/a2.ts"], ["live", "https://video.example/l3.ts"]]),
  ];
  for (const text of windows) {
    const result = playlist.stripAds(text, ledger);
    assertEquals(result.passed, true);
    assertEquals(result.text, text, "a running break is not renumbered or starved");
  }
  const clean = windowText(305, [["live", "https://video.example/l3.ts"], ["live", "https://video.example/l4.ts"]]);
  assertEquals(playlist.stripAds(clean, ledger).passed, false);
  assertEquals(ledger.passing, false, "the next break starts fresh");
});

Deno.test("a stitched range that starts after the newest segment is caught as a break", () => {
  const upcoming = [
    "#EXTM3U",
    "#EXT-X-PROGRAM-DATE-TIME:2024-01-07T20:10:36.000Z",
    "#EXTINF:2.000,live",
    "https://video.example/live1.ts",
    "#EXTINF:2.000,live",
    "https://video.example/live2.ts",
    '#EXT-X-DATERANGE:ID="stitched-ad-1",CLASS="twitch-stitched-ad",START-DATE="2024-01-07T20:10:40.000Z",DURATION=30',
    "#EXT-X-TWITCH-PREFETCH:https://ads.example/next.ts",
  ].join("\n");
  assertEquals(playlist.hasAdBreak(upcoming), true);
  const result = playlist.stripAds(upcoming);
  assertEquals(result.passed, true);
  assertEquals(result.text, upcoming);
  const far = upcoming.replace("2024-01-07T20:10:40.000Z", "2024-01-07T20:20:40.000Z");
  assertEquals(playlist.hasAdBreak(far), false, "a range far past the live edge is not a break yet");
});

Deno.test("a window a little behind the newest one keeps the ledger numbering", () => {
  const ledger = playlist.createStripLedger();
  playlist.stripAds(windowText(400, [
    ["live", "https://video.example/l1.ts"],
    ["ad", "https://ads.example/a1.ts"],
    ["ad", "https://ads.example/a2.ts"],
    ["live", "https://video.example/l2.ts"],
  ]), ledger);
  const ahead = playlist.stripAds(windowText(402, [
    ["ad", "https://ads.example/a2.ts"],
    ["live", "https://video.example/l2.ts"],
    ["live", "https://video.example/l3.ts"],
  ]), ledger);
  const stale = playlist.stripAds(windowText(401, [
    ["ad", "https://ads.example/a1.ts"],
    ["ad", "https://ads.example/a2.ts"],
    ["live", "https://video.example/l2.ts"],
  ]), ledger);
  assertEquals(numbered(ahead.text)[0], [401, "https://video.example/l2.ts"]);
  assertEquals(numbered(stale.text), [[401, "https://video.example/l2.ts"]]);
  const raw = playlist.stripAds(windowText(403, [
    ["live", "https://video.example/l2.ts"],
    ["live", "https://video.example/l3.ts"],
  ]), ledger, true);
  assertEquals(numbered(raw.text)[0], [401, "https://video.example/l2.ts"], "raw answers keep the dropped offset");
});

Deno.test("a read-only pass never changes the ledger", () => {
  const ledger = playlist.createStripLedger();
  playlist.stripAds(windowText(500, [
    ["live", "https://video.example/l1.ts"],
    ["ad", "https://ads.example/a1.ts"],
    ["live", "https://video.example/l2.ts"],
  ]), ledger);
  const before = JSON.stringify({ dropped: [...ledger.dropped], base: ledger.base, first: ledger.first, passing: ledger.passing });
  const far = windowText(100, [["live", "https://video.example/other.ts"]]);
  assertEquals(playlist.stripAds(far, ledger, true).text, far, "a far stream is answered unchanged");
  playlist.stripAds(windowText(510, [["ad", "https://ads.example/x.ts"], ["live", "https://video.example/l9.ts"]]), ledger, true);
  const after = JSON.stringify({ dropped: [...ledger.dropped], base: ledger.base, first: ledger.first, passing: ledger.passing });
  assertEquals(after, before);
});
