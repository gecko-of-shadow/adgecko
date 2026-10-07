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

const mainMaster = [
  "#EXTM3U",
  '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.4D401F",FRAME-RATE=30.000',
  "https://video.example/live-variant.m3u8",
].join("\n");

const adMedia = [
  "#EXTM3U",
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

function masterFor(variantUrl) {
  return [
    "#EXTM3U",
    '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.4D401F",FRAME-RATE=30.000',
    variantUrl,
  ].join("\n");
}

function playlistResponse(body) {
  return new Response(body, { status: 200, headers: { "Content-Type": "application/vnd.apple.mpegurl" } });
}

Deno.test("a midroll variant is replaced by the first clean backup and the player reloads once", async () => {
  const tokens = [];
  const reloads = [];
  let mainClean = false;
  const guard = createPlaylistGuard({
    async fetch(url) {
      const value = String(url);
      if (value.includes("/channel/hls/") && value.includes("token=live")) return playlistResponse(mainClean ? masterFor("https://video.example/live-variant.m3u8") : mainMaster);
      if (value.includes("/channel/hls/") && value.includes("token=autoplay")) return playlistResponse(masterFor("https://video.example/autoplay-variant.m3u8"));
      if (value.includes("/channel/hls/") && value.includes("token=picture-by-picture")) return playlistResponse(masterFor("https://video.example/pip-variant.m3u8"));
      if (value.includes("/channel/hls/") && value.includes("token=embed")) return playlistResponse(masterFor("https://video.example/embed-variant.m3u8"));
      if (value.includes("live-variant") || value.includes("autoplay-variant")) return playlistResponse(mainClean ? cleanMedia : adMedia);
      if (value.includes("pip-variant") || value.includes("embed-variant")) return playlistResponse(cleanMedia);
      if (value.includes("https://ads.example/ad.ts")) return new Response("segment", { status: 200 });
      return new Response("missing", { status: 404 });
    },
    async gql(body) {
      tokens.push({ playerType: body.variables.playerType, platform: body.variables.platform });
      return JSON.stringify({
        data: { streamPlaybackAccessToken: { value: body.variables.playerType, signature: "sig" } },
      });
    },
    reload() {
      reloads.push("reload");
    },
    status() {},
  });

  const masterUrl = "https://usher.ttvnw.net/api/v2/channel/hls/Some_Channel.m3u8?token=live&sig=live";
  const master = await guard(masterUrl);
  const masterText = await master.text();
  assert(masterText.includes("https://video.example/pip-variant.m3u8"), "master variants point at the clean backup");
  assert(!masterText.includes("live-variant.m3u8"), "the ad master is not what the player reads");
  assertEquals(tokens, [
    { playerType: "autoplay", platform: "android" },
    { playerType: "picture-by-picture", platform: "web" },
  ], "backup order");

  const media = await guard("https://video.example/live-variant.m3u8");
  const mediaText = await media.text();
  assert(mediaText.includes("https://video.example/live.ts"), "the variant the player already has is answered with backup video");
  assert(!mediaText.includes("ads.example"), "the ad segment is not in the swapped playlist");
  assertEquals(reloads, ["reload"], "one reload when the midroll swap starts");

  const backup = await guard("https://video.example/pip-variant.m3u8");
  const backupText = await backup.text();
  assert(backupText.includes("https://video.example/live.ts"), "backup playback stays on the clean playlist");
  assertEquals(reloads, ["reload"], "checking the main stream does not reload again while ads remain");

  mainClean = true;
  await guard("https://video.example/pip-variant.m3u8");
  assertEquals(reloads, ["reload", "reload"], "playback returns to the main stream when the ad break ends");
  const restored = await guard(masterUrl);
  const restoredText = await restored.text();
  assert(restoredText.includes("https://video.example/live-variant.m3u8"), "the next master is the normal stream");
  assertEquals(reloads, ["reload", "reload"], "a clean master does not reload again");
});

Deno.test("embed tokens on the response root still count", async () => {
  const guard = createPlaylistGuard({
    async fetch(url) {
      const value = String(url);
      if (value.includes("token=live")) return playlistResponse(mainMaster);
      if (value.includes("/channel/hls/")) return playlistResponse(masterFor("https://video.example/embed-variant.m3u8"));
      if (value.includes("live-variant")) return playlistResponse(adMedia);
      if (value.includes("embed-variant")) return playlistResponse(cleanMedia);
      return new Response("missing", { status: 404 });
    },
    async gql(body) {
      if (body.variables.playerType !== "embed") {
        return JSON.stringify({ data: { streamPlaybackAccessToken: null } });
      }
      return JSON.stringify({ streamPlaybackAccessToken: { value: "embed", signature: "sig" } });
    },
    reload() {},
    status() {},
  });

  const master = await guard("https://usher.ttvnw.net/api/v2/channel/hls/Some_Channel.m3u8?token=live&sig=live");
  const masterText = await master.text();
  assert(masterText.includes("https://video.example/embed-variant.m3u8"), "a root embed token is accepted");
});
