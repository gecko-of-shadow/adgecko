# Handoff

Last update: 2026-11-17.

## State

- Version 0.3.6 is released: [v0.3.6](https://github.com/gecko-of-shadow/adgecko/releases/tag/v0.3.6), from commit `5cd4ab6`, published 2026-11-16 by the release workflow.
- UNVERIFIED: all behaviour of 0.3.6 in Chrome. The owner asked for the release before the manual tests. The tests are the first item in `TODO.md`.
- New: Android milestone 1, "Adgecko Shield", is built in `android/` (plan `docs/android/PLAN.md`, owner steps `docs/android/shield.md`). It is in a draft pull request from the branch `claude/android-shield-m1`. That branch starts from the docs branch of draft pull request 18 (not merged when the session started).
- UNVERIFIED: all behaviour of the Shield on a phone. No run on the owner's phone was done.
- The next work and the open owner decisions are in `TODO.md`.

## Work done in the last session (2026-11-17, Android milestone 1 build)

Owner approvals for this session (from the session prompt, source: the owner's request of 2026-11-17 "build a working prototype" and the standing approval for all work except deletions):

- Approved: "OD-1: the new files and the document updates of plan section 4.2."
- Approved: "OD-2: the placeholder applicationId `adgecko.shield`."
- Approved: "OD-4: `android.yml` with the two GitHub-owned actions."
- Approved: "OD-5: Deno in the Android build."
- Approved: "OD-6: the `.gitignore` and `.gitattributes` lines."
- Defaults: "OD-8 to OD-12 use the recommendation of the plan." Thus: mode "Ads + threat" (OD-8), NODATA with SOA and 60 s TTL (OD-9), list filter (a) with 194,480 hosts (OD-10), pause of the list layer only (OD-11), recent blocks in memory only (OD-12).
- Not approved, and not done: a change to `src/`, `manifest.json`, `icons/`, `scripts/frozen-pins.json`, `scripts/release-gate.sh` or `.github/workflows/checks.yml`; any deletion; any work after milestone 1.

Done (plan section 13, T1 to T13; T14 see "Checks"):

1. T2: `.gitignore` and `.gitattributes` lines, before the first Gradle run.
2. T3, T4: `scripts/lib/android-dns-policy.mjs`, `scripts/export-android-data.mjs`, `scripts/build-android-vectors.mjs`, 5 vector files, `test/android-data.test.js`, `test/android-vectors.test.js`.
3. T5: Android SDK in a folder below `$HOME`, outside the repository. The licence step was accepted with no prompt (`sdkmanager` says that `--licenses` is no longer needed).
4. T6: Gradle 9.9.1 wrapper, `buildSrc` (`ExportShieldData`, `VerifyManifestPolicy`), modules `:shield-core`, `:app`, `:probe`.
5. T7, T8: `:shield-core` policy, data and packet code with JVM tests.
6. T9, T10: VPN service, tile, notification, screens, store, debug start activity.
7. T11: ART vector test, probe VPN test, `android/ci/emulator-run.sh`, `android/ci/sdk-packages.sh`, `.github/workflows/android.yml`, `test/android-static.test.js`, `test/android-workflow.test.js`.
8. T12: `docs/android/shield.md`, the codebase map, `CLAUDE.md`, the `README.md` Install section, `CHANGELOG.md`.

Build facts (record for plan T6):

- AGP 9.5.1 with Gradle 9.9.1 works. `:app` and `:probe` use the built-in Kotlin of AGP 9; they do not apply `org.jetbrains.kotlin.android`. AGP 9.5.1 depends on the Kotlin Gradle plugin 2.2.10; the root `plugins { kotlin.jvm 2.4.21 apply false }` moves it to 2.4.21 (`buildEnvironment`). `:shield-core` uses `org.jetbrains.kotlin.jvm` 2.4.21.
- The generated-asset API name of the plan is correct: `variant.sources.assets?.addGeneratedSourceDirectory(task, ExportShieldData::outputDir)`.
- `android.useAndroidX=true` is necessary for the androidTest dependencies. The APK has no AndroidX library (the merged manifest has exactly the 5 permissions).
- `VerifyManifestPolicy` needs only the Gradle API; `:app` gives it the `MERGED_MANIFEST` artifact. Thus `buildSrc` has no AGP dependency (a simplification of plan 6.2).

Deviations from the plan, and findings:

- Lint finding: the service type `systemExempted` has the platform annotation "FOREGROUND_SERVICE_SYSTEM_EXEMPTED and any of SCHEDULE_EXACT_ALARM, USE_EXACT_ALARM" (conditional). The two alarm permissions are not in the M1 policy. The lint check `ForegroundServicePermission` is suppressed on the VPN service only, with a comment. For a VPN app, the condition is the VPN consent (from memory, not checked). If Android refuses the type, the app shows a notice and stays off (plan risk 11). On API 33 the app calls `startForeground()` with no type.
- The Quick Settings tile cycles On, Paused, Off. The plan did not give the order.
- "Allow this domain" offers the blocked name itself. The registrable domain is not offered in M1.

## Checks

Checked in this session (Linux container, no phone, no emulator):

- `deno test --no-lock --allow-read --allow-run --allow-env test/`: see the pull request text for the final count.
- New Deno tests: export counts 194,480 list hosts and 15,291 threat names; two builds give the same bytes; the never-block model equals `isNeverBlock()`; the hosts of rules 1 to 3 are below a never-block suffix; the dnr-matcher cross-check on 400 samples (306 blocks) agrees; the `kick.com` frame difference is documented; vectors equal the generator output.
- Gradle (plan A2): `:shield-core:test :app:testDebugUnitTest :app:lintDebug :app:verifyManifestPolicyDebug :app:assembleDebug :app:assembleDebugAndroidTest :probe:assembleDebug :probe:assembleDebugAndroidTest` passed. 18 JVM tests in `:shield-core` and 6 in `:app`.
- A5: Kotlin equals `dnsDecision()` on 32,730 real-data samples, 0 mismatches.
- A7: packet tests for IPv4 and IPv6, types A, AAAA, HTTPS, SVCB; forward through a stub upstream on the loopback address; TCP RST+ACK; 40,000 random inputs with no exception.
- A8 (JDK): data load 191 ms, 1,000,000 lookups 735 ms, host sets 1,678,168 bytes.
- A9: merged manifest has exactly the 5 permissions; exported components as in plan 6.3.
- A11: the debug APK is 4,899,806 bytes. It holds `assets/shield/shield-manifest.json` and the 10 files that it names, with equal SHA-256 values.
- The wrapper jar SHA-256 is `621008af...cdaf8` (plan value). The two new action SHAs agree with `git ls-remote`.

Not checked:

- UNVERIFIED: all phone behaviour: the VPN, the tile, the notification, the Self-test, the Private DNS warning, battery and memory.
- CI build job and emulator job: see "CI results" below.
- The phone model of the owner is not known. The code assumes no brand.

## CI results

- Recorded after the first run of `android.yml` on the draft pull request. See the next update of this section.

## Open from the last session

- The branch `docs/cleanup-2026-11-16` of the closed pull request 16 is not deleted. The owner can delete it on the GitHub Branches page.

## Next steps

1. Owner: review the draft pull request of the Android build. Then install the debug APK with adb and do the checks O1 to O7 (`docs/android/shield.md`, sections 4 and 5).
2. Test 0.3.6 by hand on the owner's PC: `TODO.md`, section 1.
3. Owner, no code: give the phone facts (OD-7), and try the unchanged extension in Vivaldi for Android (track B0).
4. Owner decisions: OD-3 (signing) before milestone 2; the defaults OD-8 to OD-12 can change in the review.
5. Merge order: pull request 18 (plan) first, then the Android build pull request.
