// Loads src/vendor/ubo-youtube.js and src/youtube.js in one realm, in the order
// given by LAYERS ("ubo,yt", "yt", "yt,ubo"), under a minimal watch-page shim,
// and prints what youtube.js hooked. Used by test/youtube-layers.test.js.
globalThis.window = globalThis;
globalThis.self = globalThis;
localStorage.removeItem("twitch-adblock-ubo-opts");
localStorage.removeItem("twitch-adblock-yt-opts");
class Node { appendChild(c) { return c; } }
globalThis.Node = Node;
function XMLHttpRequest() {}
XMLHttpRequest.prototype.open = function open() {};
XMLHttpRequest.prototype.send = function send() {};
for (const p of ["responseText", "response"]) Object.defineProperty(XMLHttpRequest.prototype, p, { configurable: true, enumerable: true, get() { return ""; } });
globalThis.XMLHttpRequest = XMLHttpRequest;
const listeners = {};
let stylesAppended = 0;
const appendChild = (el) => { if (el && el.tag === "style") stylesAppended++; if (el) el.isConnected = true; return el; };
globalThis.document = {
  readyState: "complete", currentScript: null, hidden: false,
  addEventListener: (t, f) => (listeners[t] = listeners[t] || []).push(f), removeEventListener() {},
  querySelectorAll: () => [], querySelector: () => null, getElementById: () => null,
  createElement: (tag) => ({ tag, style: {}, set textContent(v) {} }), documentElement: { appendChild }, head: { appendChild },
};
let mutationObservers = 0;
globalThis.MutationObserver = class { constructor() { mutationObservers++; } observe() {} disconnect() {} };
const perfObservers = [];
globalThis.PerformanceObserver = class {
  constructor(cb) { this.cb = cb; }
  observe(opts) { perfObservers.push({ cb: this.cb, opts }); }
};
const logs = [];
const log = console.log;
console.log = (...a) => logs.push(a.join(" "));

const natives = () => ({ fetch: globalThis.fetch, parse: JSON.parse, toString: Function.prototype.toString, open: XMLHttpRequest.prototype.open, send: XMLHttpRequest.prototype.send, rt: Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, "responseText").get });
const files = { ubo: "../../src/vendor/ubo-youtube.js", yt: "../../src/youtube.js" };
const order = (Deno.env.get("LAYERS") || "ubo,yt").split(",");
const out = { hookedByYoutube: [] };
for (const name of order) {
  const before = natives();
  (0, eval)(await Deno.readTextFile(new URL(files[name], import.meta.url)));
  if (name === "yt") {
    const after = natives();
    out.hookedByYoutube = Object.keys(before).filter((k) => before[k] !== after[k]);
  }
}
const marker = Symbol.for("twitch-adblock.ubo");
out.marker = globalThis[marker] === true;
try {
  globalThis[marker] = false; // a page script trying to switch our layers back on
} catch {
  // strict mode: read-only property
}
out.markerAfterTamper = globalThis[marker] === true;
out.mutationObservers = mutationObservers;
out.perfObservers = perfObservers.map((p) => p.opts && p.opts.type);
const entries = [
  ["https://rr1---sn-ab.googlevideo.com/videoplayback?expire=1&sabr=1", 105],
  ["https://rr1---sn-ab.googlevideo.com/videoplayback?expire=1&sabr=1", 104],
  ["https://rr1---sn-ab.googlevideo.com/videoplayback?expire=1&sabr=1", 0],
  ["https://rr1---sn-ab.googlevideo.com/videoplayback?expire=1&sabr=1", 48213],
  ["https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg", 105],
].map(([name, encodedBodySize]) => ({ name, encodedBodySize, entryType: "resource" }));
for (const p of perfObservers) p.cb({ getEntries: () => entries });
out.waitReplies = logs.filter((l) => l.includes("SABR wait reply seen")).map((l) => Number(/\((\d+)B\)/.exec(l)[1]));
out.navListeners = Object.keys(listeners).filter((k) => k.startsWith("yt-navigate")).sort();
for (const f of listeners["yt-navigate-finish"] || []) f({});
out.armedOnWatch = logs.some((l) => l.includes("stall watchdog armed (watch navigation)"));
out.stylesAppended = stylesAppended;
log(JSON.stringify(out));
Deno.exit(0);
