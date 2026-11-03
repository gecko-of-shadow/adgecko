# Setting up the signed threat feed

[← Back to the README](../README.md) · [Threat tier](threat-tier.md)

The extension ships with the feed **dormant**: `FEED_ORIGIN` is empty and no
key is pinned. While dormant it never contacts a feed host; the packed
`threat` ruleset is the threat tier. The feed only ever carries data (block
rules for known-bad hosts); it can never run code.

Open decisions (not made by this build): the feed host name (D-1) and who
signs, by hand or automatically (D-7). The scripts below work for either.

## What the extension does once it is configured

- Every 3 hours (the `gecko-refresh` alarm) it fetches `feed.json.sig`, then
  `feed.json`, from the feed host only: HTTPS, no redirects, 15 s timeout,
  512 KB cap, no cookies, no cache.
- It checks the Ed25519 signature over the exact bytes **before** parsing,
  then a strict schema (see `src/feed/schema.js`). A protected stream host,
  an unknown key, a lower serial, an expired or not-yet-valid file rejects the
  whole file; the previous rules stay.
- It replaces the feed's session rules in one step (priority 2,000,010) and
  keeps the last two verified files for rollback.
- On browser start and after an update it re-applies the saved file (if not
  expired), otherwise the packed snapshot `src/rules/threat-snapshot.json`.
- The popup shows serial, rule count, time of the last check, the last
  problem, and paused/killed.

## Steps for the owner (PowerShell, one command at a time)

1. **Make the feed key pair.** Pick a key id (for example `feed-2026-11`) and
   a folder **outside** the repo (for example a USB stick or
   `$env:USERPROFILE\gecko-keys`). The script refuses paths inside the repo and
   never overwrites a file.

   ```
   deno run --allow-read --allow-write scripts\feed-keygen.mjs --key-id feed-2026-11 --out <folder outside the repo>\feed-2026-11.key.json
   ```

   It prints one line like `"feed-2026-11": "<base64 public key>"`. The private
   key goes only into the file. Back that file up offline.

2. **Optional: make the kill key pair** (a separate key that can sign only
   the kill document `{"format":1,"kill":true,"serial":1,"createdAt":"..."}`):

   ```
   deno run --allow-read --allow-write scripts\feed-keygen.mjs --kind kill --key-id kill-2026-11 --out <folder outside the repo>\kill-2026-11.key.json
   ```

3. **Pin the public keys:** paste the printed lines into `src/feed/keys.js`,
   into `FEED_KEYS` (and `KILL_KEYS` for the kill key).

4. **Choose the feed host**, one host you control that serves static files
   over HTTPS, for example `https://feed.<your domain>`.

5. **Set the origin:** in `src/feed/config.js` set
   `FEED_ORIGIN = "https://feed.<your domain>"` (no path, no trailing slash).

6. **Add the host permission:** in `manifest.json` add
   `"https://feed.<your domain>/*"` to `host_permissions`. The release gate
   allows exactly this one extra host once `FEED_ORIGIN` is set.

7. **List-download allow (3,000,000):** nothing to edit. Once the feed is
   configured, the worker adds the feed host to the list-download allow rule
   so no block rule can stop the extension's own feed download.

8. **Write and sign a feed**, for example `feed.json`:

   ```json
   {"format":1,"serial":1,"createdAt":"2026-11-10T12:00:00Z","notBefore":"2026-11-10T12:00:00Z","notAfter":"2026-11-24T12:00:00Z","dnr":[{"id":1,"requestDomains":["malware-drop.example"]}]}
   ```

   `notAfter` may be at most 14 days after `createdAt`; publish a new file
   (higher `serial`) before then. Then sign it:

   ```
   deno run --allow-read --allow-write scripts\feed-sign.mjs --key <folder outside the repo>\feed-2026-11.key.json --feed feed.json
   ```

   This writes `feed.json.sig`. The script refuses to sign a file the
   extension would reject.

9. **Upload** `feed.json` and `feed.json.sig` to the root of the feed host.

10. Run the tests (`deno test --no-lock --allow-read --allow-run --allow-env test/`)
    and your own release steps. Load the extension and check that the popup
    says "Threat feed: serial 1, ...".

## Emergency switches

- **Kill (for everyone):** sign a kill document with the kill key and upload
  it as `feed.json` + `feed.json.sig`, or publish a normal feed with
  `"killFeed": true`. Every client drops the feed rules; public lists and the
  packed threat tier keep running. A later feed with a higher serial turns it
  back on.
- **Rollback:** publish a feed with a higher `serial`, an empty `dnr` and
  `"rollbackTo": <earlier serial>`. Clients re-apply that earlier file if they
  still have it (they keep the last two); otherwise they keep their current
  rules.
- **Pause (one browser):** the "Pause threat feed" switch on the settings page
  drops the feed rules without deleting the saved file.

## Never

- Never put a private key in the repo, the extension, the feed host or a
  chat. Only public keys go in `src/feed/keys.js`.
- Never add code to the feed. The client accepts only block rules.
