import source from "../src/youtube.js" with { type: "text" };
import { unwrapMain } from "./fixtures/main-source.mjs";

function assertEquals(a, b, label) {
  const l = JSON.stringify(a), r = JSON.stringify(b);
  if (l !== r) throw new Error(`${label || "not equal"}\n${l}\n${r}`);
}
function assert(c, label) { if (!c) throw new Error(label); }
function fresh() {
  const api = {};
  new Function(`${unwrapMain(source)}\nreturn installYoutubeAdblock;`)()(api);
  return api;
}
const BAD = "https://rr2---sn-h9jk2mn5.googlevideo.com/videoplayback?expire=1&id=o-abc&itag=243&mn=sn-h9jk2mn5%2Csn-n5pqrstu&fvip=2&sabr=1";
const host = (u) => new URL(u).hostname;
const dnsError = () => Object.assign(new TypeError("Failed to fetch"), { message: "net::ERR_NAME_NOT_RESOLVED" });
const ok = (status = 200) => ({ ok: status < 400, status, body: null, read: false });

Deno.test("fallback hosts come from mn and fvip, then the redirector", () => {
  const api = fresh();
  const hosts = api.googlevideoFallbacks(BAD).map(host);
  assertEquals(hosts, ["rr2---sn-n5pqrstu.googlevideo.com", "r2---sn-h9jk2mn5.googlevideo.com", "redirector.googlevideo.com"]);
  assert(api.googlevideoFallbacks(BAD).every((u) => u.includes("/videoplayback?") && u.includes("id=o-abc") && u.includes("fallback_count=")), "path and query kept");
  assertEquals(api.googlevideoFallbacks("https://www.youtube.com/youtubei/v1/player"), [], "non-media urls untouched");
});

Deno.test("a DNS failure retries on the mn fallback and later requests skip the dead host", async () => {
  const api = fresh();
  const calls = [];
  const result = await api.fetchWithFallback(BAD, (u) => {
    calls.push(host(u));
    if (host(u) === "rr2---sn-h9jk2mn5.googlevideo.com") return Promise.reject(dnsError());
    return Promise.resolve(ok());
  });
  assertEquals(calls, ["rr2---sn-h9jk2mn5.googlevideo.com", "rr2---sn-n5pqrstu.googlevideo.com"]);
  assertEquals(result.exhausted, false);
  assertEquals(result.failures[0].reason, "dns");
  assertEquals(host(api.mapBadHost(BAD)), "rr2---sn-n5pqrstu.googlevideo.com", "next request goes straight to the working host");
  const calls2 = [];
  await api.fetchWithFallback(BAD, (u) => { calls2.push(host(u)); return Promise.resolve(ok()); });
  assertEquals(calls2, ["rr2---sn-n5pqrstu.googlevideo.com"], "no second round trip to the dead host");
});

Deno.test("a 403 moves on without reading the failed body", async () => {
  const api = fresh();
  api.STEALTH.failoverOn403 = true; // legacy A/B mode
  const bodies = [];
  const result = await api.fetchWithFallback(BAD, (u, i) => {
    const r = i === 0 ? ok(403) : ok(200);
    r.text = () => { bodies.push(i); return Promise.resolve(""); };
    r.clone = () => { bodies.push("clone" + i); return r; };
    return Promise.resolve(r);
  });
  assertEquals(result.response.status, 200);
  assertEquals(result.failures, [{ url: BAD, reason: "http 403" }]);
  assertEquals(bodies, [], "failed response was never cloned or read");
});

Deno.test("all hosts failing is bounded (≤6 tries) and reported as exhausted", async () => {
  const api = fresh();
  api.STEALTH.failoverOn403 = true; // legacy A/B mode
  let n = 0;
  let thrown = null;
  try {
    await api.fetchWithFallback(BAD, () => { n++; return Promise.reject(dnsError()); });
  } catch (e) { thrown = e; }
  assert(thrown && thrown.ytExhausted, "the error is marked exhausted so the page can reload the video");
  assertEquals(n, 4, "original + mn fallback + r-alias + redirector, then stop");
  // 403 everywhere returns the last 403 instead of throwing
  const api2 = fresh();
  const r = await api2.fetchWithFallback(BAD, () => Promise.resolve(ok(403)));
  assertEquals(r.flagged, true, "403 = flagged url: no failover by default");
  assertEquals(r.response.status, 403);
});

Deno.test("the time budget stops further fallbacks", async () => {
  const api = fresh();
  let t = 0, n = 0;
  await api.fetchWithFallback(BAD, () => { n++; t += 5000; return Promise.reject(dnsError()); }, { budgetMs: 8000, now: () => t }).catch(() => {});
  assertEquals(n, 2, "a slow dead host does not chain into a long wait");
});

Deno.test("an aborted request is not retried", async () => {
  const api = fresh();
  let n = 0;
  const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
  let err = null;
  await api.fetchWithFallback(BAD, () => { n++; return Promise.reject(abort); }).catch((e) => { err = e; });
  assertEquals(n, 1);
  assertEquals(err.name, "AbortError");
});

Deno.test("host mappings cannot form a loop", () => {
  const api = fresh();
  const other = BAD.replace("sn-h9jk2mn5.googlevideo", "sn-n5pqrstu.googlevideo");
  api.rememberBadHost(BAD, other);
  api.rememberBadHost(other, BAD);
  const mapped = api.mapBadHost(BAD);
  assert(typeof mapped === "string", "returns");
  assert(!api.googlevideoFallbacks(other).map(host).includes("rr2---sn-h9jk2mn5.googlevideo.com"), "a known-bad host is not offered as a fallback");
});

Deno.test("hooks recover fast and reload at most twice", () => {
  assert(source.includes("api.fetchWithFallback(url, doFetch)"), "fetch hook uses the fallback");
  assert(source.includes("if (!response || !response.ok || !api.STEALTH.patchUmpBackoff) return response;"), "failed responses are returned without wrapping");
  assert(source.includes("watchXhrFailure(this)"), "XHR media requests learn failed hosts");
  assert(source.includes("stalledReloaded >= 2"), "reload cap");
  assert(!/\.currentTime\s*=/.test(source), "no seeking");
});

// Replays the owner's log (video IjkLmNo_QrS): progressive itag=18, mn holds opaque
// ids (no sn- servers), fvip=3; rr5 does not resolve, the redirector says 403.
const LOG_URL = "https://rr5---sn-2cde6gh9.googlevideo.com/videoplayback?expire=1&id=o-x&itag=18&mn=WXYza%2CBC0e2%2CGHijk&fvip=3&source=youtube";

Deno.test("log replay: progressive itag=18 with opaque mn tries other DNS names before the redirector", async () => {
  const api = fresh();
  assertEquals(api.googlevideoFallbacks(LOG_URL).map(host), ["r5---sn-2cde6gh9.googlevideo.com", "rr3---sn-2cde6gh9.googlevideo.com", "redirector.googlevideo.com"]);
  const calls = [];
  let t = 0;
  const result = await api.fetchWithFallback(LOG_URL, (u) => {
    calls.push(host(u)); t += 300;
    if (host(u).startsWith("rr5---") || host(u).startsWith("r5---")) return Promise.reject(dnsError());
    if (host(u) === "redirector.googlevideo.com") return Promise.resolve(ok(403));
    return Promise.resolve(ok(200));
  }, { now: () => t });
  assertEquals(calls, ["rr5---sn-2cde6gh9.googlevideo.com", "r5---sn-2cde6gh9.googlevideo.com", "rr3---sn-2cde6gh9.googlevideo.com"], "redirector never needed");
  assert(!result.exhausted && result.ms < 5000, "recovered in " + result.ms + "ms");
  assertEquals(host(api.mapBadHost(LOG_URL)), "rr3---sn-2cde6gh9.googlevideo.com", "next segment goes straight to rr3");
});

Deno.test("log replay: everything fails -> exhausted once, dead names skipped after the reload", async () => {
  const api = fresh();
  const fail = (u) => (host(u) === "redirector.googlevideo.com" ? Promise.resolve(ok(403)) : Promise.reject(dnsError()));
  const r = await api.fetchWithFallback(LOG_URL, fail);
  assert(r.exhausted || r.flagged, "exhausted or 403-flagged -> reload");
  // Reload hands back the same host; a different edge now works. Dead names are not retried first.
  const RELOADED = LOG_URL.replace("expire=1", "expire=2") + "&mn=sn-5fgh9jkl";
  const calls = [];
  const r2 = await api.fetchWithFallback(RELOADED.replace("mn=WXYza%2CBC0e2%2CGHijk&", ""), (u) => { calls.push(host(u)); return host(u).includes("sn-5fgh9jkl") ? Promise.resolve(ok(200)) : fail(u); });
  assertEquals(calls[0], "rr3---sn-5fgh9jkl.googlevideo.com", "first try is the new edge, not the dead rr5: " + calls);
  assert(!r2.exhausted, "recovered after reload");
});
