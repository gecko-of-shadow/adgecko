// youtube.js without the uBO bundle (fail-open path: hooks live).
import "test/fixtures/memory-storage.mjs";
import { withYtOpts } from "test/fixtures/source-opts.mjs";
globalThis.window = globalThis; globalThis.self = globalThis;
const out = (m) => Deno.stdout.writeSync(new TextEncoder().encode(m + "\n"));
const calls = [];
const AD = JSON.stringify({ videoDetails: { videoId: "abcdefghijk" }, playabilityStatus: { status: "OK" }, adPlacements: [{ x: 1 }], pad: "y".repeat(50) });
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  calls.push(url);
  if (url.includes("rr1---sn-ab")) throw new TypeError("net::ERR_NAME_NOT_RESOLVED");
  const r = new Response(url.includes("youtubei") ? AD : "ok", { headers: { "content-type": "application/json" } });
  Object.defineProperties(r, { url: { value: url }, redirected: { value: false }, type: { value: "basic" } });
  return r;
};
function XMLHttpRequest() {}
XMLHttpRequest.prototype.open = function open() {}; XMLHttpRequest.prototype.send = function send() {};
for (const p of ["responseText", "response"]) Object.defineProperty(XMLHttpRequest.prototype, p, { configurable: true, enumerable: true, get() { return p === "response" ? { adPlacements: [1], videoDetails: {} } : ""; } });
Object.defineProperty(XMLHttpRequest.prototype, "readyState", { get() { return 4; } });
Object.defineProperty(XMLHttpRequest.prototype, "responseType", { get() { return "json"; } });
XMLHttpRequest.prototype.addEventListener = function () {};
globalThis.XMLHttpRequest = XMLHttpRequest;
const listeners = {};
globalThis.document = { readyState: "complete", currentScript: null, hidden: false,
  addEventListener: (t, f) => (listeners[t] = listeners[t] || []).push(f), removeEventListener() {},
  querySelectorAll: () => [], querySelector: () => null, getElementById: () => null,
  createElement: (tag) => ({ tag, style: {} }), documentElement: { appendChild: (e) => e, setAttribute() {}, removeAttribute() {} }, head: { appendChild: (e) => e } };
globalThis.MutationObserver = class { observe() {} disconnect() {} };
console.log = () => {};
(0, eval)(withYtOpts(await Deno.readTextFile("src/youtube.js"), { diag: false }));

// A. Request whose body was already read: native fetch rejects (async); hook throws synchronously.
const used = new Request("https://www.youtube.com/youtubei/v1/next", { method: "POST", body: "{}" });
await used.text();
try { const p = fetch(used); out("A: returned " + (p instanceof Promise ? "a promise" : typeof p)); p.catch(() => {}); }
catch (e) { out("A: hooked fetch threw synchronously: " + e.name + ": " + e.message); }
const used2 = new Request("https://www.youtube.com/youtubei/v1/next", { method: "POST", body: "{}" }); await used2.text();
try { const p = globalThis.fetch.call(null, used2); p.catch(()=>{}); } catch {}

// B. Stripped youtubei response loses url / redirected / type.
const r = await fetch("https://www.youtube.com/youtubei/v1/player?key=x", { method: "POST", body: "{}" });
const t = await r.text();
out("B: stripped=" + !t.includes('"x":1') + " url=" + JSON.stringify(r.url) + " type=" + r.type);

// C. Request object with a POST body to googlevideo; first host fails DNS.
calls.length = 0;
const req = new Request("https://rr1---sn-ab.googlevideo.com/videoplayback?expire=" + (Math.floor(Date.now()/1000)+3600) + "&mn=sn-ab,sn-cd&fvip=1", { method: "POST", body: new Uint8Array([1,2,3]) });
try { const res = await fetch(req); out("C: ok via " + calls.join(" , ")); }
catch (e) { out("C: failed: " + e.message + " | tried: " + calls.join(" , ")); }

// D. xhr.response (json) is a new object on every read.
const xhr = new XMLHttpRequest();
xhr.open("POST", "https://www.youtube.com/youtubei/v1/player");
out("D: xhr.response === xhr.response ? " + (xhr.response === xhr.response));
Deno.exit(0);
