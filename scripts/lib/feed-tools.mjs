// Shared helpers for scripts/feed-keygen.mjs and scripts/feed-sign.mjs.
// Ed25519 via WebCrypto. Private keys are only ever returned to the caller
// (which writes them to a path OUTSIDE the repo); nothing here prints them.
const B64 = {
  enc: (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))),
  dec: (s) => Uint8Array.from(atob(String(s).trim()), (c) => c.charCodeAt(0)),
};
export const KEY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

// -> { keyId, kind, publicKey (base64 raw 32 bytes), privateRecord (object to save) }
export async function generateKeyPair(keyId, kind = "feed") {
  if (!KEY_ID_RE.test(keyId || "")) throw new Error("key id must match " + KEY_ID_RE);
  if (kind !== "feed" && kind !== "kill") throw new Error("kind must be feed or kill");
  const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKey = B64.enc(await crypto.subtle.exportKey("raw", kp.publicKey));
  const pkcs8 = B64.enc(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  return { keyId, kind, publicKey, privateRecord: { format: "gecko-feed-private-key-1", keyId, kind, publicKey, pkcs8 } };
}

export async function importPrivate(record) {
  if (!record || record.format !== "gecko-feed-private-key-1" || !KEY_ID_RE.test(record.keyId || "") || !record.pkcs8) {
    throw new Error("not a gecko feed private key file");
  }
  return crypto.subtle.importKey("pkcs8", B64.dec(record.pkcs8), { name: "Ed25519" }, false, ["sign"]);
}

// Signs the EXACT bytes. -> contents of feed.json.sig
export async function signBytes(bytes, record) {
  const key = await importPrivate(record);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, key, bytes));
  return "keyId=" + record.keyId + "\n" + B64.enc(sig) + "\n";
}

// True when `child` is `parent` or inside it (case-insensitive on Windows).
export function isInside(child, parent) {
  const norm = (p) => {
    let s = String(p).replace(/\\/g, "/").replace(/\/+$/, "");
    if (/^[A-Za-z]:/.test(s) || Deno.build.os === "windows") s = s.toLowerCase();
    return s;
  };
  const c = norm(child);
  const p = norm(parent);
  return c === p || c.startsWith(p + "/");
}

export function repoRoot() {
  return decodeURIComponent(new URL("../..", import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1").replace(/\/$/, "");
}

export function absolutePath(p) {
  const s = String(p).replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(s) || s.startsWith("/")) return s;
  return Deno.cwd().replace(/\\/g, "/").replace(/\/$/, "") + "/" + s;
}
