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
