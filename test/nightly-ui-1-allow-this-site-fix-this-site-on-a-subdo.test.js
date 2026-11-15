// Allow this site / Fix this site on a subdomain must write the subdomain's own
// key, never the parent domain's entry (docs/allow-a-page.md: "Other addresses
// of the same site count separately ... Allow each one you need.").
// The fake worker answers siteInfo like src/general-background.js does:
// overrideHost = FEAT.overrideFor(overrides, host).host (nearest stored entry).
import "../src/settings/features.js";
import popupSource from "../src/popup.js" with { type: "text" };
import popupHtml from "../src/popup.html" with { type: "text" };
import manifest from "../manifest.json" with { type: "json" };

function assertEquals(actual, expected, label) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${label || "expected equal"}\nactual:   ${left}\nexpected: ${right}`);
}

const POPUP_IDS = [...popupHtml.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
const settle = () => new Promise((r) => setTimeout(r, 0));

function fakeElement() {
  const listeners = {};
  return {
    textContent: "", hidden: false, disabled: false, checked: false, src: "", dataset: {}, attrs: {},
    focus() {},
    setAttribute(n, v) { this.attrs[n] = String(v); },
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    async fire(t) { for (const fn of listeners[t] || []) await fn({ type: t }); },
  };
}

async function openPopup(pageHref, stored) {
  const F = globalThis.GeckoFeatures;
  const storage = structuredClone(stored);
  // Mirrors siteInfo() in src/general-background.js.
  const siteInfo = (origin) => {
    const host = F.normalizeHost(new URL(origin).hostname);
    const overrides = F.normalizeOverrides(storage.siteOverrides);
    const own = F.overrideFor(overrides, host);
    const stream = F.isStreamHost(host);
    const features = F.FEATURES.filter((f) => f.sites.includes("all") || (f.sites.includes("ordinary") ? !stream : f.sites.some((d) => host === d || host.endsWith("." + d))))
      .map((f) => ({ id: f.id, perSite: f.perSite, apply: f.apply, available: f.available !== false }));
    return { ok: true, host, stream, limited: false, enabled: true, siteEnabled: !(own && own.entry.enabled === false), overrideHost: own ? own.host : host, features };
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
        get(keys, cb) { const out = {}; for (const k of keys) if (k in storage) out[k] = structuredClone(storage[k]); cb(out); },
        set(patch, cb) { Object.assign(storage, structuredClone(patch)); cb(); },
        remove(keys, cb) { for (const k of [].concat(keys)) delete storage[k]; cb(); },
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
  const document = {
    getElementById: (id) => elements[id] || null,
    documentElement: { setAttribute() {}, removeAttribute() {} },
  };
  new Function("document", "chrome", popupSource)(document, chrome);
  for (let i = 0; i < 4; i++) await settle();
  return { el: elements, storage };
}

const PARENT_FIX = { "example.com": { features: { cosmetic: false, guardClipboard: false, guardPopups: false } } };

Deno.test("Allow this site on a subdomain writes the subdomain's key, not the parent's", async () => {
  const p = await openPopup("https://shop.example.com/cart", { settings: { v: 1, enabled: true, features: {} }, siteOverrides: structuredClone(PARENT_FIX) });
  assertEquals(p.el["allow-site"].textContent, "Allow this site", "subdomain starts not allowed");
  await p.el["allow-site"].fire("click");
  const o = p.storage.siteOverrides;
  assertEquals(o["example.com"], PARENT_FIX["example.com"], "parent example.com entry must stay unchanged (no enabled:false)");
  assertEquals(o["shop.example.com"] && o["shop.example.com"].enabled, false, "shop.example.com gets its own enabled:false");
});

Deno.test("Fix this site on a subdomain writes the subdomain's key, not the parent's", async () => {
  const parent = { "example.com": { features: { guardPopups: true } } };
  const p = await openPopup("https://shop.example.com/cart", { settings: { v: 1, enabled: true, features: {} }, siteOverrides: structuredClone(parent) });
  await p.el["fix-site"].fire("click");
  const o = p.storage.siteOverrides;
  assertEquals(o["example.com"], parent["example.com"], "parent example.com entry must stay unchanged");
  assertEquals(!!(o["shop.example.com"] && o["shop.example.com"].features && o["shop.example.com"].features.cosmetic === false), true, "shop.example.com gets its own Fix entry");
});
