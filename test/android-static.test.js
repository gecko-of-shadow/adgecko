// Adgecko Shield static checks (docs/android/PLAN.md section 6.7, A10 and
// A12). It reads only tracked files (git ls-files android/). The deny list
// for the app and probe sources is here; android/buildSrc/ holds the deny
// list of the manifest policy task, so this test does not scan it.
import { loadModules } from "../scripts/export-android-data.mjs";

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

const ROOT = new URL("..", import.meta.url);
const dec = new TextDecoder();

async function git(...args) {
  const out = await new Deno.Command("git", { args, cwd: ROOT, stdout: "piped", stderr: "piped" }).output();
  assert(out.code === 0, `git ${args.join(" ")} failed: ${dec.decode(out.stderr)}`);
  return dec.decode(out.stdout);
}

const tracked = (await git("ls-files", "-s", "android/")).split("\n").filter(Boolean).map((l) => {
  const [meta, path] = l.split("\t");
  return { mode: meta.split(" ")[0], path };
});
const BINARY = /\.(jar|png|webp|jks|keystore)$/;
const textOf = async (p) => dec.decode(await Deno.readFile(new URL(p, ROOT)));

Deno.test("android static: tracked files exist and no build output is tracked", () => {
  assert(tracked.length > 20, `only ${tracked.length} tracked files below android/`);
  for (const { path } of tracked) {
    assert(!/(^|\/)(build|\.gradle|\.kotlin|\.idea)\//.test(path), `build output is tracked: ${path}`);
    assert(!/(^|\/)(local|keystore)\.properties$/.test(path), `local file is tracked: ${path}`);
    assert(!/\.(apk|aab|jks|keystore|p12|pem)$/.test(path), `signing or package file is tracked: ${path}`);
  }
});

Deno.test("android static: no web view, no user CA, no cleartext and no dangerous component in app and probe sources", async () => {
  const deny = [
    "addJavascriptInterface", "WebView", "setAllowUniversalAccessFromFileURLs", 'certificates src="user"',
    'usesCleartextTraffic="true"', "QUERY_ALL_PACKAGES", "BIND_ACCESSIBILITY_SERVICE", "BIND_NOTIFICATION_LISTENER_SERVICE",
  ];
  let n = 0;
  for (const { path } of tracked) {
    if (!/^android\/(app|probe)\/src\//.test(path) || BINARY.test(path)) continue;
    const text = await textOf(path);
    for (const d of deny) assert(!text.includes(d), `${path} contains ${d}`);
    n++;
  }
  assert(n > 10, `scanned only ${n} files`);
});

// Documentation ranges only (RFC 5737); loopback only in JVM test sources.
function badIpv4(path, text) {
  const out = [];
  for (const m of text.matchAll(/(?<![\w.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\w.]*\d)/g)) {
    const p = m.slice(1, 5).map(Number);
    if (p.some((x) => x > 255)) continue;
    const doc = (p[0] === 192 && p[1] === 0 && p[2] === 2) || (p[0] === 198 && p[1] === 51 && p[2] === 100) || (p[0] === 203 && p[1] === 0 && p[2] === 113);
    const loop = p[0] === 127 && /\/src\/test\//.test(path);
    if (!doc && !loop) out.push(m[0]);
  }
  return out;
}

Deno.test("android static: no public IP literal below android/", async () => {
  for (const { path } of tracked) {
    if (BINARY.test(path)) continue;
    const bad = badIpv4(path, await textOf(path));
    assert(bad.length === 0, `${path} has IP literals outside the documentation ranges: ${bad.join(", ")}`);
  }
  // A public address, built at run time so that the privacy check does not see a literal.
  const pub = [8, 8, 4, 4].join(".");
  assert(badIpv4("android/app/src/main/x.kt", `a ${pub} b`).length === 1, "the IP check finds a public address");
  assert(badIpv4("android/app/src/main/x.kt", "192.0.2.1 198.51.100.7 203.0.113.9").length === 0, "documentation ranges pass");
});

Deno.test("android static: no list host in Kotlin and no rule data file below android/", async () => {
  const { U } = await loadModules(ROOT);
  assert(U.LIST_HOSTS.length === 8, `LIST_HOSTS has ${U.LIST_HOSTS.length} entries`);
  for (const { path } of tracked) {
    if (!path.endsWith(".kt") && !path.endsWith(".kts")) continue;
    const text = await textOf(path);
    for (const h of U.LIST_HOSTS) assert(!text.includes(h), `${path} names the list host ${h}`);
  }
  const ruleFiles = [];
  for await (const e of Deno.readDir(new URL("src/rules/", ROOT))) if (e.name.endsWith(".json")) ruleFiles.push(e.name);
  assert(ruleFiles.length >= 5, "rule files not found");
  for (const { path } of tracked) {
    const base = path.split("/").pop();
    assert(!ruleFiles.includes(base), `${path} has the name of a rule data file`);
  }
});

Deno.test("android static: gitignore and gitattributes lines, wrapper modes", async () => {
  const ignore = (await textOf(".gitignore")).split("\n");
  for (const l of ["android/**/build/", "android/**/.gradle/", "android/**/.kotlin/", "android/.idea/", "android/local.properties", "android/keystore.properties", "*.apk", "*.aab", "*.jks", "*.keystore", "*.p12", "*.pem"]) {
    assert(ignore.includes(l), `.gitignore has no line ${l}`);
  }
  const attrs = (await textOf(".gitattributes")).split("\n");
  for (const l of ["*.bat text eol=crlf", "*.jar binary", "*.jks binary", "*.keystore binary", "*.webp binary"]) {
    assert(attrs.includes(l), `.gitattributes has no line ${l}`);
  }
  const mode = (p) => tracked.find((t) => t.path === p)?.mode;
  assert(mode("android/gradlew") === "100755", "android/gradlew must have git mode 100755");
  assert(mode("android/gradle/wrapper/gradle-wrapper.jar") === "100644", "the wrapper jar must be tracked");
  const props = await textOf("android/gradle/wrapper/gradle-wrapper.properties");
  assert(props.includes("gradle-9.9.1-bin.zip"), "wrapper is not Gradle 9.9.1");
  assert(props.includes("distributionSha256Sum=d8a18a7a841dd5df825d35a685fad6f2d7f12ac0c280e57b67c27b4a520ba228"), "wrapper has no distributionSha256Sum");
  const jar = await Deno.readFile(new URL("android/gradle/wrapper/gradle-wrapper.jar", ROOT));
  const hex = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", jar)), (b) => b.toString(16).padStart(2, "0")).join("");
  assert(hex === "621008afc4f5d59357fcf06ffa644dd5aade5e091bdc363742710445f73cdaf8", `wrapper jar SHA-256 ${hex}`);
});

Deno.test("android static: the app manifest keeps the M1 policy in source form", async () => {
  const m = await textOf("android/app/src/main/AndroidManifest.xml");
  const perms = [...m.matchAll(/<uses-permission android:name="([^"]+)"/g)].map((x) => x[1]).sort();
  assert(JSON.stringify(perms) === JSON.stringify([
    "android.permission.ACCESS_NETWORK_STATE", "android.permission.FOREGROUND_SERVICE", "android.permission.FOREGROUND_SERVICE_SYSTEM_EXEMPTED",
    "android.permission.INTERNET", "android.permission.POST_NOTIFICATIONS",
  ]), `permissions ${perms.join(", ")}`);
  assert(m.includes('android:allowBackup="false"') && m.includes('android:usesCleartextTraffic="false"'), "backup or cleartext attribute");
  assert(m.includes('android:permission="android.permission.BIND_VPN_SERVICE"'), "VPN service guard");
  assert(m.includes('android:name="android.net.VpnService.SUPPORTS_ALWAYS_ON"'), "always-on meta-data");
  const service = await textOf("android/app/src/main/kotlin/adgecko/shield/vpn/ShieldVpnService.kt");
  assert(!service.includes(".allowBypass()"), "the shield must not call allowBypass()");
  assert(!/addDisallowedApplication\(packageName\)/.test(service), "M1 does not exclude its own package");
  const nsc = await textOf("android/app/src/main/res/xml/network_security_config.xml");
  assert(nsc.includes('src="system"') && nsc.includes('cleartextTrafficPermitted="false"'), "network security config");
});

// A12: the extension package does not change. scripts/lib/package_files.py
// derives the list from manifest.json; no file below android/ is in it.
Deno.test("android static: the extension package has no file below android/", async () => {
  const out = await new Deno.Command("python3", { args: ["-I", "scripts/lib/package_files.py", "--root", "."], cwd: ROOT, stdout: "piped", stderr: "piped" }).output();
  assert(out.code === 0, `package_files.py failed: ${dec.decode(out.stderr)}`);
  const files = dec.decode(out.stdout).split("\n").map((l) => l.trim()).filter(Boolean);
  assert(files.length >= 50, `package list has ${files.length} files`);
  assert(files.every((f) => !f.startsWith("android/")), "the extension package names a file below android/");
  console.log(`android static: the extension package has ${files.length} files, none below android/`);
});
