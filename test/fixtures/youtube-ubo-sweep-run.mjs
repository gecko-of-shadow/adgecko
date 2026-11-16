// Loads src/vendor/ubo-youtube.js and src/youtube.js in one realm, in the order
// given by LAYERS ("ubo,yt" is the manifest order; "yt" has no uBO layer), under
// a minimal watch-page DOM with YouTube's singleton tp-yt-paper-toast#toast,
// #movie_player and a rendered sidebar ad slot.
// Fires yt-navigate-finish and prints what the yt-navigate-finish sweep did to
// the page. Used by test/youtube-layers.test.js. All content is synthetic.
import "./memory-storage.mjs";
import { withYtOpts } from "./source-opts.mjs";
globalThis.window = globalThis;
globalThis.self = globalThis;
localStorage.removeItem("adgecko-ubo-opts");
class Node { appendChild(c) { return c; } }
globalThis.Node = Node;
function XMLHttpRequest() {}
XMLHttpRequest.prototype.open = function open() {};
XMLHttpRequest.prototype.send = function send() {};
for (const p of ["responseText", "response"]) Object.defineProperty(XMLHttpRequest.prototype, p, { configurable: true, enumerable: true, get() { return ""; } });
globalThis.XMLHttpRequest = XMLHttpRequest;

// The toast keeps the stale content of a closed "Experiencing interruptions?" toast.
const toastStyle = {};
const toast = {
  nodeType: 1, tag: "tp-yt-paper-toast", id: "toast", hidden: false,
  textContent: "Experiencing interruptions? Find out why",
  style: {
    setProperty(k, v, prio) { toastStyle[k] = v + (prio ? "!" + prio : ""); },
    removeProperty(k) { const had = toastStyle[k]; delete toastStyle[k]; return had || ""; },
  },
  matches: (s) => /tp-yt-paper-toast/.test(s),
  closest: (s) => (/tp-yt-paper-toast/.test(s) ? toast : null),
  querySelector: () => null,
};
const toastState = () => ({ hidden: toast.hidden === true, display: toastStyle.display || "", pointerEvents: toastStyle["pointer-events"] || "" });

// #movie_player records what youtube.js appends into it ("Blocking ads" chip).
const appended = [];
const player = {
  id: "movie_player", className: "", querySelector: () => null,
  appendChild(n) { appended.push(n); n.parentElement = player; return n; },
};
// A rendered sidebar ad slot (one of youtube.js DOM_AD_SELECTORS).
const adNode = { id: "", childElementCount: 1, textContent: "Sponsored", remove() { adNode.removed = true; } };

const listeners = {};
const appendChild = (el) => { if (el) el.isConnected = true; return el; };
globalThis.document = {
  readyState: "complete", currentScript: null, hidden: false,
  addEventListener: (t, f) => (listeners[t] = listeners[t] || []).push(f), removeEventListener() {},
  querySelectorAll: (s) => {
    if (String(s).includes("tp-yt-paper-toast")) return [toast];
    if (String(s).includes("ytd-watch-flexy ytd-ad-slot-renderer")) return adNode.removed ? [] : [adNode];
    return [];
  },
  querySelector: (s) => (s === "#movie_player" ? player : null),
  getElementById: (id) => appended.find((n) => n.id === id && n.parentElement === player) || null,
  createElement: (tag) => ({ tag, style: {} }),
  documentElement: { appendChild, setAttribute() {}, removeAttribute() {} }, head: { appendChild },
};
globalThis.MutationObserver = class { observe() {} disconnect() {} };
globalThis.PerformanceObserver = class { observe() {} disconnect() {} };
const log = console.log;
console.log = () => {};

const files = { ubo: "../../src/vendor/ubo-youtube.js", yt: "../../src/youtube.js" };
const order = (Deno.env.get("LAYERS") || "ubo,yt").split(",");
for (const name of order) {
  const text = await Deno.readTextFile(new URL(files[name], import.meta.url));
  (0, eval)(name === "yt" ? withYtOpts(text, { diag: false }) : text);
}
const nav = () => { for (const f of listeners["yt-navigate-finish"] || []) f({}); };
const out = { marker: globalThis[Symbol.for("gk.u")] === true };

// Navigation 1: the sweep runs while #toast still holds the stale content.
nav();
out.toastAfterNav = toastState();
// YouTube reuses #toast for the next message. Nothing else fires: under the
// uBO layer youtube.js has no DOM observer.
toast.textContent = "Saved to Watch later";
out.toastAfterReuse = toastState();
out.adNodeRemoved = adNode.removed === true;
out.appendedToPlayer = appended.map((n) => ({ id: n.id, text: n.textContent }));

log(JSON.stringify(out));
Deno.exit(0);
