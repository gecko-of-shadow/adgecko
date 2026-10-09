import debugSource from "../src/debug.js" with { type: "text" };
import vendorSource from "../src/vendor/video-swap-new.user.js" with { type: "text" };
import popupSource from "../src/popup.js" with { type: "text" };
import popupHtml from "../src/popup.html" with { type: "text" };
import bridgeSource from "../src/debug-bridge.js" with { type: "text" };
import youtubeSource from "../src/youtube.js" with { type: "text" };
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

Deno.test("a fresh page leaves debug off, and a player worker stays off", () => {
  const page = fresh(false);
  assertEquals(page.on, false, "a fresh install does not record until someone turns it on");
  assert(page.dump().includes("on=false"), "dump says debug is off");
  assert(!page.dump().includes("on by default"), "nothing turns debug on by itself");
  let called = false;
  page.note("playback", () => {
    called = true;
    return "should-not-run";
  });
  assertEquals(called, false, "an untouched page does not build log lines");
  const worker = fresh(true);
  assertEquals(worker.on, false, "a player worker stays off");
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
  assertEquals(logged.length, 4, "turning debug on does not add an automatic line, and the repeated playlist line is stored once");
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
  assert(!popupHtml.includes("on by default"), "popup does not say debug turns itself on");
  assert(!popupSource.includes("on by default"), "popup script does not turn debug on by itself");
  assert(popupSource.includes('send("get")'), "opening the popup only reads the current switch");
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

const installReply = new Function(
  `${debugSource.replace(/\ninstallTwitchAdblockDebug\(globalThis[\s\S]*$/, "")}\nreturn installDebugPopupReply;`,
)();

function pageHost(hostname, bannerText) {
  const listeners = [];
  const overlay = bannerText
    ? {
      style: { display: "block" },
      querySelector(sel) {
        return sel === "p" ? { textContent: bannerText } : null;
      },
    }
    : null;
  const host = {
    location: { hostname },
    document: {
      documentElement: { nodeType: 1 },
      querySelector(sel) {
        return sel === ".adblock-overlay" ? overlay : null;
      },
    },
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.disconnected = false;
        this.observing = false;
      }
      observe() {
        this.observing = true;
      }
      disconnect() {
        this.disconnected = true;
        this.observing = false;
      }
    },
    addEventListener(type, fn) {
      if (type === "message") listeners.push(fn);
    },
    postMessage(data) {
      const event = { source: host, data };
      for (const fn of listeners.slice()) fn(event);
    },
  };
  host.TwitchAdblockDebug = {};
  install(host.TwitchAdblockDebug, false, memoryStorage());
  installReply(host);
  return host;
}

function runBridge(host) {
  const sent = [];
  const chrome = {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        sent.push(message);
        if (callback) callback();
      },
      onMessage: {
        addListener(fn) {
          chrome.runtime._listener = fn;
        },
      },
    },
  };
  const run = new Function(
    "window",
    "chrome",
    "loc",
    `const location = loc;\n${bridgeSource}`,
  );
  run(host, chrome, host.location);
  return {
    sent,
    ask(message) {
      chrome.runtime._listener(message);
    },
  };
}

Deno.test("Twitch MAIN loads the debug reply before the unmodified vendor script", () => {
  const vendor = manifest.content_scripts.find((script) =>
    (script.js || []).includes("src/vendor/video-swap-new.user.js")
  );
  assertEquals(vendor.js, ["src/vendor/video-swap-new.user.js"], "vendor entry stays the userscript alone");
  const reply = manifest.content_scripts.find((script) =>
    script.world === "MAIN" && (script.js || []).join(",") === "src/debug.js" &&
    (script.matches || []).some((match) => match.includes("twitch.tv"))
  );
  assert(reply, "Twitch top frame loads debug.js in the page world");
  assertEquals(reply.run_at, "document_start");
  assert(reply.all_frames !== true, "the popup talks to the top frame only");
  assert(
    manifest.content_scripts.indexOf(reply) < manifest.content_scripts.indexOf(vendor),
    "the reply is installed before video-swap-new",
  );
  assert(!debugSource.includes("twitchAdSolutionsVersion"), "debug.js does not trip the vendor version gate");
  assert(!debugSource.includes("window.Worker") && !debugSource.includes("globalThis.Worker"), "debug.js does not wrap Worker");
  assert(!vendorSource.includes("installDebugPopupReply"), "the vendor file is not edited to answer the popup");
  assert(debugSource.includes('type: "state"'), "debug.js sends the popup answer");
  assert(!youtubeSource.includes('type: "state"'), "youtube.js does not answer a second time");
});

Deno.test("a Twitch ON press is answered with real events and does not turn itself on", () => {
  const idle = pageHost("www.twitch.tv", "Blocking midroll ads");
  assertEquals(idle.TwitchAdblockDebug.on, false, "loading the reply leaves debug off");
  const off = runBridge(idle);
  off.ask({ source: "twitch-adblock-debug", type: "get", gen: 1 });
  assertEquals(off.sent.length, 1, "a Twitch tab answers a read");
  assertEquals(off.sent[0].on, false);
  assertEquals(off.sent[0].type, "state");
  assert(off.sent[0].text.includes("on=false"), "a read reports off");
  assert(off.sent[0].text.includes("(no events)"), "a read does not invent events");
  assert(!off.sent[0].text.includes("Blocking midroll ads"), "off mode does not copy the banner");
  assertEquals(idle.TwitchAdblockDebug.on, false, "reading the switch does not turn it on");

  const host = pageHost("www.twitch.tv", "Blocking midroll ads");
  const popup = runBridge(host);
  popup.ask({ source: "twitch-adblock-debug", type: "set", on: true, gen: 4 });
  assertEquals(host.TwitchAdblockDebug.on, true);
  assertEquals(popup.sent.length, 1, "ON is answered");
  assertEquals(popup.sent[0].gen, 4);
  assertEquals(popup.sent[0].on, true);
  const copied = popup.sent[0].text;
  assert(copied.includes("on=true"), "Copy debug reports the switch");
  assert(!copied.includes("(no events)"), "Copy debug is not the empty fallback");
  assert(copied.includes("debug on"), "turning the switch on is recorded");
  assert(copied.includes("Blocking midroll ads"), "the visible blocking label is recorded");
  assert(!copied.includes("token="), "the banner line is not a place to stash secrets");

  popup.ask({ source: "twitch-adblock-debug", type: "set", on: false, gen: 5 });
  assertEquals(host.TwitchAdblockDebug.on, false, "OFF stays off");
  assert(popup.sent[1].text.includes("on=false"));
  host.TwitchAdblockDebug.note("banner", "after-off");
  assert(!host.TwitchAdblockDebug.dump().includes("after-off"), "OFF does not keep recording");
});

Deno.test("YouTube still answers ON from debug.js and a later Twitch label is copied", () => {
  const youtube = pageHost("www.youtube.com");
  const youtubePopup = runBridge(youtube);
  youtubePopup.ask({ source: "twitch-adblock-debug", type: "get", gen: 1 });
  assertEquals(youtube.TwitchAdblockDebug.on, false, "opening the YouTube popup does not turn debug on");
  youtubePopup.ask({ source: "twitch-adblock-debug", type: "set", on: true, gen: 2 });
  assertEquals(youtubePopup.sent[1].on, true);
  assert(youtubePopup.sent[1].text.includes("debug on"), "YouTube Copy debug includes the on event");
  assert(!youtubePopup.sent[1].text.includes("(no events)"));
  assertEquals(youtube.TwitchAdblockDebug._bannerWatch, undefined, "YouTube does not watch the Twitch label");

  const host = pageHost("www.twitch.tv");
  const popup = runBridge(host);
  popup.ask({ source: "twitch-adblock-debug", type: "set", on: true, gen: 1 });
  assert(!popup.sent[0].text.includes("Blocking midroll ads"), "no label yet");
  host.document.querySelector = (sel) => {
    if (sel !== ".adblock-overlay") return null;
    return {
      style: { display: "block" },
      querySelector(inner) {
        return inner === "p" ? { textContent: "Blocking midroll ads" } : null;
      },
    };
  };
  host.TwitchAdblockDebug._bannerWatch.callback();
  popup.ask({ source: "twitch-adblock-debug", type: "get", gen: 3 });
  assertEquals(host.TwitchAdblockDebug.on, true);
  assert(popup.sent[1].text.includes("Blocking midroll ads"), "the next read includes the label");
  assert(!popup.sent[1].text.includes("(no events)"));
});
