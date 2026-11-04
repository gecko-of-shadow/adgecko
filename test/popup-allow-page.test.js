// Runs the real popup.js against the real cosmetic.js content script, with a fake
// Chrome that behaves like ours: no "tabs" permission, so tabs.query leaves tab.url out.
// cosmetic.js asks the registry (listed before it in the manifest) which hosts are stream sites.
import "../src/settings/features.js";
import popupSource from "../src/popup.js" with { type: "text" };
import popupHtml from "../src/popup.html" with { type: "text" };
import cosmeticSource from "../src/cosmetic.js" with { type: "text" };
import manifest from "../manifest.json" with { type: "json" };

function assert(condition, label) {
  if (!condition) throw new Error(label || "assert failed");
}

function assertEquals(actual, expected, label) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${label || "expected equal"}\n${left}\n${right}`);
}

// Like a browser: cosmetic.js reads location, window and chrome, and start() gets no options.
const loadCosmetic = new Function(
  "location",
  "window",
  "chrome",
  "fetch",
  `${cosmeticSource}\nreturn installCosmeticHide;`,
);
const POPUP_IDS = [...popupHtml.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
const NO_RECEIVER = "Could not establish connection. Receiving end does not exist.";

function fakeElement() {
  const listeners = {};
  return {
    textContent: "",
    hidden: false,
    disabled: false,
    focus() {},
    checked: false,
    src: "",
    dataset: {},
    attrs: {},
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
    addEventListener(type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    async fire(type) {
      for (const fn of listeners[type] || []) await fn({ type });
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// Starts cosmetic.js in one frame and returns that frame's message listeners.
function startFrame(href, isTop) {
  const listeners = [];
  const topWindow = {};
  const win = isTop ? topWindow : { top: topWindow };
  if (isTop) topWindow.top = topWindow;
  const url = new URL(href);
  const pageChrome = {
    runtime: {
      lastError: undefined,
      getURL: (path) => "chrome-extension://test/" + path,
      onMessage: { addListener(fn) { listeners.push(fn); } },
    },
    storage: {
      local: { get: (_keys, cb) => cb({}) },
      onChanged: { addListener() {} },
    },
  };
  const page = {};
  loadCosmetic({ href, hostname: url.hostname }, win, pageChrome, () => Promise.resolve({ ok: false }))(page);
  page.start();
  return listeners;
}

// pageHref: the page in the active tab, with an ad iframe from another origin inside it.
// cosmetic.js only starts on http(s) pages that are not stream sites (manifest matches +
// exclude_matches); `scripted: false` models a page with no content script (opened before
// the extension loaded, chrome://). `answerLater` holds the reply until `answer()`.
// The fake worker answers "siteInfo" from the registry (like src/general-background.js)
// and "tabSignal" from `signal`.
async function openPopup({ pageHref, scripted = true, stored = {}, answerLater = false, signal = null, storage: shared = null, streamTop = false, failSet = null, failRemove = false }) {
  const storage = shared || Object.assign({}, stored);
  const F = globalThis.GeckoFeatures;
  // frameId -> listeners. The subframe comes first, so it would win a broadcast.
  const frames = new Map();
  if (scripted) {
    frames.set(3, startFrame("https://ads.example.net/slot?id=9", false));
    frames.set(0, startFrame(pageHref, true));
  }
  // On Twitch/YouTube/Kick cosmetic.js never runs; settings/flags.js answers in the top frame.
  if (streamTop) frames.set(0, [(msg, _s, reply) => { if (msg && msg.type === "pageOrigin") reply({ origin: new URL(pageHref).origin }); }]);
  const sent = [];
  const background = [];
  let pending = null;
  const siteInfo = (origin) => {
    let host = "";
    try { host = new URL(origin).hostname; } catch { return { ok: true, host: "", features: [] }; }
    const o = storage.siteOverrides || {};
    const stream = F.isStreamHost(host);
    const features = F.FEATURES.filter((f) => f.sites.includes("all") || (f.sites.includes("ordinary") ? !stream : f.sites.some((d) => host === d || host.endsWith("." + d))))
      .map((f) => ({ id: f.id, perSite: f.perSite, apply: f.apply, available: f.id !== "guardMiners" }));
    return { ok: true, host, overrideHost: host, stream, siteEnabled: !(o[host] && o[host].enabled === false), enabled: true, features };
  };

  const chrome = {
    runtime: {
      lastError: undefined,
      getManifest: () => manifest,
      sendMessage(msg, cb) {
        background.push(msg);
        if (msg.type === "siteInfo") return cb(siteInfo(msg.origin));
        if (msg.type === "tabSignal") return cb({ ok: true, signal });
        cb({ ok: true });
      },
      openOptionsPage() { background.push({ type: "openOptionsPage" }); },
    },
    storage: {
      local: {
        get(keys, cb) {
          const out = {};
          for (const k of keys) if (k in storage) out[k] = structuredClone(storage[k]);
          cb(out);
        },
        set(patch, cb) {
          if (failSet && failSet.on) {
            chrome.runtime.lastError = { message: "Resource::kQuotaBytes quota exceeded" };
            cb();
            chrome.runtime.lastError = undefined;
            return;
          }
          Object.assign(storage, structuredClone(patch));
          cb();
        },
        remove(keys, cb) {
          if (failRemove) {
            chrome.runtime.lastError = { message: "remove failed" };
            cb();
            chrome.runtime.lastError = undefined;
            return;
          }
          for (const k of [].concat(keys)) delete storage[k];
          cb();
        },
      },
    },
    tabs: {
      // Chrome without "tabs" (or host access to the page): id yes, url no.
      query(_info, cb) {
        cb([{ id: 7, windowId: 1, active: true }]);
      },
      sendMessage(tabId, msg, options, cb) {
        if (typeof options === "function") {
          cb = options;
          options = {};
        }
        sent.push({ tabId, msg, options });
        const targets = tabId !== 7
          ? []
          : options && typeof options.frameId === "number"
          ? [frames.get(options.frameId) || []]
          : [...frames.values()];
        let answered = false;
        let reply;
        for (const listeners of targets) {
          for (const fn of listeners) {
            fn(msg, { id: "extension" }, (r) => {
              if (!answered) {
                answered = true;
                reply = r;
              }
            });
          }
        }
        const deliver = () => {
          chrome.runtime.lastError = answered ? undefined : { message: NO_RECEIVER };
          cb(reply);
          chrome.runtime.lastError = undefined;
        };
        if (answerLater) pending = deliver;
        else deliver();
      },
    },
  };

  const elements = {};
  for (const id of POPUP_IDS) elements[id] = fakeElement();
  elements.welcome.hidden = true;
  elements["fix-ask"].hidden = true;
  const rootAttrs = {};
  const document = {
    getElementById: (id) => elements[id] || null,
    documentElement: { setAttribute: (k, v) => { rootAttrs[k] = v; }, removeAttribute: (k) => { delete rootAttrs[k]; } },
  };

  new Function("document", "chrome", popupSource)(document, chrome);
  await settle();
  await settle();
  await settle();
  return {
    el: elements,
    button: elements["allow-site"],
    status: elements["site-status"],
    note: elements["page-status"],
    rootAttrs,
    frames,
    storage,
    sent,
    background,
    async answer() {
      assert(pending, "popup asked the page");
      pending();
      for (let i = 0; i < 4; i++) await settle();
    },
  };
}

Deno.test("Allow this site works on a normal https page without the tabs permission", async () => {
  const p = await openPopup({ pageHref: "https://news.example.com/story?id=1#top" });
  assertEquals(p.sent.map((s) => s.options), [{ frameId: 0 }], "popup asks only the top frame");
  assertEquals(p.frames.get(3).length, 0, "the ad iframe does not listen");
  assertEquals(p.el["site-host"].textContent, "news.example.com");
  assertEquals(p.status.textContent, "✅ Protected");
  assertEquals(p.button.disabled, false, "button is clickable");
  assertEquals(p.button.textContent, "Allow this site");
  assertEquals(p.button.attrs["aria-pressed"], "false");

  await p.button.fire("click");
  // The popup writes the site switch to siteOverrides (keyed by host);
  // the worker derives generalAllowedOrigins from it.
  assertEquals(p.storage.siteOverrides, { "news.example.com": { enabled: false } }, "host saved, path dropped");
  assertEquals(p.storage.generalAllowedOrigins, undefined, "legacy key left to the worker");
  assertEquals(p.button.textContent, "Block again");
  assertEquals(p.button.attrs["aria-pressed"], "true");
  assertEquals(p.status.textContent, "Allowed – not blocking here");
  assert(p.background.some((m) => m.type === "applyGeneralState"), "rules re-applied after the click");
  assertEquals(p.el["fix-site"].disabled, true, "Fix is off while the site is allowed");
  // Malware rules and stream-site code outrank Allow, so no "nothing is blocked" claim.
  assertEquals(p.el["fix-note"].textContent, "", "no extra claim under Fix");
});

Deno.test("a site can be blocked again, http pages work, and the off state is honest", async () => {
  const allowed = await openPopup({
    pageHref: "http://shop.example.org:8080/cart",
    stored: { settings: { v: 1, enabled: true, features: {} }, siteOverrides: { "shop.example.org": { enabled: false }, "other.example": { enabled: false } } },
  });
  assertEquals(allowed.button.disabled, false, "allowed page still answers");
  assertEquals(allowed.button.textContent, "Block again");
  await allowed.button.fire("click");
  assertEquals(allowed.storage.siteOverrides, { "other.example": { enabled: false } }, "only this host removed");
  assertEquals(allowed.status.textContent, "✅ Protected");

  // Not migrated yet (worker not run): the old allowed-origins list still shows.
  const legacy = await openPopup({ pageHref: "https://other.example/x", stored: { generalAllowedOrigins: ["https://other.example"] } });
  assertEquals(legacy.button.textContent, "Block again");

  // The whole extension switched off in settings: no "Protected" claim.
  const off = await openPopup({ pageHref: "https://news.example.com/", stored: { settings: { v: 1, enabled: false, features: {} } } });
  assertEquals(off.status.textContent, "Off – turned off in settings");
  assertEquals(off.button.disabled, true);
});

// Same trigger as the toolbar icon (generalEnabled = master switch AND list
// blocking): the lit header must not sit next to a grey toolbar icon.
Deno.test("the header icon and glow follow list blocking, like the toolbar icon", async () => {
  const icon = (p) => [p.el["brand-icon"].src, p.el["brand-icon"].dataset.glow];
  const WORKING = ["../icons/icon48-working.png", "on"];
  const OFF = ["../icons/icon48-off.png", "off"];
  const pageHref = "https://news.example.com/";
  const on = { v: 1, enabled: true, features: {} };
  assertEquals(icon(await openPopup({ pageHref, stored: { settings: on } })), WORKING, "all on");
  assertEquals(icon(await openPopup({ pageHref, stored: { settings: on, generalEnabled: true } })), WORKING, "mirror says on");
  assertEquals(icon(await openPopup({ pageHref, stored: { settings: { v: 1, enabled: true, features: { network: false } }, generalEnabled: false } })), OFF, "lists off");
  assertEquals(icon(await openPopup({ pageHref, stored: { settings: { v: 1, enabled: false, features: {} }, generalEnabled: false } })), OFF, "master off");
});

Deno.test("a page with no content script stays greyed out and says why", async () => {
  const p = await openPopup({ pageHref: "https://news.example.com/", scripted: false });
  assertEquals(p.button.disabled, true);
  assertEquals(p.el["fix-site"].disabled, true);
  assertEquals(p.el["site-host"].textContent, "No web page");
  assert(p.note.textContent.startsWith("Open a normal http(s) page"), "explains the greyed button");
  assert(p.note.textContent.includes("Reload it"), "tabs open from before an install or update need a reload");
  await p.button.fire("click");
  assertEquals(p.storage.siteOverrides, undefined, "nothing saved");

  const stream = await openPopup({ pageHref: "https://www.twitch.tv/somechannel" });
  assertEquals(stream.button.disabled, true, "stream sites have no general script to answer");
});

Deno.test("a slow page doesn't hold up the rest of the popup; the welcome card shows once", async () => {
  const p = await openPopup({ pageHref: "https://busy.example.com/", answerLater: true });
  assertEquals(p.el.welcome.hidden, false, "first open: the You're protected card");
  assertEquals(p.storage.popupWelcomed, true, "never again");
  assertEquals(p.button.disabled, true);
  assertEquals(p.note.textContent, "Checking this page…");
  await p.button.fire("click");
  assertEquals(p.storage.siteOverrides, undefined, "a click while waiting saves nothing");
  await p.answer();
  assertEquals(p.button.disabled, false, "button turns on once the page answers");
  assertEquals(p.status.textContent, "✅ Protected");
  await p.el["welcome-close"].fire("click");
  assertEquals(p.el.welcome.hidden, true, "dismissible");
  const again = await openPopup({ pageHref: "https://busy.example.com/", stored: { popupWelcomed: true } });
  assertEquals(again.el.welcome.hidden, true, "second open: no card");
});

Deno.test("Fix this site turns off hide rules and page guards for this site only, asks, and No undoes exactly that", async () => {
  const storage = { settings: { v: 1, enabled: true, features: {} }, siteOverrides: { "news.example.com": { features: { guardPopups: true } }, "other.example": { enabled: false } } };
  const p = await openPopup({ pageHref: "https://news.example.com/a", storage });
  assertEquals(p.el["fix-site"].disabled, false);
  await p.el["fix-site"].fire("click");
  assertEquals(storage.siteOverrides["news.example.com"], { features: { guardPopups: false, cosmetic: false, guardClipboard: false } }, "extra filters off, lists untouched");
  assertEquals(storage.siteOverrides["other.example"], { enabled: false }, "other sites untouched");
  assertEquals(storage.popupFix.host, "news.example.com");
  assertEquals(storage.popupFix.prev, { cosmetic: null, guardClipboard: null, guardPopups: true });
  assertEquals(p.el["fix-ask"].hidden, false, "Did that fix it?");
  assertEquals(p.el["fix-site"].hidden, true);
  assert(p.background.some((m) => m.type === "applyGeneralState"), "rules applied");

  // The popup closed (the visitor reloaded the page); it asks again on the next open.
  const q = await openPopup({ pageHref: "https://news.example.com/b", storage });
  assertEquals(q.el["fix-ask"].hidden, false, "question survives closing the popup");
  // Meanwhile the visitor changed one switch on the settings page: kept.
  storage.siteOverrides["news.example.com"].features.network = false;
  const r = await openPopup({ pageHref: "https://news.example.com/b", storage });
  await r.el["fix-no"].fire("click");
  assertEquals(storage.siteOverrides["news.example.com"], { features: { guardPopups: true, network: false } }, "No restores exactly what Fix changed");
  assertEquals(storage.popupFix, undefined);
  assertEquals(r.el["fix-ask"].hidden, true);
  assert(/use Allow this site/.test(r.el["fix-note"].textContent), "offers Allow this site");

  // Yes keeps the fix and forgets the question.
  await r.el["fix-site"].fire("click");
  await r.el["fix-yes"].fire("click");
  assertEquals(storage.popupFix, undefined);
  assertEquals(storage.siteOverrides["news.example.com"].features.cosmetic, false, "fix kept");
  // A question for another site is not shown here.
  storage.popupFix = { host: "elsewhere.example", at: Date.now(), prev: {} };
  const s = await openPopup({ pageHref: "https://news.example.com/c", storage });
  assertEquals(s.el["fix-ask"].hidden, true);
});

Deno.test("Fix on a stream site turns off only our own helpers there; the dot's message shows under Show more; theme applies", async () => {
  const storage = { settings: { v: 1, enabled: true, features: {} }, uiTheme: "contrast" };
  const p = await openPopup({ pageHref: "https://news.example.com/", storage, signal: { kind: "clipboard", at: 1 } });
  assertEquals(p.rootAttrs["data-theme"], "contrast", "manual high-contrast theme");
  assert(/clipboard/.test(p.el["signal-line"].textContent), "says what the dot was about");
  assert(p.background.some((m) => m.type === "tabSignal" && m.tabId === 7), "asks the worker (which clears the dot)");
  assert(/^Version /.test(p.el["version-line"].textContent), "version under Show more");
  await p.el["open-settings"].fire("click");
  assert(p.background.some((m) => m.type === "openOptionsPage"), "gear opens the settings page");
});

// The dot is cleared by opening the popup, so its reason must be on screen then.
Deno.test("the dot's reason opens Show more; with no dot it stays folded", async () => {
  const dot = await openPopup({ pageHref: "https://news.example.com/", signal: { kind: "popup", at: 1 } });
  assert(dot.el["signal-line"].textContent.includes("pop-up"), "says what");
  assertEquals(dot.el.more.open, true, "reason visible on the first open");
  const quiet = await openPopup({ pageHref: "https://news.example.com/" });
  assertEquals(quiet.el["signal-line"].textContent, "");
  assert(!quiet.el.more.open, "folded by default");
});

Deno.test("Fix on YouTube turns off only the sponsored-tile helper; the stuck-start reload and Kick's ad skip stay baked in", async () => {
  const storage = { settings: { v: 1, enabled: true, features: {} } };
  const yt = await openPopup({ pageHref: "https://www.youtube.com/watch?v=x", storage, streamTop: true });
  assertEquals(yt.el["site-host"].textContent, "www.youtube.com");
  assertEquals(yt.status.textContent, "✅ Protected");
  assertEquals(yt.el["fix-site"].disabled, false);
  await yt.el["fix-site"].fire("click");
  assertEquals(storage.siteOverrides["www.youtube.com"], { features: { youtubeCosmetic: false } }, "only the hide-type helper");
  const tw = await openPopup({ pageHref: "https://www.twitch.tv/somechannel", storage, streamTop: true });
  await tw.el["fix-site"].fire("click");
  assertEquals(storage.siteOverrides["www.twitch.tv"], { features: { twitchDisplay: false } }, "on Twitch only the banner hiding");
  const kick = await openPopup({ pageHref: "https://kick.com/somechannel", stored: { settings: { v: 1, enabled: true, features: {} } }, streamTop: true });
  assertEquals(kick.el["site-host"].textContent, "kick.com");
  assertEquals(kick.el["fix-site"].disabled, true, "nothing to fix on Kick: the ad skip stays on");
  assertEquals(kick.button.disabled, false, "Allow this site still works there");
});

// "No" with nothing to restore (the filters were already off when Fix ran again):
// no claim that anything was turned back on. What to do in that state is the
// owner's call; this only stops the false sentence.
Deno.test("No does not say Turned back on when nothing was turned back on", async () => {
  const storage = {
    settings: { v: 1, enabled: true, features: {} },
    siteOverrides: { "news.example.com": { features: { cosmetic: false, guardClipboard: false, guardPopups: false } } },
  };
  const p = await openPopup({ pageHref: "https://news.example.com/", storage });
  await p.el["fix-site"].fire("click"); // Fix again, after an earlier Yes
  await p.el["fix-no"].fire("click");
  assertEquals(storage.siteOverrides["news.example.com"].features.cosmetic, false, "still off");
  assertEquals(p.el["fix-note"].textContent, "");
});

// A failed storage write must not leave the popup claiming what was never saved
// (storage full: the worker and the page read storage, not this popup).
const SAVE_ERR = "Could not save. Try again.";

Deno.test("a failed Allow changes nothing on screen, says so plainly, and a retry works", async () => {
  const failSet = { on: true };
  const p = await openPopup({ pageHref: "https://news.example.com/", stored: { popupWelcomed: true }, failSet });
  await p.button.fire("click");
  assertEquals(p.storage.siteOverrides, undefined);
  assertEquals(p.status.textContent, "✅ Protected");
  assertEquals(p.button.textContent, "Allow this site");
  assertEquals(p.button.attrs["aria-pressed"], "false");
  assertEquals(p.note.textContent, SAVE_ERR);
  failSet.on = false;
  await p.button.fire("click");
  assertEquals(p.storage.siteOverrides, { "news.example.com": { enabled: false } }, "the retry allows, it does not toggle back");
  assertEquals(p.status.textContent, "Allowed – not blocking here");
  assertEquals(p.note.textContent, "");
});

Deno.test("a failed Fix does not ask Did that fix it?", async () => {
  const p = await openPopup({ pageHref: "https://news.example.com/", stored: { popupWelcomed: true }, failSet: { on: true } });
  await p.el["fix-site"].fire("click");
  assertEquals(p.storage.popupFix, undefined);
  assertEquals(p.el["fix-ask"].hidden, true);
  assertEquals(p.el["fix-site"].hidden, false);
  assertEquals(p.note.textContent, SAVE_ERR);
});

const pendingFix = () => ({
  popupWelcomed: true,
  siteOverrides: { "news.example.com": { features: { cosmetic: false } } },
  popupFix: { host: "news.example.com", at: Date.now(), prev: { cosmetic: null } },
});

Deno.test("a failed Allow keeps the pending Fix question", async () => {
  const p = await openPopup({ pageHref: "https://news.example.com/", stored: pendingFix(), failSet: { on: true } });
  await p.button.fire("click");
  assert(p.storage.popupFix, "question still stored, so No can still undo Fix");
  assertEquals(p.el["fix-ask"].hidden, false);
});

Deno.test("when only the clean-up fails, the saved change still shows", async () => {
  const p = await openPopup({ pageHref: "https://news.example.com/", stored: pendingFix(), failRemove: true });
  await p.button.fire("click");
  assertEquals(p.storage.siteOverrides["news.example.com"].enabled, false, "the Allow was stored");
  assertEquals(p.status.textContent, "Allowed – not blocking here", "and is shown");
  assertEquals(p.note.textContent, SAVE_ERR);
});

Deno.test("each theme choice reaches the popup: an explicit Purple stays Purple, automatic sets nothing", async () => {
  for (const [uiTheme, want] of [["purple", "purple"], ["contrast", "contrast"], ["auto", undefined]]) {
    const p = await openPopup({ pageHref: "https://news.example.com/", stored: { popupWelcomed: true, uiTheme } });
    assertEquals(p.rootAttrs["data-theme"], want, uiTheme);
  }
});

Deno.test("a failed No does not say Turned back on", async () => {
  const p = await openPopup({ pageHref: "https://news.example.com/", stored: pendingFix(), failSet: { on: true } });
  await p.el["fix-no"].fire("click");
  assertEquals(p.el["fix-note"].textContent, "");
  assertEquals(p.note.textContent, SAVE_ERR);
  assert(p.storage.popupFix, "question still stored");
});

Deno.test("an unsaveable welcome flag shows no error the visitor cannot act on", async () => {
  const p = await openPopup({ pageHref: "https://news.example.com/", failSet: { on: true } });
  assertEquals(p.el.welcome.hidden, false);
  assertEquals(p.note.textContent, "");
});

// With an extension-off first open the card would say "You're protected" next to
// the Off status, and it could never show again.
Deno.test("the welcome card waits until the extension is on", async () => {
  const storage = { settings: { v: 1, enabled: false, features: {} } };
  const off = await openPopup({ pageHref: "https://news.example.com/", storage });
  assertEquals(off.el.welcome.hidden, true, "no card while off");
  assertEquals(storage.popupWelcomed, undefined, "not used up");
  storage.settings.enabled = true;
  const on = await openPopup({ pageHref: "https://news.example.com/", storage });
  assertEquals(on.el.welcome.hidden, false, "shows on the first open while on");
});

Deno.test("Show more tells the truth about the threat list when it is off", async () => {
  const more = async (settings, extra = {}) => (await openPopup({ pageHref: "https://news.example.com/", stored: { popupWelcomed: true, settings, ...extra } })).el["feed-status"].textContent;
  const on = { v: 1, enabled: true, features: {} };
  assertEquals(await more(on), "Threat feed: not set up (packed threat list in use).");
  assertEquals(await more(on, { feedPaused: true }), "Threat feed: paused (packed threat list still on).", "a real pause keeps its wording");
  const OFF = "Threat feed: off (extension turned off, packed threat list off too).";
  assertEquals(await more({ v: 1, enabled: false, features: {} }, { feedPaused: true }), OFF, "master off");
  const tierOff = { v: 1, enabled: true, features: { threatTier: false } };
  assertEquals(await more(tierOff), "Threat feed: not set up (packed threat list off too).");
  assertEquals(await more(tierOff, { feedPaused: true }), "Threat feed: paused (packed threat list off too).");
  assertEquals(await more(tierOff, { feedState: { text: "Threat feed: not set up (packed threat list in use)." } }), "Threat feed: not set up (packed threat list off too).", "the worker's stored text too");
});

Deno.test("the popup adds no permission", () => {
  assertEquals(manifest.permissions, ["storage", "declarativeNetRequest", "alarms"]);
  assert(!manifest.optional_permissions, "no optional permissions");
});
