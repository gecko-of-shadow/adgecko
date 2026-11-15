# Updating dependencies

Adgecko has two dependencies that are copied into the repository. This page tells you how to replace each one with a newer upstream copy.

All commands are for PowerShell 5.1 on Windows 11. Run them from the repository root. They need `deno`, `git`, `python3`, `rg` and Git for Windows.

| Dependency | Files | Upstream | Command |
|---|---|---|---|
| TwitchAdSolutions video-swap-new | `src/vendor/video-swap-new.user.js` | `pixeltris/TwitchAdSolutions` (archived, read-only) | `scripts/update-twitch-vendor.mjs` |
| uBlock Origin YouTube filters | `src/vendor/ubo-youtube*.{js,css,json}`, `src/rules/ubo-youtube-network.json` | `uBlockOrigin/uAssets` and `gorhill/uBlock` | `scripts/sync-ubo-youtube.mjs` |

## After each update

Do these steps after each update, before you commit.

Run the tests.

```powershell
deno test --no-lock --allow-read --allow-run --allow-env test/
```

Run the release gate. The gate runs the tests again.

```powershell
& "C:\Program Files\Git\bin\bash.exe" scripts/release-gate.sh
```

The last line must be `VERDICT: CLEAN`. Then load the unpacked extension in Chrome and test the site by hand (Twitch live stream, or a YouTube watch page). No automated test plays a real stream.

## 1. TwitchAdSolutions (Twitch live streams)

### Check for a newer version

This command writes nothing. Exit code 0 means that the copy is current. Exit code 1 means that upstream is different.

```powershell
deno run --allow-net=api.github.com,raw.githubusercontent.com --allow-read=. --allow-write=. scripts/update-twitch-vendor.mjs --check
```

### Replace the file

```powershell
deno run --allow-net=api.github.com,raw.githubusercontent.com --allow-read=. --allow-write=. scripts/update-twitch-vendor.mjs
```

The script does these steps:

1. It finds the newest upstream commit that changed the userscript.
2. It downloads the file at that commit. It reads the file as text. It does not run the file.
3. It stops if the file is not the video-swap-new userscript, is not UTF-8, or contains CR bytes.
4. It writes the file byte for byte to `src/vendor/video-swap-new.user.js`.
5. It records the commit, the version and the SHA-256 in `scripts/vendor-pins.json`.
6. It updates the version text in the tests and docs listed below.
7. It prints the old and new version, the upstream commits between them, and a text scan (`eval`, `innerHTML`, hosts).

`test/vendor-pin.test.js` fails when the file and `scripts/vendor-pins.json` do not agree. A hand edit of the vendored file thus fails the tests.

Options:

- `--ref <branch, tag or commit>`: take the file from that point. Use this to go back to an older version.
- `--repo <owner/name>`: use a different upstream repository, for example a maintained fork. The script then prints a warning. Review the code and the licence before a release.
- `--path <path>`: the path of the userscript in that repository.

Exit codes: 0 = done or current. 1 = `--check` found a difference. 2 = error, nothing written. 3 = written, but the script listed manual work.

### Text that the script updates

- `test/page.test.js` (userscript version, conflict version)
- `test/exclusions.test.js`, `test/general-cosmetic-contract.test.js`, `test/hardening.test.js` (conflict version)
- `src/vendor/README.md` (commit link, versions)
- `docs/STORE-REVIEW-NOTES.md` (version, line numbers of the `eval` call and of `getWasmWorkerJs`)
- `docs/credits.md`, `docs/how-it-works.md` (version)

The script stops before it writes anything when one of these texts is not found.

### Text that the script does not update

- `scripts/release-gate.sh`. The owner must approve each change to the gate. See the next section.
- `TODO.md` and `CHANGELOG.md`. Edit them by hand.
- `src/vendor/LICENSE-TwitchAdSolutions`. The script compares it with the upstream `LICENSE` and tells you if they differ.

### The release gate after a Twitch update (owner decision)

The gate freezes the Twitch file. After an update, expect these results:

- **Section 1b fails** until the new file is on `origin/main`. The gate compares the file with `origin/main`. This is by design: a change to a playback file needs the owner's approval. The script prints this as `OWNER DECISION`.
- **Section 6 fails** if upstream changed `ourTwitchAdSolutionsVersion`. Line 774 of the gate holds the number. The owner must change that line by hand. `test/vendor-pin.test.js` also fails until that line agrees with the new number.
- **Section 3 fails** if upstream added an `eval` call or an `innerHTML` write. Do not widen the gate's allow-list without a code review of the new lines.

Some tests read the code inside the vendored file (`test/page.test.js`, `swap`, `bug`, `memory`, `reload`, `fixtures`, `playlist`). They can fail on a real upstream change. Read each failure. Do not edit the vendored file to make a test pass.

## 2. uBlock Origin YouTube filters

### Check for drift

The weekly job `.github/workflows/ubo-youtube-drift.yml` (Mondays 06:00 UTC) does this check. To do the same check locally, run the sync and then look at the diff.

```powershell
deno run -A scripts/sync-ubo-youtube.mjs
```

```powershell
git diff --stat -- src/vendor/ubo-youtube.js src/vendor/ubo-youtube-isolated.js src/vendor/ubo-youtube.css src/rules/ubo-youtube-network.json
```

If only the `// Filters: uBlockOrigin/uAssets@...` line changed in each file, there is no drift. To discard the result of a check:

```powershell
git checkout -- src/vendor/ubo-youtube.js src/vendor/ubo-youtube-isolated.js src/vendor/ubo-youtube.css src/vendor/ubo-youtube-meta.json src/rules/ubo-youtube-network.json
```

### Replace the filters

The same command replaces the filters with the newest uAssets filters. Keep the result and commit the five files.

```powershell
deno run -A scripts/sync-ubo-youtube.mjs
```

To use one fixed uAssets commit, give the full commit id.

```powershell
deno run -A scripts/sync-ubo-youtube.mjs --uassets <40-character commit id>
```

Read the output of the sync:

- `PATCHES[n] matched nothing` or `ARG_PATCHES[n] matched nothing` means that a local patch was NOT applied. The script still exits with code 0. Do not commit that result. Update the patch text in `scripts/sync-ubo-youtube.mjs` first, then run the sync again. `test/ubo-rpnt-payload.test.js` fails while a patch is missing.
- An error from `ensurePlayerAdsPruned` means that the player prune call changed. Update `scripts/lib/youtube-local-patches.mjs`.

### Change the uBlock Origin version (scriptlet code)

The uBlock Origin release tag is a default in `scripts/sync-ubo-youtube.mjs` (line 25, `arg("--ubo", "1.75.0")`). The weekly drift job uses that default. Thus a new tag needs these steps:

1. Change the default tag on line 25 of `scripts/sync-ubo-youtube.mjs`.
2. Run `deno run -A scripts/sync-ubo-youtube.mjs`.
3. Change the version text in `docs/credits.md` and `docs/how-it-works.md`.
4. Do the steps in "After each update".

If you only pass `--ubo <tag>` and do not change line 25, the weekly drift job fails.

### Security note

The sync clones `gorhill/uBlock` at the release tag and imports three of its modules with full Deno permissions (`-A`). It thus runs uBlock Origin code on your PC. Use only a release tag of the official repository. After a sync, compare `ublock_commit` in `src/vendor/ubo-youtube-meta.json` with the commit of the tag on GitHub.

```powershell
git ls-remote https://github.com/gorhill/uBlock refs/tags/1.75.0
```
