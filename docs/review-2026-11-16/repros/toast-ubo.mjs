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
globalThis.document = { readyState: "complete", currentScript: null, hidden: false,
  addEventListener: (t, f) => (listeners[t] = listeners[t] || []).push(f), removeEventListener() {},
  querySelectorAll: (s) => (s.includes("tp-yt-paper-toast") ? [toast] : []), querySelector: () => null, getElementById: () => null,
  createElement: (tag) => ({ tag, style: {} }), documentElement: { appendChild: (e) => e, setAttribute() {}, removeAttribute() {} }, head: { appendChild: (e) => e } };
let mo = 0; globalThis.MutationObserver = class { constructor() { mo++; } observe() {} disconnect() {} };
globalThis.PerformanceObserver = class { observe() {} };
console.log = () => {};
(0, eval)(await Deno.readTextFile("src/vendor/ubo-youtube.js"));
(0, eval)(withYtOpts(await Deno.readTextFile("src/youtube.js"), { diag: false }));
const out = (m) => Deno.stdout.writeSync(new TextEncoder().encode(m + "\n"));
out("MutationObservers created by youtube.js: " + mo);
for (const f of listeners["yt-navigate-finish"]) f({});
out("after nav 1: hidden=" + toast.hidden + " display=" + style.display);
toast.textContent = "Saved to Watch later"; // YouTube reuses #toast
// No observer, no timer: nothing else runs until the next navigation.
out("Saved toast shown? hidden=" + toast.hidden + " display=" + style.display);
for (const f of listeners["yt-navigate-finish"]) f({});
out("after nav 2: hidden=" + toast.hidden + " display=" + style.display);
Deno.exit(0);
