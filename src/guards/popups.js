// Page guard "guardPopups" (default OFF: false positives are likely; never on
// Twitch/YouTube/Kick). MAIN world, document_start, all frames, plus
// about:blank / srcdoc / blob: frames of ordinary sites.
// Blocks window.open() calls that come without a user gesture, a second
// window opened in the same gesture, and "popunders": a click on plain page
// content (not a link, button or form control) that opens another site.
// Logins and share dialogs on the allowed list always open. Per-site override
// through the popup's feature list. Fail-open on any internal error.
// "Same site" (security review L-17) compares registrable domains: a.co.uk and
// evil.co.uk differ, so do x.github.io and y.github.io. The data is a small
// copy of src/threat/psl.js (generic second-level labels, wildcard TLDs and
// shared-platform parents; test/psl.test.js keeps the copies equal). Clicks
// inside shadow DOM are judged by the real clicked node (composedPath).
// The page shares this JavaScript world, so the built-ins and getters the
// decision uses are captured when this file runs, before any page script
// (follow-up review: Array.prototype.some poisoning let popups through).
// Switch: flag "guardPopups" from src/settings/flags.js (read at use time).
// Wrapped in one function so the page sees no globals from this file (L-18).
(() => {
const apply = Reflect.apply;
const sLower = String.prototype.toLowerCase;
const sSlice = String.prototype.slice;
const sLastIndexOf = String.prototype.lastIndexOf;
const StringFn = String;
const URLCtor = typeof URL === "function" ? URL : null;
const urlGetter = (k) => {
  try {
    const d = URLCtor && Object.getOwnPropertyDescriptor(URLCtor.prototype, k);
    return d && typeof d.get === "function" ? d.get : null;
  } catch {
    return null;
  }
};
const urlProtocol = urlGetter("protocol");
const urlHostname = urlGetter("hostname");
const urlHref = urlGetter("href");
const dateNow = Date.now;

function installPopupGuard(target) {
  // Destinations that legitimately open in a new window (sign-in, payment,
  // share dialogs). A host matches itself and its subdomains.
  const ALLOWED_DESTINATIONS = [
    "accounts.google.com", "login.microsoftonline.com", "login.live.com", "appleid.apple.com", "github.com", "gitlab.com",
    "paypal.com", "stripe.com", "checkout.stripe.com", "auth0.com", "okta.com",
    "facebook.com", "twitter.com", "x.com", "linkedin.com", "reddit.com", "pinterest.com", "t.me", "wa.me", "api.whatsapp.com",
  ];
  const INTERACTIVE = "a[href],button,input[type=button],input[type=submit],input[type=image],[role=button],[role=link],summary,select,label";
  // Copy of src/threat/psl.js DATA.generic / .wildcardTlds / .platforms.
  const PSL = /*POPUP-PSL-START*/{"generic":["ac","agro","ai","al","art","arts","asso","biz","ca","cn","co","com","coop","ed","edu","eng","fin","firm","fm","gen","go","gob","gouv","gov","hotel","ia","id","in","ind","inf","info","int","io","it","k12","ltd","me","med","mi","mil","mo","mobi","ms","museum","name","ne","net","ngo","nic","nom","nt","or","org","pe","per","pol","pr","prd","press","priv","pro","re","rec","sa","sc","sch","school","shop","store","tm","tourism","tur","tv","va","web"],"wildcardTlds":["ck","er","fk","jm","mm","np","pg"],"platforms":["000webhostapp.com","akamai.net","akamaihd.net","akamaized.net","amazon.com","amazonaws.com","amplifyapp.com","apple.com","appspot.com","awsapprunner.com","azure-api.net","azureedge.net","azurefd.net","azurestaticapps.net","azurewebsites.net","b-cdn.net","backblazeb2.com","bitbucket.org","blob.core.windows.net","blogspot.com","carrd.co","cdn77.org","cdnjs.cloudflare.com","cloudapp.azure.com","cloudapp.net","cloudflare.com","cloudflare.net","cloudfront.net","cloudfunctions.net","ddns.net","digitaloceanspaces.com","discord.com","discordapp.com","discordapp.net","docs.google.com","drive.google.com","dropbox.com","dropboxusercontent.com","duckdns.org","dynu.net","edgekey.net","edgesuite.net","elasticbeanstalk.com","facebook.com","fastly.net","fastlylb.net","fbcdn.net","firebaseapp.com","fly.dev","framer.app","github.com","github.io","githubusercontent.com","gitlab.com","gitlab.io","glitch.me","googleapis.com","googleusercontent.com","gstatic.com","herokuapp.com","herokudns.com","instagram.com","jsdelivr.net","linodeobjects.com","live.com","loca.lt","mediafire.com","medium.com","mega.nz","microsoft.com","myshopify.com","neocities.org","netlify.app","netlify.com","ngrok-free.app","ngrok.app","ngrok.dev","ngrok.io","no-ip.org","notion.site","now.sh","office.com","on.aws","ondigitalocean.app","onedrive.live.com","onrender.com","oraclecloud.com","pages.dev","pastebin.com","r2.dev","railway.app","redd.it","reddit.com","repl.co","replit.dev","run.app","sharepoint.com","sites.google.com","squarespace.com","substack.com","surge.sh","t.me","telegram.org","trafficmanager.net","trycloudflare.com","tumblr.com","twitter.com","unpkg.com","vercel.app","web.app","web.core.windows.net","webflow.io","weebly.com","wikipedia.org","windows.net","wixsite.com","wordpress.com","workers.dev","wpcomstaging.com","x.com"]}/*POPUP-PSL-END*/;
  // Prototype-free lookup tables and a plain array: no Set or iterator the
  // page could replace.
  const table = (list) => {
    const o = Object.create(null);
    for (let i = 0; i < list.length; i++) o[list[i]] = true;
    return o;
  };
  const generic = table(PSL.generic || []);
  const wildcardTlds = table(PSL.wildcardTlds || []);
  const platforms = PSL.platforms || [];
  const labelCount = (s) => {
    let n = 1;
    for (let i = 0; i < s.length; i++) if (s[i] === ".") n++;
    return n;
  };

  const lower = (s) => apply(sLower, s, []);
  const endsWithDot = (h, d) => h.length > d.length && apply(sSlice, h, [h.length - d.length - 1]) === "." + d;
  const under = (h, d) => h === d || endsWithDot(h, d);
  // The last `n` labels of a host name.
  function lastLabels(h, n) {
    let i = h.length;
    for (let k = 0; k < n; k++) {
      i = apply(sLastIndexOf, h, [".", i - 1]);
      if (i < 0) return h;
    }
    return apply(sSlice, h, [i + 1]);
  }

  // Registrable domain ("site") of a host under this small subset.
  function siteOf(host) {
    const h = lower(StringFn(host || ""));
    if (!h) return "";
    for (let i = 0; i < platforms.length; i++) if (endsWithDot(h, platforms[i])) return lastLabels(h, labelCount(platforms[i]) + 1);
    const two = lastLabels(h, 2);
    const dot = apply(sLastIndexOf, two, ["."]);
    const sld = dot > 0 ? apply(sSlice, two, [0, dot]) : "";
    const tld = dot > 0 ? apply(sSlice, two, [dot + 1]) : two;
    if ((tld.length === 2 && generic[sld] === true) || wildcardTlds[tld] === true) return lastLabels(h, 3);
    return two;
  }

  function sameSiteOrAllowed(url, pageLocation) {
    let u;
    try {
      u = new URLCtor(StringFn(url == null ? "" : url), pageLocation.href);
    } catch {
      return true; // unparsable: let the browser decide (fail open)
    }
    const protocol = urlProtocol ? apply(urlProtocol, u, []) : u.protocol;
    if (protocol !== "http:" && protocol !== "https:") return (urlHref ? apply(urlHref, u, []) : u.href) === "about:blank";
    const host = lower(urlHostname ? apply(urlHostname, u, []) : u.hostname);
    const pageHost = lower(StringFn(pageLocation.hostname || ""));
    if (host === pageHost || siteOf(host) === siteOf(pageHost)) return true;
    for (let i = 0; i < ALLOWED_DESTINATIONS.length; i++) if (under(host, ALLOWED_DESTINATIONS[i])) return true;
    return false;
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
  target.PSL = PSL;
  target.judge = judge;
  target.siteOf = siteOf;
  target.sameSiteOrAllowed = sameSiteOrAllowed;

  // env: { window, document, navigator, location, now(), flagOn() }
  target.install = function install(env) {
    const win = env.window;
    const now = env.now || (() => apply(dateNow, Date, []));
    const flagOn = env.flagOn || (() => false);
    let lastClick = null;
    let opens = 0;
    const getter = (proto, key) => {
      try {
        const d = proto && Object.getOwnPropertyDescriptor(proto, key);
        return d && typeof d.get === "function" ? d.get : null;
      } catch {
        return null;
      }
    };
    const protoOf = (C) => (C && C.prototype) || null;
    const closestFn = protoOf(win.Element) && typeof win.Element.prototype.closest === "function" ? win.Element.prototype.closest : null;
    const composedPathFn = protoOf(win.Event) && typeof win.Event.prototype.composedPath === "function" ? win.Event.prototype.composedPath : null;
    const targetGet = getter(protoOf(win.Event), "target");
    const parentElementGet = getter(protoOf(win.Node), "parentElement");
    const isActiveGet = getter(protoOf(win.UserActivation), "isActive");
    const ua = env.navigator && env.navigator.userActivation;
    // The real clicked node: the first entry of composedPath() (inside open or
    // closed shadow roots), else event.target.
    const clickedNode = (e) => {
      try {
        if (composedPathFn) {
          const path = apply(composedPathFn, e, []);
          if (path && path.length) return path[0];
        }
      } catch {
        // fall through
      }
      return targetGet ? apply(targetGet, e, []) : e.target;
    };
    const interactive = (node) => {
      try {
        if (!node) return false;
        let n = node;
        if (closestFn) {
          // A text node has no closest(): start from its parent element.
          try {
            return !!apply(closestFn, n, [INTERACTIVE]);
          } catch {
            n = parentElementGet ? apply(parentElementGet, n, []) : n.parentElement;
            return n ? !!apply(closestFn, n, [INTERACTIVE]) : false;
          }
        }
        if (typeof n.closest === "function") return !!n.closest(INTERACTIVE);
      } catch {
        // fail open below
      }
      return true;
    };
    try {
      env.document.addEventListener("click", (e) => {
        try {
          if (!e || e.isTrusted !== true) return;
          const t = clickedNode(e);
          lastClick = { at: now(), target: t, interactive: interactive(t) };
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
              const activation = ua ? (isActiveGet ? apply(isActiveGet, ua, []) : ua.isActive) === true : true;
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
          return apply(fn, self, args);
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
