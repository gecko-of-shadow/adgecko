#!/usr/bin/env -S deno run --allow-read --allow-write
// Generate an Ed25519 key pair for the signed threat feed.
//
//   deno run --allow-read --allow-write scripts/feed-keygen.mjs --key-id <id> --out <private key file> [--kind feed|kill]
//
// The PRIVATE key is written ONLY to --out, which must be outside this repo and
// must not exist yet. It is never printed. The PUBLIC key is printed, ready to
// paste into src/feed/keys.js (FEED_KEYS for --kind feed, KILL_KEYS for kill).
// Steps: docs/feed-setup.md. Keep the private key file offline and backed up.
import { generateKeyPair, absolutePath, keyTargetProblem } from "./lib/feed-tools.mjs";

const arg = (k, d) => { const i = Deno.args.indexOf(k); return i >= 0 ? Deno.args[i + 1] : d; };
const keyId = arg("--key-id");
const out = arg("--out");
const kind = arg("--kind", "feed");
if (!keyId || !out) {
  console.error("usage: feed-keygen.mjs --key-id <id> --out <private key file outside the repo> [--kind feed|kill]");
  Deno.exit(2);
}
const target = absolutePath(out);
// Real path check: "..", symlinks and junctions cannot sneak the key into the repo.
const problem = await keyTargetProblem(target);
if (problem) {
  console.error("refusing: " + problem);
  Deno.exit(2);
}
let exists = false;
try {
  await Deno.lstat(target);
  exists = true;
} catch {
  exists = false;
}
if (exists) {
  console.error("refusing: " + target + " already exists (never overwrite a key)");
  Deno.exit(2);
}
const pair = await generateKeyPair(keyId, kind);
await Deno.writeTextFile(target, JSON.stringify(pair.privateRecord) + "\n", { createNew: true, mode: 0o600 });
console.log("Private key written to the file you gave (not shown).");
console.log("Add this to src/feed/keys.js " + (kind === "kill" ? "KILL_KEYS" : "FEED_KEYS") + ":");
console.log(JSON.stringify(keyId) + ": " + JSON.stringify(pair.publicKey));
