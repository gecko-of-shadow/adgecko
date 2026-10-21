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
  assert(text.replace(/\r/g, "").trim() === "both.example.com\nok.example.com", JSON.stringify(text));
});
