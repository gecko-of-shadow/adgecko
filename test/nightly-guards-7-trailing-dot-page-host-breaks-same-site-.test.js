// Nightly verification: a page reached through its fully qualified host name
// ("news.example.", trailing dot) must still treat its own host as same site.
import popupsSource from "../src/guards/popups.js" with { type: "text" };
import { unwrapMain } from "./fixtures/main-source.mjs";
function assert(c, l) { if (!c) throw new Error(l); }
const loadPop = () => { const api = {}; new Function(`${unwrapMain(popupsSource)}\nreturn installPopupGuard;`)()(api); return api; };

Deno.test("popup guard: trailing-dot page host is the same site as its dotless form", () => {
  const g = loadPop();
  const page = new URL("https://news.example./article");
  // The URL parser (as location does in Chrome) keeps the trailing dot.
  assert(page.hostname === "news.example.", "hostname keeps the dot: " + page.hostname);
  const loc = { href: page.href, hostname: page.hostname };
  const ctx = (o) => Object.assign({ location: loc, activation: true, opensThisGesture: 0, lastClickTarget: {}, lastClickInteractive: true }, o);
  // Relative URL resolves to the same dotted host: allowed (sanity).
  assert(g.judge("/login", ctx({ activation: false })) === null, "relative same-host popup");
  // The site's own login window, written with the dotless host.
  const r1 = g.judge("https://news.example/login", ctx({ activation: false }));
  assert(r1 === null, "own login popup without gesture judged: " + r1);
  const r2 = g.judge("https://checkout.news.example/pay", ctx({ lastClickInteractive: false }));
  assert(r2 === null, "own subdomain popup from a page-content click judged: " + r2);
  assert(g.siteOf("news.example.") === g.siteOf("news.example"), "siteOf: " + g.siteOf("news.example.") + " vs " + g.siteOf("news.example"));
});
