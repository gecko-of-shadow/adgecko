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
// The gate needs deno, python3 and rg (scripts/release-gate.sh checks them).
const canGate = (await bash("command -v rg && command -v python3")).code === 0;

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

Deno.test({ name: "release gate on a clean package copy: frozen pins, manifest keys and secret scan pass; a password= in src/rules/*.json is not a finding", ignore: !canGate, fn: async () => {
  const r = await gateOn('printf \'{"x":"password=1"}\\n\' > "$d/pkg/src/rules/x.json"');
  assert(/PASS\s+frozen playback files match scripts\/frozen-pins\.json/.test(r.text), "frozen PASS line:\n" + r.text);
  assert(/PASS\s+permissions are storage/.test(r.text), "section 2 PASS:\n" + line(r.text, /privileged/));
  assert(/PASS\s+no obvious identity\/secret strings/.test(r.text), "rules JSON must be excluded from the secret scan:\n" + line(r.text, /identity\/secret/));
  assert(r.code === 0 && /VERDICT: CLEAN/.test(r.text), "gate verdict:\n" + r.text.slice(-3000));
} });

Deno.test({ name: "release gate on a changed package copy: a changed kick.js, a new manifest key and a password= in src/*.js each FAIL", ignore: !canGate, fn: async () => {
  const r = await gateOn([
    'echo "// changed" >> "$d/pkg/src/kick.js"',
    'python3 -c "import json,sys; p=sys.argv[1]; m=json.load(open(p)); m[\'update_url\']=\'https://updates.example/x.xml\'; m[\'content_security_policy\']={\'sandbox\':\'sandbox allow-scripts; script-src \\\'unsafe-eval\\\'\'}; json.dump(m, open(p, \'w\'), indent=2)" "$d/pkg/manifest.json"',
    'printf \'const password = "x";\\n\' > "$d/pkg/src/x.js"',
  ].join("\n"));
  assert(r.code === 1 && /VERDICT: FAIL/.test(r.text), "gate must fail");
  assert(/FAIL\s+frozen playback files/.test(r.text) && /src\/kick\.js/.test(line(r.text, /frozen pin|differs from its pin/)), "kick.js against the pin:\n" + r.text.slice(0, 4000));
  const sec2 = line(r.text, /privileged \/ permission fields/);
  assert(/FAIL/.test(sec2) && /update_url/.test(sec2) && /content_security_policy/.test(sec2), "manifest key allow-list:\n" + sec2);
  // rg prints the found path with the platform's separator: src\x.js on Windows.
  assert(/FAIL\s+possible identity\/secret strings/.test(r.text) && /src[\\/]x\.js/.test(r.text), "password= in src/x.js");
} });

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

// Two packs of the same tree, 3 s apart, must give the same bytes (Info-ZIP
// path; the Windows tar.exe fallback is not reproducible, an owner decision).
const hasZip = await (async () => {
  try { return (await new Deno.Command("bash", { args: ["-c", "command -v zip"], stdout: "null", stderr: "null" }).output()).code === 0; } catch { return false; }
})();
Deno.test({
  name: "pack-zip.sh: two packs of the same checkout give the same SHA-256",
  ignore: !hasZip,
  fn: async () => {
    const r = await bash(`d="$(mktemp -d)"; trap 'rm -rf "$d"' EXIT
bash scripts/pack-zip.sh "$d/a.zip" >/dev/null || exit 3
sleep 3
bash scripts/pack-zip.sh "$d/b.zip" >/dev/null || exit 4
sha256sum "$d/a.zip" "$d/b.zip" | awk '{print $1}'
python3 -B -c "import sys, zipfile; n = zipfile.ZipFile(sys.argv[1]).namelist(); print('sorted=' + str(n == sorted(n)))" "$d/a.zip"`);
    assert(r.code === 0, "pack failed:\n" + r.text);
    const [a, b] = r.text.trim().split("\n");
    assert(/^[0-9a-f]{64}$/.test(a) && a === b, "two packs differ: " + a + " " + b);
    assert(/sorted=True/.test(r.text), "entries in sorted order");
  },
});

// uBO sync commit pin (no real sync, no network): a stub "git" on PATH makes
// a fake clone whose parser module prints a marker when it is imported.
const uboMeta = JSON.parse(await Deno.readTextFile(new URL("src/vendor/ubo-youtube-meta.json", ROOT)));
const UBO_SYNC = (head, extra = "") => `d="$(mktemp -d)"; trap 'rm -rf "$d"' EXIT
mkdir -p "$d/bin" "$d/tmp"
cat > "$d/bin/git" <<'SH'
#!/usr/bin/env bash
case "$1" in
  clone) dest="\${@: -1}"; mkdir -p "$dest/src/js/resources"; echo 'console.log("UPSTREAM CODE RAN"); export class AstFilterParser {}' > "$dest/src/js/static-filtering-parser.js" ;;
  rev-parse) echo "$FAKE_HEAD" ;;
  *) echo "stub git: $*" >&2; exit 1 ;;
esac
SH
chmod +x "$d/bin/git"
PATH="$d/bin:$PATH" TMPDIR="$d/tmp" FAKE_HEAD="${head}" deno run --no-lock --allow-read --allow-write="$d/tmp" --allow-run=git scripts/sync-ubo-youtube.mjs --uassets ${"0".repeat(40)} ${extra}; echo "rc=$?"`;

Deno.test("uBO sync: the meta commit is the pinned commit; another tag needs --ubo-commit; a stub HEAD that differs is refused", async () => {
  const { expectedUboCommit, verifyUboClone } = await import("../scripts/lib/ubo-commit-pin.mjs");
  assert(/^[0-9a-f]{40}$/.test(uboMeta.ublock_commit), "meta records a commit");
  assert(expectedUboCommit({ tag: uboMeta.ublock_tag, meta: uboMeta }) === uboMeta.ublock_commit, "meta commit is the pin");
  let err = "";
  try { expectedUboCommit({ tag: "9.9.9", meta: uboMeta }); } catch (e) { err = e.message; }
  assert(/--ubo-commit/.test(err), "another tag needs --ubo-commit: " + err);
  assert(expectedUboCommit({ tag: "9.9.9", commitArg: "a".repeat(40), meta: uboMeta }) === "a".repeat(40), "explicit commit");
  err = "";
  try { await verifyUboClone({ tag: "1.75.0", expected: uboMeta.ublock_commit, revParse: async () => "b".repeat(40) + "\n" }); } catch (e) { err = e.message; }
  assert(/not the pinned commit/.test(err), "stub HEAD differs: " + err);
});

// A bash script named "git" on PATH is not found by Deno on Windows.
Deno.test({ name: "uBO sync with a stub git: a moved tag or another tag stops the sync before upstream code runs", ignore: Deno.build.os === "windows", fn: async () => {
  const moved = await bash(UBO_SYNC("b".repeat(40)));
  assert(/rc=[1-9]/.test(moved.text) && /not the pinned commit/.test(moved.text), "moved tag:\n" + moved.text);
  assert(!/UPSTREAM CODE RAN/.test(moved.text), "upstream code ran:\n" + moved.text);
  const other = await bash(UBO_SYNC("b".repeat(40), "--ubo 9.9.9"));
  assert(/rc=[1-9]/.test(other.text) && /--ubo-commit/.test(other.text) && !/UPSTREAM CODE RAN/.test(other.text), "other tag:\n" + other.text);
  // The pinned HEAD passes the check; the run then stops at the first
  // download, because this test grants no network.
  const pinned = await bash(UBO_SYNC(uboMeta.ublock_commit));
  assert(!/not the pinned commit/.test(pinned.text) && /net access|NotCapable|PermissionDenied/i.test(pinned.text), "pinned HEAD:\n" + pinned.text);
} });

Deno.test("uBO sync workflow: explicit Deno grants, no -A", async () => {
  const wf = await Deno.readTextFile(new URL(".github/workflows/ubo-youtube-drift.yml", ROOT));
  const run = wf.split("\n").find((l) => /deno run .*scripts\/sync-ubo-youtube\.mjs/.test(l)) || "";
  assert(run && !/\s-A\b|--allow-all/.test(run), "workflow still grants everything: " + run);
  assert(/--allow-net=raw\.githubusercontent\.com\b/.test(run) && /--allow-run=git\b/.test(run) && /--allow-write=src\/vendor,src\/rules,/.test(run), "grants: " + run);
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
