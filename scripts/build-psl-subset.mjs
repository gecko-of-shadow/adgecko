#!/usr/bin/env -S deno run --allow-read --allow-write
// Build src/threat/psl.js: a SMALL Public Suffix List subset plus a hand-kept
// list of shared-hosting / big-platform parents (security review M-3, L-3,
// L-17). Offline: reads a PSL file you downloaded yourself from
// https://publicsuffix.org/list/public_suffix_list.dat (MPL-2.0), never fetches.
//
//   deno run --allow-read --allow-write scripts/build-psl-subset.mjs --psl <file> [--out src/threat/psl.js]
//
// What is kept (and why it stays small, about 1,350 names in about 22 KB):
//   generic       second-level labels (2+ characters) that the PSL lists as
//                 public suffixes under at least three 2-letter country TLDs ("co", "com", "ac",
//                 "gov", ...): any "<label>.<cc>" host counts as a suffix,
//                 including ones the PSL does not list.
//   wildcardTlds  ICANN rules "*.<tld>": every "<x>.<tld>" is a suffix.
//   suffixes      ICANN two-label rules the generic rule misses, except under
//                 .no, .it and .aero (about 1,200 geographic / aviation names
//                 with a small blast radius; UNVERIFIED coverage gap), plus the
//                 PSL PRIVATE rules (no wildcards) that sit under one of the
//                 PLATFORMS below and have at most 3 labels (s3.amazonaws.com,
//                 s3-website-us-east-1.amazonaws.com, ...).
//   platforms     PLATFORMS below (hand-kept): shared hosting, cloud and CDN
//                 parents and a few big sites. Never blocked themselves (nor
//                 their parents); their customers' subdomains still can be.
// Deeper ICANN rules (city.kawasaki.jp, k12.ny.us) are left out on purpose.
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
  // PSL entries may be Unicode; DNR and URL hosts use punycode. Keep ASCII only.
  if (!/^[!*a-z0-9.-]+$/.test(l)) continue;
  (section === "icann" ? icann : priv).push(l);
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
const genericSet = new Set(generic);
const covered = (r) => { const [label, tld] = r.split("."); return tld.length === 2 && genericSet.has(label); };
const SKIP_TLDS = new Set(["no", "it", "aero"]);
const wildcardTlds = icann.filter((r) => /^\*\.[a-z0-9-]+$/.test(r)).map((r) => r.slice(2)).sort();
const under = (h, d) => h === d || h.endsWith("." + d);
const suffixes = new Set(twoLabel.filter((r) => !covered(r) && !SKIP_TLDS.has(r.split(".")[1])));
for (const r of priv) {
  if (!isPlain(r) || r.split(".").length > 3) continue;
  if (PLATFORMS.some((p) => under(r, p))) suffixes.add(r);
}
// A platform that is itself a PSL entry (github.io, blogspot.com) stays in
// `suffixes` too: it is a public suffix for every check, not only the threat tier.
const platforms = [...new Set(PLATFORMS)].sort();
const data = { generic, wildcardTlds, suffixes: [...suffixes].sort(), platforms };

const body = `// GENERATED by scripts/build-psl-subset.mjs. Do not edit by hand; edit the
// generator's PLATFORMS list and re-run it with a fresh copy of the PSL.
// Source: Public Suffix List, https://publicsuffix.org/list/public_suffix_list.dat
// (Mozilla Public License 2.0, https://mozilla.org/MPL/2.0/), VERSION ${version},
// COMMIT ${commit}. Subset: ${data.generic.length} generic second-level labels, ${data.wildcardTlds.length} wildcard TLDs,
// ${data.suffixes.length} explicit suffixes; plus ${data.platforms.length} hand-kept shared-hosting / platform parents.
//
// One small data set for three jobs (security review M-3, L-3, L-17):
//   - the threat tier and the signed feed never block a public suffix, a
//     shared-hosting parent or a big platform (or any of their parents), so one
//     bad list line cannot black out a whole TLD or platform; customer
//     subdomains (evil.github.io) can still be blocked;
//   - the ordinary list tier skips the same names;
//   - the "Allow this domain" box refuses them (allowing "github.io" would
//     let every github.io site through the threat tier);
//   - registrableDomain() gives the popup guard a real "same site" check.
// Coverage is a subset on purpose (small, cheap to load): deeper and some
// geographic suffixes are missing (UNVERIFIED blast radius, small).
// Classic script: the worker loads it with importScripts, the settings page
// with a script tag; tests import it for its global.
(function (root) {
  const DATA = /*PSL-SUBSET-START*/${JSON.stringify(data)}/*PSL-SUBSET-END*/;
  const generic = new Set(DATA.generic);
  const wildcardTlds = new Set(DATA.wildcardTlds);
  const suffixes = new Set(DATA.suffixes);
  const platforms = new Set(DATA.platforms);
  // Every listed name and every parent of it -> the reason it may not be blocked.
  let reasons = null;
  function table() {
    if (reasons) return reasons;
    reasons = new Map();
    const add = (name, why) => {
      const labels = name.split(".");
      if (!reasons.has(name)) reasons.set(name, why);
      for (let i = 1; i < labels.length - 1; i++) {
        const parent = labels.slice(i).join(".");
        if (!reasons.has(parent)) reasons.set(parent, "parent of " + why);
      }
    };
    for (const s of suffixes) add(s, "public suffix " + s);
    for (const p of platforms) add(p, "shared platform " + p);
    return reasons;
  }

  function normalize(host) {
    let h = String(host == null ? "" : host).trim().toLowerCase();
    if (h.endsWith(".")) h = h.slice(0, -1);
    return h;
  }

  // Rule-based suffixes (not in the table): "<generic>.<cc>" and "<x>.<wildcard tld>".
  function ruleSuffix(h) {
    const labels = h.split(".");
    if (labels.length !== 2) return false;
    const tld = labels[1];
    return (tld.length === 2 && generic.has(labels[0])) || wildcardTlds.has(tld);
  }

  // null when the host may be blocked as a whole, else why not.
  function suffixReason(host) {
    const h = normalize(host);
    if (!h || !h.includes(".")) return "single label";
    const r = table().get(h);
    if (r) return r;
    if (ruleSuffix(h)) return "public suffix " + h;
    return null;
  }

  function isPublicSuffix(host) {
    const h = normalize(host);
    return !h.includes(".") || suffixes.has(h) || ruleSuffix(h);
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

  root.GeckoPublicSuffix = Object.freeze({ DATA, normalize, suffixReason, isPublicSuffix, registrableDomain });
})(typeof self !== "undefined" ? self : globalThis);
`;
await Deno.writeTextFile(out, body);
console.log(`wrote ${out}: ${data.generic.length} generic, ${data.wildcardTlds.length} wildcard TLDs, ${data.suffixes.length} suffixes, ${data.platforms.length} platforms (PSL ${version})`);
