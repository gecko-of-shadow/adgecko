// A double-click on "Fix this site" while the worker is slow to answer siteInfo
// (asleep, waiting for settings): the second click must not overwrite the
// stored popupFix.prev with the values the first click just wrote, or "No"
// restores nothing.
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
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeElement() {
  const listeners = {};
  return {
    textContent: "", hidden: false, disabled: false, checked: false, src: "", dataset: {}, attrs: {},
    focus() {},
    setAttribute(name, value) { this.attrs[name] = String(value); },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    // Like a real click: dispatch and return; the async handler keeps running.
    click(type = "click") { return Promise.all((listeners[type] || []).map((fn) => fn({ type }))); },
  };
}

async function openPopup(storage, pageHref) {
  const F = globalThis.GeckoFeatures;
  const held = { on: false, queue: [] };
  const siteInfo = (origin) => {
    const host = new URL(origin).hostname;
    const o = storage.siteOverrides || {};
    const features = F.FEATURES.filter((f) => f.sites.includes("all") || f.sites.includes("ordinary"))
      .map((f) => ({ id: f.id, perSite: f.perSite, apply: f.apply, available: f.id !== "guardMiners" }));
    return { ok: true, host, overrideHost: host, stream: false, siteEnabled: !(o[host] && o[host].enabled === false), enabled: true, features };
  };
  const chrome = {
    runtime: {
      lastError: undefined,
      getManifest: () => manifest,
      sendMessage(msg, cb) {
        if (msg.type === "siteInfo") {
          const go = () => cb(siteInfo(msg.origin));
          if (held.on) held.queue.push(go);
          else go();
          return;
        }
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
  const document = {
    getElementById: (id) => elements[id] || null,
    documentElement: { setAttribute() {}, removeAttribute() {} },
  };
  new Function("document", "chrome", popupSource)(document, chrome);
  for (let i = 0; i < 4; i++) await settle();
  return {
    el: elements,
    hold() { held.on = true; },
    release() { held.on = false; for (const go of held.queue.splice(0)) go(); },
  };
}

Deno.test("a double-click on Fix keeps the original prev, so No turns the filters back on", async () => {
  const storage = { popupWelcomed: true, settings: { v: 1, enabled: true, features: {} } };
  const p = await openPopup(storage, "https://news.example.com/");
  const fix = p.el["fix-site"];
  assertEquals(fix.hidden, false, "Fix is offered");
  assertEquals(fix.disabled, false, "Fix is clickable");

  p.hold(); // the worker is waking up: siteInfo answers late
  const first = fix.click();
  for (let i = 0; i < 4; i++) await settle(); // first click's save() has resolved
  const prevAfterFirst = structuredClone(storage.popupFix.prev);
  // Second click of the double-click, before render() has hidden/disabled Fix.
  let second = Promise.resolve();
  if (!fix.hidden && !fix.disabled) second = fix.click();
  for (let i = 0; i < 4; i++) await settle();
  p.release();
  await Promise.all([first, second]);
  for (let i = 0; i < 4; i++) await settle();

  assertEquals(storage.popupFix.prev, prevAfterFirst, "popupFix.prev still holds what was there before Fix");

  await p.el["fix-no"].click();
  for (let i = 0; i < 4; i++) await settle();
  const left = (storage.siteOverrides || {})["news.example.com"];
  assertEquals(left && left.features, undefined, "No turns every switch Fix changed back on");
  assertEquals(p.el["fix-note"].textContent, "Turned back on. If the site still breaks, use Allow this site.");
});
