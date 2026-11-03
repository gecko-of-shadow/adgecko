// Packaging (security review H-2): the zip is built from a list DERIVED from
// manifest.json + the worker's importScripts(...) + the pages' <script>/<link>
// + package-local fetch paths (scripts/lib/package_files.py), so every file the
// extension loads is shipped. These checks never run the release gate.
import manifest from "../manifest.json" with { type: "json" };
import workerSource from "../src/general-background.js" with { type: "text" };
import gateSource from "../scripts/release-gate.sh" with { type: "text" };
function assert(c, l) { if (!c) throw new Error(l); }

const ROOT = new URL("..", import.meta.url);
const dec = new TextDecoder();

async function py(args, stdin = "") {
  // -B: no __pycache__ written into the repo.
  const child = new Deno.Command("python3", { args: ["-B", ...args], cwd: ROOT, stdin: "piped", stdout: "piped", stderr: "piped" }).spawn();
  const w = child.stdin.getWriter();
  await w.write(new TextEncoder().encode(stdin));
  await w.close();
  const out = await child.output();
  return { code: out.code, out: dec.decode(out.stdout).replace(/\r/g, ""), err: dec.decode(out.stderr) };
}

const derived = await py(["scripts/lib/package_files.py", "--root", "."]);
const FILES = derived.out.split("\n").filter(Boolean);

// Independent JS reading of what Chrome loads (not the Python helper's code).
function manifestPaths() {
  const out = [manifest.background.service_worker, manifest.action.default_popup, manifest.options_ui.page];
  for (const cs of manifest.content_scripts) out.push(...(cs.js || []), ...(cs.css || []));
  for (const r of manifest.declarative_net_request.rule_resources) out.push(r.path);
  out.push(...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon));
  return out;
}
function importScriptsPaths() {
  const m = /importScripts\(([\s\S]*?)\);/.exec(workerSource);
  assert(m, "worker importScripts call");
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => "src/" + x[1]);
}

Deno.test("packaging: the derived list includes every manifest, importScripts and page path", async () => {
  assert(derived.code === 0, "derivation failed:\n" + derived.out + derived.err);
  const want = [...manifestPaths(), ...importScriptsPaths()];
  for (const page of [manifest.action.default_popup, manifest.options_ui.page]) {
    const html = await Deno.readTextFile(new URL(page, ROOT));
    for (const m of html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)) want.push(new URL(m[1], "x:/" + page).pathname.slice(1));
  }
  // The files the review found missing from the old hand-kept list.
  want.push("src/settings.html", "src/settings.js", "src/settings/features.js", "src/settings/flags.js",
    "src/guards/clipboard.js", "src/guards/popups.js", "src/threat/compile.js", "src/threat/protected-hosts.js",
    "src/feed/client.js", "src/rules/threat-network.json", "src/rules/threat-snapshot.json");
  for (const p of want) assert(FILES.includes(p), "not packed: " + p);
  for (const p of FILES) assert(/^(manifest\.json|src\/|icons\/)/.test(p), "outside the zip roots: " + p);
});

Deno.test("packaging: the release gate allow-list and REQUIRED list match the derived files", () => {
  const allowed = new RegExp(/ALLOWED_RE='([^']+)'/.exec(gateSource)[1]);
  for (const p of FILES) assert(allowed.test(p), "release-gate ALLOWED_RE rejects " + p);
  const required = /\nREQUIRED=\(\r?\n([\s\S]*?)\r?\n\)/.exec(gateSource)[1].split(/\s+/).filter(Boolean);
  for (const p of required) assert(FILES.includes(p), "gate REQUIRED but not packed: " + p);
  for (const p of importScriptsPaths()) assert(required.includes(p), "gate REQUIRED lacks worker import " + p);
  assert(gateSource.includes("scripts/lib/package_files.py\" --root \"$PKG\""), "gate runs the package check");
  assert(/optional_permissions", "optional_host_permissions"/.test(gateSource), "gate refuses optional_* permissions");
});

Deno.test("packaging: importScripts must take string literals only", async () => {
  const code = [
    "import sys; sys.path.insert(0, 'scripts/lib'); import package_files as P",
    "assert P.import_targets('importScripts(\"a.js\",\\n  \"b/c.js\");') == ['a.js', 'b/c.js']",
    "for bad in ['importScripts(x);', 'importScripts(\"a.js\", y + \".js\");', 'importScripts(`a.js`);']:",
    "    try:",
    "        P.import_targets(bad); raise SystemExit('accepted ' + bad)",
    "    except ValueError: pass",
    "print('ok')",
  ].join("\n");
  const r = await py(["-c", code]);
  assert(r.code === 0 && r.out.trim() === "ok", r.out + r.err);
});

// Builds the real zip with scripts/pack-zip.sh into a fresh temp dir (made and
// removed by bash) and lists it: exactly the derived files, nothing missing.
const canPack = await (async () => {
  try {
    const r = await new Deno.Command("bash", { args: ["-c", "command -v zip >/dev/null || [ -x /c/Windows/System32/tar.exe ]"], stdout: "null", stderr: "null" }).output();
    return r.code === 0;
  } catch { return false; }
})();
Deno.test({
  name: "packaging: pack-zip.sh builds a zip holding every derived file and nothing else",
  ignore: !canPack,
  fn: async () => {
    const script = 'd="$(mktemp -d)"; trap \'rm -rf "$d"\' EXIT; bash scripts/pack-zip.sh "$d/gecko.zip" && ' +
      'z="$d/gecko.zip"; if command -v cygpath >/dev/null; then z="$(cygpath -m "$z")"; fi; python3 -B scripts/lib/package_files.py --root . --check-zip "$z"';
    const out = await new Deno.Command("bash", { args: ["-c", script], cwd: ROOT, stdout: "piped", stderr: "piped" }).output();
    const text = dec.decode(out.stdout) + dec.decode(out.stderr);
    assert(out.code === 0, "pack-zip failed:\n" + text);
    assert(new RegExp(`zip holds exactly the ${FILES.length} derived package files`).test(text), text);
  },
});
