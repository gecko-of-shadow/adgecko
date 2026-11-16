// WP-18 (review 2026-11-16, finding "a page's first inline script can get a
// flags port"): flags.js answers "gk-r1" requests only while no page script can
// run. A parser-inserted <head> script runs in the same task as document_start,
// before setTimeout(0). The parser does a microtask checkpoint before it runs
// such a script, so a MutationObserver sees the <script> element first.
// Real EventTarget / MessageChannel; fake document and MutationObserver.
import "../src/settings/features.js";
function assert(c, l) { if (!c) throw new Error(l); }
const src = Deno.readTextFileSync(new URL("../src/settings/flags.js", import.meta.url));

function boot() {
  const store = { settings: { v: 1, enabled: true, features: { guardPopups: true } }, siteOverrides: {} };
  const chrome = {
    runtime: { lastError: undefined, sendMessage() {}, onMessage: { addListener() {} } },
    storage: { local: { get(_k, cb) { cb(structuredClone(store)); } }, onChanged: { addListener() {} } },
  };
  const win = new EventTarget();
  win.top = win;
  const doc = new EventTarget();
  const observers = [];
  class FakeMO {
    constructor(cb) { this.cb = cb; this.on = false; observers.push(this); }
    observe(target, opts) { this.on = target === doc && !!opts.childList && !!opts.subtree; }
    disconnect() { this.on = false; }
  }
  const insert = (localName) => {
    for (const o of observers) if (o.on) o.cb([{ addedNodes: [{ nodeType: 1, localName }] }]);
  };
  new Function("chrome", "window", "location", "globalThis", "document", "MutationObserver", src)(
    chrome, win, { hostname: "example.com", origin: "https://example.com" }, globalThis, doc, FakeMO);
  const ask = () => {
    let port = null;
    const take = (e) => { if (!port) port = e.ports[0]; };
    win.addEventListener("gk-p1", take, true);
    win.dispatchEvent(new Event("gk-r1"));
    win.removeEventListener("gk-p1", take, true);
    if (port) port.close();
    return port;
  };
  return { win, doc, observers, insert, ask };
}

Deno.test({
  name: "flag port: a page <script> inserted by the parser gets no port, even before the timer fires",
  sanitizeOps: false,
  sanitizeResources: false,
  fn() {
    const t = boot();
    // Extension page-world scripts injected after flags.js still get a port.
    assert(t.ask() instanceof MessagePort, "guard script injected after flags.js got no port");
    // The parser adds <html>, <head>: no script yet, the window stays open.
    t.insert("html");
    t.insert("head");
    assert(t.ask() instanceof MessagePort, "window closed before any page script");
    // The parser adds the first inline <script>; its microtask checkpoint runs
    // the observer before the script runs. Same task: the timer has not fired.
    t.insert("script");
    assert(t.ask() === null, "a page inline <head> script got a flags port");
    assert(t.observers.every((o) => !o.on), "observer not disconnected after it closed the window");
  },
});

Deno.test({
  name: "flag port: an SVG <script> also closes the window",
  sanitizeOps: false,
  sanitizeResources: false,
  fn() {
    const t = boot();
    t.insert("SCRIPT");
    assert(t.ask() === null, "page script got a flags port");
  },
});

Deno.test({
  name: "flag port: the first readystatechange closes the window (about:blank frames have no parser)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn() {
    const t = boot();
    t.doc.dispatchEvent(new Event("readystatechange"));
    assert(t.ask() === null, "a page script got a flags port after readystatechange");
  },
});
