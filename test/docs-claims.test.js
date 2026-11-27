// WP-12 (review 2026-11-16): the docs and the licence files in the zip must
// agree with the code. Each test reads the code fact first and then checks the
// text, so a later code change that makes a claim true again does not fail
// here by accident. Files are read at run time (not imported), so the test
// runs the same on a copy of an old tree.
function assert(c, l) { if (!c) throw new Error(l); }
const ROOT = new URL("..", import.meta.url);
const read = (rel) => Deno.readTextFileSync(new URL(rel, ROOT)).replace(/\r\n/g, "\n");
const manifest = JSON.parse(read("manifest.json"));
const meta = JSON.parse(read("src/rules/meta.json"));

// The licence and credit files that ship in the release zip.
const SHIPPED_NOTICES = ["src/LICENSE-EasyList.txt", "src/rules/CREDIT-EasyList.txt", "src/rules/LICENSES.md"];

Deno.test("shipped licence files: no false 'manual updates' or 'not shipped' claims", () => {
  const bg = read("src/general-background.js");
  assert(/periodInMinutes:\s*GU\.ALARM_PERIOD_MINUTES/.test(bg), "code fact: the refresh alarm repeats");
  assert(/reason === "install"\)[^\n]*refreshLists\(true\)/.test(bg), "code fact: a fresh install downloads the lists");
  const general = JSON.parse(read("src/rules/general-network.json"));
  assert(meta.sources.easylist.kept > 0 && general.length > 0, "code fact: EasyList network domains ship in general-network.json");
  for (const f of SHIPPED_NOTICES) {
    const text = read(f);
    for (const bad of ["No background auto-fetch", "Updates are manual", "not shipped", "Network blocking only in"]) {
      assert(!text.includes(bad), `${f} still says "${bad}"`);
    }
  }
  const credit = read("src/rules/CREDIT-EasyList.txt");
  assert(credit.includes("threat-network.json"), "CREDIT-EasyList.txt names threat-network.json");
  assert(credit.includes("general-network.json") && credit.includes("cosmetic-rules.json"), "CREDIT-EasyList.txt names both EasyList forms");
  assert(/fresh install downloads the lists at once/.test(credit) && /every 3 hours/.test(credit), "CREDIT-EasyList.txt describes the background refresh");
  assert(/settings\s+page/.test(credit) && !/Update in the popup/.test(credit), "the Update lists button is on the settings page");
  const lic = read("src/LICENSE-EasyList.txt");
  assert(lic.includes("general-network.json") && lic.includes("cosmetic-rules.json"), "LICENSE-EasyList.txt names network and hide rules");
  assert(read("src/rules/LICENSES.md").includes("threat-network.json"), "LICENSES.md names threat-network.json");
});

// Owner decision 5 (review 2026-11-16): EasyList material is used under the
// GPL-3.0-or-later option of its dual licence, not CC BY-SA.
Deno.test("shipped licence files: EasyList is used under GPL-3.0-or-later", () => {
  const licenses = read("src/rules/LICENSES.md");
  assert(/## License choice for EasyList material\n\nRedistributed under \*\*GPL-3\.0-or-later\*\*/.test(licenses), "LICENSES.md chooses GPL-3.0-or-later");
  assert(/Redistributed under \*\*GPL-3\.0-or-later\*\*/.test(read("scripts/pack-filter-lists.py")), "packer writer chooses GPL-3.0-or-later");
  assert(/Chosen option: [^\n]*GNU GPL version 3 or later/.test(read("src/LICENSE-EasyList.txt")), "LICENSE-EasyList.txt names the chosen option");
  assert(/Chosen option: [^\n]*GNU GPL-3\.0-or-later/.test(read("src/rules/CREDIT-EasyList.txt")), "CREDIT-EasyList.txt names the chosen option");
  for (const f of [...SHIPPED_NOTICES, "scripts/pack-filter-lists.py"]) {
    assert(!/(Redistributed under|Chosen option)[^\n]*(CC BY-SA|Creative Commons)/.test(read(f)), f + " still chooses CC BY-SA");
  }
});

async function runPython(code) {
  const bins = Deno.build.os === "windows" ? [["py", "-3"], ["python"], ["python3"]] : [["python3"], ["python"]];
  const tried = [];
  for (const [bin, ...pre] of bins) {
    try {
      const res = await new Deno.Command(bin, { args: [...pre, "-I", "-B", "-c", code], cwd: ROOT, env: { PYTHONDONTWRITEBYTECODE: "1" } }).output();
      const err = new TextDecoder().decode(res.stderr);
      if (res.code === 9009 || /Python was not found|Microsoft Store/.test(err)) { tried.push(bin + ": Store alias"); continue; }
      if (res.code !== 0) throw new Error(err);
      return new TextDecoder().decode(res.stdout);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) { tried.push(bin + ": not found"); continue; }
      throw e;
    }
  }
  throw new Error("no usable Python 3 (" + tried.join("; ") + ")");
}

Deno.test("LICENSES.md is exactly what the packer's write_licenses() writes", async () => {
  // Digests and the pack time come from the file itself, so no repack is needed.
  const out = await runPython([
    "import importlib.util, re, sys",
    "from pathlib import Path",
    "spec = importlib.util.spec_from_file_location('pfl', Path('scripts/pack-filter-lists.py'))",
    "mod = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(mod)",
    "text = Path('src/rules/LICENSES.md').read_text(encoding='utf-8').replace('\\r\\n', '\\n')",
    "at = re.search(r'Packed at: `([^`]+)`', text).group(1)",
    "dig = dict(re.findall(r'### (\\w+)\\n\\n- URL: [^\\n]*\\n- Role: [^\\n]*\\n- SHA-256 of downloaded bytes: `([0-9a-f]+|n/a)`', text))",
    "sys.stdout.write('MATCH' if mod.write_licenses(dig, at) == text else 'DIFF')",
  ].join("\n"));
  assert(out === "MATCH", "src/rules/LICENSES.md differs from write_licenses(): " + out);
});

Deno.test("site access: the docs say that content scripts run on all websites", () => {
  const allSites = manifest.content_scripts.some((c) => c.matches.includes("http://*/*") && c.matches.includes("https://*/*"));
  assert(allSites, "code fact: a content script matches all http(s) sites");
  const priv = read("docs/permissions-and-privacy.md");
  const readme = read("README.md");
  assert(/^### Site access$/m.test(priv), "permissions-and-privacy.md has a Site access section");
  for (const [name, text] of [["permissions-and-privacy.md", priv], ["README.md", readme]]) {
    assert(text.includes("Read and change all your data on all websites"), name + " quotes Chrome's site-access warning");
    assert(!/permissions are exactly|exactly `storage`/.test(text), name + " still says the permissions are 'exactly' the API keys");
  }
  assert(/host[- ]permission justification/i.test(read("docs/STORE-REVIEW-NOTES.md")), "STORE-REVIEW-NOTES.md has the host access justification");
});

Deno.test("privacy doc: a fresh install downloads the lists at once", () => {
  assert(/reason === "install"\)[^\n]*refreshLists\(true\)/.test(read("src/general-background.js")), "code fact: install refresh");
  const priv = read("docs/permissions-and-privacy.md");
  assert(!/5 to 30 minutes after install/.test(priv), "permissions-and-privacy.md still dates the first download 5 to 30 minutes after install");
  assert(/fresh install downloads the lists at once/.test(priv), "permissions-and-privacy.md names the install download");
  assert(/fresh install downloads the lists at once/.test(read("README.md")), "README privacy bullet names the install download");
});

Deno.test("README: 'Off' and the not-covered list match the manifest and the master switch", () => {
  const bg = read("src/general-background.js");
  const uboToggled = /updateEnabledRulesets\([^)]*ubo-youtube/.test(bg) || /RulesetIds:\s*\[[^\]]*"ubo-youtube"/.test(bg);
  const readme = read("README.md");
  if (!uboToggled) {
    // Option B (owner decision 3): the code leaves the ruleset on, so the docs must say so.
    assert(!/The whole extension is switched off/.test(readme), "README says 'Off' switches the whole extension off");
    assert(/YouTube network rules[^\n]*keep running[^\n]*chrome:\/\/extensions/.test(readme), "README 'Off' names what keeps running");
    assert(/YouTube network rules[^<]*also stay on/.test(read("src/settings.html")), "settings note names the YouTube network rules");
  } else {
    // Option A (owner decision 3, 2026-11-27): the master switch also stops the ruleset.
    assert(!/The whole extension is switched off/.test(readme), "README says 'Off' switches the whole extension off");
    assert(/stops the YouTube network rules[^\n]*keep running[^\n]*chrome:\/\/extensions/.test(readme), "README 'Off' says the master switch stops the YouTube network rules and names what keeps running");
    assert(!/YouTube network rules[^\n.]*keep running/.test(readme), "README still says the YouTube network rules keep running");
    const note = read("src/settings.html");
    assert(/master switch stops the uBlock Origin YouTube network rules/.test(note), "settings note says the master switch stops the YouTube network rules");
    assert(!/YouTube network rules[^<.]*also stay on/.test(note), "settings note still says the YouTube network rules stay on");
  }
  const yt = manifest.content_scripts.filter((c) => (c.js || []).some((j) => /ubo-youtube|src\/youtube\.js/.test(j)));
  assert(yt.length > 0, "code fact: YouTube ad scripts in the manifest");
  if (yt.every((c) => !c.all_frames)) {
    // Owner decision 4: the gap is documented, not closed.
    assert(/YouTube videos embedded in other websites are not covered/.test(readme), "README not-covered list names embedded YouTube players");
  }
});

Deno.test("how-it-works.md: pack numbers, $all and the YouTube Music popup match the code", () => {
  const doc = read("docs/how-it-works.md");
  const num = (re) => { const m = doc.match(re); return m ? Number(m[1].replace(/,/g, "")) : null; };
  const pairs = [
    [/([\d,]+) whole-domain/, meta.domains_total, "domains_total"],
    [/([\d,]+) scoped entries/, meta.scoped_entries_total, "scoped_entries_total"],
    [/([\d,]+) list rules/, meta.dnr_rules_total, "dnr_rules_total"],
    [/general-network\.json` has ([\d,]+) rules/, meta.general_network_rules_total, "general_network_rules_total"],
  ];
  for (const [re, want, key] of pairs) {
    const got = num(re);
    assert(got !== null, "how-it-works.md has no number for " + key);
    assert(got === want, `how-it-works.md says ${got} for ${key}, meta.json has ${want}`);
  }
  const fo = read("src/general/filter-options.js");
  if (/function allAddsDocument/.test(fo)) assert(/plain `\$all` filter/.test(doc), "how-it-works.md names `$all` as a page block");
  const flagsHosts = manifest.content_scripts.some((c) => (c.js || []).includes("src/settings/flags.js") && c.matches.includes("*://*.youtube.com/*"));
  if (flagsHosts) {
    assert(!/YouTube hosts such as YouTube Music\) give no answer/.test(doc), "how-it-works.md says YouTube Music gives the popup no answer");
    assert(/Malware blocking only/.test(doc), "how-it-works.md names the 'Malware blocking only' status");
  }
});

// CONCERNS L3: five comments pointed to a notes file that was never in the
// repository. Their facts now stand in the comments. No source, script,
// workflow or test file may point to that file again.
Deno.test("no file points to the build notes that are not in the repository", () => {
  const name = "BUILD" + "-PROGRESS";
  const hits = [];
  const walk = (rel) => {
    for (const e of Deno.readDirSync(new URL(rel, ROOT))) {
      const r = rel + e.name;
      if (e.isDirectory) {
        if (!e.name.startsWith(".")) walk(r + "/");
      } else if (/\.(js|mjs|py|sh|yml|html|css|md)$/.test(e.name) && read(r).includes(name)) hits.push(r);
    }
  };
  for (const dir of ["src/", "scripts/", "test/", ".github/"]) walk(dir);
  assert(!hits.length, "files that point to the missing notes: " + hits.join(", "));
  const fo = read("src/general/filter-options.js");
  assert(/Evidence: redirectingat\.com \(Skimlinks\)/.test(fo) && /linksprf\.com is the redirect that deal sites/.test(fo), "the navigation exemptions keep their evidence in the comment");
});

