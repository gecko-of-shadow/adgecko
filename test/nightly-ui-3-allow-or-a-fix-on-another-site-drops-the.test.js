// Nightly repro: Allow, or a Fix on another site, drops the unanswered Fix question.
// Harness copied from test/popup-allow-page.test.js (openPopup is not exported).
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
async function openPopup({ pageHref, scripted = true, stored = {}, answerLater = false, signal = null, storage: shared = null, streamTop = false, failSet = null, failRemove = false, limited = null }) {
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
    // A stream-family host where none of our scripts runs: the worker lists the network tiers only.
    if (limited) return { ok: true, host, overrideHost: host, stream, limited: true, siteEnabled: true, enabled: true, features: [{ id: "threatTier", perSite: false, apply: "live", available: true, on: limited.threat }] };
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

// docs/allow-a-page.md: "for a day it still asks the next time you open it".
Deno.test("a Fix on another site keeps the unanswered question on the first site, so No can still undo it", async () => {
  const storage = { popupWelcomed: true, settings: { v: 1, enabled: true, features: {} } };
  const a = await openPopup({ pageHref: "https://news.example/", storage });
  await a.el["fix-site"].fire("click");
  assertEquals(a.el["fix-ask"].hidden, false, "Did that fix it? on news.example");
  // Before answering, the visitor fixes another site.
  const b = await openPopup({ pageHref: "https://shop.example/", storage });
  await b.el["fix-site"].fire("click");
  // Same day, back on news.example: the question must still be there.
  const again = await openPopup({ pageHref: "https://news.example/", storage });
  assertEquals(again.el["fix-ask"].hidden, false, "news.example still asks Did that fix it?");
  await again.el["fix-no"].fire("click");
  assertEquals(storage.siteOverrides["news.example"], undefined, "No puts back the clipboard guard and hiding on news.example");
});

Deno.test("Allow while the Fix question is open, then Block again, does not leave the Fix silently in force", async () => {
  const storage = { popupWelcomed: true, settings: { v: 1, enabled: true, features: {} } };
  const p = await openPopup({ pageHref: "https://news.example/", storage });
  await p.el["fix-site"].fire("click");
  assertEquals(p.el["fix-ask"].hidden, false, "question showing");
  await p.button.fire("click"); // Allow this site, question unanswered
  const q = await openPopup({ pageHref: "https://news.example/", storage });
  await q.button.fire("click"); // Block again
  assertEquals(q.status.textContent, "✅ Protected");
  const F = globalThis.GeckoFeatures;
  const got = F.resolve(storage.settings, storage.siteOverrides || {}, "news.example");
  const stillAsks = q.el["fix-ask"].hidden === false;
  assert(stillAsks || got.guardClipboard !== false, "after Block again the clipboard guard is off with no Did that fix it? to undo it: " + JSON.stringify(storage.siteOverrides) + " popupFix=" + JSON.stringify(storage.popupFix));
});
