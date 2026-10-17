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
  const root = decodeURIComponent(new URL("..", import.meta.url).pathname).replace(/^\//, "");
  const bins = Deno.build.os === "windows" ? ["python", "python3"] : ["python3", "python"];
  let out = null;
  let lastErr = "";
  for (const bin of bins) {
    try {
      out = await new Deno.Command(bin, { args: ["-c", script], cwd: root }).output();
      break;
    } catch (err) {
      lastErr = String(err && err.message || err);
    }
  }
  assert(out, "neither python3 nor python could start: " + lastErr);
  const text = new TextDecoder().decode(out.stdout);
  assert(out.code === 0, new TextDecoder().decode(out.stderr));
  assert(text.replace(/\r/g, "").trim() === "both.example.com\nok.example.com", JSON.stringify(text));
});
