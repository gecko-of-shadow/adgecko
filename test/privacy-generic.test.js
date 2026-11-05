// Block 1f (security review M-6, M-7, L-1, L-13): generic privacy checks that
// need no secret, the required secret on pushes to main, and the CI workflow
// hardening. Every fake value is assembled at run time so this file itself
// never holds a real-looking address, path or token.
import workflow from "../.github/workflows/checks.yml" with { type: "text" };
function assert(c, l) { if (!c) throw new Error(l); }
const ROOT = new URL("..", import.meta.url);
const dec = new TextDecoder();
const j = (...parts) => parts.join("");
// The owner's words come from PRIVACY_PATTERNS at run time, so this file names nobody.
// Without it two tests show as ignored. CI gives it to the tests job on pushes to main only.
const personalWords = (Deno.env.get("PRIVACY_PATTERNS") ?? "").split("\n").map((w) => w.trim()).filter(Boolean);

// GitHub masks each secret row, which is the \\bword\\b form, and not the bare word.
function bareWordMasks(rows) {
  const words = rows.filter((r) => /^\\b.+\\b$/.test(r)).map((r) => r.slice(2, -2).replaceAll("[.]", "."));
  return words.map((w) => "::add-mask::" + w);
}
if (Deno.env.get("GITHUB_ACTIONS") === "true") bareWordMasks(personalWords).forEach((m) => console.log(m));

async function pyCall(expr, input) {
  const code = [
    "import importlib.util, json, sys",
    "s = importlib.util.spec_from_file_location('pc', 'scripts/privacy-check.py')",
    "m = importlib.util.module_from_spec(s); s.loader.exec_module(m)",
    "data = json.loads(sys.stdin.read())",
    "print(json.dumps(" + expr + "))",
  ].join("\n");
  const child = new Deno.Command("python3", { args: ["-B", "-c", code], cwd: ROOT, stdin: "piped", stdout: "piped", stderr: "piped" }).spawn();
  const w = child.stdin.getWriter();
  await w.write(new TextEncoder().encode(JSON.stringify(input)));
  await w.close();
  const out = await child.output();
  assert(out.code === 0, dec.decode(out.stderr));
  return JSON.parse(dec.decode(out.stdout));
}

// Builds a throwaway repo in two commits and runs the checker on the second.
// spec: base and head are { path: text } (null deletes), rename is [old, new].
async function inRepo(spec) {
  const code = String.raw`
import json, os, subprocess, sys, tempfile
spec = json.loads(sys.stdin.read())
checker = os.path.abspath("scripts/privacy-check.py")
def put(d, files):
    for path, text in files.items():
        full = os.path.join(d, path)
        if text is None:
            os.remove(full)
            continue
        os.makedirs(os.path.dirname(full) or d, exist_ok=True)
        with open(full, "wb") as f:
            f.write(text.encode("utf-8"))
with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
    def git(*args):
        return subprocess.run(["git", "-c", "user.name=zq", "-c", "user.email=zq", "-c", "core.autocrlf=false", *args], cwd=d, check=True, capture_output=True).stdout.decode().strip()
    git("init", "-q")
    put(d, spec.get("base", {}))
    git("add", "-A")
    git("commit", "-q", "--allow-empty", "-m", "base")
    base = git("rev-parse", "HEAD")
    put(d, spec.get("head", {}))
    if spec.get("rename"):
        git("mv", *spec["rename"])
    git("add", "-A")
    git("commit", "-q", "--allow-empty", "-m", spec.get("message", "head"))
    env = dict(os.environ, PRIVACY_PATTERNS=spec.get("patterns", ""), GITHUB_EVENT_NAME="push", BASE_SHA=base, HEAD_SHA="HEAD",
               REQUIRE_PATTERNS="true" if spec.get("main") else "", GITHUB_STEP_SUMMARY="")
    r = subprocess.run([sys.executable, "-B", "-I", checker] + spec.get("args", []), cwd=d, env=env, capture_output=True)
    print(json.dumps({"code": r.returncode, "out": r.stdout.decode("utf-8", "replace"), "err": r.stderr.decode("utf-8", "replace")}))
`;
  const child = new Deno.Command("python3", { args: ["-B", "-c", code], cwd: ROOT, stdin: "piped", stdout: "piped", stderr: "piped" }).spawn();
  const w = child.stdin.getWriter();
  await w.write(new TextEncoder().encode(JSON.stringify(spec)));
  await w.close();
  const out = await child.output();
  assert(out.code === 0, dec.decode(out.stderr));
  const r = JSON.parse(dec.decode(out.stdout));
  r.visible = r.out.split(/\r?\n/).filter((l) => !l.startsWith("::add-mask::")).join("\n");
  return r;
}
const FAKE_ROW = String.raw`\bzqplumbus\b`;

Deno.test("privacy check: public IPs, e-mails, home paths and token shapes are found; documentation and placeholder values are not", async () => {
  const hit = [
    j("server at ", "93.184", ".216.34", " today"),
    j("ip=", "8.8", ".8.8&itag=18"),
    j("addr ", "2606:4700", ":4700::", "1111"),
    j("mail ", "someone", "@", "gmail", ".com"),
    j("cd ", "/home/", "alice", "/repo"),
    j("open ", "C:\\", "Users\\", "alice", "\\Desktop"),
    j("git bash ", "/c/", "Users/", "alice", "/x"),
    j("ls ", "/Users/", "alice", "/Library"),
    j("key ", "AIza", "x".repeat(35)),
    j("tok ", "xox", "b-", "1234567890-abcdefghij"),
    j("jwt ", "eyJ", "a".repeat(12), ".eyJ", "b".repeat(12), ".", "c".repeat(12)),
    j("gh ", "ghp", "_", "A".repeat(36)),
    // Follow-up review: a value at the end of a sentence, any-case Windows and WSL paths.
    j("write to ", "someone", "@", "gmail", ".com", "."),
    j("the server is ", "93.184", ".216.34", "."),
    j("addr ", "2606:4700", ":4700::", "1111", "."),
    j("cd ", "c:\\", "users\\", "alice", "\\x"),
    j("wsl ", "/mnt/c/", "Users/", "alice", "/x"),
  ];
  const clean = [
    j("doc ", "192.0", ".2.10", " and ", "198.51", ".100.7", " and ", "203.0", ".113.5"),
    j("lan ", "192.168", ".1.1", " loop ", "127.0", ".0.1", " any ", "0.0", ".0.0"),
    j("ua Chrome/", "155.0", ".0.0", " Safari/537.36"),
    j("v6 doc ", "2001:db8", "::1", " loop ::1"),
    "print(f\"::add-mask::{escape_command_data(line)}\")",
    "time 12:30:45 and std::vector and a::b::c",
    j("noreply ", "noreply", "@", "anthropic", ".com"),
    j("gh noreply ", "123+someone", "@users.", "noreply.github.com"),
    j("example ", "me", "@", "example", ".com", " ", "x@site", ".test"),
    j("path ", "/home/", "user", "/x ", "/c/", "Users/", "...", " C:\\", "Users\\", "<you>"),
    j("allowed ", "93.184", ".216.34", " // privacy-check: allow"),
    "version 0.2.21 and 1.75.0",
  ];
  const kinds = await pyCall("[m.kinds_for(l, [], 'docs/x.md') for l in data]", hit.concat(clean));
  hit.forEach((l, i) => assert(kinds[i].length > 0, "missed: " + l));
  clean.forEach((l, i) => assert(kinds[hit.length + i].length === 0, "false positive " + JSON.stringify(kinds[hit.length + i]) + ": " + l));
  // Host data files keep their IPs; secrets are never excused by the marker.
  const r = await pyCall("[m.kinds_for(data[0], [], 'src/rules/threat-network.json'), m.kinds_for(data[1], [], 'docs/x.md')]",
    [j("\"", "93.184", ".216.34", "\""), j("ghp", "_", "B".repeat(36), " // privacy-check: allow")]);
  assert(r[0].length === 0 && r[1].includes("obvious secret"), JSON.stringify(r));
});

Deno.test("privacy check: a personal word may sit in a quoted hostname in src/rules/*.json, and nowhere else", async () => {
  const word = "zqword";
  const ip = j("93.184", ".216.34");
  const host = "\"ads." + word + ".example\"";
  const rule = "src/rules/general-network.json";
  const cases = [
    [rule, "[" + host + ",\"b.example\"]", false],
    ["docs/x.md", host, true],
    ["src/rules/sub/x.json", host, true],
    ["src/rules/x.txt", host, true],
    [null, host, true],
    [rule, "{\"urlFilter\":\"||" + word + ".example^\"}", true],
    [rule, "{\"note\":\"" + word + "\"}", true],
    [rule, j("\"", word, "@", "mail.example\""), true],
    [rule, "\"ADS." + word + ".EXAMPLE\"", true],
    [rule, "\"" + ip + "\"", true],
  ];
  const patterns = [word, ip.replaceAll(".", "[.]")];
  const compile = "[m.re.compile(x, m.re.I) for x in data[0]]";
  const got = await pyCall("(lambda P: [m.PERSONAL_KIND in m.kinds_for(l, P, p) for p, l in data[1]])(" + compile + ")", [patterns, cases.map(([p, l]) => [p, l])]);
  cases.forEach(([p, l, want], i) => assert(got[i] === want, p + " | " + l + " -> " + got[i]));
  // The exemption does not reach secrets, and it covers removed lines in a diff too.
  const token = j("\"ghp", "_", "B".repeat(36), "\"");
  const secret = await pyCall("(lambda P: m.kinds_for(data[1], P, data[2]))(" + compile + ")", [patterns, host + "," + token, rule]);
  assert(JSON.stringify(secret) === JSON.stringify(["obvious secret"]), JSON.stringify(secret));
  const diff = (path) => ["diff --git a/" + path + " b/" + path, "--- a/" + path, "+++ b/" + path, "@@ -1 +1 @@", "-" + host, "+\"b.example\""].join("\n");
  const scanned = await pyCall("(lambda P: [(lambda f: (m.scan_diff(d, P, f), sorted(f))[1])(set()) for d in data[1]])(" + compile + ")", [patterns, [diff("src/rules/x.json"), diff("docs/x.md")]]);
  assert(JSON.stringify(scanned) === JSON.stringify([[], [["docs/x.md", 1, "forbidden personal string"]]]), JSON.stringify(scanned));
});

Deno.test("privacy check: image metadata (EXIF, XMP, comments, PNG text) is found, a plain image is not", async () => {
  const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
  const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const chunk = (type, body) => [...be32(body.length), ...[...type].map((c) => c.charCodeAt(0)), ...body, 0, 0, 0, 0];
  const png = (...chunks) => [137, 80, 78, 71, 13, 10, 26, 10, ...chunk("IHDR", new Array(13).fill(0)), ...chunks.flat(), ...chunk("IEND", [])];
  const txt = (key, value) => chunk("tEXt", [...[...key].map((c) => c.charCodeAt(0)), 0, ...[...value].map((c) => c.charCodeAt(0))]);
  const jpeg = (segs) => [0xff, 0xd8, ...segs.flat(), 0xff, 0xd9];
  const seg = (marker, body) => [0xff, marker, ((body.length + 2) >> 8) & 255, (body.length + 2) & 255, ...body];
  const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
  const cases = [
    ["a.png", png(), false],
    ["b.png", png(txt("Software", "tool")), false],
    ["c.png", png(txt("Author", "someone")), true],
    ["d.png", png(chunk("eXIf", [1, 2, 3])), true],
    ["e.jpg", jpeg([seg(0xe0, ascii("JFIF\0"))]), false],
    ["f.jpg", jpeg([seg(0xe1, [...ascii("Exif"), 0, 0, 1, 2])]), true],
    ["g.jpeg", jpeg([seg(0xfe, ascii("a comment"))]), true],
    ["h.jpg", jpeg([seg(0xe1, ascii("http://ns.adobe.com/xap/1.0/\0<x/>"))]), true],
    ["i.jpg", jpeg([seg(0xed, ascii("Photoshop 3.0\0iptc"))]), true],
    ["j.gif", [...ascii("GIF89a"), 0, 0, 0, 0, 0, 0, 0, 0x21, 0xfe, 3, ...ascii("hey"), 0, 0x3b], true],
    ["k.gif", [...ascii("GIF89a"), 0, 0, 0, 0, 0, 0, 0, 0x3b], false],
  ];
  const got = await pyCall("[m.image_metadata(__import__('base64').b64decode(d), p) for p, d in data]", cases.map(([p, bytes]) => [p, b64(bytes)]));
  cases.forEach(([p, , want], i) => assert(got[i] === want, p + " -> " + got[i]));
});

Deno.test("privacy check: a missing secret fails a push to main (REQUIRE_PATTERNS) and only warns otherwise", async () => {
  const head = dec.decode((await new Deno.Command("git", { args: ["rev-parse", "HEAD"], cwd: ROOT }).output()).stdout).trim();
  const run = async (require) => {
    const out = await new Deno.Command("python3", {
      args: ["-u", "-B", "scripts/privacy-check.py"], cwd: ROOT, clearEnv: true,
      env: { PATH: Deno.env.get("PATH") ?? "", SYSTEMROOT: Deno.env.get("SYSTEMROOT") ?? "", PRIVACY_PATTERNS: "", REQUIRE_PATTERNS: require, GITHUB_EVENT_NAME: "push", BASE_SHA: head, HEAD_SHA: head, GITHUB_STEP_SUMMARY: "" },
    }).output();
    return { code: out.code, text: dec.decode(out.stdout) };
  };
  const req = await run("true");
  assert(req.code === 1 && /::error::PRIVACY_PATTERNS secret is not set \(required on pushes to main\)/.test(req.text), req.text);
  const opt = await run("false");
  assert(opt.code === 0 && /::warning::PRIVACY_PATTERNS secret is not set/.test(opt.text), opt.text);
});

Deno.test("CI workflow: actions pinned to commit SHAs, no persisted credentials, checker from the base commit on pull requests", () => {
  const uses = [...workflow.matchAll(/^\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
  assert(uses.length >= 3 && uses.every((u) => /@[0-9a-f]{40}$/.test(u)), "unpinned: " + uses.join());
  const checkouts = workflow.split(/\n(?=\s*- name:)/).filter((s) => /uses:\s*actions\/checkout@/.test(s));
  assert(checkouts.length === 2 && checkouts.every((s) => /persist-credentials:\s*false/.test(s)), "persist-credentials");
  assert(/git show "\$PR_BASE_SHA:scripts\/privacy-check\.py" > "\$RUNNER_TEMP\/privacy-check\.py"/.test(workflow), "base checker");
  assert(/run: python3 -u -I "\$RUNNER_TEMP\/privacy-check\.py"/.test(workflow), "runs the copied checker");
  assert(/REQUIRE_PATTERNS: \$\{\{ github\.event_name == 'push' && github\.ref == 'refs\/heads\/main' \}\}/.test(workflow), "required on main");
  // Pull request code never runs with the secret: the tests job gets it on pushes to main only.
  assert(/name: Run tests\s+env:\s+PRIVACY_PATTERNS: \$\{\{ github\.event_name == 'push' && github\.ref == 'refs\/heads\/main' && secrets\.PRIVACY_PATTERNS \|\| '' \}\}/.test(workflow), "tests job: secret on main pushes only");
  assert(workflow.split("secrets.PRIVACY_PATTERNS").length === 3, "secret used only by the checker step and the tests step");
  // No expression interpolation inside run: scripts (values go through env).
  const runBlocks = [...workflow.matchAll(/run: \|?\n?([\s\S]*?)(?=\n\s*- name:|\n\s*$|$)/g)].map((m) => m[1]);
  for (const b of runBlocks) assert(!b.includes("${{"), "expression inside run: " + b.slice(0, 80));
  assert(!/pull_request_target/.test(workflow) && /permissions:\s*\n\s*contents: read/.test(workflow), "permissions");
});

Deno.test({
  name: "no personal machine references in code, tests or docs (L-1)",
  ignore: personalWords.length === 0,
  fn: async () => {
    await noHits("(" + personalWords.join("|") + ")'s (pc|log|reload)", [".", ":!analysis"]);
  },
});

// A secret in the wrong format compiles and matches nothing, so every row is
// checked, and the secret must still find the hostnames in the rule files.
// Returns null, or the real reason the control failed.
async function controlFailure(rows) {
  const wrong = rows.filter((row) => {
    if (row.includes("\t")) return true;
    try { new RegExp(row, "i"); return false; } catch { return true; }
  }).length;
  if (wrong) return `PRIVACY_PATTERNS: ${wrong} of ${rows.length} rows are not in CI format (one expression per line, no tabs or labels)`;
  const live = await new Deno.Command("git", { args: ["grep", "-q", "-I", "-i", "-w", "-E", rows.join("|"), "--", "src/rules/*.json"], cwd: ROOT, stdout: "null", stderr: "null" }).output();
  if (live.code === 0) return null;
  if (live.code === 1) return "PRIVACY_PATTERNS is in CI format, but no hostname in src/rules/*.json matches it now: a list refresh removed every matching hostname. Nothing is wrong with the secret; this control needs a new anchor.";
  return "git grep failed with code " + live.code;
}

// The art record says "the owner". The whole tree is checked too, except the
// third-party hostnames in src/rules/*.json.
// Exit code 1 means git grep ran and found nothing; anything else must not pass.
async function noHits(pattern, paths) {
  const out = await new Deno.Command("git", { args: ["grep", "-n", "-z", "-I", "-i", "-w", "-E", pattern, "--", ...paths], cwd: ROOT, stdout: "piped" }).output();
  const hits = hitList(dec.decode(out.stdout), personalWords);
  assert(out.code === 1, "personal references, path:line only:\n" + (hits || "git grep failed"));
}

// git grep -n -z lines are path NUL line NUL text. Keep path and line only, and hide
// a path segment that matches: neither a hit's text nor its word goes to the log.
function hitList(stdout, rows) {
  const word = new RegExp(rows.join("|"), "i");
  return stdout.split("\n").filter(Boolean).map((line) => {
    const [path, lineNumber] = line.split("\0");
    return path.split("/").map((part) => (word.test(part) ? "<redacted>" : part)).join("/") + ":" + lineNumber;
  }).join("\n");
}

Deno.test({
  name: "the design record and the art sources carry no personal name or place",
  ignore: personalWords.length === 0,
  fn: async () => {
    const failure = await controlFailure(personalWords);
    assert(failure === null, failure);
    await noHits(personalWords.join("|"), ["docs/design/*.md", "docs/design/screenshots/*.md", "icons/source", "src/popup.css", "src/popup.js", "src/popup.html", "test/popup-design.test.js"]);
    await noHits(personalWords.join("|"), [".", ":!src/rules/*.json"]); // the whole tree, minus third-party hostnames
  },
});

Deno.test("privacy check: removing a public IP in a diff is fine, adding one is not", async () => {
  const ip = j("93.184", ".216.34");
  const diff = ["diff --git a/x.md b/x.md", "--- a/x.md", "+++ b/x.md", "@@ -1,2 +1,2 @@", " context", "-old " + ip, "+new 192.0.2.1", "diff --git a/y.md b/y.md", "--- a/y.md", "+++ b/y.md", "@@ -1 +1 @@", "-a", "+b " + ip].join("\n");
  const got = await pyCall("(lambda f: (m.scan_diff(data, [], f), sorted(f))[1])(set())", diff);
  assert(JSON.stringify(got) === JSON.stringify([["y.md", 1, "IP address"]]), JSON.stringify(got));
});

Deno.test("privacy check: a changed file path is scanned, and the log shows only a redacted path", async () => {
  const bad = await inRepo({ patterns: FAKE_ROW, head: { "docs/zqplumbus-notes/plan.md": "fine\n" } });
  assert(bad.code === 1, "a word in a directory name passed: " + bad.out);
  assert(bad.visible.includes("in a file path") && bad.visible.includes("docs/<redacted>/plan.md"), bad.visible);
  assert(!bad.visible.includes("zqplumbus") && !bad.err.includes("zqplumbus"), "the matched word was printed");
  const clean = await inRepo({ patterns: FAKE_ROW, head: { "docs/other-notes/plan.md": "fine\n" } });
  assert(clean.code === 0, clean.out);
  // A hit in the contents of such a file must not print the path either.
  const both = await inRepo({ patterns: FAKE_ROW, head: { "docs/zqplumbus.md": "a zqplumbus line\n" } });
  assert(both.code === 1 && !both.visible.includes("zqplumbus"), both.visible);
});

Deno.test("privacy check: the generic checks cover paths too, and the allow marker does not", async () => {
  const ip = j("93.184", ".216.34");
  const added = await inRepo({ head: { ["docs/" + ip + ".md"]: "fine\n" } });
  assert(added.code === 1 && added.visible.includes("IP address in a file path") && !added.visible.includes(ip), added.visible);
  const removed = await inRepo({ base: { ["docs/" + ip + ".md"]: "fine\n" }, head: { ["docs/" + ip + ".md"]: null } });
  assert(removed.code === 0, "removing an IP-shaped path must pass: " + removed.out);
  const marked = await pyCall("m.path_kinds(data, [])", ip + " privacy-check: allow");
  assert(marked.includes("IP address"), "the marker excused a path");
});

Deno.test("privacy check: a deleted or renamed-away path still counts for personal strings", async () => {
  const deleted = await inRepo({ patterns: FAKE_ROW, base: { "zqplumbus.md": "fine\n" }, head: { "zqplumbus.md": null } });
  assert(deleted.code === 1 && !deleted.visible.includes("zqplumbus"), deleted.visible);
  const renamed = await inRepo({ patterns: FAKE_ROW, base: { "zqplumbus.md": "fine\n" }, rename: ["zqplumbus.md", "other.md"] });
  assert(renamed.code === 1 && !renamed.visible.includes("zqplumbus"), renamed.visible);
});

Deno.test("privacy check: on main every path in the tree is scanned, elsewhere only changed ones", async () => {
  const spec = { patterns: FAKE_ROW, base: { "old/zqplumbus.md": "fine\n" }, head: { "new.md": "fine\n" } };
  assert((await inRepo(spec)).code === 0, "an untouched path failed off main");
  const main = await inRepo({ ...spec, main: true });
  assert(main.code === 1 && main.visible.includes("old/<redacted>") && !main.visible.includes("zqplumbus"), main.visible);
});

Deno.test("privacy check: a word row finds camelCase, underscore and hyphen joins, in lines, paths and commit messages", async () => {
  const joined = ["myZqplumbus", "zqplumbusHouse", "someZqplumbusHouse", "my_zqplumbus", "zqplumbus_file", "ZQPLUMBUS_TOKEN", "my-zqplumbus", "zqplumbus-file", "HTTPZqplumbus", "a__zqplumbus--b"];
  const notJoined = ["zqplumbusy", "azqplumbus", "ZqplumbusyHouse", "my_azqplumbus", "zq_plumbus", "zq plumbus"];
  const rows = "[m.re.compile(data['row'], m.re.I)]";
  const got = await pyCall("[m.kinds_for(l, " + rows + ", 'docs/x.md') for l in data['lines']]", { row: FAKE_ROW, lines: joined.concat(notJoined) });
  joined.forEach((l, i) => assert(got[i].includes("forbidden personal string"), "missed: " + l));
  notJoined.forEach((l, i) => assert(got[joined.length + i].length === 0, "false positive: " + l));
  // The hostname exemption still holds, and only for a quoted hostname.
  const host = await pyCall("[m.kinds_for(data['host'], " + rows + ", 'src/rules/x.json'), m.kinds_for(data['camel'], " + rows + ", 'src/rules/x.json')]",
    { row: FAKE_ROW, host: '"zqplumbus-ads.example.com"', camel: '{"class": "myZqplumbus"}' });
  assert(host[0].length === 0 && host[1].length === 1, JSON.stringify(host));
  assert((await inRepo({ patterns: FAKE_ROW, head: { "docs/myZqplumbusNotes.md": "fine\n" } })).code === 1, "camelCase path passed");
  assert((await inRepo({ patterns: FAKE_ROW, head: { "docs/my_zqplumbus_notes.md": "fine\n" } })).code === 1, "underscore path passed");
  const message = await inRepo({ patterns: FAKE_ROW, message: "Tidy myZqplumbus setup", head: { "a.md": "fine\n" } });
  assert(message.code === 1 && !message.visible.includes("yZqplumbus"), "commit message: " + message.visible);
});

Deno.test("privacy check: no separator but newline can end a diff line", async () => {
  const ip = j("93.184", ".216.34");
  const head = ["diff --git a/x.md b/x.md", "--- a/x.md", "+++ b/x.md", "@@ -1 +1,2 @@", " context"];
  for (const sep of ["\u2028", "\u2029", "\x0b", "\x0c", "\x1c", "\x1d", "\x1e", "\x85", "\r"]) {
    const label = "U+" + sep.codePointAt(0).toString(16);
    // Split wrongly, the tail reads as a removed line, which the IP check skips.
    const asRemoved = await pyCall("(lambda f: (m.scan_diff(data, [], f), sorted(f))[1])(set())", head.concat(["+new" + sep + "-old " + ip]).join("\n"));
    assert(JSON.stringify(asRemoved) === JSON.stringify([["x.md", 2, "IP address"]]), label + " hid a line: " + JSON.stringify(asRemoved));
    // Split wrongly, a forged header would end the hunk and hide the next line.
    const asHeader = await pyCall("(lambda f: (m.scan_diff(data, [], f), sorted(f))[1])(set())", head.concat(["+ok" + sep + "diff --git a/z b/z", "+next " + ip]).join("\n"));
    assert(JSON.stringify(asHeader) === JSON.stringify([["x.md", 3, "IP address"]]), label + " forged a header: " + JSON.stringify(asHeader));
  }
});

Deno.test("privacy check: a bare CR from git cannot end a hunk and hide a removed line", async () => {
  const base = { "a.md": "old\rdiff --git a/q b/q\na zqplumbus line\n" };
  const r = await inRepo({ patterns: FAKE_ROW, base, head: { "a.md": "fresh\n" } });
  assert(r.code === 1, "a removed line was hidden: " + r.visible);
});

Deno.test("privacy check: a record separator in a commit message cannot hide the rest of it", async () => {
  const r = await inRepo({ patterns: FAKE_ROW, message: "Tidy up\x1ea zqplumbus line", head: { "a.md": "fine\n" } });
  assert(r.code === 1, "a message tail was hidden: " + r.visible);
  const clean = await inRepo({ patterns: FAKE_ROW, message: "Tidy up\x1ea fine line\n\nMore detail", head: { "a.md": "fine\n" } });
  assert(clean.code === 0, clean.visible);
});

Deno.test("the secret's positive control names the real cause", async () => {
  const format = await controlFailure(["ZQ_LABEL\tword\tzqplumbus"]);
  assert(format.includes("1 of 1 rows are not in CI format") && !format.includes("list refresh"), format);
  // One good row no longer carries a bad one.
  const mixed = await controlFailure(["doubleclick", "ZQ_LABEL\tword\tzqplumbus"]);
  assert(mixed.includes("1 of 2 rows are not in CI format"), String(mixed));
  const broken = await controlFailure(["[zqplumbus"]);
  assert(broken.includes("not in CI format"), broken);
  const refreshed = await controlFailure(["zqplumbus"]);
  assert(refreshed.includes("a list refresh removed every matching hostname") && !refreshed.includes("not in CI format"), refreshed);
  assert(await controlFailure(["doubleclick"]) === null, "a hostname that is in the rule files must pass");
});

Deno.test("privacy check: a file with a NUL byte and an image are scanned by printable runs, and the log shows no text", async () => {
  const hit = await inRepo({ patterns: FAKE_ROW, head: { "tool.bin": "\0\0a zqplumbus run\0\0" } });
  assert(hit.code === 1 && hit.visible.includes("file=tool.bin,line=1::forbidden personal string") && !hit.visible.includes("zqplumbus"), hit.visible);
  const image = await inRepo({ patterns: FAKE_ROW, head: { "art.png": "not pixels, a zqplumbus run" } });
  assert(image.code === 1 && image.visible.includes("file=art.png"), image.visible);
  const generic = await inRepo({ head: { "tool.bin": j("\0", "someone", "@", "gmail", ".com", "\0") } });
  assert(generic.code === 1 && generic.visible.includes("e-mail address"), generic.visible);
  const clean = await inRepo({ patterns: FAKE_ROW, head: { "tool.bin": "\0\0an ordinary run\0\0" } });
  assert(clean.code === 0, clean.visible);
});

Deno.test("privacy check: a printable run needs 6 characters, and the join split stays off in binary", async () => {
  const six = await inRepo({ patterns: String.raw`zqplum`, head: { "tool.bin": "\0zqplum\0" } });
  assert(six.code === 1, "a run of 6 was skipped");
  const five = await inRepo({ patterns: String.raw`zqplu`, head: { "tool.bin": "\0zqplu\0" } });
  assert(five.code === 0, "a run of 5 was scanned");
  const joined = await inRepo({ patterns: FAKE_ROW, head: { "tool.bin": "\0myZqplumbusHouse\0" } });
  assert(joined.code === 0, joined.visible);
});

Deno.test("privacy check: a listed blob is skipped only byte for byte, and only for its strings", async () => {
  const mail = j("\0", "someone", "@", "gmail", ".com", "\0");
  // data: [the listed bytes, what is added to them before the scan].
  const scan = "(lambda b, f: (setattr(m, 'BINARY_NOISE_BLOBS', frozenset([m.blob_sha(b)])), m.scan_binary('x.png', b + data[1].encode(), [], f), sorted(f))[2])(data[0].encode(), set())";
  assert((await pyCall(scan, [mail, ""])).length === 0, "a listed blob was reported");
  const changed = await pyCall(scan, [mail, "\0"]);
  assert(changed.length === 1 && changed[0][2] === "e-mail address", "a changed blob was not scanned: " + JSON.stringify(changed));
  // scan_file checks metadata before the list, so a listing cannot excuse it.
  const png = "89504e470d0a1a0a" + "00000005" + "74455874" + "4175746f00" + "00000000";
  const meta = await pyCall("(lambda b, f: (setattr(m, 'BINARY_NOISE_BLOBS', frozenset([m.blob_sha(b)])), setattr(m, 'open', lambda *a: __import__('io').BytesIO(b)), m.scan_file('x.png', [], f), sorted(f))[3])(bytes.fromhex(data), set())", png);
  assert(JSON.stringify(meta) === JSON.stringify([["x.png", 1, "image metadata"]]), JSON.stringify(meta));
  const id = await pyCall("[m.blob_sha(data.encode()), sorted(len(x) for x in m.BINARY_NOISE_BLOBS)[0], sorted(len(x) for x in m.BINARY_NOISE_BLOBS)[-1]]", "hello\n");
  assert(id[0] === "ce013625030ba8dba906f756967f9e9ca394464a" && id[1] === 40 && id[2] === 40, JSON.stringify(id));
});

Deno.test("privacy check: the gated tests' failure output is path:line, with no matched text or word", () => {
  const stdout = "docs/a.md\x003\x00a zqplumbus line\ndocs/zqplumbus/b.md\x0012\x00more zqplumbus: text\nc:d.md\x007\x00x\n";
  const got = hitList(stdout, [FAKE_ROW]);
  assert(got === "docs/a.md:3\ndocs/<redacted>/b.md:12\nc:d.md:7", got);
});

Deno.test("privacy check: the tests job masks the bare word of a word row, in CI only", async () => {
  assert(JSON.stringify(bareWordMasks([FAKE_ROW, String.raw`\bzq[.]dot\b`, "zq-plain"])) === JSON.stringify(["::add-mask::zqplumbus", "::add-mask::zq.dot"]), "bare masks");
  const source = await Deno.readTextFile(new URL("privacy-generic.test.js", import.meta.url));
  assert(/if \(Deno\.env\.get\("GITHUB_ACTIONS"\) === "true"\) bareWordMasks\(personalWords\)/.test(source), "a local run must not print the words");
});
