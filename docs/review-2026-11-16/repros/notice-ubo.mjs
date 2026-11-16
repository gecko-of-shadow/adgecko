// Repro: with the uBO bundle loaded first (manifest order), youtube.js has no
// MutationObserver, so a #toast hidden inline at yt-navigate-finish stays hidden
// when YouTube reuses it for "Saved to Watch later" until the NEXT navigation.
import "test/fixtures/memory-storage.mjs";
import { withYtOpts } from "test/fixtures/source-opts.mjs";
globalThis.window = globalThis; globalThis.self = globalThis;
class Node { appendChild(c) { return c; } }
globalThis.Node = Node;
function XMLHttpRequest() {}
XMLHttpRequest.prototype.open = function open() {}; XMLHttpRequest.prototype.send = function send() {};
for (const p of ["responseText", "response"]) Object.defineProperty(XMLHttpRequest.prototype, p, { configurable: true, enumerable: true, get() { return ""; } });
globalThis.XMLHttpRequest = XMLHttpRequest;
// one toast node: tp-yt-paper-toast#toast with stale content of a closed interruptions toast
const style = {}; 
const toast = { nodeType: 1, id: "toast", hidden: false, textContent: "Experiencing interruptions? Find out why",
  style: { setProperty(k, v) { style[k] = v; }, removeProperty(k) { delete style[k]; } },
  matches: (s) => /tp-yt-paper-toast/.test(s), closest: (s) => (/tp-yt-paper-toast/.test(s) ? toast : null), querySelector: () => null };
const listeners = {};
const appended = [];
const player = { id: "movie_player", className: "", appendChild(n) { appended.push(n); n.parentElement = player; return n; }, querySelector: () => null };
const adNode = { id: "", childElementCount: 1, textContent: "Sponsored", remove() { adNode.removed = true; } };
globalThis.document = { readyState: "complete", currentScript: null, hidden: false,
  addEventListener: (t, f) => (listeners[t] = listeners[t] || []).push(f), removeEventListener() {},
  querySelectorAll: (s) => (s.includes("ytd-watch-flexy ytd-ad-slot-renderer") ? [adNode] : []), querySelector: (s) => (s === "#movie_player" ? player : null), getElementById: () => null,
  createElement: (tag) => ({ tag, style: {} }), documentElement: { appendChild: (e) => e, setAttribute() {}, removeAttribute() {} }, head: { appendChild: (e) => e } };
let mo = 0; globalThis.MutationObserver = class { constructor() { mo++; } observe() {} disconnect() {} };
globalThis.PerformanceObserver = class { observe() {} };
console.log = () => {};
(0, eval)(await Deno.readTextFile("src/vendor/ubo-youtube.js"));
(0, eval)(withYtOpts(await Deno.readTextFile("src/youtube.js"), { diag: false }));
const out = (m) => Deno.stdout.writeSync(new TextEncoder().encode(m + "\n"));
for (const f of listeners["yt-navigate-finish"]) f({});
out("sidebar ad node removed: " + !!adNode.removed);
out("appended into #movie_player: " + JSON.stringify(appended.map((n) => ({ id: n.id, text: n.textContent }))));
Deno.exit(0);
