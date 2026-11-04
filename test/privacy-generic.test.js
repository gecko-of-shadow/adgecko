// Block 1f (security review M-6, M-7, L-1, L-13): generic privacy checks that
// need no secret, the required secret on pushes to main, and the CI workflow
// hardening. Every fake value is assembled at run time so this file itself
// never holds a real-looking address, path or token.
import workflow from "../.github/workflows/checks.yml" with { type: "text" };
function assert(c, l) { if (!c) throw new Error(l); }
const ROOT = new URL("..", import.meta.url);
const dec = new TextDecoder();
const j = (...parts) => parts.join("");

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
  // No expression interpolation inside run: scripts (values go through env).
  const runBlocks = [...workflow.matchAll(/run: \|?\n?([\s\S]*?)(?=\n\s*- name:|\n\s*$|$)/g)].map((m) => m[1]);
  for (const b of runBlocks) assert(!b.includes("${{"), "expression inside run: " + b.slice(0, 80));
  assert(!/pull_request_target/.test(workflow) && /permissions:\s*\n\s*contents: read/.test(workflow), "permissions");
});

Deno.test("no personal machine references in code, tests or docs (L-1)", async () => {
  const out = await new Deno.Command("git", { args: ["grep", "-n", "-i", "-E", j("owner", "'s (pc|log|reload)"), "--", ".", ":!analysis"], cwd: ROOT, stdout: "piped" }).output();
  const hits = dec.decode(out.stdout).trim();
  assert(hits === "", "personal references:\n" + hits);
});

// The art record says "the owner". LICENSE and the README's licence and brand
// lines are the owner's own, deliberate, and outside this list.
// Exit code 1 means git grep ran and found nothing; anything else must not pass.
async function noHits(pattern, paths) {
  const out = await new Deno.Command("git", { args: ["grep", "-n", "-I", "-i", "-w", "-E", pattern, "--", ...paths], cwd: ROOT, stdout: "piped" }).output();
  assert(out.code === 1, "personal references:\n" + (dec.decode(out.stdout).trim() || "git grep failed"));
}

Deno.test("the design record and the art sources carry no personal name or place", async () => {
  await noHits(j("personal", "-word"), ["docs/design/*.md", "docs/design/screenshots/*.md", "icons/source", "src/popup.css", "src/popup.js", "src/popup.html", "test/popup-design.test.js"]);
  await noHits(j("personal", "-word"), ["."]); // the whole tree, this file included
});

Deno.test("privacy check: removing a public IP in a diff is fine, adding one is not", async () => {
  const ip = j("93.184", ".216.34");
  const diff = ["diff --git a/x.md b/x.md", "--- a/x.md", "+++ b/x.md", "@@ -1,2 +1,2 @@", " context", "-old " + ip, "+new 192.0.2.1", "diff --git a/y.md b/y.md", "--- a/y.md", "+++ b/y.md", "@@ -1 +1 @@", "-a", "+b " + ip].join("\n");
  const got = await pyCall("(lambda f: (m.scan_diff(data, [], f), sorted(f))[1])(set())", diff);
  assert(JSON.stringify(got) === JSON.stringify([["y.md", 1, "IP address"]]), JSON.stringify(got));
});
