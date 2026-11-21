#!/usr/bin/env -S deno run --no-lock --allow-read
// Write the synthetic parity vectors of the Adgecko Shield
// (docs/android/PLAN.md section 6.5) into test/fixtures/android/vectors/.
//
//   deno run --no-lock --allow-read --allow-write=test/fixtures/android/vectors scripts/build-android-vectors.mjs
//   deno run --no-lock --allow-read scripts/build-android-vectors.mjs --check
//
// The expected values come from the JS reference
// (scripts/lib/android-dns-policy.mjs) and from the real src/ modules
// (registrableDomain(), suffixReason(), userDomainReason()). The Kotlin
// VectorRunner in android/shield-core runs the same files on the JVM and on
// ART. Do not edit the vector files by hand.
//
// Names: only reserved names (*.test, *.example, *.invalid, example.com,
// example.org, example.net), and made-up names below real public suffixes for
// the public-suffix cases. No real list host (the secret rows of
// scripts/privacy-check.py match some of them).
// --check recomputes each file and writes nothing. Exit 1 on a difference.
import { dnsDecision, formatCaseFile, isIpLiteral, neverBlockMatch, normalizeHost, prepareData, SELF_TEST_HOST, suffixMatch } from "./lib/android-dns-policy.mjs";
import { loadModules } from "./export-android-data.mjs";

export const VECTOR_DIR = "test/fixtures/android/vectors/";
export const VECTOR_FILES = Object.freeze(["host-match.json", "never-block.json", "dns-policy.json", "public-suffix.json", "allow-domain.json"]);
const GENERATOR = "scripts/build-android-vectors.mjs";

const head = (kind, note) => ({ format: 1, kind, generator: GENERATOR, note });

function hostMatch() {
  // Look-alikes stay below reserved names: "xads.example.net" ends with the
  // letters of "ads.example.net" but not at a label boundary.
  const set = ["example.com", "ads.example.net", "tracker.test", "deep.sub.example.org", "invalid"];
  const hosts = [
    "example.com", "EXAMPLE.COM", "example.com.", "Example.Com.", "www.example.com", "a.b.c.example.com",
    "xdeep.sub.example.org", "example.com.example", "notads.example.net", "example.test", "test",
    "ads.example.net", "x.ads.example.net", "example.net", "xads.example.net", "ads.example.net.test",
    "tracker.test", "sub.tracker.test", "tracker.test.", "tracker.test.example", "sub.xtracker.test",
    "deep.sub.example.org", "a.deep.sub.example.org", "sub.example.org", "example.org",
    "invalid", "x.invalid", "invalid.example",
    "", ".", "..", "example..com", "example.com..", ".example.com",
    "192.0.2.1", "198.51.100.25", "203.0.113.255", "256.1.1.1", "1.2.3", "2001:db8::1", "::1",
    "a".repeat(63) + ".example.com", ("a".repeat(63) + ".").repeat(4) + "example.com",
    "exa mple.com", "exaémple.com", "tab\tname.test", "under_score.example.com", "-dash.example.com",
  ];
  const cases = hosts.map((host) => {
    const n = normalizeHost(host);
    return { host, normalized: n, ip: n !== null && isIpLiteral(n), match: n === null ? null : suffixMatch(n, set) };
  });
  return { ...head("host-match", "normalizeHost(), isIpLiteral() and suffixMatch() of scripts/lib/android-dns-policy.mjs"), inputs: { set }, cases };
}

function neverBlock() {
  const nb = {
    suffixes: ["stream.example", "cdn.example", "api.example.net", "example.org"],
    except: ["ads.api.example.net", "imasdk.example.org"],
  };
  const hosts = [
    "stream.example", "live.stream.example", "a.b.stream.example", "xstream.example", "stream.example.test",
    "cdn.example", "img.cdn.example",
    "api.example.net", "v1.api.example.net", "ads.api.example.net", "x.ads.api.example.net", "xads.api.example.net",
    "example.net", "other.example.net",
    "example.org", "www.example.org", "imasdk.example.org", "sdk.imasdk.example.org", "ximasdk.example.org",
    "unrelated.test", "STREAM.EXAMPLE.", "Imasdk.Example.Org",
  ];
  const cases = hosts.map((host) => {
    const n = normalizeHost(host);
    return { host, neverBlock: n !== null && neverBlockMatch(n, nb) !== null };
  });
  return { ...head("never-block", "neverBlockMatch(): a suffix or below one, and not an except entry or below one (same meaning as isNeverBlock())"), inputs: nb, cases };
}

function dnsPolicy() {
  const inputs = {
    userAllow: ["allowed.example.com", "rescue.threat.test", "ok.list.example"],
    threat: ["threat.test", "evil.example.net", "overlap.example", "bad.stream.example"],
    neverBlock: { suffixes: ["stream.example", "overlap.example"], except: ["ads.stream.example"] },
    list: ["list.example", "example.com", "ads.stream.example", "tracker.example.org", "stream.example", "blocked.adgecko.test"],
  };
  const hosts = [
    SELF_TEST_HOST, "x." + SELF_TEST_HOST, "SELF-TEST.ADGECKO.TEST.", "adgecko.test", "other.adgecko.test", "self-test.adgecko.test.example",
    "allowed.example.com", "www.allowed.example.com", "example.com", "www.example.com",
    "threat.test", "a.threat.test", "rescue.threat.test", "x.rescue.threat.test", "xthreat.test",
    "evil.example.net", "example.net",
    "overlap.example", "x.overlap.example",
    "stream.example", "video.stream.example", "ads.stream.example", "x.ads.stream.example", "bad.stream.example",
    "list.example", "a.list.example", "ok.list.example", "notlist.example",
    "tracker.example.org", "example.org", "blocked.adgecko.test",
    "clean.test", "", "bad host.test", "192.0.2.53",
  ];
  const states = [
    { mode: "ads+threat", paused: false },
    { mode: "ads+threat", paused: true },
    { mode: "threat-only", paused: false },
    { mode: "threat-only", paused: true },
  ];
  const data = prepareData(inputs);
  const cases = [];
  for (const host of hosts) {
    for (const s of states) {
      const r = dnsDecision(host, data, s);
      cases.push({ host, mode: s.mode, paused: s.paused, action: r.action, layer: r.layer, matched: r.matched });
    }
  }
  return { ...head("dns-policy", "dnsDecision(): layer order SELF_TEST, USER_ALLOW, THREAT, NEVER_BLOCK, LIST, NONE"), inputs, cases };
}

function publicSuffix(PS) {
  const hosts = [
    "example.com", "www.example.com", "a.b.example.com", "com", "co.uk", "shop.example.co.uk", "example.co.uk",
    "www.shop.example.co.uk", "com.au", "x.example.com.au", "github.io", "me.github.io", "www.me.github.io",
    "blogspot.com", "someone.blogspot.com", "kawasaki.jp", "x.kawasaki.jp", "y.x.kawasaki.jp", "city.kawasaki.jp",
    "example.test", "a.example.test", "single", "", "EXAMPLE.COM.", "localhost", "example.ck", "www.ck", "a.example.ck",
    "s3.amazonaws.com", "bucket.s3.amazonaws.com", "example.invalid", "x.y.example.net",
  ];
  const cases = hosts.map((host) => ({ host, registrableDomain: PS.registrableDomain(host), suffixReason: PS.suffixReason(host) }));
  return { ...head("public-suffix", "registrableDomain() and suffixReason() of src/threat/psl.js on psl.json"), inputs: { data: "psl.json of the export" }, cases };
}

function allowDomain(TC) {
  const inputs = [
    "example.com", "EXAMPLE.COM", " example.com ", "example.com.", "https://example.com/path?q=1#x", "http://www.example.com:8080/",
    "*.example.com", "ftp://files.example.net", "me.github.io", "github.io", "co.uk", "shop.example.co.uk", "com",
    "localhost", "", "   ", "example", "-bad.example.com", "bad-.example.com", "a..example.com", "under_score.example.com",
    "exa mple.com", "user@example.com", "example.com:443", "a".repeat(64) + ".example.com", "a".repeat(63) + ".example.com",
    "192.0.2.1", "xn--bcher-kva.example", "sub.domain.example.org", "*.co.uk", "example.com/", "EXAMPLE.org.",
    "self-test.adgecko.test",
  ];
  const cases = inputs.map((input) => {
    const r = TC.userDomainReason(input);
    return { input, domain: r.domain, reason: r.reason };
  });
  return { ...head("allow-domain", "userDomainReason() of src/threat/compile.js, ASCII input only in M1"), inputs: { data: "psl.json of the export" }, cases };
}

export async function buildVectors(rootUrl) {
  const { PS, TC } = await loadModules(rootUrl);
  const out = new Map();
  out.set("host-match.json", formatCaseFile(hostMatch()));
  out.set("never-block.json", formatCaseFile(neverBlock()));
  out.set("dns-policy.json", formatCaseFile(dnsPolicy()));
  out.set("public-suffix.json", formatCaseFile(publicSuffix(PS)));
  out.set("allow-domain.json", formatCaseFile(allowDomain(TC)));
  for (const [name, text] of out) {
    if (/[^\x00-\x7f]/.test(text.replace(/\\u[0-9a-f]{4}/gi, ""))) throw new Error(`${name}: raw non-ASCII text`);
  }
  return out;
}

if (import.meta.main) {
  const rootUrl = new URL("..", import.meta.url);
  const check = Deno.args.includes("--check");
  const built = await buildVectors(rootUrl);
  let diff = 0;
  for (const [name, text] of built) {
    const url = new URL(VECTOR_DIR + name, rootUrl);
    if (check) {
      let have = null;
      try { have = await Deno.readTextFile(url); } catch { /* missing */ }
      if (have !== text) { console.error(`differs: ${VECTOR_DIR}${name}`); diff++; }
    } else {
      await Deno.mkdir(new URL(VECTOR_DIR, rootUrl), { recursive: true });
      await Deno.writeTextFile(url, text);
    }
  }
  const cases = [...built.values()].map((t) => JSON.parse(t).cases.length);
  if (check) {
    console.log(diff ? `build-android-vectors: ${diff} file(s) differ` : `build-android-vectors: no difference (${cases.join(", ")} cases)`);
    if (diff) Deno.exit(1);
  } else {
    console.log(`build-android-vectors: wrote ${built.size} files (${cases.join(", ")} cases)`);
  }
}
