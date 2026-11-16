import "src/settings/features.js";
const settingsHtml = await Deno.readTextFile("src/settings.html");
const settingsSource = await Deno.readTextFile("src/settings.js");
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
function fakeElement(tag) {
  const listeners = {};
  return { tag, textContent: "", className: "", type: "", value: "", checked: false, disabled: false, dataset: {}, children: [],
    get firstChild() { return this.children[0] || null; },
    appendChild(c) { this.children.push(c); return c; }, removeChild(c) { this.children.splice(this.children.indexOf(c), 1); return c; },
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    fire(t) { return Promise.all((listeners[t] || []).map((fn) => fn({ type: t }))); },
    querySelectorAll() { const out = []; const walk = (n) => { for (const c of n.children) { if (c.tag === "input" && c.dataset.feature) out.push(c); walk(c); } }; walk(this); return out; } };
}
Deno.test("two quick switch changes while storage.set is slow: the first is lost", async () => {
  const storage = { settings: { v: 1, enabled: true, features: {} } };
  const changed = [];
  const chrome = { runtime: { lastError: undefined, sendMessage(_m, cb) { cb({ ok: true }); } },
    storage: { local: {
      get(keys, cb) { const out = {}; for (const k of keys) if (k in storage) out[k] = structuredClone(storage[k]); setTimeout(() => cb(out), 0); },
      // storage backend busy with a big list write from the worker: 30 ms per write
      set(patch, cb) { setTimeout(() => { Object.assign(storage, structuredClone(patch)); cb(); for (const fn of changed) fn(Object.fromEntries(Object.keys(patch).map((k) => [k, {}])), "local"); }, 30); },
    }, onChanged: { addListener(fn) { changed.push(fn); } } } };
  const elements = {};
  for (const m of settingsHtml.matchAll(/\bid="([^"]+)"/g)) elements[m[1]] = fakeElement("page");
  const document = { getElementById: (id) => elements[id] || null, createElement: (t) => fakeElement(t), documentElement: { setAttribute() {}, removeAttribute() {} } };
  globalThis.GeckoThreatCompile = { userDomainReason: (v) => ({ domain: v }) };
  new Function("document", "chrome", settingsSource)(document, chrome);
  await settle();
  const box = (id) => elements.features.querySelectorAll().find((b) => b.dataset.feature === id);
  const a = box("guardClipboard"), b = box("cosmetic");
  console.log("before:", a.checked, b.checked);
  a.checked = !a.checked; const wantA = a.checked; const pa = a.fire("change");
  await new Promise((r) => setTimeout(r, 10)); // second click 10 ms later
  b.checked = !b.checked; const wantB = b.checked; const pb = b.fire("change");
  await Promise.all([pa, pb]); await new Promise((r) => setTimeout(r, 100));
  console.log("stored guardClipboard =", storage.settings.features.guardClipboard, "(wanted", wantA, ") cosmetic =", storage.settings.features.cosmetic, "(wanted", wantB, ")");
  console.log("UI box guardClipboard now shows", a.checked);
});
