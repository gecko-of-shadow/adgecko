// A slow fallback-sheet load must not overwrite a newer applyState result.
import "../src/settings/features.js";
import source from "../src/cosmetic.js" with { type: "text" };

function makeDoc() {
  const nodes = new Map();
  const root = {
    appendChild(el) {
      el.isConnected = true;
      nodes.set(el.id, el);
    },
  };
  return {
    documentElement: root,
    createElement() {
      const el = {
        id: "",
        textContent: "",
        isConnected: false,
        remove() {
          el.isConnected = false;
          nodes.delete(el.id);
        },
      };
      return el;
    },
    getElementById(id) {
      return nodes.get(id) || null;
    },
  };
}

Deno.test("late fallback sheet does not re-inject after master switch turned off", async () => {
  const doc = makeDoc();
  globalThis.document = doc;
  try {
    const api = {};
    const install = new Function(`${source}\nreturn installCosmeticHide;`)();
    install(api);
    api.hostname = "example.com";
    api.href = "https://example.com/";
    api.runtimeGetURL = () => "chrome-extension://test/src/cosmetic-hide.css";

    let release;
    const gate = new Promise((r) => (release = r));
    const slowFetch = () => gate.then(() => ({ ok: true, text: () => Promise.resolve(".bundled{display:none}") }));

    const first = api.applyState({ enabled: true, allowedOrigins: [], stored: {} }, slowFetch);
    const second = await api.applyState({ enabled: false, allowedOrigins: [], stored: {} }, slowFetch);
    if (second !== false) throw new Error("master off must report false");
    if (doc.getElementById(api.STYLE_ID)) throw new Error("style should be gone after master off");

    release();
    await first;

    const el = doc.getElementById(api.STYLE_ID);
    if (el) {
      throw new Error(`stale fallback load re-injected the sheet while master is off: ${JSON.stringify(el.textContent)}`);
    }
  } finally {
    delete globalThis.document;
  }
});
