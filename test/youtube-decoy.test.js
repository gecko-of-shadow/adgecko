import source from "../src/youtube.js" with { type: "text" };
function assert(c, label) { if (!c) throw new Error(label); }
function fresh() {
  const api = {};
  new Function(`${source}\nreturn installYoutubeAdblock;`)()(api);
  return api;
}
const NOW = Date.UTC(2026, 9, 16) ;
const url = (expire) => "https://rr3---sn-k2mn5pqr.googlevideo.com/videoplayback?expire=" + expire + "&ip=203.0.113.9&itag=18&mn=ZAbCd%2CE2GhI&fvip=3";

Deno.test("decoy: expire years in the past is a decoy (seen on the owner's PC)", () => {
  assert(fresh().isDecoyStreamUrl(url(1508648445), NOW), "2017 expire flagged");
});
Deno.test("decoy: real future / recent expiry is not a decoy", () => {
  const api = fresh();
  const s = Math.floor(NOW / 1000);
  assert(!api.isDecoyStreamUrl(url(s + 6 * 3600), NOW), "future ok");
  assert(!api.isDecoyStreamUrl(url(s - 3600), NOW), "clock skew of 1h ok");
  assert(!api.isDecoyStreamUrl(url("abc"), NOW), "non-numeric ignored");
  assert(!api.isDecoyStreamUrl("https://rr3---sn-k2mn5pqr.googlevideo.com/videoplayback?itag=18", NOW), "no expire ignored");
  assert(!api.isDecoyStreamUrl("https://www.youtube.com/videoplayback?expire=1508648445", NOW), "non-googlevideo ignored");
  assert(!api.isDecoyStreamUrl("not a url", NOW), "garbage ignored");
});
Deno.test("decoy: wiring in page hooks is bounded", () => {
  assert(/if \(api\.isDecoyStreamUrl\(url\)\) \{\s*onDecoyUrl\(url\);\s*return nativeFetch\(input, init\);/.test(source), "fetch skips failover for decoys");
  assert(source.includes("stalledReloaded >= 2") && /function onDecoyUrl[\s\S]*?stalledReloaded >= 2/.test(source), "decoy reload shares the 2-reload cap");
  assert(/decoyReloadMs: (\d+)/.exec(source)[1] < 1000, "reload well under 1s");
});
