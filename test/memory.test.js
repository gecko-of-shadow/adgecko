import pageSource from "../src/page.js" with { type: "text" };
import playlistSource from "../src/playlist.js" with { type: "text" };

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

const playlist = new Function(`${playlistSource}\nreturn TwitchAdblockPlaylist;`)();
globalThis.TwitchAdblockPlaylist = playlist;
const guardSource = pageSource.slice(pageSource.indexOf("function createPlaylistGuard"));
const createPlaylistGuard = new Function(`${guardSource}\nreturn createPlaylistGuard;`)();

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

function channelFrom(url) {
  const match = String(url).match(/\/hls\/([^./?]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function tokenBody(playerType) {
  return JSON.stringify({
    data: { streamPlaybackAccessToken: { value: playerType, signature: "sig" } },
  });
}

Deno.test("a clean live playlist drops the channel session", async () => {
  let mainClean = false;
  const guard = createPlaylistGuard({
    handoffGraceMs: 0,
    async fetch(url) {
      const value = String(url);
      if (value.includes("/channel/hls/") && value.includes("token=live")) {
        return playlistResponse(masterFor("https://video.example/live-variant.m3u8"));
      }
      if (value.includes("/channel/hls/") && value.includes("token=autoplay")) {
        return playlistResponse(masterFor("https://video.example/autoplay-variant.m3u8"));
      }
      if (value.includes("/channel/hls/")) return playlistResponse(masterFor("https://video.example/pip-variant.m3u8"));
      if (value.includes("live-variant") || value.includes("autoplay-variant")) {
        return playlistResponse(mainClean ? cleanMedia : adMedia);
      }
      if (value.includes("pip-variant")) return playlistResponse(cleanMedia);
      return new Response("missing", { status: 404 });
    },
    async gql(body) {
      return tokenBody(body.variables.playerType);
    },
    reload() {},
    status() {},
  });

  const masterUrl = "https://usher.ttvnw.net/api/v2/channel/hls/Some_Channel.m3u8?token=live&sig=live";
  await guard(masterUrl);
  const swapped = await (await guard("https://video.example/live-variant.m3u8")).text();
  assert(swapped.includes("https://video.example/live.ts"), "the ad variant is swapped while the session exists");

  mainClean = true;
  await guard(masterUrl);
  mainClean = false;
  const after = await (await guard("https://video.example/live-variant.m3u8")).text();
  assert(after.includes("https://ads.example/ad.ts"), "a finished session does not keep the old variant");
  assert(!after.includes("https://video.example/live.ts"), "the dropped variant is not answered with the backup");
});

Deno.test("old variant urls are evicted and the current one still swaps", async () => {
  const guard = createPlaylistGuard({
    handoffGraceMs: 0,
    async fetch(url) {
      const value = String(url);
      if (value.includes("/channel/hls/") && value.includes("token=live")) {
        const variant = new URL(value).searchParams.get("variant");
        return playlistResponse(masterFor(`https://video.example/variant-${variant}.m3u8`));
      }
      if (value.includes("/channel/hls/") && value.includes("token=autoplay")) {
        return playlistResponse(masterFor("https://video.example/autoplay-variant.m3u8"));
      }
      if (value.includes("/channel/hls/")) return playlistResponse(masterFor("https://video.example/pip-variant.m3u8"));
      if (value.includes("autoplay-variant") || /variant-\d+\.m3u8/.test(value)) return playlistResponse(adMedia);
      if (value.includes("pip-variant")) return playlistResponse(cleanMedia);
      return new Response("missing", { status: 404 });
    },
    async gql(body) {
      return tokenBody(body.variables.playerType);
    },
    reload() {},
    status() {},
  });

  for (let index = 0; index < 80; index++) {
    await guard(`https://usher.ttvnw.net/api/v2/channel/hls/Some_Channel.m3u8?token=live&sig=live&variant=${index}`);
  }
  const current = await (await guard("https://video.example/variant-79.m3u8")).text();
  const stale = await (await guard("https://video.example/variant-0.m3u8")).text();
  assert(current.includes("https://video.example/live.ts"), "the newest variant still swaps");
  assert(stale.includes("https://ads.example/ad.ts"), "an evicted variant is no longer swapped");
  assert(!stale.includes("https://video.example/live.ts"), "an evicted variant is not answered from the backup");
});

Deno.test("only the recent channel sessions are kept during ad breaks", async () => {
  const guard = createPlaylistGuard({
    handoffGraceMs: 0,
    async fetch(url) {
      const value = String(url);
      const channel = channelFrom(value);
      if (value.includes("/channel/hls/") && value.includes("token=live")) {
        return playlistResponse(masterFor(`https://video.example/${channel}-main.m3u8`));
      }
      if (value.includes("/channel/hls/") && value.includes("token=autoplay")) {
        return playlistResponse(masterFor(`https://video.example/${channel}-auto.m3u8`));
      }
      if (value.includes("/channel/hls/")) return playlistResponse(masterFor(`https://video.example/${channel}-pip.m3u8`));
      if (value.includes("-main.m3u8") || value.includes("-auto.m3u8")) return playlistResponse(adMedia);
      if (value.includes("-pip.m3u8")) return playlistResponse(cleanMedia);
      return new Response("missing", { status: 404 });
    },
    async gql(body) {
      return tokenBody(body.variables.playerType);
    },
    reload() {},
    status() {},
  });

  for (let index = 0; index < 20; index++) {
    const channel = `chan${String(index).padStart(2, "0")}`;
    await guard(`https://usher.ttvnw.net/api/v2/channel/hls/${channel}.m3u8?token=live&sig=live`);
  }
  const newest = await (await guard("https://video.example/chan19-main.m3u8")).text();
  const oldest = await (await guard("https://video.example/chan00-main.m3u8")).text();
  assert(newest.includes("https://video.example/live.ts"), "a recent channel still swaps");
  assert(oldest.includes("https://ads.example/ad.ts"), "a channel past the session cap is dropped");
  assert(!oldest.includes("https://video.example/live.ts"), "a dropped channel is not answered from its backup");
});
