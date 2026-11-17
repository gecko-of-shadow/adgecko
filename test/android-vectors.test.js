// Adgecko Shield parity vectors (docs/android/PLAN.md section 6.5, A4). The
// committed files in test/fixtures/android/vectors/ must equal the generator
// output, and the JS reference must pass each case. The Kotlin VectorRunner
// runs the same files on the JVM and on ART (closed set: a file with no
// Kotlin runner fails there).
import { buildVectors, VECTOR_DIR, VECTOR_FILES } from "../scripts/build-android-vectors.mjs";
import { dnsDecision, isIpLiteral, neverBlockMatch, normalizeHost, prepareData, suffixMatch } from "../scripts/lib/android-dns-policy.mjs";
import { loadModules } from "../scripts/export-android-data.mjs";

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

const ROOT = new URL("..", import.meta.url);
const built = await buildVectors(ROOT);
const { PS, TC } = await loadModules(ROOT);
const load = async (name) => JSON.parse(await Deno.readTextFile(new URL(VECTOR_DIR + name, ROOT)));

Deno.test("android vectors: the committed files equal the generator output", async () => {
  const committed = [];
  for await (const e of Deno.readDir(new URL(VECTOR_DIR, ROOT))) committed.push(e.name);
  assert(committed.sort().join() === [...VECTOR_FILES].sort().join(), `vector file set: ${committed.join(", ")}`);
  for (const [name, text] of built) {
    const have = await Deno.readTextFile(new URL(VECTOR_DIR + name, ROOT));
    assert(have === text, `${VECTOR_DIR}${name} is stale: run deno run --no-lock --allow-read --allow-write=${VECTOR_DIR.slice(0, -1)} scripts/build-android-vectors.mjs`);
  }
});

Deno.test("android vectors: only reserved names and ASCII text", async () => {
  for (const name of VECTOR_FILES) {
    const text = await Deno.readTextFile(new URL(VECTOR_DIR + name, ROOT));
    assert(/^[\x09\x0a\x20-\x7e]*$/.test(text), `${name} has a raw non-ASCII or control character`);
  }
});

Deno.test("android vectors: the JS reference passes each case", async () => {
  const counts = [];
  {
    const v = await load("host-match.json");
    for (const c of v.cases) {
      const n = normalizeHost(c.host);
      assert(n === c.normalized, `host-match normalize ${JSON.stringify(c.host)}`);
      assert((n !== null && isIpLiteral(n)) === c.ip, `host-match ip ${c.host}`);
      assert((n === null ? null : suffixMatch(n, v.inputs.set)) === c.match, `host-match ${c.host}`);
    }
    counts.push(`host-match ${v.cases.length}`);
  }
  {
    const v = await load("never-block.json");
    for (const c of v.cases) {
      const n = normalizeHost(c.host);
      assert((n !== null && neverBlockMatch(n, v.inputs) !== null) === c.neverBlock, `never-block ${c.host}`);
    }
    counts.push(`never-block ${v.cases.length}`);
  }
  {
    const v = await load("dns-policy.json");
    const d = prepareData(v.inputs);
    for (const c of v.cases) {
      const r = dnsDecision(c.host, d, { mode: c.mode, paused: c.paused });
      assert(r.action === c.action && r.layer === c.layer && r.matched === c.matched, `dns-policy ${c.host} ${c.mode} ${c.paused}: ${JSON.stringify(r)}`);
    }
    const layers = new Set(v.cases.map((c) => c.layer));
    assert(layers.size === 6, `dns-policy covers ${layers.size} layers`);
    counts.push(`dns-policy ${v.cases.length}`);
  }
  {
    const v = await load("public-suffix.json");
    for (const c of v.cases) {
      assert(PS.registrableDomain(c.host) === c.registrableDomain && PS.suffixReason(c.host) === c.suffixReason, `public-suffix ${c.host}`);
    }
    counts.push(`public-suffix ${v.cases.length}`);
  }
  {
    const v = await load("allow-domain.json");
    for (const c of v.cases) {
      assert(/^[\x20-\x7e]*$/.test(c.input), `allow-domain input must be ASCII in M1: ${c.input}`);
      const r = TC.userDomainReason(c.input);
      assert(r.domain === c.domain && r.reason === c.reason, `allow-domain ${c.input}`);
    }
    counts.push(`allow-domain ${v.cases.length}`);
  }
  console.log(`android vectors: ${counts.join(", ")}`);
});
