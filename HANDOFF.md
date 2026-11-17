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
- Service start: `startForeground()` comes before `establish()`. The plan (section 6.6, risk 11) gave the other order. Reason: a start through `startForegroundService()` must reach `startForeground()` on each path, also when `establish()` fails, else Android stops the app. The AOSP type check reads only the VPN consent app op, not the VPN state (see "Research"). UNVERIFIED on a phone.
- The Quick Settings tile cycles On, Paused, Off. The plan did not give the order. Its step O7 text ("Off, On, then Pause") does not match a cycle that starts at On; `docs/android/shield.md` has the correct order. On a locked phone, Paused and Off ask for the unlock first.
- "Allow this domain" offers the blocked name itself. The registrable domain is not offered in M1.

## Research and review (2026-11-17, after the first push)

The owner asked for real research for each step and a reason for each choice. Results:

1. Service type `systemExempted` (AOSP `ForegroundServiceTypePolicy.java`, Android 14, 15 and 16 branches and tags): the "any of" set has `SCHEDULE_EXACT_ALARM`, `USE_EXACT_ALARM` and the app op `OP_ACTIVATE_VPN`. The VPN consent dialog sets that app op (`Vpn.java`, android16-release). The developer page "Foreground service types" lists "VPN apps" for this type. Decision: keep `systemExempted` and no alarm permission. Not chosen: `specialUse` as a fallback type, because it needs a sixth permission (`FOREGROUND_SERVICE_SPECIAL_USE`), which is an owner decision (open question 1 below). Not chosen: no foreground service (as AdAway does), because the tile and the screens start the service with `startForegroundService()`.
2. Resolver (AOSP DnsResolver and netd, main branch): `.test` names are not special (only `.local` is); `rawQuery(null, ...)` uses the VPN DNS for an app that is not excluded; in Private DNS Automatic mode, queries go to UDP 53 at once while DoT is not validated, and the TCP RST only stops each validation try from a wait of up to 127 s; `appops set <pkg> ACTIVATE_VPN allow` makes `VpnService.prepare()` return null. Decision: keep the Self-test name, the RST and the probe design. Only the main branch was read, not the API 33 to 36 release branches.
3. Lifecycle review (independent agent): 10 findings, all fixed in commit `7d460d2` (start order, sticky restart, no main-thread wait, late data load, upstream queue limit, connected socket and one deadline, 65,535-byte answers, answers after a rebuild, debounce, counter races).
4. Review workflow (5 dimensions, 3 skeptics for each finding): 37 findings, 15 confirmed, 22 refuted. No JS/Kotlin parity defect survived. Fixed: tile on the lock screen, import on a background thread with cut values, the workflow test (extra permission keys, `run: |` blocks), reserved names in the vectors, the probe consent fallback (it now uses the exported debug-only `DebugStartActivity`), `adb wait-for-device` with a time limit and a dead-emulator check, a full logcat stream file, and 7 document corrections.

5. Second review workflow (on the fixes since `07d91b9`; 89 agents; a completeness critic): 28 findings, 11 confirmed and fixed, 17 refuted. The critic checked plan A1, A2, A11 and A12 again (APK 5,000,734 bytes; assets equal the manifest; no change to the protected files). Fixed: the Self-test line 3 shows a pause and the mode Threat only; the notification "Pause 10 min" asks for the unlock (as the tile); an import result reaches the screen after a rotation; `adb` errors during the boot no longer stop the CI script; the workflow test has an allow list for `${{ }}` lines and reads more `run:` forms; the APK upload fails when the APK is missing; 5 document corrections.

## Checks

Checked in this session (Linux container, no phone, no emulator):

- `deno test --no-lock --allow-read --allow-run --allow-env test/`: 909 passed, 0 failed, 9 ignored. `bash scripts/release-gate.sh`: `VERDICT: CLEAN`. `python3 -I scripts/privacy-check.py`: passed (the secret rows were not available in the container).
- New Deno tests: export counts 194,480 list hosts and 15,291 threat names; two builds give the same bytes; the never-block model equals `isNeverBlock()`; the hosts of rules 1 to 3 are below a never-block suffix; the dnr-matcher cross-check on 400 samples (306 blocks) agrees; the `kick.com` frame difference is documented; vectors equal the generator output.
- Gradle (plan A2): `:shield-core:test :app:testDebugUnitTest :app:lintDebug :app:verifyManifestPolicyDebug :app:assembleDebug :app:assembleDebugAndroidTest :probe:assembleDebug :probe:assembleDebugAndroidTest` passed. 19 JVM tests in `:shield-core` and 6 in `:app`.
- A5: Kotlin equals `dnsDecision()` on 32,730 real-data samples, 0 mismatches.
- A7: packet tests for IPv4 and IPv6, types A, AAAA, HTTPS, SVCB; forward through a stub upstream on the loopback address; TCP RST+ACK; 40,000 random inputs with no exception.
- A8 (JDK): data load 191 ms, 1,000,000 lookups 735 ms, host sets 1,678,168 bytes.
- A9: merged manifest has exactly the 5 permissions; exported components as in plan 6.3.
- A11: the debug APK is 4,899,806 bytes. It holds `assets/shield/shield-manifest.json` and the 10 files that it names, with equal SHA-256 values.
- The wrapper jar SHA-256 is `621008af...cdaf8` (plan value). The two new action SHAs agree with `git ls-remote`.

Not checked:

- UNVERIFIED: all phone behaviour: the VPN, the tile, the notification, the Self-test, the Private DNS warning, battery and memory.
- The CI emulator results are below. An emulator is not a phone.
- The phone model of the owner is not known. The code assumes no brand.

## CI results

Draft pull request 19, workflow `android.yml`:

- Build job: green on each run. The artifact `adgecko-shield-debug` exists (run 1, head `07d91b9`, and later runs).
- Run 1 (`07d91b9`): both emulator jobs were cancelled at the 60-minute limit. Log line: `ERROR | Unknown AVD name [shield] ... no file shield.ini in $HOME/.android/avd`; then `adb wait-for-device` waited. Fixed in `eb02643` (one AVD folder, checks before the boot) and `1f67a3d` (time limit).
- Runs 2 and 3 (`7d460d2`, `1f67a3d`): they have the same AVD fault (older script).
- Run 4 (`eb02643`), API 33 and API 36: the emulator booted.
  - E2 PASS on both: the vector runner passed all 5 files on ART; the data loaded on ART in 270 ms (API 33) and 975 ms (API 36), 194,480 list hosts and 15,291 threat names.
  - E3 PARTIAL on both: `example.org` resolved through the Shield (14 ms and 17 ms); TCP to the alias on port 853 failed in 1 ms and 5 ms (`ConnectException`). The VPN had the DNS alias `192.0.2.2`; Private DNS mode `null` (Automatic).
  - E3 FAIL on both: the Self-test name got NXDOMAIN from the upstream server (SOA `a.root-servers.net` on API 33, `localhost` on API 36), not the Shield's NODATA. Root cause: the probe asked about 0.3 s to 1 s before the data load of the new app process ended, and with no data the policy was null, so the Shield forwarded each name. Fix in the next commit: before the load ends, the policy has empty data, so the Self-test name is blocked and all other names are forwarded; the Self-test says whether the lists are active; a new probe test waits for the data and checks that a list host gets the Shield's NODATA.
- Run 5 (`b4ec612`): GREEN. Build job, emulator API 33 and emulator API 36 all passed.
  - E2 PASS on both: 5 vector files on ART; data load on ART 250 ms (API 33) and 2,572 ms (API 36).
  - E3 PASS on both, all 4 probe tests: the Self-test name (types A, AAAA, HTTPS) got NODATA with the SOA `blocked.adgecko.invalid` (API 33: 100, 19, 16 ms; API 36: 33, 19, 13 ms; plan limit 200 ms); after the data load, the list host `imasdk.googleapis.com` got NODATA (layer LIST); `example.org` resolved (5 ms, 22 ms); TCP to the alias on port 853 failed (1 ms, 4 ms); logcat has `decision=block layer=SELF_TEST`.
  - The consent came from `appops set adgecko.shield ACTIVATE_VPN allow`; the UI Automator fallback was not needed.
  - Note: the data load in the app process took 0.4 to 3.0 s on the emulators (plan budget A8 is 1 s on the JDK only). During that time only the Self-test name is blocked. Measure it on the phone.
- Runs 6 and 7 (`b823c9b`, `bb76286`): GREEN. Build job, emulator API 33 and emulator API 36 passed. Run 7 has the fixes of the second review.
- Run 8 (`1dd4f5a`, a commit that changed only HANDOFF.md): the build job failed with HTTP 429 "Too Many Requests" from Maven Central (an external rate limit). The one re-run built the APK. Emulator API 36 then failed one probe test: the probe asked 150 ms after the VPN was established, but before Android had made the VPN the default network of the probe app (`active network=100 vpn=102`); its answer came from the real network, and `bindSocket()` gave EPERM. Root cause in the probe, not in the app: it waited only until a VPN network existed. Fixed: the probe waits until its own default network is the VPN.
  Emulator API 33 in run 8: the Shield answered correctly, but the first answer took 230 ms (plan limit 200 ms; 100 ms in run 5). The first answer after a start shares the CPU with the data load of the new app process. Decision: a cold warm-up query with a limit of 1 s (its time is logged), then the 200 ms limit for each type. Not chosen: a higher limit for all answers (it weakens the plan criterion).
- Run 10 (`f602942`): emulator API 33 failed before any test: HTTP 429 from Maven Central again (the third time in about 35 minutes). Root cause: each job downloaded all dependencies again (the plan had no Gradle cache in M1, "add it later if CI time is a problem"). Decision: the built-in Gradle cache of `actions/setup-java` (`cache: gradle`, no new action) and `android/ci/gradle-retry.sh`, which repeats Gradle only when the log has "status code 429" (at most 2 times, 60 s and 120 s apart). Not chosen: a general retry (it hides real test failures); a different Maven mirror (a new download host). Cache risk: the workflow has no secret and `contents: read` only. The owner accepted this on 2026-11-17 (OD-new-2), and plan section 6.8 now records it.
- Run 9 (`0bd5e69`, the probe waits for its own VPN default network): GREEN.
- Run 11 (`d32fbc6`, Gradle cache and 429-only retry): GREEN. Build job, emulator API 33 and emulator API 36 passed. This is the current state of CI.
- Run 13 (`fa06166`, documents only): emulator API 33 failed 1 of 4 probe tests: `example.org` got no answer in 5.1 s (DnsResolver error 1). The Shield forwarded the query (two upstream sockets) and got no answer within its 5 s deadline, while the real network worked (NetworkMonitor HTTP 204). All block tests and the ART tests passed. The log could not show whether the emulator DNS server dropped the query or the Shield lost the answer. Action: one re-run of the failed job, and debug-only logs for each forward failure (reason, server index; no host name) and each interface rebuild.

## Open questions for the owner

1. OD-new-1: add `specialUse` as a fallback service type (a sixth permission, `FOREGROUND_SERVICE_SPECIAL_USE`)? Use: only if a phone refuses `systemExempted`. Owner decision of 2026-11-17: wait for the result of check O2 on the phone. No change until then.
2. OD-new-2: DECIDED. The owner accepted the Gradle cache in `android.yml` (`cache: gradle` of `actions/setup-java`) and `android/ci/gradle-retry.sh` on 2026-11-17. Plan section 6.8 now records the decision.

## Open from the last session

- The branch `docs/cleanup-2026-11-16` of the closed pull request 16 is not deleted. The owner can delete it on the GitHub Branches page.

## Next steps

1. Owner: review the draft pull request of the Android build. Then install the debug APK with adb and do the checks O1 to O7 (`docs/android/shield.md`, sections 4 and 5).
2. Test 0.3.6 by hand on the owner's PC: `TODO.md`, section 1.
3. Owner, no code: give the phone facts (OD-7), and try the unchanged extension in Vivaldi for Android (track B0).
4. Owner decisions: OD-3 (signing) before milestone 2; the defaults OD-8 to OD-12 can change in the review.
5. Merge order: pull request 18 (plan) first, then the Android build pull request.
