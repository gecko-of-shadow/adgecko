import debugSource from "../src/debug.js" with { type: "text" };
import pageSource from "../src/page.js" with { type: "text" };
import playlistSource from "../src/playlist.js" with { type: "text" };
import popupSource from "../src/popup.js" with { type: "text" };
import popupHtml from "../src/popup.html" with { type: "text" };
import bridgeSource from "../src/debug-bridge.js" with { type: "text" };
import manifest from "../manifest.json" with { type: "json" };

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function assertEquals(actual, expected, label) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${label || "expected equal values"}\n${left}\n${right}`);
}

const install = new Function(
  `${debugSource.replace(/\ninstallTwitchAdblockDebug\(globalThis[\s\S]*$/, "")}\nreturn installTwitchAdblockDebug;`,
)();

function fresh(worker) {
  const target = {};
  install(target, worker === true);
  return target;
}

Deno.test("debug is off until asked, and an off recorder does no work", () => {
  const debug = fresh(false);
  assertEquals(debug.on, false);
  assertEquals(debug.version, manifest.version);
  let called = false;
  debug.note("playback", () => {
    called = true;
    return "token=should-not-run";
  });
  debug.trace("playback", () => {
    called = true;
    return "sig=should-not-run";
  });
  assertEquals(called, false, "off mode does not build log lines");
  assert(!debug.dump().includes("should-not-run"), "off mode stores nothing");
  assert(debug.dump().includes("on=false"), "dump says debug is off");
  assert(debug.dump().includes("(no events)"), "empty ring is explicit");
});

Deno.test("the ring redacts secrets, drops repeats, and stays bounded", () => {
  const debug = fresh(false);
  debug.setEnabled(true);
  debug.note("debug", "on");
  debug.note(
    "playlist",
    "https://usher.ttvnw.net/a.m3u8?sig=abc&token=deadbeef&allow_source=true",
  );
  debug.note("playlist", "https://usher.ttvnw.net/a.m3u8?sig=abc&token=deadbeef&allow_source=true");
  debug.note("playback", "Bearer aaa.bbb.ccc");
  debug.note("playback", "viewer@example.com");
  const text = debug.dump();
  assert(!text.includes("deadbeef"), "token value is not stored");
  assert(!text.includes("sig=abc"), "signature value is not stored");
  assert(text.includes("sig=<redacted>"), "signature key remains");
  assert(text.includes("token=<redacted>"), "token key remains");
  assert(text.includes("allow_source=true"), "non-secret query values remain");
  assert(!text.includes("aaa.bbb.ccc"), "bearer value is not stored");
  assert(!text.includes("viewer@example.com"), "email is not stored");
  const logged = text.split("\n").filter((line) => line.startsWith("+"));
  assertEquals(logged.length, 4, "the repeated playlist line is stored once");
  for (let i = 0; i < 100; i++) debug.note("playback", "event " + i);
  const capped = debug.dump().split("\n").filter((line) => line.startsWith("+"));
  assertEquals(capped.length, 80, "the ring keeps the newest 80 lines");
  assert(capped[capped.length - 1].includes("event 99"), "the newest line is kept");
  assert(!debug.dump().includes("event 0"), "the oldest line is dropped");
  debug.setEnabled(false);
  debug.note("playback", "after-off");
  assert(!debug.dump().includes("after-off"), "off stops recording and keeps the earlier log");
});

Deno.test("a broken debug recorder cannot throw", () => {
  const debug = fresh(true);
  debug.setEnabled(true);
  const previous = globalThis.postMessage;
  globalThis.postMessage = () => {
    throw new Error("port closed");
  };
  try {
    debug.trace("playback", () => {
      throw new Error("detail failed");
    });
    debug.trace("playback", "fail-open");
    assertEquals(debug.on, true, "the switch stays on after a failed write");
  } finally {
    globalThis.postMessage = previous;
  }
});

Deno.test("worker traces are posted instead of kept in the player", () => {
  const debug = fresh(true);
  const messages = [];
  const previous = globalThis.postMessage;
  globalThis.postMessage = (message) => messages.push(message);
  try {
    debug.setEnabled(true);
    debug.trace("playback", "backup autoplay");
    assertEquals(messages.length, 1);
    assertEquals(messages[0].source, "twitch-adblock");
    assertEquals(messages[0].type, "debug");
    assertEquals(messages[0].entry.detail, "backup autoplay");
    assert(debug.dump().includes("(no events)"), "the worker ring is not the copy source");
  } finally {
    globalThis.postMessage = previous;
  }
});

Deno.test("the tab switch is restored without storing the log", () => {
  const store = new Map();
  const fakeStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
  };
  store.set("twitch-adblock-debug", "1");
  const restored = {};
  install(restored, false, fakeStorage);
  assertEquals(restored.on, true);
  assert(restored.dump().includes("on restored"), "a refresh keeps the switch");
  assert(!restored.dump().includes("sig="), "refresh does not bring secrets back");
  restored.setEnabled(false);
  assertEquals(store.get("twitch-adblock-debug"), "0");
  const worker = {};
  install(worker, true, fakeStorage);
  assertEquals(worker.on, false, "a player worker does not read the page switch itself");
});

Deno.test("popup copy surface is local and has no playback hooks", () => {
  assert(popupHtml.includes(">ON<"), "popup has ON");
  assert(popupHtml.includes(">OFF<"), "popup has OFF");
  assert(popupHtml.includes(">Copy debug<"), "popup has Copy debug");
  assert(popupHtml.includes('src="popup.js"'), "popup script is local");
  assert(!popupHtml.includes("innerHTML"), "popup html does not inject markup");
  assert(!popupSource.includes("innerHTML"), "popup script does not inject markup");
  assert(!popupSource.includes("chrome.storage"), "popup does not use extension storage");
  assert(!popupSource.includes("chrome.scripting"), "popup does not inject scripts");
  assert(!bridgeSource.includes("chrome.storage"), "bridge does not use extension storage");
  assert(!bridgeSource.includes("chrome.scripting"), "bridge does not inject scripts");
  assert(pageSource.includes('typeof installTwitchAdblockDebug === "function"'), "missing debug boot still builds a worker");
  assert(pageSource.includes('type: "debug-set"'), "the page can tell a player worker the switch");
  assert(pageSource.includes("Debug never changes the playlist response."), "playlist tracing is guarded");
  for (const source of [pageSource, playlistSource, debugSource]) {
    assert(!source.includes("chrome."), "playback files do not call chrome");
  }
});

const playlist = new Function(`${playlistSource}\nreturn TwitchAdblockPlaylist;`)();
globalThis.TwitchAdblockPlaylist = playlist;
const guardSource = pageSource.slice(pageSource.indexOf("function createPlaylistGuard"));
const createPlaylistGuard = new Function(`${guardSource}\nreturn createPlaylistGuard;`)();

function playlistResponse(body) {
  return new Response(body, { status: 200, headers: { "Content-Type": "application/vnd.apple.mpegurl" } });
}

const adMedia = [
  "#EXTM3U",
  '#EXT-X-DATERANGE:ID="stitched-ad-1",CLASS="twitch-stitched-ad",START-DATE="2024-01-07T20:10:40.960Z",DURATION=15',
  "#EXTINF:2.0,",
  "https://ads.example/ad.ts",
].join("\n");

function masterFor(urls) {
  const lines = ["#EXTM3U"];
  for (const url of urls) {
    lines.push('#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.4D401F",FRAME-RATE=30.000');
    lines.push(url);
  }
  return lines.join("\n");
}

Deno.test("a throwing debug hook still fail-opens the midroll", async () => {
  const previous = globalThis.TwitchAdblockDebug;
  let calls = 0;
  globalThis.TwitchAdblockDebug = {
    on: true,
    trace() {
      calls += 1;
      throw new Error("debug failed");
    },
  };
  try {
    const guard = createPlaylistGuard({
      handoffGraceMs: 0,
      async fetch(url) {
        const value = String(url);
        if (value.includes("token=live")) return playlistResponse(masterFor(["https://video.example/live-variant.m3u8"]));
        if (value.includes("/channel/hls/")) return playlistResponse(masterFor(["https://video.example/embed-variant.m3u8"]));
        if (value.includes("live-variant") || value.includes("embed-variant") || value.includes("autoplay-variant") || value.includes("pip-variant")) {
          return playlistResponse(adMedia);
        }
        return new Response("segment", { status: 200 });
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
    assert(masterText.includes("live-variant.m3u8"), "a broken debug log still returns the live master");
    const media = await guard("https://video.example/live-variant.m3u8");
    const mediaText = await media.text();
    assert(mediaText.includes("ads.example"), "a broken debug log still passes the midroll through");
    assert(calls > 0, "debug on still attempted to record");
  } finally {
    if (previous === undefined) delete globalThis.TwitchAdblockDebug;
    else globalThis.TwitchAdblockDebug = previous;
  }
});

Deno.test("debug off does not call the recorder during playback", async () => {
  const previous = globalThis.TwitchAdblockDebug;
  let calls = 0;
  globalThis.TwitchAdblockDebug = {
    on: false,
    trace() {
      calls += 1;
      throw new Error("should not record");
    },
  };
  try {
    const guard = createPlaylistGuard({
      handoffGraceMs: 0,
      async fetch(url) {
        const value = String(url);
        if (value.includes("/channel/hls/") || value.includes(".m3u8")) {
          return playlistResponse(masterFor(["https://video.example/v1.m3u8"]));
        }
        return playlistResponse("#EXTM3U\n#EXTINF:2.0,\nhttps://video.example/live.ts");
      },
      async gql() {
        return "{}";
      },
      reload() {},
      status() {},
    });
    const master = await guard("https://usher.ttvnw.net/api/v2/channel/hls/Some_Channel.m3u8?token=live&sig=live");
    assert((await master.text()).includes("#EXTM3U"), "clean playback still returns a playlist");
    assertEquals(calls, 0, "debug off does not enter the recorder");
  } finally {
    if (previous === undefined) delete globalThis.TwitchAdblockDebug;
    else globalThis.TwitchAdblockDebug = previous;
  }
});

Deno.test("Copy reads the top frame and query secrets with longer names are redacted", () => {
  assert(popupSource.includes("{ frameId: 0 }"), "the popup asks only the top frame, where the player lives");
  const debug = fresh(false);
  debug.setEnabled(true);
  debug.note("playlist", "https://usher.ttvnw.net/a.m3u8?access_token=secret1&play_session_id=secret2&allow_source=true");
  const text = debug.dump();
  assert(!text.includes("secret1") && !text.includes("secret2"), "token and session values are not stored");
  assert(text.includes("allow_source=true"), "non-secret query values remain");
});
