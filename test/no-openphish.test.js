// Owner decisions 2026-11-02: no OpenPhish data at all, direct or indirect
// (#13): Curben's phishing-filter (curated from OpenPhish, IPThreat and
// PhishTank) is dropped everywhere. curbengh's urlhaus-filter (URLhaus data,
// CC0) is the ONE documented Curben exception (#18b): source urlhaus_hosts,
// fetched only from malware-filter.gitlab.io/malware-filter/urlhaus-filter-hosts-online.txt.
// The rule lives in scripts/lib/curben_check.py, shared with the release gate
// (section 2c); these tests run it on the repo and on copies with each
// forbidden case injected. CHANGELOG and docs are not scanned: they may say
// the list was removed.
import updateSource from "../src/general/update.js" with { type: "text" };
import packerSource from "../scripts/pack-filter-lists.py" with { type: "text" };
import licenses from "../src/rules/LICENSES.md" with { type: "text" };
import meta from "../src/rules/meta.json" with { type: "json" };
import manifest from "../manifest.json" with { type: "json" };
function assert(c, l) { if (!c) throw new Error(l); }

const U = {};
new Function(`${updateSource}\nreturn installGeneralAdblockUpdate;`)()(U);
const ROOT = new URL("..", import.meta.url);
const URLHAUS = "https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-hosts-online.txt";
// Built from pieces so the injected cases below are obviously test data.
const OP = "open" + "phish";
const PF = "phishing" + "-filter";
const CP = "curben" + "_phishing";

async function runCheck(extra = [], overrides = null) {
  const args = ["scripts/lib/curben_check.py", "--root", ".", "--packer", "scripts/pack-filter-lists.py", "--gate", "scripts/release-gate.sh", ...extra];
  if (overrides) args.push("--overrides-stdin");
  const child = new Deno.Command("python3", { args, cwd: ROOT, stdin: "piped", stdout: "piped", stderr: "piped" }).spawn();
  const w = child.stdin.getWriter();
  await w.write(new TextEncoder().encode(overrides ? JSON.stringify(overrides) : ""));
  await w.close();
  const out = await child.output();
  const dec = new TextDecoder();
  return { code: out.code, text: dec.decode(out.stdout) + dec.decode(out.stderr) };
}

Deno.test("Curben rule: the repo passes (only urlhaus-filter from malware-filter.gitlab.io)", async () => {
  const r = await runCheck();
  assert(r.code === 0, r.text);
});

Deno.test("Curben rule: urlhaus_hosts is the sole Curben source, at the one allowed URL", () => {
  const curben = U.SOURCES.filter((s) => [s.url, ...(s.mirrors || [])].some((u) => /malware-filter|curben/i.test(u)));
  assert(curben.length === 1 && curben[0].name === "urlhaus_hosts", "runtime: " + curben.map((s) => s.name));
  assert(curben[0].url === URLHAUS && curben[0].mirrors.length === 0, "runtime url / no mirrors");
  const metaCurben = Object.entries(meta.sources).filter(([, s]) => /malware-filter|curben/i.test(s.url || ""));
  assert(metaCurben.length === 1 && metaCurben[0][0] === "urlhaus_hosts" && metaCurben[0][1].url === URLHAUS, "packed meta");
  assert(manifest.host_permissions.filter((h) => /malware-filter|curben/i.test(h)).join() === "https://malware-filter.gitlab.io/*", "manifest host");
  // Licence line: upstream terms (CC0 + MIT), not the old wrong NC licence.
  const line = licenses.split(/\r?\n/).find((l) => /License \/ terms: urlhaus-filter/.test(l));
  assert(line && /CC0 1\.0/.test(line) && /MIT/.test(line) && !/BY-NC/.test(line), "licence line: " + line);
  assert(/one Curben list/i.test(licenses) && /#18b/.test(licenses), "exception documented in LICENSES.md");
});

Deno.test("Curben rule: licence strings are clean UTF-8 and LICENSES.md matches the packer", () => {
  const MOJIBAKE = /ΓÇ|Γå|â€|�/;
  assert(!MOJIBAKE.test(licenses), "LICENSES.md mojibake");
  assert(!MOJIBAKE.test(packerSource), "packer mojibake");
  const strings = [...packerSource.matchAll(/"license":\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse('"' + m[1] + '"'));
  assert(strings.length === U.SOURCES.length, "one licence string per source: " + strings.length);
  for (const s of strings) assert(licenses.includes("- License / terms: " + s), "LICENSES.md lacks: " + s.slice(0, 60));
});

Deno.test("Curben rule: each forbidden case makes the checker fail", async () => {
  // Contents are swapped in memory (--overrides-stdin): nothing is written.
  const orig = {};
  const keyOf = { "scripts/pack-filter-lists.py": "@packer", "scripts/release-gate.sh": "@gate" };
  for (const f of ["manifest.json", "src/general/update.js", "src/threat/compile.js", "src/rules/meta.json", "src/rules/threat-meta.json",
    "src/rules/dnr-merge-meta.json", "src/rules/LICENSES.md", "scripts/pack-filter-lists.py", "scripts/release-gate.sh"]) {
    orig[f] = await Deno.readTextFile(new URL(f, ROOT));
  }
  {
    const urlhausLine = /[ \t]*\{ name: "urlhaus_hosts"[^\n]*\n/;
    const addSource = (s) => orig["src/general/update.js"].replace(urlhausLine, (m) => m + "    " + s + "\n");
    const cases = [
      ["update.js: urlhaus_hosts points at the phishing list", "src/general/update.js",
        orig["src/general/update.js"].replace(URLHAUS, "https://malware-filter.gitlab.io/malware-filter/" + PF + ".txt")],
      ["update.js: the dropped phishing source is back", "src/general/update.js",
        addSource(`{ name: "${CP}", url: "https://malware-filter.gitlab.io/malware-filter/${PF}.txt", mirrors: [] },`)],
      ["update.js: another malware-filter path", "src/general/update.js",
        addSource(`{ name: "pup", url: "https://malware-filter.gitlab.io/malware-filter/pup-filter-hosts.txt", mirrors: [] },`)],
      ["update.js: Curben's Cloudflare Pages mirror", "src/general/update.js",
        orig["src/general/update.js"].replace(`url: "${URLHAUS}", mirrors: []`, `url: "${URLHAUS}", mirrors: ["https://urlhaus-filter.pages.dev/urlhaus-filter-hosts-online.txt"]`)],
      ["update.js: another Curben list on Cloudflare Pages", "src/general/update.js",
        addSource(`{ name: "pup", url: "https://pup-filter.pages.dev/pup-filter-hosts.txt", mirrors: [] },`)],
      ["update.js: a Curben mirror for urlhaus", "src/general/update.js",
        orig["src/general/update.js"].replace(`url: "${URLHAUS}", mirrors: []`, `url: "${URLHAUS}", mirrors: ["https://curbengh.github.io/malware-filter/urlhaus-filter-hosts-online.txt"]`)],
      ["update.js: an OpenPhish source", "src/general/update.js",
        addSource(`{ name: "feed", url: "https://${OP}.com/feed.txt", mirrors: [] },`)],
      ["update.js: urlhaus_hosts removed (no longer exactly one)", "src/general/update.js",
        orig["src/general/update.js"].replace(urlhausLine, "")],
      ["threat compile: the dropped list named as a threat list", "src/threat/compile.js",
        orig["src/threat/compile.js"].replace('"urlhaus_hosts",', `"urlhaus_hosts", "${CP}",`)],
      ["manifest: a Curben mirror host", "manifest.json",
        orig["manifest.json"].replace('"https://malware-filter.gitlab.io/*",', '"https://malware-filter.gitlab.io/*",\n    "https://malware-filter.pages.dev/*",')],
      ["manifest: an OpenPhish host", "manifest.json",
        orig["manifest.json"].replace('"https://malware-filter.gitlab.io/*",', `"https://malware-filter.gitlab.io/*",\n    "https://${OP}.com/*",`)],
      ["meta.json: the dropped source", "src/rules/meta.json",
        orig["src/rules/meta.json"].replace('"urlhaus_hosts": {', `"${CP}": { "url": "https://malware-filter.gitlab.io/malware-filter/${PF}.txt" },\n    "urlhaus_hosts": {`)],
      ["threat-meta.json: the dropped source", "src/rules/threat-meta.json",
        orig["src/rules/threat-meta.json"].replace('"urlhaus_hosts": {', `"${CP}": { "added": 1 },\n    "urlhaus_hosts": {`)],
      ["dnr-merge-meta.json: an OpenPhish string", "src/rules/dnr-merge-meta.json",
        orig["src/rules/dnr-merge-meta.json"].replace('"ruleset_id": "general",', `"ruleset_id": "general",\n  "note": "${OP}",`)],
      ["LICENSES.md: the dropped list", "src/rules/LICENSES.md",
        orig["src/rules/LICENSES.md"] + `\n### ${CP}\n\n- URL: \`https://malware-filter.gitlab.io/malware-filter/${PF}.txt\`\n`],
      ["LICENSES.md: OpenPhish named", "src/rules/LICENSES.md", orig["src/rules/LICENSES.md"] + "\nData from OpenPhish.\n"],
      ["packer: the dropped source", "scripts/pack-filter-lists.py",
        orig["scripts/pack-filter-lists.py"].replace(/\(\s*\n\s*"adguard_base",/,
          `(\n            "${CP}",\n            {\n                "url": "https://malware-filter.gitlab.io/malware-filter/${PF}.txt",\n                "license": "x",\n            },\n        ),\n        (\n            "adguard_base",`)],
      ["gate: a Curben mirror in the outbound allow-list", "scripts/release-gate.sh",
        orig["scripts/release-gate.sh"].replace('"malware-filter.gitlab.io", "ublockorigin.github.io",', '"malware-filter.gitlab.io", "curbengh.github.io", "ublockorigin.github.io",')],
      ["gate: an OpenPhish host in the outbound allow-list", "scripts/release-gate.sh",
        orig["scripts/release-gate.sh"].replace('"malware-filter.gitlab.io", "ublockorigin.github.io",', `"malware-filter.gitlab.io", "${OP}.com", "ublockorigin.github.io",`)],
      ["gate: the checker call removed", "scripts/release-gate.sh",
        orig["scripts/release-gate.sh"].replaceAll("curben_check.py", "removed.py")],
    ];
    for (const [label, file, text] of cases) {
      assert(text !== orig[file], "case did not change the file: " + label);
      const r = await runCheck([], { [keyOf[file] || file]: text });
      assert(r.code === 1, `checker passed a forbidden case: ${label}\n${r.text}`);
      assert(!/not JSON|missing input|usage/.test(r.text), `failed for the wrong reason: ${label}\n${r.text}`);
    }
    // Control: the same plumbing with unchanged contents passes.
    const same = await runCheck([], Object.fromEntries(Object.entries(orig).map(([f, x]) => [keyOf[f] || f, x])));
    assert(same.code === 0, "unchanged overrides pass: " + same.text);
  }
});

function fakeDeps(state, data) {
  const removed = [];
  let dynamic = [{ id: U.LIST_RULE_ID_BASE, priority: 1, action: { type: "block" }, condition: { requestDomains: ["stale-phish.example"] } }];
  let staticOn = false;
  const deps = {
    removed, get dynamic() { return dynamic; }, get staticOn() { return staticOn; },
    now: () => 1e12,
    getState: async () => structuredClone(state),
    setState: async (p) => Object.assign(state, structuredClone(p)),
    getListData: async (names) => Object.fromEntries(names.filter((n) => data[n]).map((n) => [n, structuredClone(data[n])])),
    setListData: async (n, p) => { data[n] = structuredClone(p); },
    removeListData: async (names) => { for (const n of names) { removed.push(n); delete data[n]; } },
    listDataPresent: async (names) => names.filter((n) => data[n]),
    getDynamicRules: async () => dynamic.slice(),
    updateDynamicRules: async ({ removeRuleIds, addRules }) => { dynamic = dynamic.filter((r) => !removeRuleIds.includes(r.id)).concat(addRules); },
    setStaticEnabled: async (on) => { staticOn = on; },
    loadBundled: async () => ({ rules: [], extraIds: [] }),
    enabled: () => true,
  };
  return deps;
}

Deno.test("stale Curben data on an existing install is dropped and its domains stop being blocked", async () => {
  const lists = {};
  const data = {};
  for (const s of U.SOURCES) {
    lists[s.name] = { url: s.url, fetchedAt: 1, expiresMs: 86400000, count: 2, parser: U.PARSER_VERSION };
    data[s.name] = { domains: [s.name.replace(/_/g, "-") + "-a.example", s.name.replace(/_/g, "-") + "-b.example"], scoped: [], parser: U.PARSER_VERSION };
  }
  lists.curben_phishing = { url: "https://malware-filter.gitlab.io/malware-filter/phishing-filter.txt", fetchedAt: 1, count: 1 };
  data.curben_phishing = { domains: ["stale-phish.example"] };
  const state = { schema: 2, dynamicActive: true, lists };
  const d = fakeDeps(state, data);
  const r = await U.applyEnabled(d, true);
  assert(r.ok && r.mode === "dynamic", JSON.stringify(r));
  assert(!state.lists.curben_phishing && !data.curben_phishing && d.removed.includes("curben_phishing"), "metadata and payload removed");
  const blocked = d.dynamic.flatMap((x) => x.condition.requestDomains || []);
  assert(!blocked.includes("stale-phish.example"), "stale domain still blocked");
  assert(blocked.includes("urlhaus-hosts-a.example"), "other lists rebuilt");
  // Idempotent: a second run finds nothing to drop and does not error.
  assert((await U.dropRetiredLists(d, state)).length === 0, "nothing left to drop");
  const again = await U.applyEnabled(d, true);
  assert(again.ok, "second run ok");
});

Deno.test("no stale Curben data: cleanup is a no-op without errors", async () => {
  const d = fakeDeps({ schema: 2, lists: {} }, {});
  assert((await U.dropRetiredLists(d, { lists: {} })).length === 0, "nothing dropped");
  assert(d.removed.length === 0, "no removes");
  // A payload key left behind without metadata is still removed.
  const data = { curben_phishing: { domains: ["x.example"] } };
  const d2 = fakeDeps({ schema: 2, lists: {} }, data);
  assert(JSON.stringify(await U.dropRetiredLists(d2, { lists: {} })) === '["curben_phishing"]' && !data.curben_phishing, "orphan payload removed");
});

// Block 1h (security review M-8): every list names its upstream terms (checked
// 2026-11-02), not "see ... for the current license".
Deno.test("licence record: each list's line names concrete upstream terms", () => {
  const line = (name) => {
    const block = licenses.split(/\r?\n### /).find((b) => b.startsWith(name + "\n") || b.startsWith(name + "\r\n"));
    return block ? (block.split(/\r?\n/).find((l) => l.startsWith("- License / terms: ")) || "") : "";
  };
  assert(!/for the current license/i.test(licenses), "a list still says 'see ... for the current license'");
  assert(/GPL-3\.0/.test(line("hagezi_pro_mini")) && /GPL-3\.0/.test(line("ublock_badware")) && /GPL-3\.0/.test(line("adguard_base")), "GPL-3.0 lists");
  assert(/Dandelicence v1\.4/.test(line("dandelion_antimalware")) && /adfilt\/blob\/master\/LICENSE\.md/.test(line("dandelion_antimalware")), "Dandelicence + link");
  assert(/GPL-3\.0-or-later OR CC BY-SA 3\.0/.test(line("easylist")), "EasyList dual licence");
  // Peter Lowe: wording kept as it was; the owner decides (NEEDS OWNER in BUILD-PROGRESS.md).
  assert(/Peter Lowe's list/.test(line("peter_lowe")), "Peter Lowe line present");
});

// Owner decision 2026-11-04: uBO badware's "! openphish" section stays out. The
// parser and the packer both skip it, so a repack or a refresh cannot bring it
// back. vzla-qr.com is not in the general list here: HaGeZi has it on its own.
const SECTION_LIST = ["! Title: x", "||before.example^", "! " + OP, "||drop-a.example^", "||drop-b.example^", "", "||drop-c.example^", "! https://scan.example/1", "||after.example^", "! OPENPHISH feed", "||drop-d.example^", "! other", "||last.example^"].join("\n");

Deno.test("OpenPhish section: the refresh parser drops it from its header to the next comment", () => {
  const { domains, scoped } = U.parseEntries(SECTION_LIST);
  assert(JSON.stringify(domains) === '["before.example","after.example","last.example"]', JSON.stringify(domains));
  assert(scoped.length === 0, JSON.stringify(scoped));
  assert(U.PARSER_VERSION >= 3, "saved lists from before the section rule are rebuilt");
});

Deno.test("OpenPhish section: the packer drops the same entries", async () => {
  const code = [
    "import importlib.util, json, sys",
    "sys.dont_write_bytecode = True",
    "spec = importlib.util.spec_from_file_location('pack', 'scripts/pack-filter-lists.py')",
    "mod = importlib.util.module_from_spec(spec); sys.modules['pack'] = mod; spec.loader.exec_module(mod)",
    `print(json.dumps(mod.extract_entries(${JSON.stringify(SECTION_LIST)})))`,
  ].join("\n");
  const out = await new Deno.Command("python3", { args: ["-c", code], cwd: ROOT, stdout: "piped", stderr: "piped" }).output();
  const dec = new TextDecoder();
  assert(out.code === 0, dec.decode(out.stderr));
  const parsed = U.parseEntries(SECTION_LIST);
  assert(JSON.stringify(JSON.parse(dec.decode(out.stdout))) === JSON.stringify([parsed.domains, parsed.scoped]), dec.decode(out.stdout));
});

// A sentinel host is accepted only when the committed pack metadata records at
// least one approved source that listed it, and none of those is a banned one.
const BAD_SOURCE = new RegExp(OP + "|" + PF + "|" + CP, "i");
function sentinelVerdict(host, map, approved) {
  const srcs = (map && map[host]) || [];
  if (!srcs.length) return "no recorded source for " + host;
  const good = srcs.filter((s) => approved.includes(s) && !BAD_SOURCE.test(s));
  return good.length ? null : "only unapproved or banned sources for " + host;
}

Deno.test("OpenPhish guard: no configured source is an OpenPhish or Curben phishing-filter source", async () => {
  for (const s of U.SOURCES) {
    for (const v of [s.name, s.url, ...(s.mirrors || [])]) assert(!BAD_SOURCE.test(v), "runtime source: " + v);
  }
  const code = [
    "import importlib.util, json, sys",
    "sys.dont_write_bytecode = True",
    "spec = importlib.util.spec_from_file_location('pack', 'scripts/pack-filter-lists.py')",
    "mod = importlib.util.module_from_spec(spec); sys.modules['pack'] = mod; spec.loader.exec_module(mod)",
    "print(json.dumps({'sources': [[n, s['url']] for n, s in mod.SOURCES.items()], 'sentinels': list(mod.SENTINEL_HOSTS)}))",
  ].join("\n");
  const out = await new Deno.Command("python3", { args: ["-c", code], cwd: ROOT, stdout: "piped", stderr: "piped" }).output();
  const dec = new TextDecoder();
  assert(out.code === 0, dec.decode(out.stderr));
  const packer = JSON.parse(dec.decode(out.stdout));
  assert(packer.sources.length > 0, "packer sources read");
  for (const [n, u] of packer.sources) assert(!BAD_SOURCE.test(n) && !BAD_SOURCE.test(u), "packer source: " + n);
});

Deno.test("OpenPhish guard: sentinel verdict fails on zero or only banned sources", () => {
  const approved = ["hagezi_pro_mini", "easylist"];
  assert(sentinelVerdict("x.example", { "x.example": ["hagezi_pro_mini"] }, approved) === null, "approved source passes");
  assert(sentinelVerdict("x.example", {}, approved) !== null, "zero sources fails");
  assert(sentinelVerdict("x.example", { "x.example": [] }, approved) !== null, "empty list fails");
  assert(sentinelVerdict("x.example", { "x.example": [CP] }, approved) !== null, "banned-only fails");
  assert(sentinelVerdict("x.example", { "x.example": [CP, "unknown_list"] }, approved) !== null, "unapproved-only fails");
});

Deno.test("OpenPhish section: the shipped rule files hold none of its hosts without an approved recorded source", async () => {
  const code = [
    "import importlib.util, json, sys",
    "sys.dont_write_bytecode = True",
    "spec = importlib.util.spec_from_file_location('pack', 'scripts/pack-filter-lists.py')",
    "mod = importlib.util.module_from_spec(spec); sys.modules['pack'] = mod; spec.loader.exec_module(mod)",
    "print(json.dumps({'sources': list(mod.SOURCES.keys()), 'sentinels': list(mod.SENTINEL_HOSTS)}))",
  ].join("\n");
  const out = await new Deno.Command("python3", { args: ["-c", code], cwd: ROOT, stdout: "piped", stderr: "piped" }).output();
  const dec = new TextDecoder();
  assert(out.code === 0, dec.decode(out.stderr));
  const { sources, sentinels } = JSON.parse(dec.decode(out.stdout));
  const approved = sources.filter((n) => !BAD_SOURCE.test(n));
  const map = meta.sentinel_sources || {};
  for (const file of ["general-network", "threat-network", "threat-snapshot"]) {
    const text = await Deno.readTextFile(new URL(`src/rules/${file}.json`, ROOT));
    for (const h of sentinels) {
      if (!text.includes(`"${h}"`)) continue;
      if (file === "general-network") {
        const why = sentinelVerdict(h, map, approved);
        assert(why === null, `${file} holds ${h}: ${why}`);
      } else {
        assert(false, `${file} still holds ${h}`);
      }
    }
    if (file !== "general-network") assert(!text.includes('"vzla-qr.com"'), `${file} still holds vzla-qr.com`);
  }
});
