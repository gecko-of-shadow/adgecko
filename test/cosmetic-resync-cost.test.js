// Every frame of every tab listens to storage changes. A change that does
// not change this frame's CSS must not write the (large) sheet again, and a
// site switch on another site must not even read storage again.
import "../src/settings/features.js";
import "../src/general/cosmetic-parse.js";
import source from "../src/cosmetic.js" with { type: "text" };

function assert(c, l) { if (!c) throw new Error(l); }
const P = globalThis.GeneralCosmeticParse;
const install = new Function(`${source}\nreturn installCosmeticHide;`)();
const tick = () => new Promise((r) => setTimeout(r, 0));

function fakeDoc() {
  const nodes = [];
  return {
    writes: 0,
    documentElement: { appendChild(el) { el.isConnected = true; nodes.push(el); } },
    createElement() {
      const doc = this;
      const el = { id: "", isConnected: false, _t: "", remove() { el.isConnected = false; } };
      Object.defineProperty(el, "textContent", { get: () => el._t, set: (t) => { doc.writes += 1; el._t = t; } });
      return el;
    },
    getElementById(id) { return nodes.find((n) => n.id === id && n.isConnected) || null; },
    addEventListener() {},
  };
}

class CountSheet {
  static writes = 0;
  replaceSync() { CountSheet.writes += 1; }
}

async function withGlobals(doc, sheet, fn) {
  const prev = { document: globalThis.document, CSSStyleSheet: globalThis.CSSStyleSheet };
  globalThis.document = doc;
  if (sheet) { globalThis.CSSStyleSheet = sheet; doc.adoptedStyleSheets = []; } else delete globalThis.CSSStyleSheet;
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete globalThis[k];
      else globalThis[k] = v;
    }
  }
}

const stored = { cosMeta: { source: "refresh" }, cosG: ".ad-box", settings: { v: 1, enabled: true, features: {} }, siteOverrides: {} };

Deno.test("resync cost: a second applyState with the same CSS does not write again", async () => {
  for (const sheet of [CountSheet, null]) {
    const doc = fakeDoc();
    CountSheet.writes = 0;
    await withGlobals(doc, sheet, async () => {
      const api = { hostname: "news.example", href: "https://news.example/", isTop: true, parse: P };
      install(api);
      await api.applyState({ stored });
      await api.applyState({ stored });
      await api.applyState({ stored });
      const n = sheet ? CountSheet.writes : doc.writes;
      assert(n === 1, (sheet ? "adopted sheet" : "<style> fallback") + ": the same CSS was written " + n + " times");
      // New CSS is written.
      await api.applyState({ stored: Object.assign({}, stored, { cosG: ".other" }) });
      assert((sheet ? CountSheet.writes : doc.writes) === 2, "a changed CSS is written");
      // After a remove, the same CSS is written again.
      api.removeStyle();
      await api.applyState({ stored: Object.assign({}, stored, { cosG: ".other" }) });
      assert((sheet ? CountSheet.writes : doc.writes) === 3, "the CSS comes back after a remove");
    });
  }
});

Deno.test("resync cost: a site switch on another site does not re-read storage in this frame", async () => {
  const doc = fakeDoc();
  await withGlobals(doc, CountSheet, async () => {
    let reads = 0;
    let listener = null;
    let current = JSON.parse(JSON.stringify(stored));
    const api = { hostname: "news.example", href: "https://news.example/", isTop: true, parse: P };
    install(api);
    api.start({
      hostname: "news.example", href: "https://news.example/", isTop: true,
      getLocal: (_keys, cb) => { reads += 1; cb(JSON.parse(JSON.stringify(current))); },
      onChanged: { addListener: (fn) => { listener = fn; } },
      onMessage: { addListener() {} },
    });
    await tick();
    assert(reads === 1, "first read");
    const change = (key, value) => {
      const old = current[key];
      current = Object.assign({}, current, { [key]: value });
      listener({ [key]: { oldValue: old, newValue: value } }, "local");
    };
    // Allow on another site, then the legacy mirror write that follows it.
    change("siteOverrides", { "other.example": { enabled: false } });
    change("generalAllowedOrigins", ["http://other.example", "https://other.example"]);
    await tick();
    assert(reads === 1, "a change for another site re-read storage: " + reads);
    // Allow on this site: the frame must re-read and remove the sheet.
    change("siteOverrides", { "other.example": { enabled: false }, "news.example": { enabled: false } });
    await tick();
    assert(reads === 2, "a change for this site must re-read: " + reads);
    assert(doc.adoptedStyleSheets.length === 0, "Allow on this site removes the sheet");
    // The settings switch for the cosmetic feature affects every site.
    change("siteOverrides", { "other.example": { enabled: false } });
    await tick();
    assert(reads === 3 && doc.adoptedStyleSheets.length === 1, "the sheet comes back");
    change("settings", { v: 1, enabled: true, features: { cosmetic: false } });
    await tick();
    assert(reads === 4 && doc.adoptedStyleSheets.length === 0, "cosmetic off removes the sheet");
    // A new rule set (cosMeta) always re-reads.
    change("cosMeta", { source: "refresh", updatedAt: 2 });
    await tick();
    assert(reads === 5, "cosMeta change re-reads");
  });
});
