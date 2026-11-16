#!/usr/bin/env -S deno run --allow-read --allow-write
// Build src/threat/psl.js: a SMALL Public Suffix List subset plus a hand-kept
// list of shared-hosting / big-platform parents (security review M-3, L-3,
// L-17). Offline: reads a PSL file you downloaded yourself from
// https://publicsuffix.org/list/public_suffix_list.dat (MPL-2.0), never fetches.
//
//   deno run --allow-read --allow-write scripts/build-psl-subset.mjs --psl <file> [--out src/threat/psl.js]
//
// What is kept (explicit names only; about 7,000 names, loaded only by the
// service worker and the settings page, never by web pages):
//   suffixes      every ICANN rule with two labels (co.uk, com.au, aichi.jp)
//                 and the base of every ICANN wildcard rule with at most 3
//                 labels. The packer uses only these.
//   icannDeep     every plain ICANN rule with 3+ labels (act.edu.au,
//                 k12.ca.us, aisai.aichi.jp), grouped as {parent: "label ..."}
//                 to keep the file small. Added to `suffixes` at load: the
//                 ordinary list tier (isIcannSuffix) uses both.
//   wildcardBases ICANN rules "*.<base>" with a 2+ label base (*.kawasaki.jp):
//                 every "<x>.<base>" is a suffix, except the "!" rules in
//   icannExceptions (city.kawasaki.jp, www.ck).
//   privateSuffixes  every plain PRIVATE rule with at most 3 labels and the
//                 base of every PRIVATE wildcard rule (github.io, ru.com,
//                 webhop.me, s3.amazonaws.com). The threat tier, the feed and
//                 the allow box use these too. Only the 2-label names are
//                 stored here; the 3-label names are stored grouped in
//                 privateDeep (file size; the set at load is the same).
//   privateDeep   the 3-label privateSuffixes, plus PRIVATE rules with 4+
//                 labels (and 4+ label bases of PRIVATE wildcard rules) under
//                 a PLATFORMS parent, e.g. the regional S3 endpoints
//                 s3.us-east-2.amazonaws.com; same grouping as icannDeep. A
//                 block on one would take out every bucket there. Joined
//                 into privateSuffixes at load.
//   wildcardTlds  ICANN rules "*.<tld>": every "<x>.<tld>" is a suffix.
//   platforms     PLATFORMS below (hand-kept): shared hosting, cloud and CDN
//                 parents and a few big sites. Never blocked themselves (nor
//                 their parents); their customers' subdomains still can be.
//   servicePlatforms  SERVICE_PLATFORMS below: the PLATFORMS entries that
//                 serve ONE service, not one subdomain per customer
//                 (facebook.com, live.com, jsdelivr.net). Every host under
//                 them is the service itself (www.facebook.com,
//                 login.live.com, cdn.jsdelivr.net), so the threat tier, the
//                 feed and the allow box refuse every host under them too
//                 (review 2026-11-16, WP-13).
//   serviceHosts  SERVICE_HOSTS below: exact shared service hosts under a
//                 per-customer parent (raw.githubusercontent.com,
//                 firebasestorage.googleapis.com). Refused with their
//                 parents; hosts under them (one per file or customer, e.g.
//                 uc<id>.dl.dropboxusercontent.com) can still be blocked.
//   generic       second-level labels (2+ characters) the PSL lists under at
//                 least three country TLDs ("co", "com", "ac", "gov", ...).
//                 Data for the popup guard's small same-site check only.
//   privateWildcardBases  REGIONAL_WILDCARD_BASES below (hand-kept, checked
//                 against the PSL): PRIVATE wildcard bases whose children are
//                 shared regional namespaces ("*.compute.amazonaws.com":
//                 us-west-1.compute.amazonaws.com holds every EC2 host in that
//                 region). Every "<x>.<base>" is refused by suffixReason()
//                 only: the threat tier, the feed and the allow box.
//                 isIcannSuffix() stays ICANN only (review 2026-11-16, WP-21).
// Unicode (IDN) rules are converted to punycode (公司.cn -> xn--55qx5d.cn).
// Left out: PRIVATE rules with 4+ labels that are not under a PLATFORMS
// parent (file size; UNVERIFIED blast radius, small), and the children of
// the other PRIVATE wildcard rules. Most of those children are ONE customer
// or ONE machine (ec2-1-2-3-4.compute-1.amazonaws.com, <id>.auiusercontent.com),
// and the packed threat set blocks such hosts.
const PLATFORMS = [
  // Cloud / object storage / app hosting
  "amazonaws.com", "cloudfront.net", "elasticbeanstalk.com", "awsapprunner.com", "on.aws", "amplifyapp.com",
  "azurewebsites.net", "azurestaticapps.net", "azureedge.net", "azurefd.net", "windows.net", "blob.core.windows.net", "web.core.windows.net",
  "cloudapp.net", "cloudapp.azure.com", "trafficmanager.net", "azure-api.net",
  "googleusercontent.com", "appspot.com", "firebaseapp.com", "web.app", "run.app", "cloudfunctions.net", "googleapis.com", "gstatic.com",
  "digitaloceanspaces.com", "ondigitalocean.app", "linodeobjects.com", "oraclecloud.com", "backblazeb2.com",
  // Static / app hosts with one subdomain per customer
  "github.io", "githubusercontent.com", "gitlab.io", "pages.dev", "workers.dev", "r2.dev", "netlify.app", "netlify.com", "vercel.app",
  "now.sh", "herokuapp.com", "herokudns.com", "fly.dev", "onrender.com", "railway.app", "glitch.me", "replit.dev", "repl.co", "surge.sh",
  "neocities.org", "000webhostapp.com", "wixsite.com", "weebly.com", "squarespace.com", "myshopify.com", "webflow.io", "framer.app",
  "blogspot.com", "wordpress.com", "wpcomstaging.com", "tumblr.com", "substack.com", "medium.com", "notion.site", "carrd.co", "sites.google.com",
  // CDNs
  "fastly.net", "fastlylb.net", "akamaized.net", "akamaihd.net", "akamai.net", "edgekey.net", "edgesuite.net", "b-cdn.net", "cdn77.org",
  "cloudflare.net", "jsdelivr.net", "unpkg.com", "cdnjs.cloudflare.com",
  // Tunnels and dynamic DNS (one subdomain per user)
  "ngrok.io", "ngrok-free.app", "ngrok.app", "ngrok.dev", "trycloudflare.com", "loca.lt", "duckdns.org", "ddns.net", "no-ip.org", "dynu.net",
  // Big shared platforms (a host-level block would black them out)
  "docs.google.com", "drive.google.com", "github.com", "gitlab.com", "bitbucket.org", "dropbox.com", "dropboxusercontent.com",
  "onedrive.live.com", "sharepoint.com", "discord.com", "discordapp.com", "discordapp.net", "t.me", "telegram.org",
  "facebook.com", "fbcdn.net", "instagram.com", "x.com", "twitter.com", "reddit.com", "redd.it", "wikipedia.org", "apple.com", "microsoft.com",
  "live.com", "office.com", "amazon.com", "cloudflare.com", "pastebin.com", "mediafire.com", "mega.nz",
];
// PLATFORMS entries with no per-customer subdomains: every host under them
// belongs to the service (www.facebook.com, en.wikipedia.org, cdn.jsdelivr.net,
// challenges.cloudflare.com, download2390.mediafire.com). A host-level block
// on one of them would black out the platform, and the rule (priority
// 2,000,010) is above "Allow this page". Per-customer parents (github.io,
// pages.dev, cloudfront.net, sharepoint.com, medium.com, ...) stay out: their
// customers' hosts must stay blockable.
const SERVICE_PLATFORMS = [
  "gstatic.com", "jsdelivr.net", "unpkg.com", "cdnjs.cloudflare.com",
  "docs.google.com", "drive.google.com", "github.com", "gitlab.com", "bitbucket.org", "dropbox.com",
  "onedrive.live.com", "discord.com", "discordapp.com", "discordapp.net", "t.me", "telegram.org",
  "facebook.com", "fbcdn.net", "instagram.com", "x.com", "twitter.com", "reddit.com", "redd.it", "wikipedia.org", "apple.com", "microsoft.com",
  "live.com", "office.com", "amazon.com", "cloudflare.com", "pastebin.com", "mediafire.com", "mega.nz",
];
// Exact shared service hosts whose parent holds customer content (so the
// parent cannot be a SERVICE_PLATFORMS entry), and widget hosts that many
// sites load. Hosts under them are not protected.
const SERVICE_HOSTS = [
  "raw.githubusercontent.com", "objects.githubusercontent.com", "avatars.githubusercontent.com",
  "camo.githubusercontent.com", "user-images.githubusercontent.com", "media.githubusercontent.com",
  "dl.dropboxusercontent.com",
  "firebasestorage.googleapis.com", "lh3.googleusercontent.com", "yt3.googleusercontent.com",
  "www.recaptcha.net", "js.stripe.com",
];
// PRIVATE wildcard bases ("*.<base>" in the PSL) whose children are regions
// or shards that many customers share, not one customer: EC2 and ELB
// regions, object-storage regions (<bucket>.nyc3.digitaloceanspaces.com),
// App Engine and Cloud Run shards (<app>.uc.r.appspot.com,
// <svc>.a.run.app), Firebase App Hosting, API Gateway and Azure Container
// Instances regions. Not "*.compute-1.amazonaws.com": each child there is one
// EC2 machine (UNVERIFIED for the non-AWS entries: from the providers' URL
// formats, not from a live check).
const REGIONAL_WILDCARD_BASES = [
  "compute.amazonaws.com", "compute.amazonaws.com.cn", "elb.amazonaws.com", "elb.amazonaws.com.cn",
  "digitaloceanspaces.com", "linodeobjects.com", "vultrobjects.com",
  "r.appspot.com", "run.app", "hosted.app", "gateway.dev", "azurecontainer.io",
];
for (const p of SERVICE_PLATFORMS) if (!PLATFORMS.includes(p)) throw new Error("SERVICE_PLATFORMS entry not in PLATFORMS: " + p);
for (const h of SERVICE_HOSTS) {
  if (SERVICE_PLATFORMS.some((p) => h === p || h.endsWith("." + p))) throw new Error("SERVICE_HOSTS entry already under SERVICE_PLATFORMS: " + h);
}

const arg = (k, d) => { const i = Deno.args.indexOf(k); return i >= 0 ? Deno.args[i + 1] : d; };
const pslPath = arg("--psl", null);
if (!pslPath) throw new Error("usage: build-psl-subset.mjs --psl <public_suffix_list.dat> [--out src/threat/psl.js]");
const out = arg("--out", new URL("../src/threat/psl.js", import.meta.url));
const text = await Deno.readTextFile(pslPath);
const version = (/\/\/ VERSION: (\S+)/.exec(text) || [])[1] || "unknown";
const commit = (/\/\/ COMMIT: ([0-9a-f]+)/.exec(text) || [])[1] || "unknown";

const icann = [];
const priv = [];
let section = null;
for (const raw of text.split(/\r?\n/)) {
  const l = raw.trim();
  if (l.includes("===BEGIN ICANN DOMAINS===")) { section = "icann"; continue; }
  if (l.includes("===BEGIN PRIVATE DOMAINS===")) { section = "private"; continue; }
  if (!l || l.startsWith("//") || !section) continue;
  // PSL entries may be Unicode (公司.cn); DNR, URL hosts and list hosts use
  // punycode (xn--55qx5d.cn). Convert with the URL parser (IDNA mapping) and
  // keep the "*." / "!" prefix. Skip a line only when the conversion fails
  // (review 2026-11-16, WP-21: the old code skipped every Unicode line).
  let rule = l;
  if (/[^\x00-\x7f]/.test(rule)) {
    const prefix = rule.startsWith("*.") ? "*." : rule.startsWith("!") ? "!" : "";
    try {
      rule = prefix + new URL("http://" + rule.slice(prefix.length)).hostname;
    } catch {
      continue;
    }
  }
  if (!/^[!*a-z0-9.-]+$/.test(rule)) continue;
  (section === "icann" ? icann : priv).push(rule);
}
const isPlain = (r) => !r.startsWith("*") && !r.startsWith("!");
const twoLabel = icann.filter((r) => isPlain(r) && r.split(".").length === 2);
const ccCount = new Map();
for (const r of twoLabel) {
  const [label, tld] = r.split(".");
  if (tld.length !== 2) continue;
  ccCount.set(label, (ccCount.get(label) || 0) + 1);
}
// Labels of 2+ characters under 3+ country TLDs (single letters and digits
// are suffixes only in a few TLDs, e.g. a.se, 0.bg: they stay explicit).
const generic = [...ccCount].filter(([l, n]) => n >= 3 && l.length >= 2).map(([l]) => l).sort();
// Follow-up review: a rule-based "<generic label>.<cc>" match called real
// sites (web.de, id.me) public suffixes, and leaving out most PRIVATE names
// let the threat tier block ru.com, webhop.me and other shared parents. So
// only explicit PSL names are used for decisions; `generic` is kept as data
// for the popup guard's small same-site check (src/guards/popups.js).
const wildcardTlds = icann.filter((r) => /^\*\.[a-z0-9-]+$/.test(r)).map((r) => r.slice(2)).sort();
const labelsOf = (r) => r.split(".").length;
// Wildcard rules ("*.kawasaki.jp"): every child is a suffix, so the base is
// treated as one too.
const wildBase = (rules) => rules.filter((r) => r.startsWith("*.") && labelsOf(r.slice(2)) >= 2).map((r) => r.slice(2));
const suffixes = new Set(twoLabel);
for (const b of wildBase(icann)) if (labelsOf(b) <= 3) suffixes.add(b);
// ICANN rules with 3+ labels (act.edu.au, k12.ca.us): kept in full.
const icannDeepList = icann.filter((r) => isPlain(r) && labelsOf(r) >= 3 && !suffixes.has(r));
const wildcardBases = wildBase(icann).sort();
const icannExceptions = icann.filter((r) => r.startsWith("!")).map((r) => r.slice(1)).sort();
const icannAll = new Set([...suffixes, ...icannDeepList]);
const privateSuffixes = new Set();
for (const r of priv.filter(isPlain)) if (labelsOf(r) <= 3 && !icannAll.has(r)) privateSuffixes.add(r);
for (const b of wildBase(priv)) if (labelsOf(b) <= 3 && !icannAll.has(b)) privateSuffixes.add(b);
// Deeper PRIVATE names under a platform parent (regional S3 endpoints).
const underPlatform = (r) => PLATFORMS.some((p) => r.endsWith("." + p));
const privateDeepList = [];
for (const r of priv.filter(isPlain).concat(wildBase(priv))) {
  if (labelsOf(r) >= 4 && underPlatform(r) && !icannAll.has(r) && !privateSuffixes.has(r) && !privateDeepList.includes(r)) privateDeepList.push(r);
}
// REGIONAL_WILDCARD_BASES must be PRIVATE wildcard bases. The base itself is
// kept too (compute.amazonaws.com.cn has 4 labels and no PLATFORMS parent).
const privateWildBases = new Set(wildBase(priv));
for (const b of REGIONAL_WILDCARD_BASES) {
  if (!privateWildBases.has(b)) throw new Error("REGIONAL_WILDCARD_BASES entry is not a PRIVATE wildcard base in this PSL: " + b);
  if (!privateSuffixes.has(b) && !privateDeepList.includes(b) && !icannAll.has(b)) privateDeepList.push(b);
}
const privateWildcardBaseList = [...new Set(REGIONAL_WILDCARD_BASES)].sort();
// {parent: "label label ..."}: about half the size of a flat list.
function group(names) {
  const g = new Map();
  for (const n of [...names].sort()) {
    const i = n.indexOf(".");
    const parent = n.slice(i + 1);
    if (!g.has(parent)) g.set(parent, []);
    g.get(parent).push(n.slice(0, i));
  }
  return Object.fromEntries([...g].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([p, l]) => [p, l.join(" ")]));
}
// A platform that is itself a PSL entry (github.io, blogspot.com) stays in
// `suffixes` too: it is a public suffix for every check, not only the threat tier.
const platforms = [...new Set(PLATFORMS)].sort();
const servicePlatforms = [...new Set(SERVICE_PLATFORMS)].sort();
const serviceHosts = [...new Set(SERVICE_HOSTS)].sort();
const data = {
  generic, wildcardTlds, wildcardBases, icannExceptions, suffixes: [...suffixes].sort(), icannDeep: group(icannDeepList),
  privateSuffixes: [...privateSuffixes].filter((r) => labelsOf(r) <= 2).sort(),
  privateDeep: group([...privateSuffixes].filter((r) => labelsOf(r) > 2).concat(privateDeepList)),
  privateWildcardBases: privateWildcardBaseList,
  platforms, servicePlatforms, serviceHosts,
};

const body = `// GENERATED by scripts/build-psl-subset.mjs. Do not edit by hand; edit the
// generator's PLATFORMS list and re-run it with a fresh copy of the PSL.
// Source: Public Suffix List, https://publicsuffix.org/list/public_suffix_list.dat
// (Mozilla Public License 2.0, https://mozilla.org/MPL/2.0/), VERSION ${version},
// COMMIT ${commit}. Subset: ${data.suffixes.length + icannDeepList.length} ICANN + ${privateSuffixes.size + privateDeepList.length} private suffixes, ${data.wildcardTlds.length} wildcard TLDs,
// ${data.wildcardBases.length} deeper ICANN wildcard bases, ${data.icannExceptions.length} ICANN exceptions, ${privateWildcardBaseList.length} private wildcard bases,
// ${data.platforms.length} hand-kept shared-hosting / platform parents (${data.servicePlatforms.length} of them single-service: every host
// under them is refused too), ${data.serviceHosts.length} exact shared service hosts; ${data.generic.length} generic labels (popup guard only).
//
// One data set for three jobs (security review M-3, L-3, I-5):
//   - the threat tier and the signed feed never block a public suffix, a
//     shared-hosting parent or a big platform (or any of their parents), nor
//     a host under a single-service platform (www.facebook.com,
//     cdn.jsdelivr.net) or an exact shared service host
//     (raw.githubusercontent.com), so one bad list line cannot black out a
//     whole TLD or platform; customer subdomains (evil.github.io) can still
//     be blocked;
//   - the ordinary list tier skips the same names;
//   - the "Allow this domain" box refuses them (allowing "github.io" would
//     let every github.io site through the threat tier);
//   - registrableDomain() gives a real "same site" check (worker side).
// The lookup table is built on first use, not at load.
// Classic script: the worker loads it with importScripts, the settings page
// with a script tag; tests import it for its global.
(function (root) {
  const DATA = /*PSL-SUBSET-START*/${JSON.stringify(data)}/*PSL-SUBSET-END*/;
  const wildcardTlds = new Set(DATA.wildcardTlds);
  const wildcardBases = new Set(DATA.wildcardBases);
  const icannExceptions = new Set(DATA.icannExceptions);
  const suffixes = new Set(DATA.suffixes);
  const privateSuffixes = new Set(DATA.privateSuffixes);
  // Grouped names ({parent: "label ..."}) join the flat sets.
  const ungroup = (groups, into) => {
    for (const parent of Object.keys(groups)) for (const label of groups[parent].split(" ")) into.add(label + "." + parent);
  };
  ungroup(DATA.icannDeep, suffixes);
  ungroup(DATA.privateDeep, privateSuffixes);
  const privateWildcardBases = new Set(DATA.privateWildcardBases);
  const platforms = new Set(DATA.platforms);
  const servicePlatforms = new Set(DATA.servicePlatforms);
  // Every listed name and every parent of it -> the reason it may not be blocked.
  let reasons = null;
  function table() {
    if (reasons) return reasons;
    reasons = new Map();
    // Exact names first, then parents, so a name that is itself listed
    // reports its own reason.
    for (const s of suffixes) reasons.set(s, "public suffix " + s);
    for (const s of privateSuffixes) reasons.set(s, "public suffix " + s);
    for (const p of platforms) if (!reasons.has(p)) reasons.set(p, "shared platform " + p);
    for (const s of DATA.serviceHosts) if (!reasons.has(s)) reasons.set(s, "shared service host " + s);
    for (const name of [...suffixes, ...privateSuffixes, ...platforms, ...DATA.serviceHosts]) {
      const labels = name.split(".");
      for (let i = 1; i < labels.length - 1; i++) {
        const parent = labels.slice(i).join(".");
        if (!reasons.has(parent)) reasons.set(parent, "parent of " + reasons.get(name));
      }
    }
    return reasons;
  }

  function normalize(host) {
    let h = String(host == null ? "" : host).trim().toLowerCase();
    if (h.endsWith(".")) h = h.slice(0, -1);
    return h;
  }

  // Rule-based suffixes (not in the table): "<x>.<wildcard tld>" and
  // "<x>.<wildcard base>" (nakahara.kawasaki.jp), minus the PSL "!" exceptions.
  function ruleSuffix(h) {
    const labels = h.split(".");
    if (labels.length < 2 || icannExceptions.has(h)) return false;
    if (labels.length === 2) return wildcardTlds.has(labels[1]);
    return wildcardBases.has(labels.slice(1).join("."));
  }

  // null when the host may be blocked as a whole, else why not.
  function suffixReason(host) {
    const h = normalize(host);
    if (!h || !h.includes(".")) return "single label";
    const r = table().get(h);
    if (r) return r;
    // Every host under a single-service platform (www.facebook.com).
    const labels = h.split(".");
    for (let i = 1; i < labels.length - 1; i++) {
      const parent = labels.slice(i).join(".");
      if (servicePlatforms.has(parent)) return "part of shared platform " + parent;
    }
    if (ruleSuffix(h)) return "public suffix " + h;
    // Children of PRIVATE wildcard rules (us-west-1.compute.amazonaws.com).
    if (labels.length >= 3 && privateWildcardBases.has(labels.slice(1).join("."))) return "public suffix " + h;
    return null;
  }

  // ICANN part only (co.uk, *.ck): the ordinary list tier and the packer.
  function isIcannSuffix(host) {
    const h = normalize(host);
    return !h.includes(".") || suffixes.has(h) || ruleSuffix(h);
  }

  function isPublicSuffix(host) {
    const h = normalize(host);
    return isIcannSuffix(h) || privateSuffixes.has(h);
  }

  // eTLD+1 under this subset (platform parents count as suffixes, so
  // a.github.io and b.github.io are different sites).
  function registrableDomain(host) {
    const h = normalize(host);
    const labels = h.split(".");
    if (labels.length < 2) return h;
    for (let i = 1; i < labels.length; i++) {
      const rest = labels.slice(i).join(".");
      if (isPublicSuffix(rest) || platforms.has(rest)) return labels.slice(i - 1).join(".");
    }
    return labels.slice(-2).join(".");
  }

  root.GeckoPublicSuffix = Object.freeze({ DATA, normalize, suffixReason, isIcannSuffix, isPublicSuffix, registrableDomain });
})(typeof self !== "undefined" ? self : globalThis);
`;
await Deno.writeTextFile(out, body);
// Keep the popup guard's small copy (same-site check, per frame) in step.
const popupsUrl = new URL("../src/guards/popups.js", import.meta.url);
const popups = await Deno.readTextFile(popupsUrl);
const small = JSON.stringify({ generic: data.generic, wildcardTlds: data.wildcardTlds, platforms: data.platforms });
const updated = popups.replace(/\/\*POPUP-PSL-START\*\/[\s\S]*?\/\*POPUP-PSL-END\*\//, "/*POPUP-PSL-START*/" + small + "/*POPUP-PSL-END*/");
if (updated === popups && !popups.includes(small)) throw new Error("POPUP-PSL markers not found in src/guards/popups.js");
if (updated !== popups) await Deno.writeTextFile(popupsUrl, updated);
console.log(`wrote ${out}: ${data.generic.length} generic, ${data.wildcardTlds.length} wildcard TLDs, ${data.suffixes.length} suffixes, ${data.platforms.length} platforms (PSL ${version})`);
