#!/usr/bin/env -S deno run --allow-read --allow-write
// Sign a threat feed file (or a kill document) for upload.
//
//   deno run --allow-read --allow-write scripts/feed-sign.mjs --key <private key file> --feed <feed.json> [--out <feed.json.sig>]
//
// Signs the EXACT bytes of --feed and writes the two-line signature file
// ("keyId=<id>" + base64 Ed25519 signature) to --out (default: <feed>.sig).
// Before signing it checks the file the way the extension will (512 KB, no BOM,
// UTF-8, strict format-1 schema with the protected-host check), so a file the
// extension would reject is not signed. Who runs this, and where, is up to the
// owner (open decision D-7); the key file never needs to be on the feed host.
import { signBytes } from "./lib/feed-tools.mjs";

const arg = (k, d) => { const i = Deno.args.indexOf(k); return i >= 0 ? Deno.args[i + 1] : d; };
const keyPath = arg("--key");
const feedPath = arg("--feed");
const outPath = arg("--out", feedPath ? feedPath + ".sig" : null);
if (!keyPath || !feedPath) {
  console.error("usage: feed-sign.mjs --key <private key file> --feed <feed.json> [--out <feed.json.sig>]");
  Deno.exit(2);
}
const ROOT = new URL("..", import.meta.url);
// psl.js first: protected-hosts.js refuses every host without it (follow-up review).
// never-block-captcha.js (generated captcha list) too: protected-hosts.js throws without it.
for (const f of ["src/threat/psl.js", "src/general/never-block-captcha.js", "src/threat/protected-hosts.js", "src/feed/canonical.js", "src/feed/schema.js"]) await import(new URL(f, ROOT).href);
const C = globalThis.GeckoFeedCanonical;
const S = globalThis.GeckoFeedSchema;

const record = JSON.parse(await Deno.readTextFile(keyPath));
const bytes = C.checkFeedBytes(await Deno.readFile(feedPath));
const doc = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
if (record.kind === "kill") {
  S.validateKill(doc, { storedKillSerial: 0 });
} else {
  if (doc && typeof doc === "object" && "kill" in doc) throw new Error("a kill document must be signed with the kill key");
  S.validateFeed(doc, { storedSerial: 0, now: Date.parse(doc.notBefore) });
}
await Deno.writeTextFile(outPath, await signBytes(bytes, record));
console.log("Signed " + feedPath + " (serial " + doc.serial + ") with key id " + record.keyId + "; wrote " + outPath);
