import source from "../src/youtube.js" with { type: "text" };
function assert(c, m) { if (!c) throw new Error(m); }

Deno.test("hooks look native: toString, name, length, no own props, no string globals", async () => {
  const saved = { ts: Function.prototype.toString, parse: JSON.parse, fetch: globalThis.fetch, XHR: globalThis.XMLHttpRequest, document: globalThis.document, window: globalThis.window, location: globalThis.location };
  const nativeFetch = globalThis.fetch;
  const nativeParse = JSON.parse;
  function XMLHttpRequest() { this.readyState = 0; this.responseType = ""; }
  // Stand-ins carry native-looking source via the real toString of natives.
  XMLHttpRequest.prototype.open = function open(a, b) {};
  XMLHttpRequest.prototype.send = function send(b) {};
  Object.defineProperty(XMLHttpRequest.prototype, "responseText", { configurable: true, enumerable: true, get() { return "x"; } });
  Object.defineProperty(XMLHttpRequest.prototype, "response", { configurable: true, enumerable: true, get() { return "x"; } });
  const before = {
    open: Function.prototype.toString.call(XMLHttpRequest.prototype.open),
    rt: Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, "responseText"),
  };
  globalThis.XMLHttpRequest = XMLHttpRequest;
  globalThis.document = { readyState: "complete", documentElement: {}, getElementById() { return null; }, createElement() { return { style: {}, appendChild() {} }; }, querySelector() { return null; }, querySelectorAll() { return []; }, addEventListener() {} };
  globalThis.location = { pathname: "/watch" };
  globalThis.window = globalThis;
  delete globalThis[Symbol.for("twitch-adblock.yt")];
  const keysBefore = new Set(Object.getOwnPropertyNames(globalThis));
  try {
    new Function(source)();
    assert(globalThis.fetch !== nativeFetch, "fetch is hooked");
    assert(String(globalThis.fetch) === String(nativeFetch), "fetch toString is native: " + String(globalThis.fetch));
    assert(globalThis.fetch.name === nativeFetch.name && globalThis.fetch.length === nativeFetch.length, "fetch name/length kept");
    assert(Object.getOwnPropertyNames(globalThis.fetch).join() === Object.getOwnPropertyNames(nativeFetch).join(), "fetch own props unchanged");
    assert(JSON.parse !== nativeParse && String(JSON.parse) === String(nativeParse), "JSON.parse looks native");
    assert(JSON.parse.name === "parse" && JSON.parse.length === 2, "JSON.parse name/length");
    assert(/\[native code\]/.test(Function.prototype.toString.toString()), "toString itself looks native");
    assert(Function.prototype.toString.name === "toString", "toString name");
    assert(Function.prototype.toString.call(XMLHttpRequest.prototype.open) === before.open, "XHR open source unchanged");
    const rt = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, "responseText");
    assert(rt.get !== before.rt.get && String(rt.get) === String(before.rt.get), "responseText getter cloaked");
    assert(rt.enumerable === before.rt.enumerable && rt.configurable === before.rt.configurable && !("value" in rt), "descriptor shape kept");
    const xhr = new XMLHttpRequest();
    const own = Object.getOwnPropertyNames(xhr).join();
    xhr.open("POST", "https://www.youtube.com/youtubei/v1/player");
    xhr.send("{}");
    assert(Object.getOwnPropertyNames(xhr).join() === own, "no own properties added to the XHR: " + Object.getOwnPropertyNames(xhr));
    const added = Object.getOwnPropertyNames(globalThis).filter((k) => !keysBefore.has(k) && !/^ytInitial(PlayerResponse|Data)$/.test(k)); // YouTube defines these itself
    assert(added.length === 0, "no new string-keyed globals: " + added);
    assert(!Object.keys(globalThis).some((k) => /adblock/i.test(k)), "nothing enumerable mentions adblock");
  } finally {
    delete globalThis[Symbol.for("twitch-adblock.yt")];
    Function.prototype.toString = saved.ts;
    JSON.parse = saved.parse;
    globalThis.fetch = saved.fetch;
    globalThis.XMLHttpRequest = saved.XHR;
    globalThis.document = saved.document;
    globalThis.window = saved.window;
    globalThis.location = saved.location;
  }
});

Deno.test("uBO layer present: no fetch/XHR/JSON.parse/toString hooks (uBO-only speed)", () => {
  const saved = { ts: Function.prototype.toString, parse: JSON.parse, fetch: globalThis.fetch, XHR: globalThis.XMLHttpRequest, document: globalThis.document, window: globalThis.window, location: globalThis.location };
  function XMLHttpRequest() {}
  XMLHttpRequest.prototype.open = function open() {};
  XMLHttpRequest.prototype.send = function send() {};
  const rt = { configurable: true, enumerable: true, get() { return ""; } };
  Object.defineProperty(XMLHttpRequest.prototype, "responseText", rt);
  Object.defineProperty(XMLHttpRequest.prototype, "response", rt);
  const open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
  globalThis.XMLHttpRequest = XMLHttpRequest;
  globalThis.document = { readyState: "complete", documentElement: {}, getElementById() { return null; }, createElement() { return { style: {}, appendChild() {} }; }, querySelector() { return null; }, querySelectorAll() { return []; }, addEventListener() {} };
  globalThis.location = { pathname: "/watch" };
  globalThis.window = globalThis;
  delete globalThis[Symbol.for("twitch-adblock.yt")];
  Object.defineProperty(globalThis, Symbol.for("twitch-adblock.ubo"), { value: true, configurable: true });
  try {
    new Function(source)();
    assert(globalThis.fetch === saved.fetch, "fetch untouched");
    assert(JSON.parse === saved.parse, "JSON.parse untouched");
    assert(Function.prototype.toString === saved.ts, "toString untouched");
    assert(XMLHttpRequest.prototype.open === open && XMLHttpRequest.prototype.send === send, "XHR untouched");
    assert(Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, "responseText").get === rt.get, "getters untouched");
  } finally {
    delete globalThis[Symbol.for("twitch-adblock.ubo")];
    delete globalThis[Symbol.for("twitch-adblock.yt")];
    Function.prototype.toString = saved.ts; JSON.parse = saved.parse; globalThis.fetch = saved.fetch;
    globalThis.XMLHttpRequest = saved.XHR; globalThis.document = saved.document; globalThis.window = saved.window; globalThis.location = saved.location;
  }
});
