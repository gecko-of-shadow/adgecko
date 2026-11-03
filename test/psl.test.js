// Block 1e (security review M-3, L-3, I-5): public-suffix / shared-platform
// guard for the threat tier, the signed feed, the ordinary list tier and the
// "Allow this domain" box; per-refresh cap on new threat hosts.
import "../src/general/filter-options.js";
import "../src/threat/psl.js";
import "../src/threat/protected-hosts.js";
import "../src/threat/compile.js";
import "../src/feed/canonical.js";
import "../src/feed/schema.js";
import updateSource from "../src/general/update.js" with { type: "text" };
import pslSource from "../src/threat/psl.js" with { type: "text" };
import threat from "../src/rules/threat-network.json" with { type: "json" };
import snapshot from "../src/rules/threat-snapshot.json" with { type: "json" };
import manifest from "../manifest.json" with { type: "json" };
import settingsHtml from "../src/settings.html" with { type: "text" };
import workerSource from "../src/general-background.js" with { type: "text" };
function assert(c, l) { if (!c) throw new Error(l); }
const PS = globalThis.GeckoPublicSuffix;
const PH = globalThis.GeckoProtectedHosts;
const TC = globalThis.GeckoThreatCompile;
const U = {};
new Function(`${updateSource}\nreturn installGeneralAdblockUpdate;`)()(U);
const ROOT = new URL("..", import.meta.url);

// Never blockable as a whole (nor their parents): suffixes, shared platforms, big sites.
const REJECT = ["co.uk", "com.au", "co.jp", "github.io", "githubusercontent.com", "gitlab.io", "pages.dev", "workers.dev", "r2.dev",
  "amazonaws.com", "s3.amazonaws.com", "cloudfront.net", "blogspot.com", "netlify.app", "vercel.app", "herokuapp.com",
  "web.app", "firebaseapp.com", "appspot.com", "azurewebsites.net", "blob.core.windows.net", "core.windows.net", "windows.net",
  "docs.google.com", "drive.google.com", "sites.google.com", "github.com", "dropbox.com", "sharepoint.com", "discordapp.com", "ngrok.io",
  "duckdns.org", "x.ck", "pisz.pl", "uk", "com",
  // PSL PRIVATE parents the first subset missed (follow-up review).
  "ru.com", "webhop.me", "3utilities.com", "cprapid.com", "fastvps-server.com"];
// Customers' own hosts under those stay blockable.
const ALLOW = ["evil.github.io", "phish.co.uk", "bad.blogspot.com", "d123abc.cloudfront.net", "malware-drop.example", "x.pages.dev",
  "bucket.s3.amazonaws.com", "t.co", "a.b.c.example", "203.0.113.5", "evil.ngrok.io", "tenant.sharepoint.com",
  // Real sites a generic "<label>.<cc>" rule wrongly called suffixes (follow-up review).
  "web.de", "id.me", "pro.de", "me.ly", "co.nf", "evil.ru.com"];

Deno.test("psl: public suffixes, shared platforms, big sites and their parents are refused; their customers' hosts are not", () => {
  for (const h of REJECT) assert(PS.suffixReason(h), "should be refused: " + h);
  for (const h of ALLOW) assert(PS.suffixReason(h) === null, "should be blockable: " + h + " (" + PS.suffixReason(h) + ")");
  for (const h of REJECT) assert(PH.protectedReason(h), "threat check refuses " + h);
  // The threat tier keeps its older, stricter two-label heuristic ("co.<tld>" etc.): co.nf stays refused there.
  for (const h of ALLOW.filter((x) => x !== "co.nf")) assert(PH.protectedReason(h) === null, "threat check blocks " + h + ": " + PH.protectedReason(h));
  assert(/public suffix/.test(PH.protectedReason("co.nf")), "heuristic still applies in the threat tier");
  assert(PS.registrableDomain("a.b.example.co.uk") === "example.co.uk" && PS.registrableDomain("x.github.io") === "x.github.io" && PS.registrableDomain("www.news.example") === "news.example", "registrable domain");
});

Deno.test("threat check: non-public IPv4 literals are refused, public ones allowed; without the PSL data nothing is accepted", () => {
  for (const ip of ["0.0.0.0", "10.0.0.1", "127.0.0.1", "169.254.1.1", "172.16.0.1", "172.31.255.255", "192.168.1.1", "100.64.0.1", "224.0.0.1", "255.255.255.255"]) { // privacy-check: allow (multicast)
    assert(PH.protectedReason(ip), "refuse " + ip);
  }
  // Just outside the 172.16/12 and 100.64/10 ranges.
  for (const ip of ["198.51.100.8", "172.32.0.1", "100.128.0.1", "192.0.2.10"]) assert(PH.protectedReason(ip) === null, "allow " + ip); // privacy-check: allow
  const saved = globalThis.GeckoPublicSuffix;
  try {
    delete globalThis.GeckoPublicSuffix;
    assert(PH.protectedReason("malware-drop.example") === "public-suffix data not loaded", "fails closed");
    assert(TC.normalizeUserDomain("example.com") === null, "allow box refuses without data");
  } finally {
    globalThis.GeckoPublicSuffix = saved;
  }
});

Deno.test("threat compiler and signed feed refuse platform names", () => {
  const c = TC.compileThreatRules(["evil.github.io", "github.io", "amazonaws.com", "co.uk", "bad.example"], { idBase: 1 });
  const blocked = c.rules.flatMap((r) => r.condition.requestDomains);
  assert(JSON.stringify(blocked) === JSON.stringify(["evil.github.io", "bad.example"]), JSON.stringify(blocked));
  assert(c.rejected.map((r) => r.host).join() === "github.io,amazonaws.com,co.uk", JSON.stringify(c.rejected));
  const S = globalThis.GeckoFeedSchema;
  let msg = "";
  try {
    S.validateSnapshot({ format: 1, snapshot: true, createdAt: "2026-11-02T00:00:00Z", dnr: [{ id: 1, requestDomains: ["bad.example", "pages.dev"] }] }, {});
  } catch (e) {
    msg = String(e && e.message);
  }
  assert(/pages\.dev rejected: (public suffix|shared platform) pages\.dev/.test(msg), "feed refuses a platform host: " + msg);
});

Deno.test("allow box: same validator (platforms and suffixes refused, one site under them accepted)", () => {
  for (const d of ["github.io", "co.uk", "*.github.io", "https://pages.dev/x", "amazonaws.com"]) assert(TC.normalizeUserDomain(d) === null, "refuse " + d);
  assert(TC.userDomainReason("github.io").reason.includes("github.io"), "reason names the platform");
  assert(TC.normalizeUserDomain("me.github.io") === "me.github.io", "a site under a platform");
  assert(TC.normalizeUserDomain("https://www.example.com/path?q") === "www.example.com", "url input");
  const rules = TC.buildUserAllowRules(["github.io", "me.github.io", "co.uk"], 950000);
  assert(rules.length === 1 && rules[0].condition.requestDomains[0] === "me.github.io", "stored platform entries make no allow rule");
  assert(/<script src="threat\/psl\.js"><\/script>\s*<script src="threat\/compile\.js">/.test(settingsHtml), "settings page loads the data first");
  const order = /importScripts\(([\s\S]*?)\);/.exec(workerSource)[1];
  assert(order.indexOf('"threat/psl.js"') >= 0 && order.indexOf('"threat/psl.js"') < order.indexOf('"threat/protected-hosts.js"') && order.indexOf('"threat/psl.js"') < order.indexOf('"general/update.js"'), "worker loads psl.js before its users");
});

Deno.test("ordinary list tier: public suffixes and non-public IPs never become rules (parse and stored payloads); JS and the packer agree", async () => {
  const text = ["||co.uk^", "||phish.co.uk^", "||192.168.0.1^", "||203.0.113.44^", "0.0.0.0 10.0.0.5", "0.0.0.0 ads.example", "||github.io^$third-party", "||0.0.0.1^", "duckdns.org", "||t.co^"].join("\n");
  const p = U.parseEntries(text);
  const all = [...p.domains, ...p.scoped.map((e) => e[0])].sort();
  // ICANN suffixes only here: private parents (github.io, duckdns.org) stay up to the lists.
  assert(JSON.stringify(all) === JSON.stringify(["203.0.113.44", "ads.example", "duckdns.org", "github.io", "phish.co.uk", "t.co"]), JSON.stringify(all));
  // A payload stored by an older version still holding them: filtered when rules are built.
  const rules = U.buildListRules(["co.uk", "ok.example", "127.0.0.1"], [["com.au", "p=3p|t=|x="], ["github.io", "p=3p|t=|x="]]);
  const domains = rules.flatMap((r) => r.condition.requestDomains);
  assert(JSON.stringify(domains) === JSON.stringify(["ok.example", "github.io"]), JSON.stringify(domains));
  // Packer parity on the same hosts.
  const hosts = ["co.uk", "phish.co.uk", "192.168.0.1", "203.0.113.44", "10.0.0.5", "ads.example", "github.io", "0.0.0.1", "duckdns.org", "t.co", "a.se", "x.ck", "pisz.pl", "evil.github.io", "com.au", "blogspot.com", "s3.amazonaws.com", "amazonaws.com"];
  const script = [
    "import importlib.util, json, sys",
    "s = importlib.util.spec_from_file_location('p', 'scripts/pack-filter-lists.py')",
    "m = importlib.util.module_from_spec(s); s.loader.exec_module(m)",
    "print(json.dumps([m.looks_like_domain(h) for h in json.loads(sys.argv[1])]))",
  ].join("\n");
  const out = await new Deno.Command("python3", { args: ["-B", "-c", script, JSON.stringify(hosts)], cwd: ROOT, stdout: "piped", stderr: "piped" }).output();
  assert(out.code === 0, new TextDecoder().decode(out.stderr));
  const py = JSON.parse(new TextDecoder().decode(out.stdout));
  const js = hosts.map((h) => U.parseEntries("||" + h + "^").domains.length === 1);
  assert(JSON.stringify(py) === JSON.stringify(js), "packer " + JSON.stringify(py) + " vs runtime " + JSON.stringify(js));
});

Deno.test("every host in the shipped threat ruleset and snapshot passes the new checks", () => {
  const hosts = threat.flatMap((r) => r.condition.requestDomains).concat(snapshot.dnr.flatMap((e) => e.requestDomains));
  const bad = hosts.filter((h) => PH.protectedReason(h));
  assert(hosts.length > 30000 && bad.length === 0, "shipped threat hosts refused: " + bad.slice(0, 10).join());
});

Deno.test("psl.js: the generated data is small, MPL-attributed and names its PSL version", () => {
  // Loaded only by the worker and the settings page, never by web pages.
  assert(pslSource.length < 120000, "psl.js size " + pslSource.length);
  assert(!manifest.content_scripts.some((c) => (c.js || []).includes("src/threat/psl.js")), "psl.js must not be a content script");
  assert(/Mozilla Public License 2\.0/.test(pslSource) && /VERSION \d{4}-\d{2}-\d{2}/.test(pslSource), "attribution + version");
  const d = PS.DATA;
  assert(d.generic.includes("co") && d.generic.includes("com") && !d.generic.includes("t"), "generic labels (popup guard data)");
  assert(d.suffixes.includes("co.uk") && !d.suffixes.includes("github.io") && d.privateSuffixes.includes("github.io") && d.privateSuffixes.includes("ru.com"), "ICANN and private parts");
  assert(PS.isIcannSuffix("co.uk") && !PS.isIcannSuffix("github.io") && PS.isPublicSuffix("github.io") && !PS.isPublicSuffix("web.de"), "ICANN vs public");
  assert(["github.io", "amazonaws.com", "blogspot.com", "pages.dev"].every((x) => d.platforms.includes(x)), "platform list");
  assert(manifest.background.service_worker === "src/general-background.js", "worker");
});

// Per-refresh cap on new threat hosts (absolute and share of the previous set).
function capDeps(previousHosts, packed) {
  let dynamic = previousHosts.length ? [{ id: U.THREAT_RULE_ID_BASE, priority: 2000010, action: { type: "block" }, condition: { requestDomains: previousHosts, resourceTypes: ["main_frame"] } }] : [];
  const state = {};
  const deps = {
    get dynamic() { return dynamic; }, state,
    getDynamicRules: async () => dynamic.slice(),
    updateDynamicRules: async ({ removeRuleIds, addRules }) => { dynamic = dynamic.filter((r) => !removeRuleIds.includes(r.id)).concat(addRules); },
    getState: async () => structuredClone(state),
    setState: async (p) => Object.assign(state, structuredClone(p)),
    threatEnabled: () => true,
  };
  if (packed) deps.loadPackedThreatRules = async () => [{ id: 1, condition: { requestDomains: packed } }];
  return deps;
}
const hostsN = (n, tag) => Array.from({ length: n }, (_, i) => `h${i}-${tag}.example`);
const blockedHosts = (deps) => deps.dynamic.flatMap((r) => r.condition.requestDomains);

Deno.test("threat refresh: too many new hosts at once keep the previous rules; the same jump seen twice is accepted", async () => {
  const before = hostsN(1000, "a");
  const d = capDeps(before);
  // 30% new (> 20%): held.
  let r = await U.applyThreatRules(d, { urlhaus_hosts: { domains: before.concat(hostsN(300, "b")), scoped: [] } }, 1);
  assert(r.ok === false && r.held && blockedHosts(d).length === 1000 && d.state.threatRejectedNew === 300 && /too many new threat hosts/.test(d.state.threatError), JSON.stringify(r));
  // Re-applying stored payloads (threat tier off and on) is not a new download: still held.
  r = await U.applyThreatRules(d, { urlhaus_hosts: { domains: before.concat(hostsN(305, "b")), scoped: [] } }, 2);
  assert(r.held && blockedHosts(d).length === 1000, "re-applied payloads confirmed a held jump");
  // Next refresh with a fresh download, similar jump (310, within 10%): accepted as real.
  r = await U.applyThreatRules(d, { urlhaus_hosts: { domains: before.concat(hostsN(310, "b")), scoped: [] } }, 3, { downloaded: true });
  assert(r.ok && blockedHosts(d).length === 1310 && d.state.threatRejectedNew === 0 && d.state.threatError === "", JSON.stringify(r));
  // Small change (5% new): applied at once.
  r = await U.applyThreatRules(d, { urlhaus_hosts: { domains: before.concat(hostsN(310, "b"), hostsN(60, "c")), scoped: [] } }, 4);
  assert(r.ok && blockedHosts(d).length === 1370, "small change applied");
  // A hold is forgotten when the threat rules are removed (switch off / revert).
  await U.applyThreatRules(d, { urlhaus_hosts: { domains: before.concat(hostsN(310, "b"), hostsN(60, "c"), hostsN(900, "d")), scoped: [] } }, 5);
  assert(d.state.threatRejectedNew === 900, "held again");
  await U.removeThreatRules(d);
  assert(d.state.threatRejectedNew === 0 && d.state.threatHeldAt === 0, "removeThreatRules clears the hold");
});

Deno.test("threat refresh: absolute cap, and the packed ruleset is the baseline on the first refresh", async () => {
  const big = hostsN(20000, "a");
  const d = capDeps(big);
  const r = await U.applyThreatRules(d, { urlhaus_hosts: { domains: big.concat(hostsN(2600, "n")), scoped: [] } }, 1);
  assert(r.held && blockedHosts(d).length === 20000, "13% new but over 2,500: held");
  const first = capDeps([], hostsN(1000, "a"));
  const r2 = await U.applyThreatRules(first, { urlhaus_hosts: { domains: hostsN(1000, "a").concat(hostsN(400, "z")), scoped: [] } }, 1);
  assert(r2.held && blockedHosts(first).length === 0, "first refresh compared with the packed ruleset");
  const r3 = await U.applyThreatRules(capDeps([], hostsN(1000, "a")), { urlhaus_hosts: { domains: hostsN(1000, "a").concat(hostsN(50, "z")), scoped: [] } }, 1);
  assert(r3.ok, "first refresh close to the packed set applies");
});

Deno.test("feed-sign.mjs loads psl.js before protected-hosts.js (follow-up review)", () => {
  const src = Deno.readTextFileSync(new URL("../scripts/feed-sign.mjs", import.meta.url));
  const i = src.indexOf('"src/threat/psl.js"');
  assert(i > 0 && i < src.indexOf('"src/threat/protected-hosts.js"'), "feed-sign would refuse every host");
});

// Security review L-17 + follow-up review: the popup guard's same-site check
// uses registrable domains from a small copy of psl.js, and its decision path
// survives poisoned built-ins.
import popupsSource from "../src/guards/popups.js" with { type: "text" };
import { unwrapMain } from "./fixtures/main-source.mjs";
Deno.test("popup guard: registrable-domain same-site check, copy of psl.js data, poisoned built-ins, shadow-DOM clicks", () => {
  const m = /\/\*POPUP-PSL-START\*\/([\s\S]*?)\/\*POPUP-PSL-END\*\//.exec(popupsSource);
  const copy = JSON.parse(m[1]);
  assert(JSON.stringify(copy) === JSON.stringify({ generic: PS.DATA.generic, wildcardTlds: PS.DATA.wildcardTlds, platforms: PS.DATA.platforms }), "popups.js copy differs from psl.js (re-run scripts/build-psl-subset.mjs)");
  const g = {};
  new Function(`${unwrapMain(popupsSource)}\nreturn installPopupGuard;`)()(g);
  const loc = (h) => ({ href: "https://" + h + "/", hostname: h });
  assert(!g.sameSiteOrAllowed("https://evil.co.uk/x", loc("a.co.uk")), "a.co.uk vs evil.co.uk are different sites");
  assert(!g.sameSiteOrAllowed("https://y.github.io/x", loc("x.github.io")), "x.github.io vs y.github.io are different sites");
  assert(g.sameSiteOrAllowed("https://cdn.news.example/x", loc("www.news.example")), "same registrable domain");
  assert(g.sameSiteOrAllowed("https://shop.example.co.uk/x", loc("www.example.co.uk")), "same site under co.uk");
  assert(g.siteOf("a.b.example.co.uk") === "example.co.uk" && g.siteOf("x.github.io") === "x.github.io" && g.siteOf("deep.x.github.io") === "x.github.io", "siteOf");
  const saved = { some: Array.prototype.some, split: String.prototype.split, lower: String.prototype.toLowerCase, has: Set.prototype.has };
  try {
    Array.prototype.some = () => true;
    String.prototype.split = () => ["x"];
    String.prototype.toLowerCase = function () { return "news.example"; };
    Set.prototype.has = () => true;
    const ctx = { location: loc("news.example"), activation: false, opensThisGesture: 0, lastClickTarget: null, lastClickInteractive: true };
    assert(g.judge("https://ads.example/x", ctx) === "no user gesture", "poisoned built-ins let a no-gesture popup through");
  } finally {
    Array.prototype.some = saved.some; String.prototype.split = saved.split; String.prototype.toLowerCase = saved.lower; Set.prototype.has = saved.has;
  }
  // A click inside a shadow root: composedPath()[0] is the real button, the event target is the plain host.
  const opened = [];
  const listeners = {};
  class Event { composedPath() { return this._path; } get target() { return this._target; } }
  const button = { tagName: "BUTTON", closest: () => button };
  const host = { tagName: "DIV", closest: () => null };
  const win = { open: (u) => { opened.push(u); return {}; }, Event };
  g.install({ window: win, document: { addEventListener: (t, f) => { listeners[t] = f; } }, navigator: { userActivation: { isActive: true } }, location: loc("news.example"), now: () => 5000, flagOn: () => true });
  const click = Object.assign(new Event(), { isTrusted: true, _path: [button, host], _target: host });
  listeners.click(click);
  win.open("https://share.example/");
  assert(opened.length === 1, "button inside a shadow root counts as a button, not page content");
});
