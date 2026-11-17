// Checks of .github/workflows/android.yml (docs/android/PLAN.md sections 6.8
// and A10; owner approval OD-4). Text checks, no YAML library (the suite has
// no network permission).
function assert(condition, label) {
  if (!condition) throw new Error(label);
}

const text = await Deno.readTextFile(new URL("../.github/workflows/android.yml", import.meta.url));
const code = text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

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
  assert(/^permissions:\n\s+contents: read\s*$/m.test(code), "top-level permissions must be contents: read");
  assert(!/^\s+permissions:/m.test(code.replace(/^permissions:.*$/m, "")), "no job may widen the permissions");
  const checkouts = (code.match(/uses:\s*actions\/checkout@/g) || []).length;
  const noCreds = (code.match(/persist-credentials:\s*false/g) || []).length;
  assert(checkouts === 2 && noCreds === checkouts, `checkouts ${checkouts}, persist-credentials false ${noCreds}`);
  assert(!code.includes("secrets."), "the workflow must not use a secret");
  assert(!code.includes("pull_request_target"), "no pull_request_target");
  assert(/^\s+pull_request:/m.test(code) && /^\s+workflow_dispatch:/m.test(code), "triggers pull_request and workflow_dispatch");
  assert(!/^\s+schedule:/m.test(code), "no schedule in M1");
  assert(!/actions\/cache/.test(code), "no Gradle cache in M1");
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
  for (const m of code.matchAll(/^\s*run:\s*(.*)$/gm)) assert(!m[1].includes("${{"), `run: line uses a context directly: ${m[1]}`);
});
