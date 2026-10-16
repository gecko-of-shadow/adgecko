import source from "../src/youtube.js" with { type: "text" };

function assertEquals(a, b, label) {
  const l = JSON.stringify(a), r = JSON.stringify(b);
  if (l !== r) throw new Error(`${label || "not equal"}\n${l}\n${r}`);
}
function assert(c, label) { if (!c) throw new Error(label); }
function fresh() {
  const api = {};
  new Function(`${source}\nreturn installYoutubeAdblock;`)()(api);
  return api;
}
const BAD = "https://rr2---sn-h9jk2mn5.googlevideo.com/videoplayback?expire=1&id=o-abc&itag=243&mn=sn-h9jk2mn5%2Csn-n5pqrstu&fvip=2&sabr=1";
const host = (u) => new URL(u).hostname;
const dnsError = () => Object.assign(new TypeError("Failed to fetch"), { message: "net::ERR_NAME_NOT_RESOLVED" });
const ok = (status = 200) => ({ ok: status < 400, status, body: null, read: false });

Deno.test("fallback hosts come from mn and fvip, then the redirector", () => {
  const api = fresh();
  const hosts = api.googlevideoFallbacks(BAD).map(host);
  assertEquals(hosts, ["rr2---sn-n5pqrstu.googlevideo.com", "redirector.googlevideo.com"]);
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

Deno.test("all hosts failing is bounded (≤3 tries) and reported as exhausted", async () => {
  const api = fresh();
  let n = 0;
  let thrown = null;
  try {
    await api.fetchWithFallback(BAD, () => { n++; return Promise.reject(dnsError()); });
  } catch (e) { thrown = e; }
  assert(thrown && thrown.ytExhausted, "the error is marked exhausted so the page can reload the video");
  assertEquals(n, 3, "original + mn fallback + redirector, then stop");
  // 403 everywhere returns the last 403 instead of throwing
  const api2 = fresh();
  const r = await api2.fetchWithFallback(BAD, () => Promise.resolve(ok(403)));
  assertEquals(r.exhausted, true);
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
  assert(source.includes("if (!response || !response.ok) return response;"), "failed responses are returned without wrapping");
  assert(source.includes("watchXhrFailure(this)"), "XHR media requests learn failed hosts");
  assert(source.includes("stalledReloaded >= 2"), "reload cap");
  assert(!/\.currentTime\s*=/.test(source), "no seeking");
});
