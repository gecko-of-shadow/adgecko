// JS reference of the Adgecko Shield DNS policy (docs/android/PLAN.md
// sections 3 and 6.5). It is the oracle for the Kotlin port in
// android/shield-core (DnsPolicy, HostSet, NeverBlock, HostName). The
// committed vectors in test/fixtures/android/vectors/ and the build-only
// samples.json come from these functions.
//
// It does not load src/ modules. The data comes in as plain arrays or sets,
// so the same function serves the synthetic vectors and the real export.
//
// Layer order (first match wins). It follows the DNR priorities
// 2,000,020 > 2,000,010 > 2,000,000 > 1:
//   1. SELF_TEST   the marker self-test.adgecko.test   BLOCK
//   2. USER_ALLOW  "Allow this domain"                FORWARD
//   3. THREAT      threat names                        BLOCK
//   4. NEVER_BLOCK suffixes minus except                FORWARD
//   5. LIST        list hosts (mode "ads+threat", not paused)  BLOCK
//   6. NONE        all other names                      FORWARD
// Each layer matches the host and each parent domain (requestDomains meaning).
// Difference from DNR: DNS has no frame context, so the allowAllRequests frame
// rule for YouTube and Kick pages has no equivalent (plan section 3, risk 21).

export const SELF_TEST_HOST = "self-test.adgecko.test";
export const MODES = Object.freeze(["ads+threat", "threat-only"]);
export const LAYERS = Object.freeze(["SELF_TEST", "USER_ALLOW", "THREAT", "NEVER_BLOCK", "LIST", "NONE"]);

// Lower case, one trailing dot removed. null when the name can never match a
// layer: empty, longer than 253 characters, an empty label, or a character
// outside printable ASCII (0x21 to 0x7e). The Kotlin HostName does the same.
export function normalizeHost(input) {
  let h = String(input == null ? "" : input);
  if (h.endsWith(".")) h = h.slice(0, -1);
  if (h.length === 0 || h.length > 253) return null;
  for (let i = 0; i < h.length; i++) {
    const c = h.charCodeAt(i);
    if (c < 0x21 || c > 0x7e) return null;
  }
  h = h.toLowerCase();
  if (h.split(".").some((l) => l.length === 0)) return null;
  return h;
}

// Dotted-quad IPv4 (each part 0 to 255, no sign) or a name with a colon (IPv6).
export function isIpLiteral(host) {
  const h = String(host || "");
  if (h.includes(":")) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  return !!m && m.slice(1).every((p) => Number(p) <= 255);
}

const asSet = (x) => (x instanceof Set ? x : new Set(x || []));

// The entry of `set` that is the host or a parent of the host, else null.
// The host itself is tested first, then each parent up to the top label.
export function suffixMatch(host, set) {
  const s = asSet(set);
  let h = host;
  for (;;) {
    if (s.has(h)) return h;
    const dot = h.indexOf(".");
    if (dot < 0) return null;
    h = h.slice(dot + 1);
  }
}

// Same meaning as isNeverBlock() of src/general/update.js on the data
// {suffixes: meta.json never_block_suffixes, except: NEVER_BLOCK_EXCEPTIONS}.
export function neverBlockMatch(host, neverBlock) {
  if (suffixMatch(host, neverBlock.except || [])) return null;
  return suffixMatch(host, neverBlock.suffixes || []);
}

// Prepared data: arrays become sets one time (the real export has about
// 210,000 names).
export function prepareData(data) {
  return {
    userAllow: asSet(data.userAllow),
    threat: asSet(data.threat),
    neverBlock: { suffixes: asSet(data.neverBlock?.suffixes), except: asSet(data.neverBlock?.except) },
    list: asSet(data.list),
  };
}

// host: the query name. data: {userAllow, threat, neverBlock: {suffixes,
// except}, list} (arrays or sets). state: {mode, paused}.
// Returns {action: "BLOCK" | "FORWARD", layer, matched}.
export function dnsDecision(host, data, state) {
  const d = data && data.list instanceof Set && data.threat instanceof Set ? data : prepareData(data || {});
  const st = state || { mode: "ads+threat", paused: false };
  if (!MODES.includes(st.mode)) throw new Error("unknown mode " + st.mode);
  const h = normalizeHost(host);
  if (h === null) return { action: "FORWARD", layer: "NONE", matched: null };
  let m = suffixMatch(h, [SELF_TEST_HOST]);
  if (m) return { action: "BLOCK", layer: "SELF_TEST", matched: m };
  m = suffixMatch(h, d.userAllow);
  if (m) return { action: "FORWARD", layer: "USER_ALLOW", matched: m };
  m = suffixMatch(h, d.threat);
  if (m) return { action: "BLOCK", layer: "THREAT", matched: m };
  m = neverBlockMatch(h, d.neverBlock);
  if (m) return { action: "FORWARD", layer: "NEVER_BLOCK", matched: m };
  if (st.mode === "ads+threat" && !st.paused) {
    m = suffixMatch(h, d.list);
    if (m) return { action: "BLOCK", layer: "LIST", matched: m };
  }
  return { action: "FORWARD", layer: "NONE", matched: null };
}

// Small seeded PRNG (mulberry32) for the fixed sample selection.
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Vector and sample files: the top keys pretty-printed, one case on each line,
// so a diff shows each changed case. Plain JSON (RFC 8259) for MiniJson.
// Each character outside ASCII is a \uXXXX escape, so the files stay ASCII.
const asciiJson = (v) => JSON.stringify(v).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

export function formatCaseFile(obj) {
  const keys = Object.keys(obj);
  const parts = keys.map((k) => {
    const v = obj[k];
    if (k === "cases" && Array.isArray(v)) {
      return `  ${JSON.stringify(k)}: [\n${v.map((c) => "    " + asciiJson(c)).join(",\n")}\n  ]`;
    }
    return `  ${JSON.stringify(k)}: ${asciiJson(v)}`;
  });
  return "{\n" + parts.join(",\n") + "\n}\n";
}
