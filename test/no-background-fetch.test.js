import updateSource from "../src/general/update.js" with { type: "text" };
import exclusionsSource from "../src/general/exclusions.js" with { type: "text" };
import togglesSource from "../src/general/toggles.js" with { type: "text" };
import cosmeticSource from "../src/general/cosmetic.js" with { type: "text" };
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
const packagedJs = [
  popupSource,
  youtubeSource,
  exclusionsSource,
  togglesSource,
  cosmeticSource,
];

Deno.test("update policy is startup refresh + manual, list hosts only", () => {
  assertEquals(api.POLICY, "startup-and-manual");
  assertEquals(api.STARTUP_DELAY_MS, 5000);
  assert(api.MIN_INTERVAL_MS >= 12 * 60 * 60 * 1000, "at most every 12h");
  assertEquals(api.LIST_HOSTS, ["pgl.yoyo.org", "malware-filter.gitlab.io", "easylist.to", "ublockorigin.github.io", "easylist-downloads.adblockplus.org", "secure.fanboy.co.nz"]);
  for (const src of api.SOURCES) for (const m of src.mirrors) assert(api.isListUrl(m), "mirror on a list host: " + m);
  const allow = api.listAllowRule("abcdefghijklmnop");
  assert(allow.action.type === "allow" && allow.condition.initiatorDomains[0] === "abcdefghijklmnop" && allow.priority > 2000000, "list allow rule is extension-only and outranks blocks");
  for (const src of api.SOURCES) assert(api.isListUrl(src.url), "source on a list host: " + src.url);
  assert(!api.isListUrl("https://www.twitch.tv/"), "not a list host");
  assert(!api.isListUrl("https://evil.example/easylist.to"), "host match, not substring");
});

Deno.test("only the background worker fetches lists, and only list hosts", () => {
  assert(backgroundSource.includes("GU.isListUrl(url)"), "worker fetch is gated to list hosts");
  assert(!backgroundSource.includes("setInterval"), "no polling");
  assert(!backgroundSource.includes("chrome.alarms"), "no alarms");
});

Deno.test("manifest has no background worker for list fetching", () => {
  const worker = (manifest.background || {}).service_worker;
  assertEquals(worker, "src/general-background.js", "only the icon and switch worker");
  const perms = manifest.permissions || [];
  assert(!perms.includes("alarms"), "no alarms permission");
  assert(!perms.includes("unlimitedStorage"), "no unlimitedStorage for list caches");
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
