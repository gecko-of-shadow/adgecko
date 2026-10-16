#!/usr/bin/env -S deno run -A
// Refresh the YouTube port of uBlock Origin's own filters.
//
//   deno run -A scripts/sync-ubo-youtube.mjs [--uassets <commit|master>] [--ubo <tag>]
//
// Pulls uBlockOrigin/uAssets filters/{filters,quick-fixes,unbreak}.txt at a
// pinned commit and gorhill/uBlock scriptlet sources at a release tag, keeps
// only the YouTube-scoped filters (as uBO would see them on Chromium, MV2,
// no HTML filtering), and writes:
//   src/vendor/ubo-youtube.js            MAIN-world scriptlets, built exactly as uBO injects them
//   src/vendor/ubo-youtube.css           plain cosmetic hides
//   src/rules/ubo-youtube-network.json   DNR rules (uBO's own DNR converter)
//   src/vendor/ubo-youtube-meta.json     commits used, ported and skipped filters
// uBlock Origin and uAssets are GPLv3; see src/vendor/LICENSE-uBlock.md.
const ROOT = new URL("..", import.meta.url).pathname;
const arg = (k, d) => { const i = Deno.args.indexOf(k); return i >= 0 ? Deno.args[i + 1] : d; };
const run = async (cmd, cwd) => {
  const out = await new Deno.Command(cmd[0], { args: cmd.slice(1), cwd, stdout: "piped", stderr: "piped" }).output();
  if (!out.success) throw new Error(cmd.join(" ") + "\n" + new TextDecoder().decode(out.stderr));
  return new TextDecoder().decode(out.stdout).trim();
};

const uboTag = arg("--ubo", "1.75.0");
let uassets = arg("--uassets", "master");
if (!/^[0-9a-f]{40}$/.test(uassets)) {
  const ref = uassets === "master" ? "HEAD" : uassets;
  uassets = (await run(["git", "ls-remote", "https://github.com/uBlockOrigin/uAssets", ref])).split(/\s/)[0];
}
const tmp = await Deno.makeTempDir({ prefix: "ubo-sync-" });
await run(["git", "clone", "-q", "--depth", "1", "--branch", uboTag, "https://github.com/gorhill/uBlock", tmp + "/ubo"]);
const uboCommit = await run(["git", "rev-parse", "HEAD"], tmp + "/ubo");
const LISTS = ["filters", "quick-fixes", "unbreak"];
const texts = {};
for (const name of LISTS) {
  const res = await fetch(`https://raw.githubusercontent.com/uBlockOrigin/uAssets/${uassets}/filters/${name}.txt`);
  if (!res.ok) throw new Error(name + " " + res.status);
  texts[name] = await res.text();
}

const sfp = await import(`file://${tmp}/ubo/src/js/static-filtering-parser.js`);
const { builtinScriptlets } = await import(`file://${tmp}/ubo/src/js/resources/scriptlets.js`);
const { dnrRulesetFromRawLists } = await import(`file://${tmp}/ubo/src/js/static-dnr-filtering.js`);

// uBO on Chromium (MV2): no html filtering, native :has().
const ENV = ["chromium", "ublock", "native_css_has", "user_stylesheet"];
// Hosts our MAIN-world YouTube content script runs on (manifest scope).
const HOSTS = ["www.youtube.com", "m.youtube.com", "youtube.com"];
const ancestors = (h) => { const p = h.split("."); const out = []; for (let i = 0; i < p.length - 1; i++) out.push(p.slice(i).join(".")); return out; };
const ytRe = /youtube|youtubekids|youtube-nocookie/;
function hostsApply(spec, host) {
  if (!spec) return false;
  const parts = spec.split(",").map((s) => s.trim()).filter(Boolean);
  const anc = ancestors(host);
  const pos = parts.filter((p) => !p.startsWith("~"));
  const neg = parts.filter((p) => p.startsWith("~")).map((p) => p.slice(1));
  if (neg.some((n) => anc.includes(n))) return false;
  return pos.some((p) => anc.includes(p));
}

const byName = new Map();
for (const s of builtinScriptlets) {
  byName.set(s.name, s);
  for (const a of s.aliases || []) byName.set(a, s);
}
const parser = new sfp.AstFilterParser({ trustedSource: true, nativeCssHas: true });
const ported = { scriptlets: [], cosmetic: [], network: [] };
const skipped = [];
const perHost = Object.fromEntries(HOSTS.map((h) => [h, { js: new Map(), jsEx: new Set(), css: new Set(), cssEx: new Set() }]));
const networkLines = [];
for (const name of LISTS) {
  const pruned = sfp.utils.preparser.prune(texts[name], ENV);
  for (const raw of pruned.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("!") || !ytRe.test(line)) continue;
    const m = /^([^#\s]*?)(#@?#)(\+js\(.*\)|\^.*|.*)$/.exec(line);
    if (m && m[1] !== undefined && line.includes("#")) {
      const [, spec, sep, body] = m;
      const hosts = HOSTS.filter((h) => hostsApply(spec, h));
      if (!spec || !ytRe.test(spec)) continue; // other sites' rules that merely mention youtube
      if (!hosts.length) { skipped.push({ list: name, filter: line, why: "host outside our YouTube content-script scope (manifest/release-gate limit to www/m/youtube.com)" }); continue; }
      if (body.startsWith("+js(")) {
        parser.parse(line);
        const args = parser.getScriptletArgs();
        let token = args[0] ? args[0] + (args[0].endsWith(".js") ? "" : ".js") : "";
        const s = byName.get(token);
        if (args.length && !s) { skipped.push({ list: name, filter: line, why: "scriptlet not in uBO " + uboTag }); continue; }
        const key = JSON.stringify([s ? s.name.slice(0, -3) : "", ...args.slice(1)]);
        for (const h of hosts) {
          if (sep === "#@#") perHost[h].jsEx.add(key);
          else perHost[h].js.set(key, line);
        }
        ported.scriptlets.push(line);
      } else if (body.startsWith("^")) {
        skipped.push({ list: name, filter: line, why: "HTML filtering is Firefox-only (not possible in Chrome MV3)" });
      } else {
        parser.parse(line);
        if (parser.hasError() || parser.isProceduralFilter?.() || /:(has-text|upward|xpath|remove|style|min-text-length|watch-attr|matches-css|matches-attr|matches-path|matches-prop|others|remove-attr|remove-class)\(/.test(body)) {
          skipped.push({ list: name, filter: line, why: "procedural cosmetic filter (needs uBO's procedural engine)" });
          continue;
        }
        for (const h of hosts) (sep === "#@#" ? perHost[h].cssEx : perHost[h].css).add(body);
        ported.cosmetic.push(line);
      }
      continue;
    }
    if (line.includes("##") || line.includes("#@#") || line.includes("#$#")) continue;
    networkLines.push({ list: name, line });
  }
}

// ---- scriptlets, assembled like uBO's scriptlet-filtering-core.js ----
const WORLDS = ["MAIN", "ISOLATED"];
const fnCodeBy = { MAIN: new Map(), ISOLATED: new Map() };
let fnCode;
const addDeps = (names) => {
  const queue = [...names];
  while (queue.length) {
    const n = queue.shift();
    if (fnCode.has(n)) continue;
    const d = byName.get(n);
    if (!d) throw new Error("missing dependency " + n);
    fnCode.set(n, d.fn.toString());
    queue.push(...(d.dependencies || []));
  }
};
const hostCallsBy = { MAIN: {}, ISOLATED: {} };
for (const world of WORLDS) {
fnCode = fnCodeBy[world];
const hostCalls = hostCallsBy[world];
for (const h of HOSTS) {
  const calls = [];
  for (const [key] of perHost[h].js) {
    if (perHost[h].jsEx.has(key) || perHost[h].jsEx.has('[""]')) continue;
    const args = JSON.parse(key);
    const d = byName.get(args[0] + ".js");
    if ((d.world === "ISOLATED" ? "ISOLATED" : "MAIN") !== world) continue;
    addDeps([d.name]);
    const fname = /^function\s+([^(\s]+)\s*\(/.exec(d.fn.toString())[1];
    calls.push({ code: `try {\n\t${fname}(${JSON.stringify(args.slice(1)).slice(1, -1)});\n} catch (e) {\n}`, priority: d.priority ?? 0 });
  }
  calls.sort((a, b) => a.priority === b.priority ? a.code.localeCompare(b.code) : b.priority - a.priority);
  hostCalls[h] = calls.map((c) => c.code);
}
}
for (const world of WORLDS) {
const fnCode = fnCodeBy[world];
const hostCalls = hostCallsBy[world];
const fnDefs = Array.from(fnCode.values()).sort((a, b) => a.localeCompare(b));
var banner = `// GENERATED by scripts/sync-ubo-youtube.mjs. Do not edit by hand.
// Scriptlet code: uBlock Origin ${uboTag} (gorhill/uBlock@${uboCommit}), GPLv3.
// Filters: uBlockOrigin/uAssets@${uassets} (filters, quick-fixes, unbreak), GPLv3.
// Copyright (C) Raymond Hill and contributors. See src/vendor/LICENSE-uBlock.md.
`;
const groups = new Map();
for (const h of HOSTS) {
  const body = hostCalls[h].join("\n\n");
  if (!groups.has(body)) groups.set(body, []);
  groups.get(body).push(h);
}
let js = banner + "(function() {\n// >>>> start of private namespace\n;\nconst scriptletGlobals = {};\n\n" + fnDefs.join("\n\n") + "\n\nconst hostname = location.hostname;\n";
for (const [body, hosts] of groups) {
  if (!body) continue;
  js += `\nif (${JSON.stringify(hosts)}.includes(hostname)) {\n${body}\n}\n`;
}
if (world === "MAIN") js += "\n// Tells src/youtube.js that uBO's filters own player-response pruning.\ntry { Object.defineProperty(globalThis, Symbol.for(\"twitch-adblock.ubo\"), { value: true }); } catch (e) {\n}\n";
js += "\n// <<<< end of private namespace\n})();\n";
await Deno.writeTextFile(ROOT + (world === "MAIN" ? "src/vendor/ubo-youtube.js" : "src/vendor/ubo-youtube-isolated.js"), js);
}

// ---- cosmetic ----
const cssRules = new Map();
for (const h of HOSTS) for (const sel of perHost[h].css) if (!perHost[h].cssEx.has(sel)) cssRules.set(sel, true);
const css = banner.replace(/^\/\/ (.*)$/gm, "/* $1 */") + Array.from(cssRules.keys()).map((s) => `${s} { display: none !important; }`).join("\n") + "\n";
await Deno.writeTextFile(ROOT + "src/vendor/ubo-youtube.css", css);
for (const h of HOSTS) for (const sel of perHost[h].cssEx) ported.cosmetic.push(`(exception) ${h}#@#${sel} — no matching hide in these lists; nothing to undo`);

// ---- network: uBO's own DNR converter over the YouTube-related lines ----
const result = await dnrRulesetFromRawLists([{ name: "youtube", text: networkLines.map((x) => x.line).join("\n") }], { env: ENV });
const ytDomain = (d) => ytRe.test(d);
const PRIORITY_BASE = 2000001; // must outrank the general ruleset's YouTube allowAllRequests / video-CDN allow (2000000)
const rules = [];
for (const r of result.network.ruleset || []) {
  if (r._error || r._warning) { skipped.push({ filter: JSON.stringify(r), why: "uBO DNR converter: " + (r._error || r._warning) }); continue; }
  const c = r.condition || {};
  const init = c.initiatorDomains || [];
  const targetsYt = (c.requestDomains || []).some(ytDomain) || /^\|\|[^/^*]*(youtube|googlevideo)/.test(c.urlFilter || "") || /youtube|googlevideo/.test(c.regexFilter || "");
  const onYt = init.some(ytDomain);
  const keep = onYt || (r.action.type === "block" && targetsYt && !init.length);
  if (!keep) continue;
  const clean = JSON.parse(JSON.stringify(r, (k, v) => (k.startsWith("_") ? undefined : v)));
  clean.priority = PRIORITY_BASE + (clean.priority || 1);
  rules.push(clean);
}
rules.forEach((r, i) => { r.id = i + 1; });
await Deno.writeTextFile(ROOT + "src/rules/ubo-youtube-network.json", JSON.stringify(rules, null, 1) + "\n");
for (const x of networkLines) ported.network.push(x.line);

const meta = {
  generated_at_utc: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  uassets_commit: uassets,
  ublock_tag: uboTag,
  ublock_commit: uboCommit,
  env: ENV,
  hosts: HOSTS,
  scriptlet_calls: Object.fromEntries(WORLDS.map((w) => [w, Object.fromEntries(HOSTS.map((h) => [h, hostCallsBy[w][h].length]))])),
  css_rules: cssRules.size,
  dnr_rules: rules.length,
  ported,
  skipped,
};
await Deno.writeTextFile(ROOT + "src/vendor/ubo-youtube-meta.json", JSON.stringify(meta, null, 2) + "\n");
await Deno.remove(tmp, { recursive: true });
console.log(JSON.stringify({ uassets, uboCommit, calls: meta.scriptlet_calls, css: cssRules.size, dnr: rules.length, skipped: skipped.length }));
Deno.exit(0);
