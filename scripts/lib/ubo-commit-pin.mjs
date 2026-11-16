// Which gorhill/uBlock commit scripts/sync-ubo-youtube.mjs may run.
//
// The sync imports uBO's own parser and DNR converter from a clone, so it runs
// upstream code. A tag can be moved, so the clone's HEAD must be the commit
// recorded in src/vendor/ubo-youtube-meta.json (ublock_commit, for the same
// ublock_tag), or the commit given with --ubo-commit after a review of that
// commit. Review 2026-11-16 (WP-22 item 8). Pure helpers: no I/O here.

const SHA_RE = /^[0-9a-f]{40}$/;

export function expectedUboCommit({ tag, commitArg, meta }) {
  if (commitArg != null) {
    if (!SHA_RE.test(commitArg)) throw new Error("--ubo-commit must be a 40-hex commit, got " + JSON.stringify(commitArg));
    return commitArg;
  }
  if (meta && meta.ublock_tag === tag && SHA_RE.test(meta.ublock_commit || "")) return meta.ublock_commit;
  throw new Error("no pinned commit for uBO tag " + tag + " (src/vendor/ubo-youtube-meta.json has " +
    (meta && meta.ublock_tag) + "): review the new tag, then pass --ubo-commit <40-hex commit>");
}

// revParse: async () => the clone's HEAD (git rev-parse HEAD). Returns HEAD,
// or throws before any upstream code is imported.
export async function verifyUboClone({ tag, expected, revParse }) {
  const head = String(await revParse()).trim();
  if (head !== expected) {
    throw new Error("gorhill/uBlock " + tag + " is at " + head + ", not the pinned commit " + expected + "; its code was not run");
  }
  return head;
}
