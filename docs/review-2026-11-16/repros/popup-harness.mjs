import "src/settings/features.js";
const popupSource = await Deno.readTextFile("src/popup.js");
const popupHtml = await Deno.readTextFile("src/popup.html");
const manifest = JSON.parse(await Deno.readTextFile("manifest.json"));
const POPUP_IDS = [...popupHtml.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
export const settle = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
export async function openPopup(storage, pageHref, opts = {}) {
  const F = globalThis.GeckoFeatures;
  const doc = { activeElement: null };
  const holdApply = { on: !!opts.holdApply, queue: [] };
  function fakeElement(id) {
    const listeners = {};
    return {
      id, textContent: "", hidden: false, disabled: false, checked: false, src: "", dataset: {}, attrs: {},
      focus() { if (!this.disabled && !this.hidden) doc.activeElement = this; },
      setAttribute(n, v) { this.attrs[n] = String(v); },
      addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
      click() { if (this.disabled || this.hidden) return Promise.resolve("not-clickable"); return Promise.all((listeners.click || []).map((fn) => fn({ type: "click" }))); },
    };
  }
  const siteInfo = (origin) => {
    const host = new URL(origin).hostname;
    const o = storage.siteOverrides || {};
    const features = F.FEATURES.filter((f) => f.sites.includes("all") || f.sites.includes("ordinary"))
      .map((f) => ({ id: f.id, perSite: f.perSite, apply: f.apply, available: f.available !== false }));
    return { ok: true, host, overrideHost: host, stream: false, siteEnabled: !(o[host] && o[host].enabled === false), enabled: true, features };
  };
  const chrome = {
    runtime: {
      lastError: undefined, getManifest: () => manifest,
      sendMessage(msg, cb) {
        if (msg.type === "siteInfo") return cb(siteInfo(msg.origin));
        if (msg.type === "tabSignal") return cb({ ok: true, signal: null });
        if (msg.type === "applyGeneralState" && holdApply.on) { holdApply.queue.push(() => cb({ ok: true })); return; }
        cb({ ok: true });
      },
      openOptionsPage() {}, getURL: (p) => "chrome-extension://x/" + p,
    },
    storage: { local: {
      get(keys, cb) { const out = {}; for (const k of keys) if (k in storage) out[k] = structuredClone(storage[k]); cb(out); },
      set(patch, cb) { Object.assign(storage, structuredClone(patch)); setTimeout(cb, 0); },
      remove(keys, cb) { for (const k of [].concat(keys)) delete storage[k]; setTimeout(cb, 0); },
    } },
    tabs: {
      query(_i, cb) { cb([{ id: 7, windowId: 1, active: true }]); },
      sendMessage(_t, msg, o, cb) { if (typeof o === "function") cb = o; cb(msg && msg.type === "pageOrigin" ? { origin: new URL(pageHref).origin } : undefined); },
      reload() {},
    },
  };
  const elements = {};
  for (const id of POPUP_IDS) elements[id] = fakeElement(id);
  elements.welcome.hidden = true; elements["fix-ask"].hidden = true; elements["undo-fix"].hidden = true;
  const document = { getElementById: (id) => elements[id] || null, documentElement: { setAttribute() {}, removeAttribute() {} }, get activeElement() { return doc.activeElement; } };
  new Function("document", "chrome", popupSource)(document, chrome);
  await settle(10);
  return { el: elements, doc, holdApply, release() { holdApply.on = false; for (const g of holdApply.queue.splice(0)) g(); } };
}
