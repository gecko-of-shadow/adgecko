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
async function openPopup({ pageHref, scripted = true, stored = {}, answerLater = false, signal = null, storage: shared = null }) {
  const storage = shared || Object.assign({}, stored);
  const F = globalThis.GeckoFeatures;
  // frameId -> listeners. The subframe comes first, so it would win a broadcast.
  const frames = new Map();
  if (scripted) {
    frames.set(3, startFrame("https://ads.example.net/slot?id=9", false));
    frames.set(0, startFrame(pageHref, true));
  }
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
          Object.assign(storage, structuredClone(patch));
          cb();
        },
        remove(keys, cb) {
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

Deno.test("the popup adds no permission", () => {
  assertEquals(manifest.permissions, ["storage", "declarativeNetRequest", "alarms"]);
  assert(!manifest.optional_permissions, "no optional permissions");
});
