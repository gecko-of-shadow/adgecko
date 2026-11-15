// Finding 4 (final review): 0.3.4's Fix wrote the most specific existing
// override entry, so popupFix.host could be a parent ("example.com") of the
// page ("www.example.com"). 0.3.5 looked up the question by the page host
// only, so the question vanished and No could not undo the Fix. The popup now
// also matches the nearest parent that has an entry when the page host has none.
import "../src/settings/features.js";
import popupSource from "../src/popup.js" with { type: "text" };
import popupHtml from "../src/popup.html" with { type: "text" };
import manifest from "../manifest.json" with { type: "json" };

function assertEquals(actual, expected, label) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${label || "expected equal"}\n${left}\n${right}`);
}
const POPUP_IDS = [...popupHtml.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

function fakeElement() {
  const listeners = {};
  return {
    textContent: "", hidden: false, disabled: false, checked: false, src: "", dataset: {}, attrs: {},
    focus() {},
    setAttribute(name, value) { this.attrs[name] = String(value); },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    click(type = "click") { return Promise.all((listeners[type] || []).map((fn) => fn({ type }))); },
  };
}

async function openPopup(storage, pageHref) {
  const F = globalThis.GeckoFeatures;
  const siteInfo = (origin) => {
    const host = new URL(origin).hostname;
    const own = F.overrideFor(F.normalizeOverrides(storage.siteOverrides), host);
    const features = F.FEATURES.filter((f) => f.sites.includes("all") || f.sites.includes("ordinary"))
      .map((f) => ({ id: f.id, perSite: f.perSite, apply: f.apply, available: f.id !== "guardMiners" }));
    return { ok: true, host, overrideHost: own ? own.host : host, stream: false, siteEnabled: !(own && own.entry.enabled === false), enabled: true, features };
  };
  const chrome = {
    runtime: {
      lastError: undefined,
      getManifest: () => manifest,
      sendMessage(msg, cb) {
        if (msg.type === "siteInfo") return cb(siteInfo(msg.origin));
        if (msg.type === "tabSignal") return cb({ ok: true, signal: null });
        cb({ ok: true });
      },
      openOptionsPage() {},
    },
    storage: {
      local: {
        get(keys, cb) {
          const out = {};
          for (const k of keys) if (k in storage) out[k] = structuredClone(storage[k]);
          cb(out);
        },
        set(patch, cb) { Object.assign(storage, structuredClone(patch)); setTimeout(cb, 0); },
        remove(keys, cb) { for (const k of [].concat(keys)) delete storage[k]; setTimeout(cb, 0); },
      },
    },
    tabs: {
      query(_i, cb) { cb([{ id: 7, windowId: 1, active: true }]); },
      sendMessage(_tabId, msg, options, cb) {
        if (typeof options === "function") cb = options;
        cb(msg && msg.type === "pageOrigin" ? { origin: new URL(pageHref).origin } : undefined);
      },
    },
  };
  const elements = {};
  for (const id of POPUP_IDS) elements[id] = fakeElement();
  elements.welcome.hidden = true;
  elements["fix-ask"].hidden = true;
  const document = { getElementById: (id) => elements[id] || null, documentElement: { setAttribute() {}, removeAttribute() {} } };
  new Function("document", "chrome", popupSource)(document, chrome);
  await settle();
  return elements;
}

// 0.3.4-shaped storage: Fix on www.example.com while example.com had an entry.
function legacyStorage() {
  return {
    popupWelcomed: true,
    settings: { v: 1, enabled: true, features: {} },
    siteOverrides: { "example.com": { features: { network: true, cosmetic: false, guardClipboard: false, guardPopups: false } } },
    popupFix: { host: "example.com", at: Date.now() - 60000, prev: { cosmetic: null, guardClipboard: null, guardPopups: null } },
  };
}

Deno.test("upgrade: a 0.3.4 popupFix on the parent still asks on the subdomain, and No undoes it", async () => {
  const storage = legacyStorage();
  const el = await openPopup(storage, "https://www.example.com/");
  assertEquals(el["fix-ask"].hidden, false, "the Did-that-fix-it question shows");
  assertEquals(el["fix-site"].hidden, true, "Fix this site is hidden while the question is open");
  await el["fix-no"].click();
  await settle();
  assertEquals(storage.siteOverrides["example.com"], { features: { network: true } }, "No turns the parent's Fix switches back on");
  assertEquals("popupFix" in storage, false, "the question is answered");
  assertEquals(el["fix-note"].textContent, "Turned back on. If the site still breaks, use Allow this site.");
});

Deno.test("upgrade: Yes on the subdomain answers the parent's 0.3.4 question and keeps the Fix", async () => {
  const storage = legacyStorage();
  const el = await openPopup(storage, "https://www.example.com/");
  await el["fix-yes"].click();
  await settle();
  assertEquals("popupFix" in storage, false, "the question is answered");
  assertEquals(storage.siteOverrides["example.com"].features.cosmetic, false, "the Fix stays");
});

Deno.test("a parent's question does not show on a subdomain with its own entry", async () => {
  const storage = legacyStorage();
  storage.siteOverrides["www.example.com"] = { features: { cosmetic: true } };
  const el = await openPopup(storage, "https://www.example.com/");
  assertEquals(el["fix-ask"].hidden, true, "own entry: the parent's Fix does not apply here");
  await el["fix-no"].click();
  await settle();
  assertEquals(storage.popupFix && storage.popupFix.host, "example.com", "the parent's question is kept");
  assertEquals(storage.siteOverrides["example.com"].features.cosmetic, false, "the parent's Fix is untouched");
});
