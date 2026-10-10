import source from "../src/general/toggles.js" with { type: "text" };
import popupSource from "../src/popup.js" with { type: "text" };
import popupHtml from "../src/popup.html" with { type: "text" };

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function assertEquals(actual, expected, label) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${label || "expected equal values"}\n${left}\n${right}`);
}

const api = {};
const install = new Function(`${source}\nreturn installGeneralAdblockToggles;`)();
install(api);

Deno.test("general blocking defaults to on", () => {
  const state = api.emptyState();
  assertEquals(api.DEFAULT_ENABLED, true);
  assertEquals(state.enabled, true);
  assert(api.generalBlockingApplies(state, "https://example.com/"), "default on applies to ordinary sites");
});

Deno.test("master off disables general blocking on ordinary sites", () => {
  const off = api.setMasterEnabled(api.emptyState(), false);
  assertEquals(off.enabled, false);
  assert(!api.generalBlockingApplies(off, "https://example.com/news"), "master off");
  assert(!api.generalBlockingApplies(off, "https://shop.example/"), "master off other origin");
});

Deno.test("allow this page overrides master on for that origin only", () => {
  let state = api.emptyState();
  state = api.allowPage(state, "https://broken.example/path");
  assert(api.isPageAllowed(state, "https://broken.example/other"));
  assert(!api.generalBlockingApplies(state, "https://broken.example/"));
  assert(api.generalBlockingApplies(state, "https://other.example/"), "other origins still blocked");
  state = api.revokePage(state, "https://broken.example/");
  assert(api.generalBlockingApplies(state, "https://broken.example/"));
});

Deno.test("stored JSON round-trips and refuses junk", () => {
  const saved = api.serialize(api.allowPage(api.setMasterEnabled(api.emptyState(), true), "https://a.example"));
  const parsed = api.parseStored(saved);
  assertEquals(parsed.enabled, true);
  assertEquals(parsed.allowedOrigins, ["https://a.example"]);
  assertEquals(api.parseStored("{").enabled, true, "corrupt storage falls back to default on");
  assertEquals(api.parseStored(null).enabled, true);
});

Deno.test("master toggle stays separate from the debug switch", () => {
  assert(popupHtml.includes("debug-on"), "debug on stays");
  assert(popupHtml.includes("debug-off"), "debug off stays");
  assert(popupSource.includes('sendDebug("set", true)'), "debug set stays");
  assert(popupHtml.includes("general-enabled"), "general master is its own control");
  assert(!popupSource.includes("kick.js"), "popup does not load Kick playback");
  assert(!popupSource.includes("youtube.js"), "popup does not load YouTube playback");
});

Deno.test("toggle helpers never gate stream playback scripts", () => {
  assert(!source.includes("youtube.js"), "toggles do not import youtube");
  assert(!source.includes("video-swap-new"), "toggles do not import twitch vendor");
  assert(!source.includes("kick.js"), "toggles do not import kick");
  assertEquals(api.STORAGE_KEY, "general-adblock");
});
