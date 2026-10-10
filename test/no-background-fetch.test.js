import updateSource from "../src/general/update.js" with { type: "text" };
import exclusionsSource from "../src/general/exclusions.js" with { type: "text" };
import togglesSource from "../src/general/toggles.js" with { type: "text" };
import cosmeticSource from "../src/general/cosmetic.js" with { type: "text" };
import popupSource from "../src/popup.js" with { type: "text" };
import popupHtml from "../src/popup.html" with { type: "text" };
import debugSource from "../src/debug.js" with { type: "text" };
import bridgeSource from "../src/debug-bridge.js" with { type: "text" };
import youtubeSource from "../src/youtube.js" with { type: "text" };
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
  debugSource,
  bridgeSource,
  youtubeSource,
  exclusionsSource,
  togglesSource,
  cosmeticSource,
];

Deno.test("update policy is manual-only", () => {
  assertEquals(api.POLICY, "manual-only");
  assert(api.isManualOnly());
  assert(api.mayFetchLists({ userInitiated: true }), "explicit Update is allowed");
  assert(!api.mayFetchLists({ userInitiated: false }), "no implicit fetch");
  assert(!api.mayFetchLists({ userInitiated: true, background: true }), "no background fetch");
  assert(!api.mayFetchLists({ userInitiated: true, alarm: true }), "no alarm fetch");
  assert(!api.mayFetchLists({ userInitiated: true, idle: true }), "no idle fetch");
  assert(!api.mayFetchLists({ userInitiated: true, startup: true }), "no startup fetch");
  assert(!api.mayFetchLists({}), "empty context is refused");
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
  assert(api.isForbiddenAutoFetchUrl("https://easylist.to/easylist/easylist.txt"));
  assert(api.isForbiddenAutoFetchUrl("https://pgl.yoyo.org/adservers/serverlist.php"));
  assert(!api.isForbiddenAutoFetchUrl("https://www.twitch.tv/"));
});

Deno.test("popup stays local and does not schedule list downloads", () => {
  assert(!popupSource.includes("fetch("), "popup does not fetch");
  assert(!popupHtml.toLowerCase().includes("auto-update"));
  assert(!popupSource.includes("setInterval"), "popup does not poll for lists");
});
