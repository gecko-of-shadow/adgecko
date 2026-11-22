// WP-23 (review 2026-11-16): popup clicks while the worker is slow, keyboard
// focus after Fix / Undo fix, the status line when the ad lists are off or the
// site is a stream site, a stale "Did that fix it?", and the Allow button's
// accessible state. Runs the real popup.js on a small fake page. focus() is
// refused on a disabled or hidden button, as in Chrome.
import "../src/settings/features.js";
import popupSource from "../src/popup.js" with { type: "text" };
import popupHtml from "../src/popup.html" with { type: "text" };
import popupCss from "../src/popup.css" with { type: "text" };
import manifest from "../manifest.json" with { type: "json" };

function assert(c, l) { if (!c) throw new Error(l); }
function assertEquals(actual, expected, label) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error((label || "expected equal") + "\n" + a + "\n" + b);
}
const POPUP_IDS = [...popupHtml.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

async function openPopup(storage, pageHref) {
  const F = globalThis.GeckoFeatures;
  const doc = { activeElement: null };
  const held = { on: false, queue: [] };
  const sent = [];
  function fakeElement(id) {
    const listeners = {};
    return {
      id, textContent: "", hidden: false, disabled: false, checked: false, src: "", dataset: {}, attrs: {},
      focus() { if (!this.disabled && !this.hidden) doc.activeElement = this; },
      setAttribute(n, v) { this.attrs[n] = String(v); },
      addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
      // A real click on a disabled or hidden button does nothing.
      click() {
        if (this.disabled || this.hidden) return Promise.resolve("not clickable");
        return Promise.all((listeners.click || []).map((fn) => fn({ type: "click" })));
      },
    };
  }
  // Like the worker's siteInfo (src/general-background.js), without the
  // manifest script check.
  const siteInfo = (origin) => {
    const host = new URL(origin).hostname;
    const stream = F.isStreamHost(host);
    const o = storage.siteOverrides || {};
    const onSite = (f) => f.sites.includes("all") || (f.sites.includes("ordinary") ? !stream : f.sites.some((d) => host === d || host.endsWith("." + d)));
    const features = F.FEATURES.filter(onSite)
      .map((f) => ({ id: f.id, perSite: f.perSite, apply: f.apply, available: f.available !== false }));
    return { ok: true, host, overrideHost: host, stream, limited: false, siteEnabled: !(o[host] && o[host].enabled === false), enabled: true, features };
  };
  const chrome = {
    runtime: {
      lastError: undefined,
      getManifest: () => manifest,
      sendMessage(msg, cb) {
        sent.push(msg.type);
        if (msg.type === "siteInfo") return cb(siteInfo(msg.origin));
        if (msg.type === "tabSignal") return cb({ ok: true, signal: null });
        // The worker's DNR queue is busy (a list swap): the reply comes late.
        if (msg.type === "applyGeneralState" && held.on) { held.queue.push(() => cb({ ok: true })); return; }
        cb({ ok: true });
      },
      openOptionsPage() {},
      getURL: (p) => "chrome-extension://x/" + p,
    },
    storage: {
      local: {
        get(keys, cb) { const out = {}; for (const k of keys) if (k in storage) out[k] = structuredClone(storage[k]); cb(out); },
        set(patch, cb) { Object.assign(storage, structuredClone(patch)); setTimeout(cb, 0); },
        remove(keys, cb) { for (const k of [].concat(keys)) delete storage[k]; setTimeout(cb, 0); },
      },
    },
    tabs: {
      query(_i, cb) { cb([{ id: 7, windowId: 1, active: true }]); },
      sendMessage(_t, msg, o, cb) { if (typeof o === "function") cb = o; cb(msg && msg.type === "pageOrigin" ? { origin: new URL(pageHref).origin } : undefined); },
      reload() {},
    },
  };
  const elements = {};
  for (const id of POPUP_IDS) elements[id] = fakeElement(id);
  elements.welcome.hidden = true;
  elements["fix-ask"].hidden = true;
  elements["undo-fix"].hidden = true;
  const document = {
    getElementById: (id) => elements[id] || null,
    documentElement: { setAttribute() {}, removeAttribute() {} },
    get activeElement() { return doc.activeElement; },
  };
  new Function("document", "chrome", popupSource)(document, chrome);
  await settle();
  return {
    el: elements, doc, sent,
    hold() { held.on = true; },
    release() { held.on = false; for (const go of held.queue.splice(0)) go(); },
  };
}

const BASE = { popupWelcomed: true, settings: { v: 1, enabled: true, features: {} } };
const FIXED = { cosmetic: false, guardClipboard: false, guardPopups: false };

// Item 1: busy waited for the worker's applyGeneralState reply, so No, Allow
// and Block again were dropped without a word while the worker was slow.
Deno.test("WP-23.1: No works while the worker is still applying the Fix", async () => {
  const storage = structuredClone(BASE);
  const p = await openPopup(storage, "https://news.example.com/");
  p.hold();
  const fixDone = p.el["fix-site"].click();
  await settle();
  assert(p.sent.includes("applyGeneralState"), "the Fix still asks the worker to apply the rules");
  assertEquals(p.el["fix-ask"].hidden, false, "Did that fix it? shows");
  await p.el["fix-no"].click();
  await settle();
  assertEquals(storage.siteOverrides, {}, "No did not turn the filters back on while the worker was busy");
  assertEquals(storage.popupFix, undefined, "the Fix question stays");
  // Site-breakage job: on an ordinary site the note points to the second test.
  assertEquals(p.el["fix-note"].textContent, "Turned back on. Still broken? Test with the ad lists off too.");
  // Allow, then Block again at once: the second click is not lost.
  await p.el["allow-site"].click();
  await settle();
  assertEquals(storage.siteOverrides, { "news.example.com": { enabled: false } }, "Allow saved");
  await p.el["allow-site"].click();
  await settle();
  assertEquals(storage.siteOverrides, {}, "Block again was dropped while the worker was busy");
  p.release();
  await fixDone;
});

// Item 2: focus moved to a button that was still disabled (busy), so it fell
// to the page body.
Deno.test("WP-23.2: Undo fix moves keyboard focus to Fix this site", async () => {
  const storage = Object.assign(structuredClone(BASE), { siteOverrides: { "news.example.com": { features: { ...FIXED } } } });
  const p = await openPopup(storage, "https://news.example.com/");
  const undo = p.el["undo-fix"];
  assertEquals(undo.hidden, false, "Undo fix shows for a kept Fix");
  undo.focus();
  await undo.click();
  await settle();
  assertEquals(undo.hidden, true, "Undo fix is gone");
  assertEquals(p.doc.activeElement && p.doc.activeElement.id, "fix-site", "focus is on Fix this site");
});

Deno.test("WP-23.2: after Fix, focus is on Yes before the slow worker answers", async () => {
  const storage = structuredClone(BASE);
  const p = await openPopup(storage, "https://news.example.com/");
  p.el["fix-site"].focus();
  p.hold();
  const done = p.el["fix-site"].click();
  await settle();
  assertEquals(p.doc.activeElement && p.doc.activeElement.id, "fix-yes", "focus is on Yes");
  p.release();
  await done;
});

// Site-breakage job: after No the next step is the second test (ad lists off
// too), so focus goes there. Where that test does not apply (the ad lists
// are off), focus stays on Allow this site as before.
Deno.test("WP-23.2: after No, focus is on the next step: the second test, or Allow this site", async () => {
  const storage = structuredClone(BASE);
  const p = await openPopup(storage, "https://news.example.com/");
  await p.el["fix-site"].click();
  await settle();
  p.el["fix-no"].focus();
  await p.el["fix-no"].click();
  await settle();
  assertEquals(p.doc.activeElement && p.doc.activeElement.id, "fix-lists", "focus is on Test with the ad lists off");

  const off = Object.assign(structuredClone(BASE), { generalEnabled: false, settings: { v: 1, enabled: true, features: { network: false } } });
  const q = await openPopup(off, "https://news.example.com/");
  await q.el["fix-site"].click();
  await settle();
  q.el["fix-no"].focus();
  await q.el["fix-no"].click();
  await settle();
  assertEquals(q.el["fix-lists"].hidden, true, "no second test with the ad lists off");
  assertEquals(q.doc.activeElement && q.doc.activeElement.id, "allow-site", "focus is on Allow this site");
});

// Item 4: the status line said Protected with the filter lists off.
Deno.test("WP-23.4: the status line says so when the ad lists are off", async () => {
  const storage = Object.assign(structuredClone(BASE), { generalEnabled: false, settings: { v: 1, enabled: true, features: { network: false } } });
  const p = await openPopup(storage, "https://news.example.com/");
  assertEquals(p.el["site-status"].textContent, "Ad lists off – turned off in settings");
  assertEquals(p.el["brand-icon"].dataset.glow, "off", "icon agrees");
  // Lists on: unchanged.
  const q = await openPopup(structuredClone(BASE), "https://news.example.com/");
  assertEquals(q.el["site-status"].textContent, "✅ Protected");
});

// Item 5: Allow on YouTube / Twitch leaves the built-in (vendored) ad
// blocking on, so "not blocking here" was false there.
Deno.test("WP-23.5: Allow on YouTube and Twitch says the built-in ad blocking still runs", async () => {
  for (const [host, name] of [["www.youtube.com", "YouTube"], ["www.twitch.tv", "Twitch"]]) {
    const storage = Object.assign(structuredClone(BASE), { siteOverrides: { [host]: { enabled: false } } });
    const p = await openPopup(storage, "https://" + host + "/x");
    assertEquals(p.el["site-status"].textContent, "Allowed – built-in " + name + " ad blocking still runs", host);
    assertEquals(p.el["allow-site"].textContent, "Block again", host);
  }
  // Kick has no always-on part: Allow stops the Kick ad skip too.
  const storage = Object.assign(structuredClone(BASE), { siteOverrides: { "kick.com": { enabled: false } } });
  const k = await openPopup(storage, "https://kick.com/x");
  assertEquals(k.el["site-status"].textContent, "Allowed – not blocking here", "kick.com");
  const n = await openPopup(Object.assign(structuredClone(BASE), { siteOverrides: { "news.example.com": { enabled: false } } }), "https://news.example.com/");
  assertEquals(n.el["site-status"].textContent, "Allowed – not blocking here", "ordinary site");
});

// Item 6: the settings page undid the Fix, but popupFix stayed for a day.
Deno.test("WP-23.6: no Did that fix it? after the Fix was undone on the settings page", async () => {
  const fix = { host: "news.example.com", at: Date.now(), prev: { cosmetic: null, guardClipboard: null, guardPopups: null } };
  const storage = Object.assign(structuredClone(BASE), { popupFix: structuredClone(fix) });
  const p = await openPopup(storage, "https://news.example.com/");
  assertEquals(p.el["fix-ask"].hidden, true, "a stale question shows");
  assertEquals(p.el["fix-site"].hidden, false, "Fix this site is offered again");
  assertEquals(p.el["site-status"].textContent, "✅ Protected");
  await p.el["fix-site"].click();
  await settle();
  assertEquals(storage.popupFix.prev, fix.prev, "a new Fix keeps what was there before");
  assertEquals(storage.siteOverrides["news.example.com"].features, FIXED, "new Fix saved");
  // The Fix is still in place: the question still shows (docs/allow-a-page.md).
  const live = Object.assign(structuredClone(BASE), { popupFix: structuredClone(fix), siteOverrides: { "news.example.com": { features: { ...FIXED } } } });
  const q = await openPopup(live, "https://news.example.com/");
  assertEquals(q.el["fix-ask"].hidden, false, "the question for a live Fix");
  assertEquals(q.el["fix-site"].hidden, true, "Fix hidden while the question shows");
});

// Item 7: aria-pressed with a label that changes read as "Block again,
// pressed". The state is in the status line; the label names the action.
Deno.test("WP-23.7: the Allow button has no aria-pressed; its look comes from data-allowed", async () => {
  assert(!/id="allow-site"[^>]*aria-pressed/.test(popupHtml), "popup.html still sets aria-pressed");
  const storage = structuredClone(BASE);
  const p = await openPopup(storage, "https://news.example.com/");
  const b = p.el["allow-site"];
  assert(!("aria-pressed" in b.attrs), "aria-pressed set on Allow this site");
  assertEquals(b.dataset.allowed, "false");
  await b.click();
  await settle();
  assertEquals(b.textContent, "Block again");
  assert(!("aria-pressed" in b.attrs), "aria-pressed set on Block again");
  assertEquals(b.dataset.allowed, "true");
  const css = popupCss.replace(/\/\*[\s\S]*?\*\//g, "");
  assert(!css.includes("aria-pressed"), "popup.css still styles aria-pressed");
  assert(/button\.primary\[data-allowed="true"\]\s*\{[^}]*background:\s*transparent/.test(css), "Block again keeps its outlined look");
});
