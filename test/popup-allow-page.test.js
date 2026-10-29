// Runs the real popup.js against the real cosmetic.js content script, with a fake
// Chrome that behaves like ours: no "tabs" permission, so tabs.query leaves tab.url out.
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
    disabled: false,
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
async function openPopup({ pageHref, scripted = true, stored = {}, answerLater = false }) {
  const storage = Object.assign({}, stored);
  // frameId -> listeners. The subframe comes first, so it would win a broadcast.
  const frames = new Map();
  if (scripted) {
    frames.set(3, startFrame("https://ads.example.net/slot?id=9", false));
    frames.set(0, startFrame(pageHref, true));
  }
  const sent = [];
  const background = [];
  let pending = null;

  const chrome = {
    runtime: {
      lastError: undefined,
      getManifest: () => manifest,
      sendMessage(msg, cb) {
        background.push(msg);
        cb({ ok: true });
      },
    },
    storage: {
      local: {
        get(keys, cb) {
          const out = {};
          for (const k of keys) if (k in storage) out[k] = storage[k];
          cb(out);
        },
        set(patch, cb) {
          Object.assign(storage, patch);
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
  const h1 = fakeElement();
  const document = {
    getElementById: (id) => elements[id] || null,
    querySelector: (sel) => (sel === "h1" ? h1 : null),
  };

  new Function("document", "chrome", popupSource)(document, chrome);
  await settle();
  await settle();
  return {
    button: elements["allow-page"],
    status: elements["page-status"],
    toggle: elements["general-enabled"],
    frames,
    storage,
    sent,
    background,
    async answer() {
      assert(pending, "popup asked the page");
      pending();
      await settle();
      await settle();
    },
  };
}

Deno.test("Allow this page works on a normal https page without the tabs permission", async () => {
  const p = await openPopup({ pageHref: "https://news.example.com/story?id=1#top" });
  assertEquals(p.sent.map((s) => s.options), [{ frameId: 0 }], "popup asks only the top frame");
  assertEquals(p.frames.get(3).length, 0, "the ad iframe does not listen");
  assertEquals(p.button.disabled, false, "button is clickable");
  assertEquals(p.button.textContent, "Allow this page");
  assertEquals(p.button.attrs["aria-pressed"], "false");
  assertEquals(p.status.textContent, "Lists apply on this page.");

  await p.button.fire("click");
  assertEquals(p.storage.generalAllowedOrigins, ["https://news.example.com"], "origin saved, path dropped");
  assertEquals(p.button.textContent, "Blocking this page");
  assertEquals(p.button.attrs["aria-pressed"], "true");
  assertEquals(p.status.textContent, "Allowed for this site: https://news.example.com");
  assert(p.background.some((m) => m.type === "applyGeneralState"), "rules re-applied after the click");
});

Deno.test("an allowed page can be un-allowed, http pages work, and the off state explains itself", async () => {
  const allowed = await openPopup({
    pageHref: "http://shop.example.org:8080/cart",
    stored: { generalAllowedOrigins: ["http://shop.example.org:8080", "https://other.example"] },
  });
  assertEquals(allowed.button.disabled, false, "allowed page still answers");
  assertEquals(allowed.button.textContent, "Blocking this page");
  await allowed.button.fire("click");
  assertEquals(allowed.storage.generalAllowedOrigins, ["https://other.example"], "only this origin removed");

  const off = await openPopup({ pageHref: "https://news.example.com/", stored: { generalEnabled: false } });
  assertEquals(off.button.disabled, true);
  assertEquals(off.status.textContent, "Turn general blocking on to change page allows.");
});

Deno.test("a page with no content script stays greyed out and says why", async () => {
  const p = await openPopup({ pageHref: "https://news.example.com/", scripted: false });
  assertEquals(p.button.disabled, true);
  assert(p.status.textContent.startsWith("Open a normal http(s) page"), "explains the greyed button");
  assert(p.status.textContent.includes("Reload it"), "tabs open from before an install or update need a reload");
  await p.button.fire("click");
  assertEquals(p.storage.generalAllowedOrigins, undefined, "nothing saved");

  const stream = await openPopup({ pageHref: "https://www.twitch.tv/somechannel" });
  assertEquals(stream.button.disabled, true, "stream sites have no general script to answer");
});

Deno.test("a slow page doesn't hold up the rest of the popup", async () => {
  const p = await openPopup({
    pageHref: "https://busy.example.com/",
    stored: { generalEnabled: false },
    answerLater: true,
  });
  assertEquals(p.toggle.checked, false, "stored master switch shows before the page answers");
  assertEquals(p.button.disabled, true);
  assertEquals(p.status.textContent, "Checking this page…");
  await p.button.fire("click");
  assertEquals(p.storage.generalAllowedOrigins, undefined, "a click while waiting saves nothing");

  p.toggle.checked = true;
  await p.toggle.fire("change");
  assertEquals(p.storage.generalEnabled, true, "the switch works while waiting");
  assertEquals(p.status.textContent, "Checking this page…");
  await p.answer();
  assertEquals(p.button.disabled, false, "button turns on once the page answers");
  assertEquals(p.status.textContent, "Lists apply on this page.");
});

Deno.test("the allow fix adds no permission", () => {
  assertEquals(manifest.permissions, ["storage", "declarativeNetRequest"]);
  assert(!manifest.optional_permissions, "no optional permissions");
});
