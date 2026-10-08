import pageSource from "../src/page.js" with { type: "text" };
import playlistSource from "../src/playlist.js" with { type: "text" };
import mafAd from "./fixtures/twitch-maf-ad.m3u8" with { type: "text" };

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
  // video-swap-new tries autoplay first; that clean backup is what we stay on.
  await guard("https://video.example/autoplay-variant.m3u8");
  assert(statuses.includes(true), "blocking label turns on while on backup");

  // Main is clean again, but the cached mainVariantUrl rotated off the CDN.
  mainClean = true;
  rotated = true;
  statuses.length = 0;
  reloads.length = 0;
  await guard("https://video.example/autoplay-variant.m3u8");
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
        return playlistResponse(masterFor("https://video.example/autoplay-variant.m3u8"));
      }
      if (value.includes("live-variant")) {
        if (mastersDead) return new Response("gone", { status: 404 });
        return playlistResponse(adMedia);
      }
      if (value.includes("autoplay-variant")) return playlistResponse(cleanMedia);
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
  await guard("https://video.example/autoplay-variant.m3u8");

  mastersDead = true;
  statuses.length = 0;
  reloads.length = 0;
  // Several backup polls with no reachable main/master should not stay latched forever.
  await guard("https://video.example/autoplay-variant.m3u8");
  await guard("https://video.example/autoplay-variant.m3u8");
  await guard("https://video.example/autoplay-variant.m3u8");
  await flushReload();

  assertEquals(statuses.at(-1), false, "fail open clears the blocking label");
  assert(reloads.length >= 1, "fail open reloads so the player is not stuck on a dead backup");
});

Deno.test("exhausted dirty backups fail open: pass ads through without reload", async () => {
  const reloads = [];
  const statuses = [];
  const guard = createPlaylistGuard({
    handoffGraceMs: 0,
    async fetch(url) {
      const value = String(url);
      if (value.includes("/channel/hls/")) {
        const token = value.includes("token=live") ? "live" : "backup";
        return playlistResponse(masterFor(`https://video.example/${token}-variant.m3u8`));
      }
      // Every player type is midroll-dirty — no clean backup exists.
      if (value.includes("-variant")) return playlistResponse(adMedia);
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
  const master = await guard(masterUrl);
  const masterText = await master.text();
  assert(masterText.includes("live-variant.m3u8"), "fail-open keeps the real live ladder");
  assert(!masterText.includes("backup-variant"), "no dirty backup is latched as the stream");
  await flushReload();
  assertEquals(reloads, [], "fail-open must not force a reload (0.1.16 starved ad-heavy buffers)");

  const media = await guard("https://video.example/live-variant.m3u8");
  const mediaText = await media.text();
  assert(mediaText.includes("ads.example/ad.ts"), "real ad segments pass through unmodified");
  assert(mediaText.includes("stitched-ad"), "ad markers stay so Twitch midroll UI can run");
  assertEquals(statuses.at(-1), false, "Blocking ads stays off during fail-open");
  await flushReload();
  assertEquals(reloads, [], "media fail-open pass-through also avoids reload");
});

Deno.test("fail-open clears quietly when the midroll playlist goes clean", async () => {
  const reloads = [];
  let dirty = true;
  const guard = createPlaylistGuard({
    handoffGraceMs: 0,
    async fetch(url) {
      const value = String(url);
      if (value.includes("/channel/hls/")) {
        return playlistResponse(masterFor("https://video.example/live-variant.m3u8"));
      }
      if (value.includes("live-variant")) return playlistResponse(dirty ? adMedia : cleanMedia);
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
    status() {},
  });

  const masterUrl = "https://usher.ttvnw.net/api/v2/channel/hls/Some_Channel.m3u8?token=live&sig=live";
  await guard(masterUrl);
  await guard("https://video.example/live-variant.m3u8");
  await flushReload();
  assertEquals(reloads, [], "enter fail-open without reload");

  dirty = false;
  const clean = await guard("https://video.example/live-variant.m3u8");
  assert((await clean.text()).includes("video.example/live.ts"), "clean live segments return");
  await flushReload();
  assertEquals(reloads, [], "leave fail-open without reload so buffer is not reset");
});

Deno.test("stitched midroll with live holds passes ads instead of freezing on the hold", async () => {
  // Real midrolls often keep a prior live .ts beside stitched ads. stripAds would
  // collapse that to one live hold → frozen frame under Twitch ad UI.
  const midrollWithLiveHold = [
    "#EXTM3U",
    "#EXTINF:2.0,live",
    "https://video.example/live-hold.ts",
    '#EXT-X-DATERANGE:ID="stitched-ad-1",CLASS="twitch-stitched-ad",START-DATE="2024-01-07T20:10:40.960Z",DURATION=120',
    "#EXT-X-PROGRAM-DATE-TIME:2024-01-07T20:10:40.960Z",
    "#EXTINF:2.0,",
    "https://ads.example/ad.ts",
    "#EXTINF:2.0,",
    "https://ads.example/ad2.ts",
  ].join("\n");
  const reloads = [];
  const guard = createPlaylistGuard({
    handoffGraceMs: 0,
    async fetch(url) {
      const value = String(url);
      if (value.includes("/channel/hls/")) {
        return playlistResponse(masterFor("https://video.example/live-variant.m3u8"));
      }
      if (value.includes("-variant")) return playlistResponse(midrollWithLiveHold);
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
    status() {},
  });

  await guard("https://usher.ttvnw.net/api/v2/channel/hls/Some_Channel.m3u8?token=live&sig=live");
  const media = await guard("https://video.example/live-variant.m3u8");
  const mediaText = await media.text();
  assert(mediaText.includes("ads.example/ad.ts"), "real ad A/V must play under the ad-break UI");
  assert(mediaText.includes("ads.example/ad2.ts"), "full ad pod passes through");
  assert(mediaText.includes("stitched-ad"), "Twitch midroll markers stay");
  await flushReload();
  assertEquals(reloads, [], "no reload thrash while fail-open shows ads");
});

Deno.test("long fail-open midroll keeps ads after the backup retry window", async () => {
  const reloads = [];
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    const guard = createPlaylistGuard({
      handoffGraceMs: 0,
      async fetch(url) {
        const value = String(url);
        if (value.includes("/channel/hls/")) {
          return playlistResponse(masterFor("https://video.example/live-variant.m3u8"));
        }
        if (value.includes("-variant")) return playlistResponse(adMedia);
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
      status() {},
    });

    const masterUrl = "https://usher.ttvnw.net/api/v2/channel/hls/Some_Channel.m3u8?token=live&sig=live";
    await guard(masterUrl);
    await guard("https://video.example/live-variant.m3u8");
    await flushReload();
    assertEquals(reloads, [], "enter fail-open without reload");

    // Past the 30s retryAt: old tip cleared failOpen and could strip again.
    now += 31000;
    const masterAgain = await guard(masterUrl);
    assert((await masterAgain.text()).includes("live-variant.m3u8"), "still on the live ladder");
    const mediaAgain = await guard("https://video.example/live-variant.m3u8");
    const mediaText = await mediaAgain.text();
    assert(mediaText.includes("ads.example/ad.ts"), "long midroll still passes real ads after retry");
    assert(mediaText.includes("stitched-ad"), "ad markers remain after retry");
    await flushReload();
    assertEquals(reloads, [], "retry window must not force reload thrash");
  } finally {
    Date.now = realNow;
  }
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

Deno.test("a backup that turns dirty after its probe moves to the next clean type instead of passing the midroll", async () => {
  const reloads = [];
  const statuses = [];
  let mainAds = false;
  let autoplayFetches = 0;
  const pipMedia = "#EXTM3U\n#EXTINF:2.0,live\nhttps://video.example/pip-live.ts";
  const guard = createPlaylistGuard({
    handoffGraceMs: 0,
    async fetch(url) {
      const value = String(url);
      if (value.includes("/channel/hls/") && value.includes("token=live")) return playlistResponse(mainMaster);
      if (value.includes("/channel/hls/") && value.includes("token=autoplay")) return playlistResponse(masterFor("https://video.example/autoplay-variant.m3u8"));
      if (value.includes("/channel/hls/") && value.includes("token=picture-by-picture")) return playlistResponse(masterFor("https://video.example/pip-variant.m3u8"));
      if (value.includes("/channel/hls/") && value.includes("token=embed")) return playlistResponse(masterFor("https://video.example/embed-variant.m3u8"));
      if (value.includes("live-variant")) return playlistResponse(mainAds ? adMedia : cleanMedia);
      if (value.includes("autoplay-variant")) {
        autoplayFetches += 1;
        // Clean when probed, then the backup's own ad starts.
        return playlistResponse(autoplayFetches === 1 ? cleanMedia : adMedia);
      }
      if (value.includes("pip-variant")) return playlistResponse(pipMedia);
      if (value.includes("embed-variant")) return playlistResponse(adMedia);
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
  mainAds = true;
  const media = await guard("https://video.example/live-variant.m3u8");
  const mediaText = await media.text();
  assert(mediaText.includes("https://video.example/pip-live.ts"), "the next clean backup type is served");
  assert(!mediaText.includes("ads.example"), "the midroll is not passed through while a clean backup exists");
  assertEquals(statuses.at(-1), true, "Blocking ads shows while on the backup");
  await flushReload();
  assertEquals(reloads, ["reload"], "one reload hands the player to the backup");
  const next = await guard(masterUrl);
  assert((await next.text()).includes("https://video.example/pip-variant.m3u8"), "the next master points at the clean type");
});

Deno.test("a moving-off guard that no master clears expires, so the next midroll is still caught", async () => {
  const reloads = [];
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    let mainAds = true;
    const guard = createPlaylistGuard({
      handoffGraceMs: 0,
      async fetch(url) {
        const value = String(url);
        if (value.includes("/channel/hls/") && value.includes("token=live")) return playlistResponse(mainMaster);
        if (value.includes("/channel/hls/")) return playlistResponse(masterFor("https://video.example/autoplay-variant.m3u8"));
        if (value.includes("live-variant")) return playlistResponse(mainAds ? adMedia : cleanMedia);
        if (value.includes("autoplay-variant")) return playlistResponse(cleanMedia);
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
      status() {},
    });

    const masterUrl = "https://usher.ttvnw.net/api/v2/channel/hls/Some_Channel.m3u8?token=live&sig=live";
    await guard(masterUrl);
    await guard("https://video.example/autoplay-variant.m3u8");
    mainAds = false;
    await guard("https://video.example/autoplay-variant.m3u8");
    await flushReload();
    assertEquals(reloads, ["reload"], "leaving the backup reloads once");

    // The reload never refetched the master, and a new midroll starts.
    mainAds = true;
    now += 1000;
    const early = await guard("https://video.example/live-variant.m3u8");
    assert((await early.text()).includes("ads.example"), "inside the guard window the handoff is left alone");
    now += 10000;
    const late = await guard("https://video.example/live-variant.m3u8");
    const lateText = await late.text();
    assert(!lateText.includes("ads.example"), "after the guard expires the midroll is swapped");
    assert(lateText.includes("https://video.example/live.ts"), "the backup video is served");
    await flushReload();
    assertEquals(reloads, ["reload", "reload"], "the new swap reloads without a manual page reload");
  } finally {
    Date.now = realNow;
  }
});

function tokenFor(body) {
  return JSON.stringify({
    data: { streamPlaybackAccessToken: { value: body.variables.playerType, signature: "sig" } },
  });
}

const masterUrlForTests = "https://usher.ttvnw.net/api/v2/channel/hls/Some_Channel.m3u8?token=live&sig=live";
const pipMedia = "#EXTM3U\n#EXTINF:2.0,live\nhttps://video.example/pip-live.ts";

function backupFetch(state) {
  return async function (url) {
    const value = String(url);
    if (value.includes("/channel/hls/") && value.includes("token=live")) return playlistResponse(mainMaster);
    if (value.includes("/channel/hls/") && value.includes("token=autoplay")) return playlistResponse(masterFor("https://video.example/autoplay-variant.m3u8"));
    if (value.includes("/channel/hls/") && value.includes("token=picture-by-picture")) return playlistResponse(masterFor("https://video.example/pip-variant.m3u8"));
    if (value.includes("/channel/hls/") && value.includes("token=embed")) return playlistResponse(masterFor("https://video.example/embed-variant.m3u8"));
    if (value.includes("live-variant")) return playlistResponse(state.mainAds ? (state.mainText || adMedia) : cleanMedia);
    if (value.includes("autoplay-variant")) {
      state.autoplayFetches = (state.autoplayFetches || 0) + 1;
      return playlistResponse(state.autoplayFetches <= (state.autoplayCleanFor || 1) ? cleanMedia : adMedia);
    }
    if (value.includes("pip-variant")) {
      if (state.pipDelay) await new Promise((resolve) => setTimeout(resolve, state.pipDelay));
      return playlistResponse(pipMedia);
    }
    if (value.includes("embed-variant")) return playlistResponse(adMedia);
    return new Response("missing", { status: 404 });
  };
}

Deno.test("a stalled backup probe cannot hold the player's playlist past the probe deadline", async () => {
  const guard = createPlaylistGuard({
    handoffGraceMs: 0,
    probeDeadlineMs: 30,
    async fetch(url) {
      const value = String(url);
      if (value.includes("/channel/hls/") && value.includes("token=live")) return playlistResponse(mainMaster);
      if (value.includes("/channel/hls/")) return playlistResponse(masterFor("https://video.example/dirty-variant.m3u8"));
      if (value.includes("-variant")) return playlistResponse(adMedia);
      return new Response("missing", { status: 404 });
    },
    gql(body) {
      if (body.variables.playerType === "embed") return new Promise(() => {});
      return Promise.resolve(tokenFor(body));
    },
    reload() {},
    status() {},
  });
  const started = Date.now();
  const master = await guard(masterUrlForTests);
  assert((await master.text()).includes("live-variant.m3u8"), "the live ladder is served once the deadline passes");
  assert(Date.now() - started < 1000, "the stalled probe did not hold the master");
});

Deno.test("a clean backup still answering is awaited before the midroll is passed through", async () => {
  const state = { mainAds: false, pipDelay: 15 };
  const reloads = [];
  const guard = createPlaylistGuard({
    handoffGraceMs: 0,
    probeDeadlineMs: 500,
    fetch: backupFetch(state),
    async gql(body) {
      return tokenFor(body);
    },
    reload() {
      reloads.push("reload");
    },
    status() {},
  });
  await guard(masterUrlForTests);
  state.mainAds = true;
  const media = await guard("https://video.example/live-variant.m3u8");
  const text = await media.text();
  assert(text.includes("https://video.example/pip-live.ts"), "the late clean backup is served");
  assert(!text.includes("ads.example"), "the midroll is not passed through");
  await flushReload();
  assertEquals(reloads, ["reload"]);
});

Deno.test("overlapping main polls share one backup decision", async () => {
  const state = { mainAds: false };
  const reloads = [];
  const statuses = [];
  const guard = createPlaylistGuard({
    handoffGraceMs: 0,
    fetch: backupFetch(state),
    async gql(body) {
      return tokenFor(body);
    },
    reload() {
      reloads.push("reload");
    },
    status(blocking) {
      statuses.push(Boolean(blocking));
    },
  });
  await guard(masterUrlForTests);
  state.mainAds = true;
  const [first, second] = await Promise.all([
    guard("https://video.example/live-variant.m3u8"),
    guard("https://video.example/live-variant.m3u8"),
  ]);
  for (const response of [first, second]) {
    const text = await response.text();
    assert(text.includes("https://video.example/pip-live.ts"), "both polls get the clean backup");
  }
  assertEquals(statuses.at(-1), true, "no poll failed the session open");
  await flushReload();
  assertEquals(reloads, ["reload"]);
});

Deno.test("a backup that gets its own ad plays it through without another reload", async () => {
  const state = { mainAds: true, autoplayCleanFor: 2 };
  const reloads = [];
  const statuses = [];
  const guard = createPlaylistGuard({
    handoffGraceMs: 0,
    fetch: backupFetch(state),
    async gql(body) {
      return tokenFor(body);
    },
    reload() {
      reloads.push("reload");
    },
    status(blocking) {
      statuses.push(Boolean(blocking));
    },
  });
  const master = await guard(masterUrlForTests);
  assert((await master.text()).includes("autoplay-variant.m3u8"), "the player starts on the first clean backup");
  const onBackup = await guard("https://video.example/autoplay-variant.m3u8");
  assert((await onBackup.text()).includes("https://video.example/live.ts"), "the first backup plays while clean");
  assertEquals(statuses.at(-1), true, "Blocking ads shows on the clean backup");
  const dirty = await guard("https://video.example/autoplay-variant.m3u8");
  assert((await dirty.text()).includes("https://ads.example/ad.ts"), "the backup's own ad passes through");
  assertEquals(statuses.at(-1), false, "Blocking ads is off while that ad plays");
  await flushReload();
  assertEquals(reloads, [], "no hop to another type, so no extra reload");
});

Deno.test("a maf ad break loses only its tag: no token request, no reload, no label", async () => {
  const traces = [];
  const previous = globalThis.TwitchAdblockDebug;
  globalThis.TwitchAdblockDebug = { on: true, trace: (kind, detail) => traces.push(kind + " " + detail) };
  try {
    let tokens = 0;
    const reloads = [];
    const statuses = [];
    let mediaText = "#EXTM3U\n#EXTINF:2.0,live\nhttps://video.example/live.ts";
    const guard = createPlaylistGuard({
      handoffGraceMs: 0,
      async fetch(url) {
        const value = String(url);
        if (value.includes("/channel/hls/")) return playlistResponse(mainMaster);
        if (value.includes("live-variant")) return playlistResponse(mediaText);
        return new Response("missing", { status: 404 });
      },
      async gql(body) {
        tokens += 1;
        return tokenFor(body);
      },
      reload() {
        reloads.push("reload");
      },
      status(blocking) {
        statuses.push(Boolean(blocking));
      },
    });
    await guard(masterUrlForTests);
    mediaText = mafAd;
    const media = await guard("https://video.example/live-variant.m3u8");
    const text = await media.text();
    const expected = mafAd.split("\n").filter((line) => !line.includes('CLASS="twitch-maf-ad"')).join("\n");
    assertEquals(text, expected, "only the maf DATERANGE line is removed");
    await flushReload();
    assertEquals(tokens, 0, "no backup token is requested");
    assertEquals(reloads, [], "no player reload");
    assert(!statuses.includes(true), "Blocking ads never turns on");
    assert(traces.includes("playlist maf-ad tag removed"), "debug mode shows the strip");
  } finally {
    globalThis.TwitchAdblockDebug = previous;
  }
});

Deno.test("a stitched range at the live edge swaps before any ad segment is listed", async () => {
  const upcoming = [
    "#EXTM3U",
    "#EXT-X-PROGRAM-DATE-TIME:2024-01-07T20:10:36.000Z",
    "#EXTINF:2.000,live",
    "https://video.example/live1.ts",
    '#EXT-X-DATERANGE:ID="stitched-ad-1",CLASS="twitch-stitched-ad",START-DATE="2024-01-07T20:10:38.000Z",DURATION=30',
  ].join("\n");
  const state = { mainAds: false, mainText: upcoming, autoplayCleanFor: 99 };
  const reloads = [];
  const guard = createPlaylistGuard({
    handoffGraceMs: 0,
    fetch: backupFetch(state),
    async gql(body) {
      return tokenFor(body);
    },
    reload() {
      reloads.push("reload");
    },
    status() {},
  });
  await guard(masterUrlForTests);
  state.mainAds = true;
  const media = await guard("https://video.example/live-variant.m3u8");
  assert((await media.text()).includes("https://video.example/live.ts"), "the backup answers the cue");
  await flushReload();
  assertEquals(reloads, ["reload"]);
});
