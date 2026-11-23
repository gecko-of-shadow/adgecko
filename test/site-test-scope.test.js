// Site-breakage job (whatbox.ca Apps panel, platform.claude.com sign-in): the
// popup's second test ("Test with the ad lists off") is an Allow of the page's
// own host with a question. Its scope line is built from the worker's
// siteInfo (features[].on) and says what is off and what stays on on the page
// itself, and that frames from other addresses keep their own filters. A "No"
// says only "likely not the cause" and points to chrome://extensions. This
// file proves those sentences against the real worker rules and the real
// feature registry, so the popup cannot promise more than the rules do:
//   - the page: the Allow turns off the ad lists for its own requests, ad box
//     hiding and the pop-up guard; the malware list (priority above the
//     Allow) and the clipboard guard (keepOnAllow) stay;
//   - a frame from another address, also a sibling subdomain: the Allow
//     matches by initiator and every content script resolves the frame's own
//     host, so the ad lists, hiding and the guards all stay on in it;
//   - the page guards stay installed: they read their flag at use time, so no
//     switch removes them (only chrome://extensions does).
import "../src/settings/features.js";
import general from "../src/rules/general-network.json" with { type: "json" };
import threat from "../src/rules/threat-network.json" with { type: "json" };
import popupSource from "../src/popup.js" with { type: "text" };
import clipboardSource from "../src/guards/clipboard.js" with { type: "text" };
import popupsSource from "../src/guards/popups.js" with { type: "text" };
import { evaluate } from "./fixtures/dnr-matcher.js";
import { loadWorker, settle } from "./fixtures/fake-chrome-worker.js";

function assert(c, l) { if (!c) throw new Error(l); }

const F = globalThis.GeckoFeatures;
const SITE = "www.news.example";
const FRAME = "widget.example.org";
const SIBLING = "login.news.example";
const CHILD = "login.www.news.example";

// A plain list rule of the packed set: block, priority 1, request domains only.
const LIST_RULE = general.find((r) => r.action.type === "block" && r.priority === 1 && r.condition.requestDomains &&
  Object.keys(r.condition).every((k) => k === "requestDomains" || (k === "resourceTypes" && r.condition.resourceTypes.includes("script"))));
const AD_HOST = LIST_RULE.condition.requestDomains[0];
const BAD_HOST = threat[0].condition.requestDomains[0];

async function rulesWithAllow() {
  const w = loadWorker({ store: { settings: { v: 1, enabled: true, features: {} }, siteOverrides: { [SITE]: { enabled: false } } } });
  await settle(150);
  await w.send({ source: "adgecko-general", type: "applyGeneralState" });
  await settle(150);
  const allow = w.dnr.dynamic.filter((r) => r.action.type === "allow" && r.priority === 10000);
  return { allow, rules: (w.dnr.staticOn ? general : []).concat(threat, w.dnr.dynamic) };
}

const FRAMES_LINE = (popupSource.match(/const SCOPE_FRAMES = "([^"]+)";/) || [])[1] || "";
const NAMED = [...((popupSource.match(/const SCOPE_NAMES = \[([\s\S]*?)\];/) || [])[1] || "").matchAll(/\["(\w+)", "([^"]+)"\]/g)].map((m) => m[1]);
const VERDICT = (popupSource.match(/const NOTE_LISTS_NO = "([^"]+)";/) || [])[1] || "";

Deno.test("second test: the Allow turns off the ad lists only for what the page itself loads", async () => {
  assert(AD_HOST && BAD_HOST, "fixtures found");
  const { allow, rules } = await rulesWithAllow();
  assert(allow.length === 1 && allow[0].condition.initiatorDomains.join() === SITE, "one Allow rule for the site: " + JSON.stringify(allow));
  const v = (frames, host) => evaluate(rules, { url: "https://" + host + "/x.js", type: "script", frames }).action;
  assert(v(["other.example"], AD_HOST) === "block", "the ad host is blocked on other sites");
  assert(v([SITE], AD_HOST) === "allow", "off: the ad lists for the page's own requests");
  assert(v([SITE, FRAME], AD_HOST) === "block", "still on: the ad lists inside a frame from another site");
  assert(v([SITE, SIBLING], AD_HOST) === "block", "still on: the ad lists inside a frame from a sibling subdomain");
  assert(v([SITE], BAD_HOST) === "block", "still on: malware blocking");
  assert(v([SITE, CHILD], AD_HOST) === "allow", "a frame under the tested host follows the page (initiatorDomains covers subdomains)");
  assert(FRAMES_LINE === "Frames from addresses outside {host} keep their own filters.", "the popup names the host: " + FRAMES_LINE);
  assert(VERDICT.includes("Frames from addresses outside {host} kept their own filters."), "the verdict names the host: " + VERDICT);
});

Deno.test("second test: on the page hiding and the pop-up guard are off and the clipboard guard stays; in other frames all stay on", () => {
  const settings = { v: 1, enabled: true, features: { guardPopups: true } };
  const r = F.resolve(settings, { [SITE]: { enabled: false } }, SITE);
  assert(r.network === false && r.cosmetic === false && r.guardPopups === false, "off: " + JSON.stringify(r));
  assert(r.guardClipboard === true && r.threatTier === true, "still on: the clipboard guard (keepOnAllow) and malware blocking");
  for (const host of [FRAME, SIBLING]) {
    const f = F.resolve(settings, { [SITE]: { enabled: false } }, host);
    assert(f.network && f.cosmetic && f.guardPopups && f.guardClipboard, "a frame from " + host + " keeps its filters: " + JSON.stringify(f));
  }
  const child = F.resolve(settings, { [SITE]: { enabled: false } }, CHILD);
  assert(!child.network && !child.cosmetic && !child.guardPopups, "a frame under the tested host follows the page, so the line says outside: " + JSON.stringify(child));
  // The scope line names each of these switches from siteInfo, so it reports
  // their real state (test/popup-allow-page.test.js checks the sentences).
  for (const id of ["network", "threatTier", "cosmetic", "guardClipboard", "guardPopups"]) assert(NAMED.includes(id), "the scope line names " + id + ": " + NAMED.join());
});

Deno.test("second test: the page guards stay installed whatever the switches say, so the last step is chrome://extensions", () => {
  for (const [name, src] of [["clipboard", clipboardSource], ["popups", popupsSource]]) {
    assert(/read at use time/.test(src), name + ": the guard reads its flag at use time (its header says so)");
  }
  assert(VERDICT.includes("likely not the cause") && VERDICT.includes("chrome://extensions"), "the verdict hedges and names the last step: " + VERDICT);
  assert(!/is not the cause|not Adgecko/i.test(VERDICT), "no claim that Adgecko is cleared");
});
