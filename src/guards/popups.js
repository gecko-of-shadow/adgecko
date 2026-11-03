// Page guard "guardPopups" (default OFF: false positives are likely; never on
// Twitch/YouTube/Kick). MAIN world, document_start, all frames.
// Blocks window.open() calls that come without a user gesture, a second
// window opened in the same gesture, and "popunders": a click on plain page
// content (not a link, button or form control) that opens another site.
// Logins and share dialogs on the allowed list always open. Per-site override
// through the popup's feature list. Fail-open on any internal error.
// Switch: flag "guardPopups" from src/settings/flags.js (read at use time).
// Wrapped in one function so the page sees no globals from this file (L-18).
(() => {
function installPopupGuard(target) {
  // Destinations that legitimately open in a new window (sign-in, payment,
  // share dialogs). A host matches itself and its subdomains.
  const ALLOWED_DESTINATIONS = [
    "accounts.google.com", "login.microsoftonline.com", "login.live.com", "appleid.apple.com", "github.com", "gitlab.com",
    "paypal.com", "stripe.com", "checkout.stripe.com", "auth0.com", "okta.com",
    "facebook.com", "twitter.com", "x.com", "linkedin.com", "reddit.com", "pinterest.com", "t.me", "wa.me", "api.whatsapp.com",
  ];
  const INTERACTIVE = "a[href],button,input[type=button],input[type=submit],input[type=image],[role=button],[role=link],summary,select,label";

  function sameSiteOrAllowed(url, pageLocation) {
    let u;
    try {
      u = new URL(String(url == null ? "" : url), pageLocation.href);
    } catch {
      return true; // unparsable: let the browser decide (fail open)
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return u.href === "about:blank";
    const host = u.hostname.toLowerCase();
    const pageHost = String(pageLocation.hostname || "").toLowerCase();
    const site = (h) => h.split(".").slice(-2).join(".");
    if (host === pageHost || site(host) === site(pageHost)) return true;
    return ALLOWED_DESTINATIONS.some((d) => host === d || host.endsWith("." + d));
  }

  // -> null (allow) or the reason it is blocked.
  function judge(url, ctx) {
    if (sameSiteOrAllowed(url, ctx.location)) return null;
    if (!ctx.activation) return "no user gesture";
    if (ctx.opensThisGesture > 0) return "second window in one click";
    if (ctx.lastClickTarget && !ctx.lastClickInteractive) return "popunder (click on page content)";
    return null;
  }

  target.ALLOWED_DESTINATIONS = ALLOWED_DESTINATIONS;
  target.judge = judge;
  target.sameSiteOrAllowed = sameSiteOrAllowed;

  // env: { window, document, navigator, location, now(), flagOn() }
  target.install = function install(env) {
    const win = env.window;
    const now = env.now || (() => Date.now());
    const flagOn = env.flagOn || (() => false);
    let lastClick = null;
    let opens = 0;
    try {
      env.document.addEventListener("click", (e) => {
        try {
          if (!e || e.isTrusted !== true) return;
          const t = e.target;
          lastClick = { at: now(), target: t, interactive: !!(t && t.closest && t.closest(INTERACTIVE)) };
          opens = 0;
        } catch {
          // fail open
        }
      }, true);
    } catch {
      // no click tracking: only the gesture check applies
    }
    if (typeof win.open !== "function") return;
    const nativeOpen = win.open;
    try {
      win.open = new Proxy(nativeOpen, {
        apply(fn, self, args) {
          try {
            if (flagOn()) {
              const ua = env.navigator && env.navigator.userActivation;
              const activation = ua ? ua.isActive === true : true;
              const fresh = lastClick && now() - lastClick.at < 1000 ? lastClick : null;
              const reason = judge(args[0], {
                location: env.location, activation, opensThisGesture: fresh ? opens : 0,
                lastClickTarget: fresh ? fresh.target : null, lastClickInteractive: fresh ? fresh.interactive : true,
              });
              if (reason) return null;
              if (fresh) opens += 1;
            }
          } catch {
            // fail open
          }
          return Reflect.apply(fn, self, args);
        },
      });
    } catch {
      // stays native
    }
  };
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  try {
    // Switch "guardPopups" over the private flag port (src/settings/flags.js;
    // never window messages, which the page can forge). Off until told otherwise.
    let on = false;
    const PORT_EVENT = "gk-p1";
    let port = null;
    // Read events through MessageEvent getters captured now, before any page
    // script runs: a page that later redefines MessageEvent.prototype.data or
    // .ports can then neither rewrite nor read the flags (review of M-1). Outside
    // a browser (tests) plain property reads are used.
    const applyFn = Reflect.apply;
    const meGetter = (k) => {
      const d = Object.getOwnPropertyDescriptor(MessageEvent.prototype, k);
      return d && typeof d.get === "function" ? d.get : null;
    };
    const dataGet = meGetter("data");
    const portsGet = meGetter("ports");
    const dataOf = dataGet ? (m) => applyFn(dataGet, m, []) : (m) => m && m.data;
    const portsOf = portsGet ? (e) => applyFn(portsGet, e, []) : (e) => e && e.ports;
    const flagsOf = (m) => {
      const d = dataOf(m);
      return d && typeof d === "object" ? d.f : null;
    };
    const take = (event) => {
      const ps = portsOf(event);
      const p = ps && ps[0];
      if (port || !p) return;
      port = p;
      window.removeEventListener(PORT_EVENT, take, true);
      p.addEventListener("message", (m) => {
        const f = flagsOf(m);
        if (f && typeof f === "object" && typeof f.guardPopups === "boolean") on = f.guardPopups;
      });
      p.start();
    };
    window.addEventListener(PORT_EVENT, take, true);
    window.dispatchEvent(new Event("gk-r1"));
    const api = {};
    installPopupGuard(api);
    api.install({ window, document, navigator: typeof navigator !== "undefined" ? navigator : null, location, flagOn: () => on });
  } catch {
    // guard not installed
  }
}
})();
