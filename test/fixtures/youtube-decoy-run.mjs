// Loads src/vendor/ubo-youtube.js and src/youtube.js in one realm (like
// youtube-layers-run.mjs), then drives the resource-timing decoy watcher, the
// late-uBO hooks stand-down and the yt-navigate reset. SCENARIO picks the setup:
// "manifest" (ubo,yt), "late" (yt,ubo), "late-hooks" (yt,ubo + hooksUnderUbo), "yt".
// Used by test/youtube-decoy-nav.test.js. All urls are synthetic.
import "./memory-storage.mjs";
globalThis.window = globalThis;
globalThis.self = globalThis;
const SCENARIO = Deno.env.get("SCENARIO") || "manifest";
localStorage.removeItem("twitch-adblock-ubo-opts");
localStorage.removeItem("twitch-adblock-yt-opts");
if (SCENARIO === "late-hooks") localStorage.setItem("twitch-adblock-yt-opts", JSON.stringify({ hooksUnderUbo: true }));
class Node { appendChild(c) { return c; } }
globalThis.Node = Node;
function XMLHttpRequest() {}
XMLHttpRequest.prototype.open = function open() {};
XMLHttpRequest.prototype.send = function send() {};
for (const p of ["responseText", "response"]) Object.defineProperty(XMLHttpRequest.prototype, p, { configurable: true, enumerable: true, get() { return ""; } });
globalThis.XMLHttpRequest = XMLHttpRequest;
const listeners = {};
const appendChild = (el) => { if (el) el.isConnected = true; return el; };
globalThis.document = {
  readyState: "complete", currentScript: null, hidden: false,
  addEventListener: (t, f) => (listeners[t] = listeners[t] || []).push(f), removeEventListener() {},
  querySelectorAll: () => [], querySelector: () => null, getElementById: () => null,
  createElement: (tag) => ({ tag, style: {}, set textContent(v) {} }), documentElement: { appendChild }, head: { appendChild },
};
globalThis.MutationObserver = class { observe() {} disconnect() {} };
const perfObservers = [];
globalThis.PerformanceObserver = class {
  constructor(cb) { this.cb = cb; }
  observe(opts) { perfObservers.push({ cb: this.cb, opts }); }
  disconnect() {}
};
const spyCalls = [];
globalThis.fetch = function fetch(input) { spyCalls.push(String(input && input.url || input)); return Promise.resolve(new Response("{}")); };
const logs = [];
const log = console.log;
console.log = (...a) => logs.push(a.join(" "));

const DECOY = "https://rr3---sn-test.googlevideo.com/videoplayback?expire=1508648445&itag=18&sabr=1";
const WAIT = "https://rr1---sn-test.googlevideo.com/videoplayback?expire=" + Math.floor(Date.now() / 1000 + 21600) + "&sabr=1";
const entry = (name, encodedBodySize = 0, ageMs = 0) => ({ name, encodedBodySize, entryType: "resource", startTime: performance.now() - ageMs });
const emit = (...entries) => { for (const p of perfObservers) p.cb({ getEntries: () => entries }); };
const fire = (type, detail) => { for (const f of listeners[type] || []) f({ type, detail, target: globalThis.document }); };
const count = (text) => logs.filter((l) => l.includes(text)).length;
const lastArm = () => logs.filter((l) => l.includes("stall watchdog armed")).pop() || "";
const navigate = () => { fire("yt-navigate-start", { url: "/watch?v=abcdefghijk" }); fire("yt-navigate-finish", {}); return lastArm(); };

const files = { ubo: "../../src/vendor/ubo-youtube.js", yt: "../../src/youtube.js" };
const order = SCENARIO === "manifest" ? ["ubo", "yt"] : SCENARIO === "yt" ? ["yt"] : ["yt", "ubo"];
const out = { scenario: SCENARIO };
for (const name of order) {
  const before = globalThis.fetch;
  (0, eval)(await Deno.readTextFile(new URL(files[name], import.meta.url)));
  if (name === "yt") out.ytHookedFetch = globalThis.fetch !== before;
}
out.observersAtLoad = perfObservers.length;

// Hooked calls after the uBO marker is live (late order: the first one stands the hooks down).
for (let i = 0; i < 5; i++) JSON.parse('{"a":' + i + "}");
out.standDowns = count("hooks standing down");
out.observers = perfObservers.length;
spyCalls.length = 0;
await globalThis.fetch(DECOY).catch(() => {});
out.decoyReachedNative = spyCalls.includes(DECOY);
out.hookDecoyLogs = count("decoy seen, uBO present") + count("decoy seen: ");

// Resource-timing evidence: twice in one navigation logs once.
emit(entry(DECOY), entry(DECOY));
out.rtDecoyLogs = count("decoy seen via resource timing");
emit(entry("https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg?expire=1508648445"), entry(WAIT, 105));
out.rtDecoyLogsAfterImage = count("decoy seen via resource timing");
out.waitReplies = count("SABR wait reply seen");
fire("yt-navigate-finish", {});
out.armWithDecoy = lastArm();
// Real yt-navigate-start handler: next video starts without decoy evidence.
out.armNextNav = navigate();
// Fresh evidence in the new navigation counts again.
fire("yt-navigate-start", { url: "/watch?v=abcdefghijk" });
emit(entry(DECOY));
fire("yt-navigate-finish", {});
out.armFreshDecoy = lastArm();
out.rtDecoyLogsTotal = count("decoy seen via resource timing");
// A previous video's request whose entry is delivered after yt-navigate-start.
fire("yt-navigate-start", { url: "/watch?v=abcdefghijk" });
emit(entry(DECOY, 0, 5000));
fire("yt-navigate-finish", {});
out.armStaleEntry = lastArm();

localStorage.removeItem("twitch-adblock-yt-opts");
log(JSON.stringify(out));
Deno.exit(0);
