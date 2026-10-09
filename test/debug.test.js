import debugSource from "../src/debug.js" with { type: "text" };
import vendorSource from "../src/vendor/video-swap-new.user.js" with { type: "text" };
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

function memoryStorage(initial) {
  const store = new Map(initial || []);
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
  };
}

function fresh(worker) {
  const target = {};
  install(target, worker === true, memoryStorage());
  return target;
}

Deno.test("a fresh page has debug on by default, and a player worker starts off", () => {
  const page = fresh(false);
  assertEquals(page.on, true, "a fresh install records with no user action");
  assert(page.dump().includes("on=true"), "dump says debug is on");
  assert(page.dump().includes("on by default"), "the default is logged");
  const worker = fresh(true);
  assertEquals(worker.on, false, "a player worker waits for the page to switch it on");
});

Deno.test("a saved off switch beats the default, and an off recorder does no work", () => {
  const saved = {};
  install(saved, false, memoryStorage([["twitch-adblock-debug", "0"]]));
  assertEquals(saved.on, false, "a tab the user turned off stays off after a refresh");
  const debug = fresh(false);
  debug.setEnabled(false);
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
  assert(!saved.dump().includes("on by default"), "an off tab logs nothing");
  assert(debug.dump().includes("on=false"), "dump says debug is off");
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
  assertEquals(logged.length, 5, "the default line and the repeated playlist line are each stored once");
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
  for (const source of [vendorSource, debugSource]) {
    assert(!source.includes("chrome."), "playback/debug files do not call chrome");
  }
});

Deno.test("manifest keeps YouTube debug + isolated bridge; Twitch is vendor MAIN only", () => {
  assertEquals(manifest.action.default_popup, "src/popup.html");
  const youtube = manifest.content_scripts.find((script) => (script.js || []).includes("src/youtube.js"));
  assertEquals(youtube.js, ["src/debug.js", "src/youtube.js"]);
  const twitch = manifest.content_scripts.find((script) =>
    (script.js || []).includes("src/vendor/video-swap-new.user.js")
  );
  assertEquals(twitch.js, ["src/vendor/video-swap-new.user.js"]);
  assertEquals(twitch.world, "MAIN");
  const bridge = manifest.content_scripts.find((script) => (script.js || []).includes("src/debug-bridge.js"));
  assert(bridge, "debug popup bridge is a content script");
  assert(bridge.world !== "MAIN", "debug bridge stays out of the page world");
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
