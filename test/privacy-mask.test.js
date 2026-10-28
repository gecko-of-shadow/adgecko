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

const root = new URL("..", import.meta.url).pathname;
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

Deno.test("missing PRIVACY_PATTERNS still warns and does not mask", async () => {
  const { code, stdout, stderr } = await runScanner("");
  assert(code === 0, "missing secret should pass");
  assert(!stdout.includes("::add-mask::"), "empty secret emitted a mask");
  assert(stdout.includes("::warning::PRIVACY_PATTERNS secret is not set"), "missing-secret warning was not emitted");
  assert(stdout.includes("Privacy check passed."), "scanner did not pass");
  assert(stderr === "", "unexpected stderr");
});
