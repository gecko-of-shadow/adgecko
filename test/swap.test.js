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

function flushReload() {
  // scheduleReload uses setTimeout(0) so the playlist Response lands first.
  return new Promise((resolve) => setTimeout(resolve, 0));
}

Deno.test("a midroll variant is replaced by the first clean backup and the player reloads once", async () => {
  const tokens = [];
  const reloads = [];
  let mainClean = false;
  const guard = createPlaylistGuard({
    handoffGraceMs: 0,
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
  assert(tokens.some((item) => item.playerType === "picture-by-picture" && item.platform === "web"), "picture-by-picture is probed");
  assert(tokens.some((item) => item.playerType === "autoplay" && item.platform === "android") || tokens.some((item) => item.playerType === "embed"), "other backup types are probed in parallel");

  const media = await guard("https://video.example/live-variant.m3u8");
  const mediaText = await media.text();
  assert(mediaText.includes("https://video.example/live.ts"), "the variant the player already has is answered with backup video");
  assert(!mediaText.includes("ads.example"), "the ad segment is not in the swapped playlist");
  await flushReload();
  assertEquals(reloads, ["reload"], "one reload when the midroll swap starts");

  const backup = await guard("https://video.example/pip-variant.m3u8");
  const backupText = await backup.text();
  assert(backupText.includes("https://video.example/live.ts"), "backup playback stays on the clean playlist");
  await flushReload();
  assertEquals(reloads, ["reload"], "checking the main stream does not reload again while ads remain");

  mainClean = true;
  await guard("https://video.example/pip-variant.m3u8");
  await flushReload();
  assertEquals(reloads, ["reload", "reload"], "playback returns to the main stream when the ad break ends");
  const restored = await guard(masterUrl);
  const restoredText = await restored.text();
  assert(restoredText.includes("https://video.example/live-variant.m3u8"), "the next master is the normal stream");
  await flushReload();
  assertEquals(reloads, ["reload", "reload"], "a clean master does not reload again");
});

Deno.test("a higher-quality clean backup wins when probes finish in the grace window", async () => {
  const chosen = [];
  const lowMaster = [
    "#EXTM3U",
    '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4D401F",FRAME-RATE=30.000',
    "https://video.example/pip-low.m3u8",
  ].join("\n");
  const highMaster = [
    "#EXTM3U",
    '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.4D401F",FRAME-RATE=30.000',
    "https://video.example/embed-high.m3u8",
  ].join("\n");
  const guard = createPlaylistGuard({
    handoffGraceMs: 40,
    async fetch(url) {
      const value = String(url);
      if (value.includes("token=live")) return playlistResponse(mainMaster);
      if (value.includes("token=picture-by-picture")) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return playlistResponse(lowMaster);
      }
      if (value.includes("token=embed")) {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return playlistResponse(highMaster);
      }
      if (value.includes("token=autoplay")) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return playlistResponse(masterFor("https://video.example/autoplay-variant.m3u8"));
      }
      if (value.includes("live-variant") || value.includes("autoplay-variant")) return playlistResponse(adMedia);
      if (value.includes("pip-low") || value.includes("embed-high")) return playlistResponse(cleanMedia);
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
  chosen.push(masterText.includes("embed-high.m3u8"), masterText.includes("pip-low.m3u8"));
  assert(masterText.includes("https://video.example/embed-high.m3u8"), "grace window keeps the closer quality backup");
  assert(!masterText.includes("pip-low.m3u8"), "lower quality is not preferred when a match exists");
});

Deno.test("embed tokens on the response root still count", async () => {
  const guard = createPlaylistGuard({
    handoffGraceMs: 0,
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

Deno.test("a stale main variant still returns to main and clears Blocking ads", async () => {
  const statuses = [];
  const reloads = [];
  let mainClean = false;
  let rotated = false;
  const guard = createPlaylistGuard({
    handoffGraceMs: 0,
    async fetch(url) {
      const value = String(url);
      if (value.includes("/channel/hls/") && value.includes("token=live")) {
        const live = rotated
          ? "https://video.example/live-variant-v2.m3u8"
          : "https://video.example/live-variant.m3u8";
        return playlistResponse(masterFor(live));
      }
      if (value.includes("/channel/hls/") && value.includes("token=picture-by-picture")) {
        return playlistResponse(masterFor("https://video.example/pip-variant.m3u8"));
      }
      if (value.includes("/channel/hls/") && value.includes("token=embed")) {
        return playlistResponse(masterFor("https://video.example/embed-variant.m3u8"));
      }
      if (value.includes("/channel/hls/") && value.includes("token=autoplay")) {
        return playlistResponse(masterFor("https://video.example/autoplay-variant.m3u8"));
      }
      if (value.includes("live-variant-v2")) return playlistResponse(cleanMedia);
      if (value.includes("live-variant")) {
        if (rotated) return new Response("gone", { status: 404 });
        return playlistResponse(mainClean ? cleanMedia : adMedia);
      }
      if (value.includes("pip-variant") || value.includes("embed-variant") || value.includes("autoplay-variant")) {
        return playlistResponse(cleanMedia);
      }
      return new Response("missing", { status: 404 });
    },
    async gql(body) {
      return JSON.stringify({
        data: { streamPlaybackAccessToken: { value: body.variables.playerType, signature: "sig" } },
      });
    },
    reload() {
      reloads.push("reload");
    },
    status(blocking) {
      statuses.push(Boolean(blocking));
    },
  });

  const masterUrl = "https://usher.ttvnw.net/api/v2/channel/hls/Some_Channel.m3u8?token=live&sig=live";
  await guard(masterUrl);
  await guard("https://video.example/live-variant.m3u8");
  await guard("https://video.example/pip-variant.m3u8");
  assert(statuses.includes(true), "blocking label turns on while on backup");

  // Main is clean again, but the cached mainVariantUrl rotated off the CDN.
  mainClean = true;
  rotated = true;
  statuses.length = 0;
  reloads.length = 0;
  await guard("https://video.example/pip-variant.m3u8");
  await flushReload();

  assertEquals(statuses.at(-1), false, "Blocking ads clears once main is clean again");
  assertEquals(reloads, ["reload"], "player reloads back onto the main stream");
  const restored = await guard(masterUrl);
  assert((await restored.text()).includes("live-variant-v2.m3u8"), "next master uses the rotated live ladder");
});

Deno.test("failed main probes while on backup fail open instead of freezing", async () => {
  const statuses = [];
  const reloads = [];
  let mastersDead = false;
  const guard = createPlaylistGuard({
    handoffGraceMs: 0,
    async fetch(url) {
      const value = String(url);
      if (value.includes("/channel/hls/") && value.includes("token=live")) {
        if (mastersDead) return new Response("gone", { status: 404 });
        return playlistResponse(masterFor("https://video.example/live-variant.m3u8"));
      }
      if (value.includes("/channel/hls/")) {
        return playlistResponse(masterFor("https://video.example/pip-variant.m3u8"));
      }
      if (value.includes("live-variant")) {
        if (mastersDead) return new Response("gone", { status: 404 });
        return playlistResponse(adMedia);
      }
      if (value.includes("pip-variant")) return playlistResponse(cleanMedia);
      return new Response("missing", { status: 404 });
    },
    async gql(body) {
      return JSON.stringify({
        data: { streamPlaybackAccessToken: { value: body.variables.playerType, signature: "sig" } },
      });
    },
    reload() {
      reloads.push("reload");
    },
    status(blocking) {
      statuses.push(Boolean(blocking));
    },
  });

  const masterUrl = "https://usher.ttvnw.net/api/v2/channel/hls/Some_Channel.m3u8?token=live&sig=live";
  await guard(masterUrl);
  await guard("https://video.example/pip-variant.m3u8");

  mastersDead = true;
  statuses.length = 0;
  reloads.length = 0;
  // Several backup polls with no reachable main/master should not stay latched forever.
  await guard("https://video.example/pip-variant.m3u8");
  await guard("https://video.example/pip-variant.m3u8");
  await guard("https://video.example/pip-variant.m3u8");
  await flushReload();

  assertEquals(statuses.at(-1), false, "fail open clears the blocking label");
  assert(reloads.length >= 1, "fail open reloads so the player is not stuck on a dead backup");
});

Deno.test("scheduleReload fires after the clean playlist Response is returned", async () => {
  const order = [];
  const guard = createPlaylistGuard({
    handoffGraceMs: 0,
    async fetch(url) {
      const value = String(url);
      if (value.includes("token=live")) return playlistResponse(mainMaster);
      if (value.includes("/channel/hls/")) return playlistResponse(masterFor("https://video.example/pip-variant.m3u8"));
      if (value.includes("live-variant")) return playlistResponse(adMedia);
      if (value.includes("pip-variant")) return playlistResponse(cleanMedia);
      return new Response("missing", { status: 404 });
    },
    async gql(body) {
      return JSON.stringify({
        data: { streamPlaybackAccessToken: { value: body.variables.playerType, signature: "sig" } },
      });
    },
    reload() {
      order.push("reload");
    },
    status() {},
  });

  await guard("https://usher.ttvnw.net/api/v2/channel/hls/Some_Channel.m3u8?token=live&sig=live");
  const media = await guard("https://video.example/live-variant.m3u8");
  order.push("response");
  await media.text();
  assertEquals(order, ["response"], "reload must not run before the fetch caller gets the body");
  await flushReload();
  assertEquals(order, ["response", "reload"], "reload runs on the next macrotask after the Response");
});
