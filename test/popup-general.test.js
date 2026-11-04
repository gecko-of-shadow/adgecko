import popupSource from "../src/popup.js" with { type: "text" };
import popupHtml from "../src/popup.html" with { type: "text" };
import settingsSource from "../src/general-settings.js" with { type: "text" };
import backgroundSource from "../src/general-background.js" with { type: "text" };
import manifest from "../manifest.json" with { type: "json" };
import vendorSource from "../src/vendor/video-swap-new.user.js" with { type: "text" };
import youtubeSource from "../src/youtube.js" with { type: "text" };

function assert(condition, label) {
  if (!condition) throw new Error(label || "assert failed");
}

function assertEquals(actual, expected, label) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${label || "expected equal"}\n${left}\n${right}`);
}

Deno.test("general popup defaults on and never auto-fetches lists", () => {
  // Redesign (design rules, 2026-11-02): the global switches and "Update lists"
  // live on the settings page (the gear); the popup has none.
  assert(!popupHtml.includes('id="general-enabled"') && !popupHtml.includes("Update lists"), "no master switch / update button in the popup");
  const settingsHtml = Deno.readTextFileSync(new URL("../src/settings.html", import.meta.url));
  assert(settingsHtml.includes('id="master"') && settingsHtml.includes('id="update-lists"'), "they are on the settings page");
  assert(popupSource.includes("generalEnabled: true") || popupSource.includes("generalEnabled: true,"), "storage default ON");
  assert(!popupSource.includes("chrome.alarms"), "no alarms in popup");
  // The worker's single 3 h "gecko-refresh" alarm is allowed (owner decision 2026-11-02).
  assert(!/chrome\.alarms\.create\((?!REFRESH_ALARM,)/.test(backgroundSource), "only the refresh alarm in background");
  assert(!backgroundSource.includes("setInterval"), "no interval polling for lists");
  assert(backgroundSource.includes("manual"), "update path is manual");
});

// Block H: the stream-site list lives only in src/settings/features.js. The
// worker's settings module asks it (no allow rule for a stream host), and the
// popup asks the worker ("siteInfo") because popup.html loads only popup.js.
Deno.test("allow-this-page skips Twitch YouTube Kick hosts", async () => {
  await import("../src/settings/features.js");
  const GS = new Function("self", `${settingsSource}\nreturn self.GeneralSettings;`)(globalThis);
  for (const host of ["twitch.tv", "www.youtube.com", "kick.com", "cdn.kickusercontent.com"]) assert(GS.isHardExcludedHost(host), "excluded " + host);
  assert(!GS.isHardExcludedHost("news.example.com"), "ordinary host");
  assert(settingsSource.includes("isStreamHost") && !/twitch\\?\.tv/.test(settingsSource), "settings module uses the registry, no own list");
  assert(popupSource.includes('notifyBackground("siteInfo"') && !/twitch\\?\.tv/.test(popupSource), "popup asks the worker, no own list");
  assert(popupHtml.includes("Allow this site"), "allow control labeled");
});

Deno.test("working and off icon variants are packaged and wired", () => {
  assert(popupHtml.includes("icon48-working.png"), "popup uses the working icon");
  assert(popupSource.includes("icon48-off.png"), "popup can show the off icon");
  for (const size of [16, 48, 128]) assertEquals(manifest.action.default_icon[size], `icons/icon${size}-working.png`);
  assert(backgroundSource.includes("icon48-working.png"), "worker sets working icon");
  assert(backgroundSource.includes("icon48-off.png"), "worker sets off icon");
});

Deno.test("playback files stay untouched by general UI APIs", () => {
  for (const [name, source] of [
    ["vendor", vendorSource],
    ["youtube", youtubeSource],
  ]) {
    assert(!source.includes("chrome."), `${name} has no chrome.*`);
    assert(!source.includes("generalEnabled"), `${name} does not read general master`);
    assert(!source.includes("declarativeNetRequest"), `${name} does not use DNR`);
  }
});

Deno.test("storage key contract matches settings module", () => {
  assert(settingsSource.includes('enabled: "generalEnabled"'), "enabled key");
  assert(settingsSource.includes('allowedOrigins: "generalAllowedOrigins"'), "allow key");
  assert(settingsSource.includes('listUpdateRequestAt: "generalListUpdateRequestAt"'), "manual update flag");
  assert(settingsSource.includes('RULESET_ID = "general"'), "ruleset id general");
  // general/filter-options.js (shared option table) must load before update.js.
  // The threat tier (public-suffix data, protected hosts, compiler) loads before update.js too.
  // Then the signed-feed client (dormant until configured).
  // Block H: the feature registry loads first.
  assert(backgroundSource.replace(/\s+/g, " ").includes("importScripts(\"settings/features.js\", \"general-settings.js\", \"general/filter-options.js\", \"threat/psl.js\", \"threat/protected-hosts.js\", \"threat/compile.js\", \"general/update.js\", \"general/cosmetic-parse.js\", \"feed/config.js\", \"feed/keys.js\", \"feed/canonical.js\", \"feed/schema.js\", \"feed/verify.js\", \"feed/compile.js\", \"feed/client.js\")"), "worker loads shared settings");
});
