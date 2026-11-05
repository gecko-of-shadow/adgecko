// The scanner must register each pattern line before it prints anything else,
// and the visible log (add-mask commands removed, as the runner does) must not
// contain the multiline value.
const line1 = "zqmask" + "Alpha" + "9173";
const line2 = "zqmask" + "Beta" + "4286pct" + "%zz";
const patterns = line1 + "\n\n   \n" + line2 + "\n";

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function decodeCommandData(value) {
  return value.replaceAll("%25", "%").replaceAll("%0D", "\r").replaceAll("%0A", "\n");
}

function splitLog(raw) {
  const lines = raw.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const masks = [];
  const visible = [];
  for (const line of lines) {
    if (line.startsWith("::add-mask::")) {
      masks.push(decodeCommandData(line.slice("::add-mask::".length)));
      continue;
    }
    visible.push(line);
  }
  return { masks, visible: visible.join("\n") };
}

// A URL cwd works on every OS and with spaces in the path. `.pathname` keeps the
// percent-encoding ("D:/My%20Code/...") and a leading "/" on Windows: "No such cwd".
const root = new URL("..", import.meta.url);
const headOut = await new Deno.Command("git", {
  args: ["rev-parse", "HEAD"],
  cwd: root,
}).output();
assert(headOut.code === 0, "git rev-parse failed");
const head = new TextDecoder().decode(headOut.stdout).trim();

async function runScanner(privacyPatterns) {
  const result = await new Deno.Command("python3", {
    args: ["-u", "scripts/privacy-check.py"],
    cwd: root,
    env: {
      PATH: Deno.env.get("PATH") ?? "",
      PRIVACY_PATTERNS: privacyPatterns,
      GITHUB_EVENT_NAME: "push",
      BASE_SHA: head,
      HEAD_SHA: head,
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONUNBUFFERED: "1",
      GITHUB_STEP_SUMMARY: "",
    },
    clearEnv: true,
  }).output();
  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);
  return { code: result.code, stdout, stderr };
}

Deno.test("a set multiline PRIVACY_PATTERNS value never appears in the visible log", async () => {
  const { code, stdout, stderr } = await runScanner(patterns);
  const parsed = splitLog(stdout);
  assert(code === 0, "scanner failed on an empty diff");
  assert(parsed.masks[0] === line1, "first output was not the first pattern mask");
  assert(parsed.masks[1] === line2, "second mask was not the second pattern");
  assert(parsed.masks.length === 2, "blank lines were masked");
  assert(!parsed.visible.includes(line1), "first pattern appeared outside add-mask");
  assert(!parsed.visible.includes(line2), "second pattern appeared outside add-mask");
  assert(!stdout.includes("PRIVACY_PATTERNS:"), "env block was printed");
  assert(!stdout.includes("env:"), "env block was printed");
  assert(!stderr.includes(line1) && !stderr.includes(line2), "pattern appeared on stderr");
  assert(parsed.visible.includes("Privacy check passed."), "scanner did not pass");
});

Deno.test("a word row masks its bare word too, and those masks still come first", async () => {
  const word = "zqmask" + "Word";
  const dotted = "zqmask.dot";
  const plain = "zqmask-plain";
  const rows = [String.raw`\b` + word + String.raw`\b`, String.raw`\b` + dotted.replace(".", "[.]") + String.raw`\b`, plain];
  const { code, stdout } = await runScanner(rows.join("\n") + "\n");
  assert(code === 0, "scanner failed on an empty diff");
  const expected = [rows[0], word, rows[1], dotted, plain];
  const lines = stdout.split(/\r?\n/);
  assert(JSON.stringify(lines.slice(0, 5).map((l) => l.replace("::add-mask::", ""))) === JSON.stringify(expected), "masks are not first, or a bare word was not masked");
  assert(lines.slice(0, 5).every((l) => l.startsWith("::add-mask::")), "masks are not first");
  const parsed = splitLog(stdout);
  assert(parsed.masks.length === 5, "a row was masked twice");
  assert(!parsed.visible.includes(word) && !parsed.visible.includes(dotted), "a word appeared outside add-mask");
});

Deno.test("missing PRIVACY_PATTERNS still warns and does not mask", async () => {
  const { code, stdout, stderr } = await runScanner("");
  assert(code === 0, "missing secret should pass");
  assert(!stdout.includes("::add-mask::"), "empty secret emitted a mask");
  assert(stdout.includes("::warning::PRIVACY_PATTERNS secret is not set"), "missing-secret warning was not emitted");
  assert(stdout.includes("Privacy check passed."), "scanner did not pass");
  assert(stderr === "", "unexpected stderr");
});
