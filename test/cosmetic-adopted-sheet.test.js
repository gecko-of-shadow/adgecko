// The hide CSS goes into a constructed sheet in document.adoptedStyleSheets,
// not into a <style> node under <html>. A node there breaks React 18
// whole-document hydration (hydrateRoot(document)): React finds a <style>
// where it expects <head>, renders the whole document again, and the node
// is lost. The <style> path stays as a fallback when the sheet API fails.
import "../src/settings/features.js";
import "../src/general/cosmetic-parse.js";
import source from "../src/cosmetic.js" with { type: "text" };

function assert(c, l) { if (!c) throw new Error(l); }
const P = globalThis.GeneralCosmeticParse;
const install = new Function(`${source}\nreturn installCosmeticHide;`)();

class FakeSheet {
  constructor() { this.text = ""; this.writes = 0; }
  replaceSync(t) { this.text = t; this.writes += 1; }
}

function makeDoc({ adopted = true } = {}) {
  const children = [];
  const listeners = {};
  const doc = {
    readyState: "loading",
    styleNodes: children,
    documentElement: {
      appendChild(el) { el.isConnected = true; children.push(el); },
    },
    createElement() {
      const el = {
        id: "", textContent: "", isConnected: false,
        remove() { el.isConnected = false; children.splice(children.indexOf(el), 1); },
      };
      return el;
    },
    getElementById(id) { return children.find((c) => c.id === id) || null; },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    fire(type) { for (const fn of listeners[type] || []) fn(); },
  };
  // "load" fires on window, "DOMContentLoaded" on document (both bubble to window).
  doc.win = { addEventListener(type, fn) { (listeners[type] ||= []).push(fn); } };
  if (adopted) doc.adoptedStyleSheets = [];
  return doc;
}

const stored = { cosMeta: { source: "refresh" }, cosG: ".ad-box", "cosS:news.example": [".site-ad"] };
const state = () => ({ stored, enabled: true, allowedOrigins: [] });

async function withDoc(doc, fn, sheetCtor = FakeSheet) {
  const prev = { document: globalThis.document, window: globalThis.window, CSSStyleSheet: globalThis.CSSStyleSheet, MutationObserver: globalThis.MutationObserver };
  globalThis.document = doc;
  globalThis.window = doc.win;
  globalThis.CSSStyleSheet = sheetCtor;
  const observers = [];
  globalThis.MutationObserver = class {
    constructor(cb) { this.cb = cb; this.targets = []; observers.push(this); }
    observe(t) { this.targets.push(t); }
    disconnect() { this.targets = []; }
  };
  try {
    const api = { hostname: "news.example", href: "https://news.example/", isTop: true, parse: P };
    install(api);
    await fn(api, observers);
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete globalThis[k];
      else globalThis[k] = v;
    }
  }
}

Deno.test("adopted sheet: applyState hides through adoptedStyleSheets, with no <style> node", async () => {
  const doc = makeDoc();
  await withDoc(doc, async (api) => {
    assert(await api.applyState(state()) === true, "applied");
    assert(doc.styleNodes.length === 0, "no <style> node under <html>");
    assert(doc.adoptedStyleSheets.length === 1, "one adopted sheet");
    const css = doc.adoptedStyleSheets[0].text;
    assert(css.includes(".ad-box{display:none!important}") && css.includes(".site-ad{display:none!important}"), "the sheet hides: " + css);
    // A second apply reuses the same sheet.
    await api.applyState(state());
    assert(doc.adoptedStyleSheets.length === 1, "still one adopted sheet");
    // The page's own adopted sheets stay.
    const own = new FakeSheet();
    doc.adoptedStyleSheets = [own, ...doc.adoptedStyleSheets];
    api.removeStyle();
    assert(doc.adoptedStyleSheets.length === 1 && doc.adoptedStyleSheets[0] === own, "removeStyle removes only our sheet");
    assert(await api.applyState({ stored, enabled: false, allowedOrigins: [] }) === false, "master off");
    assert(doc.adoptedStyleSheets.length === 1, "nothing adopted while off");
  });
});

Deno.test("adopted sheet: the sheet is adopted again at DOMContentLoaded and load when the page dropped it", async () => {
  const doc = makeDoc();
  await withDoc(doc, async (api) => {
    await api.applyState(state());
    doc.adoptedStyleSheets = [];
    doc.fire("DOMContentLoaded");
    assert(doc.adoptedStyleSheets.length === 1, "re-adopted at DOMContentLoaded");
    doc.adoptedStyleSheets = [];
    doc.fire("load");
    assert(doc.adoptedStyleSheets.length === 1, "re-adopted at load");
    api.removeStyle();
    doc.fire("load");
    assert(doc.adoptedStyleSheets.length === 0, "a removed sheet is not adopted again");
  });
});

Deno.test("adopted sheet: when the sheet API fails, the <style> fallback is used and put back", async () => {
  for (const [label, doc, ctor] of [
    ["no adoptedStyleSheets", makeDoc({ adopted: false }), FakeSheet],
    ["the constructor throws", makeDoc(), class { constructor() { throw new Error("no"); } }],
  ]) {
    await withDoc(doc, async (api, observers) => {
      assert(await api.applyState(state()) === true, label + ": applied");
      const el = doc.getElementById(api.STYLE_ID);
      assert(el && el.textContent.includes(".ad-box"), label + ": <style> fallback with the CSS");
      assert(!doc.adoptedStyleSheets || doc.adoptedStyleSheets.length === 0, label + ": nothing adopted");
      // The page (or a hydration re-render) removes the node: it comes back.
      el.remove();
      for (const o of observers) if (o.targets.length) o.cb([]);
      const back = doc.getElementById(api.STYLE_ID);
      assert(back && back.textContent.includes(".ad-box"), label + ": the <style> node is put back");
      api.removeStyle();
      for (const o of observers) if (o.targets.length) o.cb([]);
      assert(!doc.getElementById(api.STYLE_ID), label + ": a removed node stays removed");
    }, ctor);
  }
});
