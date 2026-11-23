function assert(condition, label) {
  if (!condition) throw new Error(label);
}

Deno.test("packer never-blocks live-video and skips non-blocking options", async () => {
  const script = [
    "import importlib.util",
    "from pathlib import Path",
    "p = Path('scripts/pack-filter-lists.py')",
    "spec = importlib.util.spec_from_file_location('pfl', p)",
    "mod = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(mod)",
    "text = '''||stats.live-video.net^",
    "||rp.example.com^$removeparam",
    "||pop.example.com^$popup",
    "||both.example.com^$script,popup",
    "||redir.example.com^$redirect=noopjs",
    "||csp.example.com^$csp=script-src 'none'",
    "||lim.example.com^$domain=news.com",
    "||from.example.com^$from=news.com",
    "||ok.example.com^'''",
    "merged, _stats = mod.merge_domains({'peter_lowe': mod.extract_domains(text)})",
    "print('\\n'.join(merged))",
    "raise SystemExit(0 if mod.is_never_block('stats.live-video.net') else 2)",
  ].join("\n");
  // A URL cwd works on every OS. Stripping the leading "/" off .pathname (meant for
  // "/G:/...") turned POSIX roots relative ("workspace/twitch-adblock/"): "No such cwd".
  const root = new URL("..", import.meta.url);
  // Windows: the launcher first. The Store alias python.exe/python3.exe starts but
  // exits 9009 ("Python was not found"), so it counts as missing and the next is tried.
  const bins = Deno.build.os === "windows" ? [["py", "-3"], ["python"], ["python3"]] : [["python3"], ["python"]];
  let out = null;
  const tried = [];
  for (const [bin, ...pre] of bins) {
    try {
      const res = await new Deno.Command(bin, { args: [...pre, "-c", script], cwd: root, env: { PYTHONDONTWRITEBYTECODE: "1" } }).output();
      if (res.code === 9009 || /Python was not found|Microsoft Store/.test(new TextDecoder().decode(res.stderr))) {
        tried.push(bin + ": Store alias, not a real Python");
        continue;
      }
      out = res;
      break;
    } catch (err) {
      tried.push(bin + ": " + String(err && err.message || err));
    }
  }
  assert(out, "no usable Python 3 (" + tried.join("; ") + ")");
  const text = new TextDecoder().decode(out.stdout);
  assert(out.code === 0, new TextDecoder().decode(out.stderr));
  // H-2: "$script,popup" is no longer widened to a whole-domain block (it is a
  // script-only scoped entry now; see test/filter-options.test.js).
  assert(text.replace(/\r/g, "").trim() === "ok.example.com", JSON.stringify(text));
});

// CONCERNS L4: the packer wrote a src/rules/README.md with 3 of the files and
// a manifest hint with the ruleset id `general_network`. The packer text is
// now checked against the folder and the manifest. The shipped README.md and
// meta.json change at the next repack (they ship in the zip).
async function runPython(script) {
  const root = new URL("..", import.meta.url);
  const bins = Deno.build.os === "windows" ? [["py", "-3"], ["python"], ["python3"]] : [["python3"], ["python"]];
  for (const [bin, ...pre] of bins) {
    try {
      const res = await new Deno.Command(bin, { args: [...pre, "-c", script], cwd: root, env: { PYTHONDONTWRITEBYTECODE: "1" } }).output();
      if (res.code === 9009 || /Python was not found|Microsoft Store/.test(new TextDecoder().decode(res.stderr))) continue;
      assert(res.code === 0, new TextDecoder().decode(res.stderr));
      return new TextDecoder().decode(res.stdout);
    } catch (_err) { /* next binary */ }
  }
  throw new Error("no usable Python 3");
}

Deno.test("packer: the rules README names every file in src/rules/, and the manifest hint matches manifest.json", async () => {
  const out = JSON.parse(await runPython([
    "import importlib.util, json",
    "from pathlib import Path",
    "spec = importlib.util.spec_from_file_location('pfl', Path('scripts/pack-filter-lists.py'))",
    "mod = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(mod)",
    "print(json.dumps({'rows': [r[0] for r in mod.RULES_README_ROWS], 'readme': mod.rules_readme(), 'hint': mod.MANIFEST_HINT}))",
  ].join("\n")));
  const folder = [...Deno.readDirSync(new URL("../src/rules/", import.meta.url))].filter((e) => e.isFile).map((e) => e.name).sort();
  assert(JSON.stringify([...out.rows].sort()) === JSON.stringify(folder), "README rows " + JSON.stringify(out.rows) + " differ from the folder " + JSON.stringify(folder));
  for (const name of folder) assert(out.readme.includes("| `" + name + "` |"), "README row for " + name);
  const manifest = JSON.parse(Deno.readTextFileSync(new URL("../manifest.json", import.meta.url)));
  const hint = out.hint.declarative_net_request.rule_resources;
  assert(hint.length === 1, "one hint entry");
  const real = manifest.declarative_net_request.rule_resources.find((r) => r.path === hint[0].path);
  assert(real && JSON.stringify(hint[0]) === JSON.stringify(real), "hint " + JSON.stringify(hint[0]) + " vs manifest " + JSON.stringify(real));
  assert(out.hint.permissions.every((p) => manifest.permissions.includes(p)), "hint permissions are in the manifest");
});

