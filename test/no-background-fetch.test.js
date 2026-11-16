import "../src/general/never-block-captcha.js";
import updateSource from "../src/general/update.js" with { type: "text" };
import popupSource from "../src/popup.js" with { type: "text" };
import popupHtml from "../src/popup.html" with { type: "text" };
import youtubeSource from "../src/youtube.js" with { type: "text" };
import backgroundSource from "../src/general-background.js" with { type: "text" };
import manifest from "../manifest.json" with { type: "json" };

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function assertEquals(actual, expected, label) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${label || "expected equal values"}\n${left}\n${right}`);
}

const api = {};
const install = new Function(`${updateSource}\nreturn installGeneralAdblockUpdate;`)();
install(api);

// update.js names forbidden list hosts on purpose (deny list). Do not scan it
// for those substrings — scan the code that must never phone them.
// Review 2026-11-16 WP-09 item 5: the scanned files come from the manifest
// content scripts, the script tags of the extension pages and the worker
// importScripts list, so a new live script is scanned too. Only update.js and
// general-background.js (the worker, which fetches the lists) are left out.
// The dead modules (exclusions.js, toggles.js, general/cosmetic.js) were
// removed in 0.3.6 with the owner's approval, so they are not scanned.
const ROOT = new URL("../", import.meta.url);
const LIST_FETCHERS = new Set(["src/general/update.js", "src/general-background.js"]);
function liveScriptPaths() {
  const files = new Set();
  for (const cs of manifest.content_scripts || []) for (const js of cs.js || []) files.add(js);
  for (const page of ["src/popup.html", "src/settings.html"]) {
    const html = Deno.readTextFileSync(new URL(page, ROOT));
    for (const m of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) files.add("src/" + m[1]);
  }
  const imports = /importScripts\(([^)]*)\)/.exec(backgroundSource);
  for (const m of (imports ? imports[1] : "").matchAll(/"([^"]+)"/g)) files.add("src/" + m[1]);
  return [...files].filter((f) => !LIST_FETCHERS.has(f));
}
const livePaths = liveScriptPaths();
const packagedJs = livePaths.map((f) => Deno.readTextFileSync(new URL(f, ROOT))).concat([
  popupSource,
  youtubeSource,
]);

Deno.test("the fetch scan covers the live scripts (manifest, pages, worker imports)", () => {
  for (const f of ["src/cosmetic.js", "src/settings/flags.js", "src/guards/clipboard.js", "src/guards/popups.js", "src/twitch-directory-ads.js", "src/settings.js", "src/popup.js", "src/feed/client.js", "src/threat/compile.js"]) {
    assert(livePaths.includes(f), "not scanned: " + f + " in " + JSON.stringify(livePaths));
  }
  assert(!livePaths.some((f) => LIST_FETCHERS.has(f)), "list fetchers are left out");
  assert(packagedJs.length === livePaths.length + 2 && packagedJs.every((t) => typeof t === "string" && t.length > 0), "each scanned file has text");
});

Deno.test("update policy is alarm refresh + manual, list hosts only", () => {
  assertEquals(api.POLICY, "alarm-and-manual");
  assertEquals(api.REFRESH_ALARM, "gecko-refresh");
  assertEquals(api.ALARM_PERIOD_MINUTES, 180);
  assert(api.MIN_INTERVAL_MS >= 12 * 60 * 60 * 1000, "at most every 12h");
  assertEquals(api.LIST_HOSTS, ["pgl.yoyo.org", "malware-filter.gitlab.io", "easylist.to", "ublockorigin.github.io", "easylist-downloads.adblockplus.org", "secure.fanboy.co.nz", "raw.githubusercontent.com", "filters.adtidy.org"]);
  for (const src of api.SOURCES) for (const m of src.mirrors) assert(api.isListUrl(m), "mirror on a list host: " + m);
  const allow = api.listAllowRule("abcdefghijklmnop");
  assert(allow.action.type === "allow" && allow.condition.initiatorDomains[0] === "abcdefghijklmnop" && allow.priority > 2000000, "list allow rule is extension-only and outranks blocks");
  for (const src of api.SOURCES) assert(api.isListUrl(src.url), "source on a list host: " + src.url);
  assert(!api.isListUrl("https://www.twitch.tv/"), "not a list host");
  assert(!api.isListUrl("https://evil.example/easylist.to"), "host match, not substring");
  assert(!api.isListUrl("http://easylist.to/easylist/easylist.txt"), "https only");
});

Deno.test("only the background worker fetches lists, and only list hosts", () => {
  assert(backgroundSource.includes("GU.isListUrl(url)"), "worker fetch is gated to list hosts");
  assert(!backgroundSource.includes("setInterval"), "no polling");
  // Owner decision 2026-11-02: one alarm drives refreshes (was: no alarms at all).
  const creates = backgroundSource.match(/chrome\.alarms\.create\(/g) || [];
  assert(creates.length >= 1 && /chrome\.alarms\.create\(REFRESH_ALARM,/.test(backgroundSource), "only the refresh alarm is created");
  // Review 2026-11-16 WP-16: plus one one-shot retry alarm after a failed run
  // (no periodInMinutes, so it never polls).
  assertEquals(api.RETRY_ALARM, "gecko-refresh-retry");
  assert(api.RETRY_DELAY_MINUTES > 30, "the retry passes the 30-min throttle");
  assert(/chrome\.alarms\.create\(GU\.RETRY_ALARM, \{ delayInMinutes: GU\.RETRY_DELAY_MINUTES \}/.test(backgroundSource), "retry alarm is one-shot");
  assert(!/chrome\.alarms\.create\((?!REFRESH_ALARM,|GU\.RETRY_ALARM, \{ delayInMinutes: GU\.RETRY_DELAY_MINUTES \})/.test(backgroundSource), "no other alarm");
});

Deno.test("manifest: alarms is the only background-scheduling permission", () => {
  const worker = (manifest.background || {}).service_worker;
  assertEquals(worker, "src/general-background.js", "only the icon and switch worker");
  const perms = manifest.permissions || [];
  assert(perms.includes("alarms"), "alarms permission for the 3 h refresh");
  assert(!perms.includes("unlimitedStorage"), "no unlimitedStorage for list caches");
  for (const p of ["tabs", "scripting", "webRequest", "activeTab", "downloads", "declarativeNetRequestFeedback"]) assert(!perms.includes(p), "no " + p);
});

Deno.test("packaged scripts do not auto-fetch filter lists", () => {
  const banned = [
    "easylist.to",
    "easylist-downloads.adblockplus.org",
    "filters.adtidy.org",
    "pgl.yoyo.org",
    "chrome.alarms",
    "browser.alarms",
  ];
  for (const text of packagedJs) {
    for (const bit of banned) {
      assert(!text.includes(bit), "must not mention " + bit);
    }
  }
});

Deno.test("popup stays local and does not schedule list downloads", () => {
  assert(!popupSource.includes("fetch("), "popup does not fetch");
  assert(!popupHtml.toLowerCase().includes("auto-update"));
  assert(!popupSource.includes("setInterval"), "popup does not poll for lists");
});
