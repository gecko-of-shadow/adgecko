// Test-only option injection. src/youtube.js and the generated uBO bundle no
// longer read options from localStorage (the page can write it; Block I), so
// harnesses patch the defaults into the source text before they eval it.

// src/youtube.js: `  const OPTS = { ... };` -> `Object.assign({ ... }, opts)`.
// diag stays on in harnesses unless a test says otherwise (it was the old
// default, and some tests read the log lines).
export function withYtOpts(src, opts) {
  const all = Object.assign({ diag: true }, opts || {});
  const re = /^(  const OPTS = )(\{.*\});(\r?)$/m;
  if (!re.test(src)) throw new Error("youtube.js OPTS line not found");
  return src.replace(re, (_m, a, b, cr) => a + "Object.assign(" + b + ", " + JSON.stringify(all) + ");" + cr);
}

// Generated uBO bundle: `  const defaults = {...};` in the uboOn prelude.
export function withUboOpts(src, opts) {
  if (!opts || !Object.keys(opts).length) return src;
  const re = /^(  const defaults = )(\{.*\});(\r?)$/m;
  if (!re.test(src)) throw new Error("uBO bundle defaults line not found");
  return src.replace(re, (_m, a, b, cr) => a + "Object.assign(" + b + ", " + JSON.stringify(opts) + ");" + cr);
}
