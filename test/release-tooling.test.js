// Release tooling (review 2026-11-16, WP-22): the release gate, the zip check,
// the list packer, feed-sign, pack-zip and the uBO sync commit pin.
// The gate runs on a scratch copy of the package files (made and removed by
// bash, so this file needs no --allow-write). A scratch copy has no test/, so
// the gate does not run the deno suite again.
import frozen from "../scripts/frozen-pins.json" with { type: "json" };
import vendorPins from "../scripts/vendor-pins.json" with { type: "json" };
import manifest from "../manifest.json" with { type: "json" };

function assert(c, l) { if (!c) throw new Error(l || "assertion failed"); }
const ROOT = new URL("..", import.meta.url);
const dec = new TextDecoder();

async function bash(script, env = {}) {
  const out = await new Deno.Command("bash", { args: ["-c", script], cwd: ROOT, env, stdout: "piped", stderr: "piped" }).output();
  return { code: out.code, text: (dec.decode(out.stdout) + dec.decode(out.stderr)).replace(/\r/g, "") };
}
async function sha256Hex(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Copies the derived package files to "$d/pkg", runs MUTATE (bash, may use
// $d/pkg), then the release gate on that copy. Prints the gate output.
const SCRATCH = 'd="$(mktemp -d)"; trap \'rm -rf "$d"\' EXIT; ' +
  'python3 -B scripts/lib/package_files.py --root . | tr -d "\\r" | while IFS= read -r f; do mkdir -p "$d/pkg/$(dirname "$f")"; cp "$f" "$d/pkg/$f"; done; ';
const gateOn = (mutate) => bash(SCRATCH + mutate + '\nbash scripts/release-gate.sh --dir "$d/pkg"');
const line = (text, re) => text.split("\n").find((l) => re.test(l)) || "";

Deno.test("frozen pins: each frozen file in the checkout matches its pin; the Twitch pin agrees with vendor-pins.json", async () => {
  const files = Object.keys(frozen.frozen).sort();
  assert(files.join() === "src/kick.js,src/vendor/video-swap-new.user.js", "frozen files: " + files.join());
  for (const rel of files) {
    const bytes = await Deno.readFile(new URL(rel, ROOT));
    assert(bytes.length === frozen.frozen[rel].bytes, rel + " size differs from scripts/frozen-pins.json");
    assert(await sha256Hex(bytes) === frozen.frozen[rel].sha256, rel + " SHA-256 differs from scripts/frozen-pins.json (frozen file changed)");
  }
  const tw = frozen.frozen[vendorPins.twitch.file];
  assert(tw && tw.sha256 === vendorPins.twitch.sha256 && tw.bytes === vendorPins.twitch.bytes, "Twitch frozen pin != scripts/vendor-pins.json");
});

Deno.test("release gate on a clean package copy: frozen pins, manifest keys and secret scan pass; a password= in src/rules/*.json is not a finding", async () => {
  const r = await gateOn('printf \'{"x":"password=1"}\\n\' > "$d/pkg/src/rules/x.json"');
  assert(/PASS\s+frozen playback files match scripts\/frozen-pins\.json/.test(r.text), "frozen PASS line:\n" + r.text);
  assert(/PASS\s+permissions are storage/.test(r.text), "section 2 PASS:\n" + line(r.text, /privileged/));
  assert(/PASS\s+no obvious identity\/secret strings/.test(r.text), "rules JSON must be excluded from the secret scan:\n" + line(r.text, /identity\/secret/));
  assert(r.code === 0 && /VERDICT: CLEAN/.test(r.text), "gate verdict:\n" + r.text.slice(-3000));
});

Deno.test("release gate on a changed package copy: a changed kick.js, a new manifest key and a password= in src/*.js each FAIL", async () => {
  const r = await gateOn([
    'echo "// changed" >> "$d/pkg/src/kick.js"',
    'python3 -c "import json,sys; p=sys.argv[1]; m=json.load(open(p)); m[\'update_url\']=\'https://updates.example/x.xml\'; m[\'content_security_policy\']={\'sandbox\':\'sandbox allow-scripts; script-src \\\'unsafe-eval\\\'\'}; json.dump(m, open(p, \'w\'), indent=2)" "$d/pkg/manifest.json"',
    'printf \'const password = "x";\\n\' > "$d/pkg/src/x.js"',
  ].join("\n"));
  assert(r.code === 1 && /VERDICT: FAIL/.test(r.text), "gate must fail");
  assert(/FAIL\s+frozen playback files/.test(r.text) && /src\/kick\.js/.test(line(r.text, /frozen pin|differs from its pin/)), "kick.js against the pin:\n" + r.text.slice(0, 4000));
  const sec2 = line(r.text, /privileged \/ permission fields/);
  assert(/FAIL/.test(sec2) && /update_url/.test(sec2) && /content_security_policy/.test(sec2), "manifest key allow-list:\n" + sec2);
  assert(/FAIL\s+possible identity\/secret strings/.test(r.text) && /src\/x\.js/.test(r.text), "password= in src/x.js");
});

Deno.test("release gate: the manifest key allow-list is exactly the keys of the current manifest.json", async () => {
  const gate = await Deno.readTextFile(new URL("scripts/release-gate.sh", ROOT));
  const m = /ALLOWED_MANIFEST_KEYS = \(([^)]*)\)/.exec(gate);
  assert(m, "ALLOWED_MANIFEST_KEYS in section 2");
  const keys = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort();
  assert(keys.join() === Object.keys(manifest).sort().join(), "allow-list " + keys.join() + " != manifest keys " + Object.keys(manifest).sort().join());
});

Deno.test("package_files --check-zip --check-bytes: a zip with one changed byte FAILs; a fresh zip of the checkout PASSes", async () => {
  const r = await bash(`d="$(mktemp -d)"; trap 'rm -rf "$d"' EXIT
python3 -B - "$d" <<'PY'
import sys, zipfile, subprocess
d = sys.argv[1]
files = subprocess.run([sys.executable, "-B", "scripts/lib/package_files.py", "--root", "."], capture_output=True, text=True, check=True).stdout.split()
for name, change in (("good.zip", None), ("bad.zip", "src/popup.js")):
    with zipfile.ZipFile(f"{d}/{name}", "w", zipfile.ZIP_DEFLATED) as z:
        for f in files:
            data = open(f, "rb").read()
            if f == change:
                data = data[:-1] + bytes([data[-1] ^ 1])
            z.writestr(f, data)
PY
python3 -B scripts/lib/package_files.py --root . --check-zip "$d/good.zip" --check-bytes; echo "rc_good=$?"
python3 -B scripts/lib/package_files.py --root . --check-zip "$d/bad.zip"; echo "rc_names=$?"
python3 -B scripts/lib/package_files.py --root . --check-zip "$d/bad.zip" --check-bytes; echo "rc_bad=$?"`);
  assert(/rc_good=0/.test(r.text), "fresh zip:\n" + r.text);
  assert(/rc_names=0/.test(r.text), "the name-only check stays for an old-version zip:\n" + r.text);
  assert(/rc_bad=1/.test(r.text) && /zip is not a pack of this checkout: src\/popup\.js/.test(r.text), "changed byte:\n" + r.text);
});

Deno.test("release gate: --zip mode asks for the byte check when it derives the list from this checkout", async () => {
  const gate = await Deno.readTextFile(new URL("scripts/release-gate.sh", ROOT));
  assert(/--check-zip "\$ZIP" "\$\{CHECK_BYTES\[@\]\}"/.test(gate) && /CHECK_BYTES=\(--check-bytes\)/.test(gate), "gate passes --check-bytes when DERIVE_ROOT is ROOT");
});

// The list packer with a stub download (no network). ROOT, OUT_DIR, CACHE_DIR
// and packed-cross.json point into a temp dir that holds a copy of the
// committed meta.json; subprocess is a stub, so nothing runs and nothing in
// the checkout can change. Prints "rc=<main() result>" and "files=<temp files>".
const PACKER = (body, argv = "") => `d="$(mktemp -d)"; trap 'rm -rf "$d"' EXIT
mkdir -p "$d/out" && cp src/rules/meta.json "$d/out/meta.json" && echo "[]" > "$d/out/general-network.json"
python3 -B - "$d" <<'PY'
import importlib.util, io, sys, types
from pathlib import Path
d = Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("pfl", "scripts/pack-filter-lists.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
mod.ROOT, mod.OUT_DIR, mod.CACHE_DIR = d, d / "out", d / "cache"
mod.PACKED_CROSS_JSON = d / "out" / "packed-cross.json"
mod.subprocess = types.SimpleNamespace(run=lambda *a, **k: types.SimpleNamespace(returncode=0))
BODY = ${JSON.stringify(body)}
class Resp(io.BytesIO):
    def __enter__(self): return self
    def __exit__(self, *a): return False
mod.urllib.request.urlopen = lambda req, timeout=0: Resp(BODY.encode())
sys.argv = ["pack-filter-lists.py"] + ${JSON.stringify(argv ? [argv] : [])}
rc = mod.main()
print("rc=" + str(rc))
files = sorted(p.relative_to(d).as_posix() for p in d.rglob("*") if p.is_file())
print("files=" + ",".join(files))
PY
cmp -s src/rules/meta.json "$d/out/meta.json" && echo "meta=same" || echo "meta=changed"`;
const NOTHING_WRITTEN = "files=out/general-network.json,out/meta.json\nmeta=same";

Deno.test("packer: an empty or HTML list body exits non-zero and writes nothing", async () => {
  for (const body of ["", "\n\n", "<!DOCTYPE html><html><head><title>Sign in to Wi-Fi</title></head><body>login</body></html>\n"]) {
    const r = await bash(PACKER(body));
    assert(/rc=[1-9]/.test(r.text), "exit code for " + JSON.stringify(body.slice(0, 20)) + ":\n" + r.text.slice(-1500));
    assert(r.text.includes(NOTHING_WRITTEN), "nothing written:\n" + r.text.slice(-1500));
    assert(/refus/i.test(r.text), "says why:\n" + r.text.slice(-1500));
  }
});

Deno.test("packer: a list that shrinks by more than 25% against meta.json is refused unless --accept-shrink is given", async () => {
  const small = "[Adblock Plus 2.0]\n" + Array.from({ length: 40 }, (_, i) => "||ad" + i + ".example.com^").join("\n") + "\n";
  const r = await bash(PACKER(small));
  assert(/rc=[1-9]/.test(r.text) && r.text.includes(NOTHING_WRITTEN), "shrink refused, nothing written:\n" + r.text.slice(-1500));
  assert(/shrinks/.test(r.text) && /--accept-shrink/.test(r.text), "names the flag:\n" + r.text.slice(-1500));
  const ok = await bash(PACKER(small, "--accept-shrink"));
  assert(/rc=0/.test(ok.text) && /out\/packed-cross\.json/.test(ok.text), "--accept-shrink packs:\n" + ok.text.slice(-1500));
});

// feed-sign with a fresh key and feed in a temp dir (bash makes and removes it).
const FEED_SIGN = (notBefore, notAfter, created = notBefore) => `d="$(mktemp -d)"; trap 'rm -rf "$d"' EXIT
deno run --no-lock --allow-read --allow-write scripts/feed-keygen.mjs --key-id t1 --out "$d/k.json" >/dev/null || exit 9
printf '%s' '{"format":1,"serial":5,"createdAt":"${created}","notBefore":"${notBefore}","notAfter":"${notAfter}","dnr":[{"id":1,"requestDomains":["evil.example"]}]}' > "$d/f.json"
deno run --no-lock --allow-read --allow-write scripts/feed-sign.mjs --key "$d/k.json" --feed "$d/f.json"; echo "rc=$?"
[ -f "$d/f.json.sig" ] && echo "sig=yes" || echo "sig=no"`;
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
const HOUR = 3600000;

Deno.test("feed-sign: a feed whose notAfter has passed is not signed", async () => {
  const r = await bash(FEED_SIGN("2025-01-01T00:00:00Z", "2025-01-02T00:00:00Z"));
  assert(/rc=[1-9]/.test(r.text) && /sig=no/.test(r.text), "expired feed was signed:\n" + r.text);
  assert(/expired/.test(r.text), "says expired:\n" + r.text);
});

Deno.test("feed-sign: a valid feed is signed; less than 24 h left gives a warning; a future notBefore still signs", async () => {
  const now = Date.now();
  const ok = await bash(FEED_SIGN(iso(now - HOUR), iso(now + 5 * 24 * HOUR)));
  assert(/rc=0/.test(ok.text) && /sig=yes/.test(ok.text) && !/WARNING/.test(ok.text), "valid feed:\n" + ok.text);
  const soon = await bash(FEED_SIGN(iso(now - HOUR), iso(now + 3 * HOUR)));
  assert(/rc=0/.test(soon.text) && /sig=yes/.test(soon.text) && /WARNING.*24 h/.test(soon.text), "short feed warns:\n" + soon.text);
  const ahead = await bash(FEED_SIGN(iso(now + 48 * HOUR), iso(now + 6 * 24 * HOUR)));
  assert(/rc=0/.test(ahead.text) && /sig=yes/.test(ahead.text), "signing ahead of time still works:\n" + ahead.text);
});
