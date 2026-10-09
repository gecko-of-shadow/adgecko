import manifest from "../manifest.json" with { type: "json" };
import vendorSource from "../src/vendor/video-swap-new.user.js" with { type: "text" };
import licenseText from "../src/vendor/LICENSE-TwitchAdSolutions" with { type: "text" };
import vendorReadme from "../src/vendor/README.md" with { type: "text" };

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function assertEquals(actual, expected, label) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${label || "expected equal values"}\n${left}\n${right}`);
}

Deno.test("Twitch path is the vendored userscript only (no hand playlist rewrite)", () => {
  const twitch = manifest.content_scripts.find((script) =>
    (script.js || []).includes("src/vendor/video-swap-new.user.js")
  );
  assert(twitch, "Twitch content script loads the vendored userscript");
  assertEquals(twitch.js, ["src/vendor/video-swap-new.user.js"]);
  assertEquals(twitch.world, "MAIN");
  assertEquals(twitch.run_at, "document_start");
  assert(twitch.all_frames === true, "all_frames matches userscript page inject");
  assert(!manifest.content_scripts.some((s) => (s.js || []).includes("src/page.js")), "src/page.js removed");
  assert(!manifest.content_scripts.some((s) => (s.js || []).includes("src/playlist.js")), "src/playlist.js removed");
});

Deno.test("vendor provenance and MIT license are present", () => {
  assert(licenseText.includes("MIT License"), "MIT license file");
  assert(licenseText.includes("TwitchAdSolutions"), "copyright names TwitchAdSolutions");
  assert(vendorReadme.includes("video-swap-new.user.js"), "vendor README names the file");
  assert(vendorReadme.includes("Do not edit it here"), "vendor README says copy upstream only");
  assert(vendorSource.includes("// @namespace    https://github.com/pixeltris/TwitchAdSolutions"), "userscript namespace");
});
