import pageSource from "../src/page.js" with { type: "text" };
import playlistSource from "../src/playlist.js" with { type: "text" };

function assertEquals(actual, expected, label) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${label || "expected equal values"}\n${left}\n${right}`);
}

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

const playlist = new Function(`${playlistSource}\nreturn TwitchAdblockPlaylist;`)();
globalThis.TwitchAdblockPlaylist = playlist;
const guardSource = pageSource.slice(pageSource.indexOf("function createPlaylistGuard"));
const createPlaylistGuard = new Function(`${guardSource}\nreturn createPlaylistGuard;`)();

const adMedia = [
  "#EXTM3U",
  "#EXTINF:2.0,live",
  "https://video.example/live.ts",
  '#EXT-X-DATERANGE:ID="stitched-ad-1",CLASS="twitch-stitched-ad",START-DATE="2024-01-07T20:10:40.960Z",DURATION=15',
  "#EXT-X-PROGRAM-DATE-TIME:2024-01-07T20:10:40.960Z",
  "#EXTINF:2.0,",
  "https://ads.example/ad.ts",
].join("\n");

const cleanMedia = [
  "#EXTM3U",
  "#EXTINF:2.0,live",
  "https://video.example/live.ts",
].join("\n");

function masterFor(urls) {
  const lines = ["#EXTM3U"];
  for (const url of urls) {
    lines.push('#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.4D401F",FRAME-RATE=30.000');
    lines.push(url);
  }
  return lines.join("\n");
}

function playlistResponse(body) {
  return new Response(body, { status: 200, headers: { "Content-Type": "application/vnd.apple.mpegurl" } });
}

Deno.test("an all-ad backup is not substituted for the live stream", async () => {
  const fetched = [];
  const guard = createPlaylistGuard({
    async fetch(url) {
      const value = String(url);
      fetched.push(value);
      if (value.includes("token=live")) return playlistResponse(masterFor(["https://video.example/live-variant.m3u8"]));
      if (value.includes("/channel/hls/")) return playlistResponse(masterFor(["https://video.example/embed-variant.m3u8"]));
      if (value.includes("live-variant")) return playlistResponse(adMedia);
      if (value.includes("embed-variant") || value.includes("autoplay-variant") || value.includes("pip-variant")) return playlistResponse(adMedia);
      if (value.includes("live.ts") || value.includes("ad.ts")) return new Response("segment", { status: 200 });
      return new Response("missing", { status: 404 });
    },
    async gql(body) {
      return JSON.stringify({
        data: { streamPlaybackAccessToken: { value: body.variables.playerType, signature: "sig" } },
      });
    },
    reload() {},
    status() {},
  });

  const master = await guard("https://usher.ttvnw.net/api/v2/channel/hls/Some_Channel.m3u8?token=live&sig=live");
  const masterText = await master.text();
  assert(masterText.includes("https://video.example/live-variant.m3u8"), "the player stays on the main master");
  assert(!masterText.includes("embed-variant.m3u8"), "an ad-only backup is not installed");
  const media = await guard("https://video.example/live-variant.m3u8");
  const mediaText = await media.text();
  assert(mediaText.includes("https://video.example/live.ts"), "the last live frame stays in the playlist");
  assert(!mediaText.includes("ads.example"), "the ad segment is removed from the main playlist");
  const segment = await guard("https://ads.example/ad.ts");
  assertEquals(await segment.text(), "segment", "a segment that was not the only thing left is not blanked");
});

Deno.test("a 404 on the first rung does not hide ads on the next rung", async () => {
  const tokens = [];
  const guard = createPlaylistGuard({
    async fetch(url) {
      const value = String(url);
      if (value.includes("token=live")) {
        return playlistResponse(masterFor([
          "https://video.example/missing.m3u8",
          "https://video.example/ad-variant.m3u8",
        ]));
      }
      if (value.includes("token=picture-by-picture")) return playlistResponse(masterFor(["https://video.example/pip-variant.m3u8"]));
      if (value.includes("/channel/hls/")) return playlistResponse(masterFor(["https://video.example/ad-backup.m3u8"]));
      if (value.includes("missing.m3u8")) return new Response("missing", { status: 404 });
      if (value.includes("ad-variant") || value.includes("ad-backup")) return playlistResponse(adMedia);
      if (value.includes("pip-variant")) return playlistResponse(cleanMedia);
      return new Response("missing", { status: 404 });
    },
    async gql(body) {
      tokens.push(body.variables.playerType);
      return JSON.stringify({
        data: { streamPlaybackAccessToken: { value: body.variables.playerType, signature: "sig" } },
      });
    },
    reload() {},
    status() {},
  });

  const master = await guard("https://usher.ttvnw.net/api/v2/channel/hls/Some_Channel.m3u8?token=live&sig=live");
  const masterText = await master.text();
  assert(masterText.includes("pip-variant.m3u8"), "ads on a later rung still select a clean backup");
  assert(tokens.includes("picture-by-picture"), "the search continues after the first rung 404");
});

Deno.test("clip and non-live media playlists pass through unchanged", async () => {
  const guard = createPlaylistGuard({
    async fetch(url) {
      const value = String(url);
      if (value.includes("clip.m3u8")) {
        return playlistResponse("#EXTM3U\n#EXTINF:2.0,\nhttps://clips.example/seg.ts");
      }
      if (value.includes("seg.ts")) return new Response("clip-bytes", { status: 200 });
      if (value.includes("vod.m3u8")) return playlistResponse("#EXTM3U\n#EXTINF:4.0,\nhttps://vod.example/seg.ts");
      return new Response("missing", { status: 404 });
    },
    async gql() {
      return "{}";
    },
    reload() {},
    status() {},
  });

  const clip = await guard("https://clips-media-assets2.twitch.tv/AT-cm/clip.m3u8");
  assertEquals(await clip.text(), "#EXTM3U\n#EXTINF:2.0,\nhttps://clips.example/seg.ts");
  const segment = await guard("https://clips.example/seg.ts");
  assertEquals(await segment.text(), "clip-bytes");
  const vod = await guard("https://d2e2de1etea730.cloudfront.net/video/hls/vod.m3u8");
  assertEquals(await vod.text(), "#EXTM3U\n#EXTINF:4.0,\nhttps://vod.example/seg.ts");
});

Deno.test("a second master waits for the backup already in flight", async () => {
  let releaseFirst;
  const gate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let probes = 0;
  const tokens = [];
  const guard = createPlaylistGuard({
    async fetch(url) {
      const value = String(url);
      if (value.includes("token=live")) return playlistResponse(masterFor(["https://video.example/live-variant.m3u8"]));
      if (value.includes("token=autoplay")) return playlistResponse(masterFor(["https://video.example/autoplay-variant.m3u8"]));
      if (value.includes("live-variant")) {
        probes += 1;
        if (probes === 1) await gate;
        return playlistResponse(adMedia);
      }
      if (value.includes("autoplay-variant")) return playlistResponse(cleanMedia);
      return new Response("missing", { status: 404 });
    },
    async gql(body) {
      tokens.push(body.variables.playerType);
      return JSON.stringify({
        data: { streamPlaybackAccessToken: { value: body.variables.playerType, signature: "sig" } },
      });
    },
    reload() {},
    status() {},
  });

  const masterUrl = "https://usher.ttvnw.net/api/v2/channel/hls/Some_Channel.m3u8?token=live&sig=live";
  const first = guard(masterUrl);
  const second = guard(masterUrl);
  await new Promise((resolve) => setTimeout(resolve, 20));
  releaseFirst();
  const [left, right] = await Promise.all([first, second]);
  assert((await left.text()).includes("autoplay-variant.m3u8"), "the first master uses the clean backup");
  assert((await right.text()).includes("autoplay-variant.m3u8"), "the overlapping master uses the same backup");
  assertEquals(tokens, ["autoplay"], "one backup search serves both masters");
});
