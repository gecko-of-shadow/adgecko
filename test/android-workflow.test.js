// Checks of .github/workflows/android.yml (docs/android/PLAN.md sections 6.8
// and A10; owner approval OD-4). Text checks, no YAML library (the suite has
// no network permission).
function assert(condition, label) {
  if (!condition) throw new Error(label);
}

const text = await Deno.readTextFile(new URL("../.github/workflows/android.yml", import.meta.url));
const code = text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

// The lines of the block under a key: the following lines with more indent
// than the key line (review of 2026-11-17: a check of the first line only
// let extra keys through).
export function blockAfter(src, keyLineRe) {
  const lines = src.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = keyLineRe.exec(lines[i]);
    if (!m) continue;
    const indent = lines[i].match(/^\s*/)[0].length;
    const body = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === "") continue;
      if (lines[j].match(/^\s*/)[0].length <= indent) break;
      body.push(lines[j].trim());
    }
    out.push({ line: lines[i].trim(), body });
  }
  return out;
}

// Script text of each run: step, also block scalars (run: | and run: >).
export function runScripts(src) {
  return blockAfter(src, /^\s*(?:-\s*)?run:/).map((b) => {
    const head = b.line.replace(/^(?:-\s*)?run:\s*/, "");
    return /^[|>][-+]?$/.test(head) ? b.body.join("\n") : head;
  });
}

const ALLOWED = new Map([
  ["actions/checkout", "3d3c42e5aac5ba805825da76410c181273ba90b1"],
  ["actions/setup-java", "d1374f8ac74474200d16ef8ecee22c7ae7a51880"],
  ["denoland/setup-deno", "22d081ff2d3a40755e97629de92e3bcbfa7cf2ed"],
  ["actions/upload-artifact", "cf430e030ddbb5b0abf93d22962f4752f3646cd9"],
]);

Deno.test("android workflow: each uses: is one of the 4 actions, pinned to its 40-character SHA", () => {
  const uses = [...code.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)].map((m) => m[1]);
  assert(uses.length >= 8, `only ${uses.length} uses: lines`);
  for (const u of uses) {
    const [name, ref] = u.split("@");
    assert(ALLOWED.has(name), `action not in the plan: ${name}`);
    assert(/^[0-9a-f]{40}$/.test(ref || ""), `${name} is not pinned to a full SHA: ${ref}`);
    assert(ALLOWED.get(name) === ref, `${name} has SHA ${ref}, expected ${ALLOWED.get(name)}`);
  }
});

Deno.test("android workflow: runner, permissions, credentials, secrets and triggers", () => {
  const runsOn = [...code.matchAll(/^\s*runs-on:\s*(\S+)/gm)].map((m) => m[1]);
  assert(runsOn.length === 2 && runsOn.every((r) => r === "ubuntu-24.04"), `runs-on: ${runsOn.join(", ")}`);
  const top = blockAfter(code, /^permissions:\s*$/);
  assert(top.length === 1, `expected one top-level permissions block, found ${top.length}`);
  assert(JSON.stringify(top[0].body) === JSON.stringify(["contents: read"]), `top-level permissions must be exactly contents: read, found ${JSON.stringify(top[0].body)}`);
  assert(!/^permissions:[ \t]*\S/m.test(code), "no one-line top-level permissions value (for example write-all)");
  assert(!/^[ \t]+permissions:/m.test(code), "no job may set its own permissions");
  const checkouts = (code.match(/uses:\s*actions\/checkout@/g) || []).length;
  const noCreds = (code.match(/persist-credentials:\s*false/g) || []).length;
  assert(checkouts === 2 && noCreds === checkouts, `checkouts ${checkouts}, persist-credentials false ${noCreds}`);
  assert(!code.includes("secrets."), "the workflow must not use a secret");
  assert(!code.includes("pull_request_target"), "no pull_request_target");
  assert(/^\s+pull_request:/m.test(code) && /^\s+workflow_dispatch:/m.test(code), "triggers pull_request and workflow_dispatch");
  assert(!/^\s+schedule:/m.test(code), "no schedule in M1");
  assert(!/actions\/cache/.test(code), "no Gradle cache in M1");
});

Deno.test("android workflow: the block parsers see extra keys and block scalars", () => {
  const extra = "permissions:\n  contents: read\n  actions: write\njobs:\n";
  assert(JSON.stringify(blockAfter(extra, /^permissions:\s*$/)[0].body) === JSON.stringify(["contents: read", "actions: write"]), "extra permission key not seen");
  const block = "steps:\n  - name: x\n    run: |\n      echo ok\n      echo ${{ github.head_ref }}\n  - run: echo y\n";
  const s = runScripts(block);
  assert(s.length === 2 && s[0].includes("${{") && s[1] === "echo y", `block scalar not read: ${JSON.stringify(s)}`);
});

Deno.test("android workflow: the wrapper jar check, the build tasks and the APK artifact", () => {
  assert(code.includes('echo "621008afc4f5d59357fcf06ffa644dd5aade5e091bdc363742710445f73cdaf8  android/gradle/wrapper/gradle-wrapper.jar" | sha256sum -c -'), "no sha256sum -c step for the wrapper jar");
  for (const t of [":shield-core:test", ":app:testDebugUnitTest", ":app:lintDebug", ":app:verifyManifestPolicyDebug", ":app:assembleDebug", ":app:assembleDebugAndroidTest", ":probe:assembleDebug", ":probe:assembleDebugAndroidTest"]) {
    assert(code.includes(t + " ") || code.includes(t + "\n"), `build step has no ${t}`);
  }
  assert(/name:\s*adgecko-shield-debug\b/.test(code), "no adgecko-shield-debug artifact");
  assert(code.includes("android/app/build/outputs/apk/debug/app-debug.apk"), "artifact path");
  assert(/api:\s*\[33,\s*36\]/.test(code) && /fail-fast:\s*false/.test(code), "emulator matrix API 33 and 36 with fail-fast false");
  assert(code.includes("bash android/ci/emulator-run.sh"), "emulator script");
  // Values from contexts go into env: first; run: lines use no ${{ }}.
  const scripts = runScripts(code);
  assert(scripts.length >= 6, `found only ${scripts.length} run: steps`);
  for (const s of scripts) assert(!s.includes("${{"), `run: script uses a context directly: ${s}`);
});
