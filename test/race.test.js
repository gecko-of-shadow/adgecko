import source from "../src/youtube.js" with { type: "text" };

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function playerBody(id) {
  return JSON.stringify({
    videoDetails: { videoId: id },
    streamingData: { serverAbrStreamingUrl: `https://rr.example/videoplayback?id=${id}` },
    adPlacements: [{ adPlacementRenderer: { id } }],
  });
}

function cleanBody(id) {
  return JSON.stringify({
    videoDetails: { videoId: id },
    streamingData: { serverAbrStreamingUrl: `https://rr.example/videoplayback?id=${id}` },
  });
}

Deno.test("a reused player XHR returns the second response", async () => {
  const saved = {
    document: globalThis.document,
    window: globalThis.window,
    location: globalThis.location,
    XMLHttpRequest: globalThis.XMLHttpRequest,
    fetch: globalThis.fetch,
    JSON: JSON.parse,
  };
  const nodes = new Map();
  const listeners = {};
  let player = null;
  function element() {
    const node = {
      id: "",
      textContent: "",
      style: {},
      parentElement: null,
      childElementCount: 0,
      children: [],
      appendChild(child) {
        child.parentElement = this;
        this.children.push(child);
        this.childElementCount = this.children.length;
        if (child.id) nodes.set(child.id, child);
      },
      remove() {
        if (this.id) nodes.delete(this.id);
        this.parentElement = null;
      },
    };
    return new Proxy(node, {
      set(target, prop, value) {
        target[prop] = value;
        if (prop === "id" && value) nodes.set(value, target);
        return true;
      },
    });
  }
  function XMLHttpRequest() {
    this.readyState = 0;
    this.responseType = "";
    this._body = "";
  }
  XMLHttpRequest.prototype.open = function () {
    this.readyState = 1;
  };
  XMLHttpRequest.prototype.send = function () {
    this.readyState = 4;
  };
  Object.defineProperty(XMLHttpRequest.prototype, "responseText", {
    configurable: true,
    get() {
      return this._body;
    },
  });
  Object.defineProperty(XMLHttpRequest.prototype, "response", {
    configurable: true,
    get() {
      return this._body;
    },
  });
  const document = {
    readyState: "complete",
    documentElement: {},
    getElementById(id) {
      return nodes.get(id) || null;
    },
    createElement() {
      return element();
    },
    querySelector(selector) {
      if (String(selector).includes("ytd-reel-video-renderer")) return null;
      return player;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener(name, fn) {
      (listeners[name] ||= []).push(fn);
    },
  };
  let mode = "ad";
  globalThis.XMLHttpRequest = XMLHttpRequest;
  globalThis.document = document;
  globalThis.location = { pathname: "/watch" };
  globalThis.window = globalThis;
  globalThis.fetch = async (input) => {
    const url = String(input && input.url ? input.url : input);
    if (mode === "clean" || url.includes("clean=1")) return new Response(cleanBody("videoB"), { status: 200 });
    return new Response(playerBody("videoA"), { status: 200 });
  };
  delete globalThis.__twitchAdblockYoutube;
  try {
    new Function(source)();
    player = element();
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "https://www.youtube.com/youtubei/v1/player?prettyPrint=false");
    xhr._body = playerBody("videoA");
    xhr.send();
    const first = xhr.responseText;
    assert(first.includes("videoA"), "the first body is the first video");
    assert(!first.includes("adPlacements"), "ads are removed from the first body");
    xhr.open("POST", "https://www.youtube.com/youtubei/v1/player?prettyPrint=false");
    xhr._body = playerBody("videoB");
    xhr.send();
    const second = xhr.responseText;
    assert(second.includes("videoB"), "a reused XHR moves to the second video");
    assert(!second.includes("videoA"), "the first body is not sticky");
    assert(!second.includes("adPlacements"), "ads are removed from the second body");
    assert(xhr.response === second, "the default response getter follows responseText");

    await globalThis.fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false");
    assert(document.getElementById("twitch-adblock-notice"), "a stripped player response shows the label");
    mode = "clean";
    await globalThis.fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false");
    assert(!document.getElementById("twitch-adblock-notice"), "a clean player response clears the label");

    mode = "ad";
    player = null;
    await globalThis.fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false");
    for (const fn of listeners["yt-navigate-start"] || []) fn();
    for (const fn of listeners["yt-navigate-start"] || []) fn();
    player = element();
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert(!document.getElementById("twitch-adblock-notice"), "navigation cancels a label retry");
  } finally {
    delete globalThis.__twitchAdblockYoutube;
    JSON.parse = saved.JSON;
    globalThis.document = saved.document;
    globalThis.window = saved.window;
    globalThis.location = saved.location;
    globalThis.XMLHttpRequest = saved.XMLHttpRequest;
    globalThis.fetch = saved.fetch;
  }
});

Deno.test("watch and shorts parsing keeps an ad-only player payload", () => {
  const savedParse = JSON.parse;
  const nodes = new Map();
  globalThis.document = {
    readyState: "complete",
    documentElement: {},
    getElementById() {
      return null;
    },
    createElement() {
      return { id: "", textContent: "", style: {}, appendChild() {}, remove() {} };
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener() {},
  };
  globalThis.location = { pathname: "/watch" };
  globalThis.window = globalThis;
  function XMLHttpRequest() {}
  XMLHttpRequest.prototype.open = function () {};
  XMLHttpRequest.prototype.send = function () {};
  Object.defineProperty(XMLHttpRequest.prototype, "responseText", { configurable: true, get() { return ""; } });
  Object.defineProperty(XMLHttpRequest.prototype, "response", { configurable: true, get() { return ""; } });
  globalThis.XMLHttpRequest = XMLHttpRequest;
  globalThis.fetch = async () => new Response("{}");
  delete globalThis.__twitchAdblockYoutube;
  try {
    new Function(source)();
    const adOnly = '{"adPlacements":[{"adPlacementRenderer":{}}],"playerAds":[{"playerLegacyDesktopWatchAdsRenderer":{}}]}';
    const parsed = JSON.parse(adOnly);
    assert(parsed.adPlacements, "an ad-only watch payload is left so the ad can play");
    assert(parsed.playerAds, "player ads stay when there is no video to keep");
    globalThis.location = { pathname: "/shorts/abc" };
    const shorts = JSON.parse(adOnly);
    assert(shorts.playerAds, "an ad-only shorts payload is left so the ad can play");
    const withVideo = JSON.parse(playerBody("videoC"));
    assert(withVideo.videoDetails.videoId === "videoC", "a watch payload with video is kept");
    assert(!withVideo.adPlacements, "ads are still removed when the video remains");
  } finally {
    JSON.parse = savedParse;
  }
});
