import popupSource from "../src/popup.js" with { type: "text" };
import popupHtml from "../src/popup.html" with { type: "text" };
import settingsSource from "../src/general-settings.js" with { type: "text" };
import backgroundSource from "../src/general-background.js" with { type: "text" };
import manifest from "../manifest.json" with { type: "json" };
import vendorSource from "../src/vendor/video-swap-new.user.js" with { type: "text" };
import youtubeSource from "../src/youtube.js" with { type: "text" };
import debugSource from "../src/debug.js" with { type: "text" };

function assert(condition, label) {
  if (!condition) throw new Error(label || "assert failed");
}

function assertEquals(actual, expected, label) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${label || "expected equal"}\n${left}\n${right}`);
}

Deno.test("general popup defaults on and never auto-fetches lists", () => {
  assert(popupHtml.includes('id="general-enabled"'), "master switch present");
  assert(/id="general-enabled"[^>]*checked|checked[^>]*id="general-enabled"/.test(popupHtml), "master defaults checked");
  assert(popupSource.includes("generalEnabled: true") || popupSource.includes("generalEnabled: true,"), "storage default ON");
  assert(popupSource.includes("updateLists") || popupHtml.includes("Update lists"), "manual Update control");
  assert(!popupSource.includes("chrome.alarms"), "no alarms in popup");
  assert(!backgroundSource.includes("chrome.alarms"), "no alarms in background");
  assert(!backgroundSource.includes("setInterval"), "no interval polling for lists");
  assert(backgroundSource.includes("manual"), "update path is manual");
});

Deno.test("allow-this-page skips Twitch YouTube Kick hosts", () => {
  assert(settingsSource.includes("twitch\\.tv") || settingsSource.includes("twitch.tv"), "settings know twitch");
  assert(settingsSource.includes("youtube\\.com") || settingsSource.includes("youtube.com"), "settings know youtube");
  assert(settingsSource.includes("kick\\.com") || settingsSource.includes("kick.com"), "settings know kick");
  assert(popupSource.includes("HARD_EXCLUDE_HOST_RE"), "popup hard-excludes streams");
  assert(popupHtml.includes("Allow this page"), "allow control labeled");
});

Deno.test("glowing-eyes icon variants are packaged and wired", () => {
  assert(popupHtml.includes("icon48-working.png"), "popup uses working glow icon");
  assert(popupSource.includes("icon48-off.png"), "popup can dim eyes when off");
  assertEquals(manifest.action.default_icon["48"], "icons/icon48-working.png");
  assert(backgroundSource.includes("icon48-working.png"), "worker sets working icon");
  assert(backgroundSource.includes("icon48-off.png"), "worker sets off icon");
});

Deno.test("playback files stay untouched by general UI APIs", () => {
  for (const [name, source] of [
    ["vendor", vendorSource],
    ["youtube", youtubeSource],
    ["debug", debugSource],
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
  assert(backgroundSource.includes("importScripts(\"general-settings.js\")"), "worker loads shared settings");
});
