# Adgecko Shield (Android): build, install and checks

[Back to the README](../../README.md). The plan: [`PLAN.md`](PLAN.md). Milestone: 1 ("Shield, day one").

- Language: ASD-STE100.
- Rule: each phone behaviour on this page is UNVERIFIED until a run on the owner's phone proves it.

## 1. What it is

Adgecko Shield is a small Android app in the folder `android/` of this repository. It is a local VPN that routes only DNS. It blocks the whole-domain ad, tracker and malware hosts of Adgecko in all apps on the phone. All other traffic uses the normal network. The app has no account, no analytics and no crash reporter.

- Data: the Gradle build runs `scripts/export-android-data.mjs` with Deno. The script reads `src/rules/` and the real modules of `src/`. Nothing derived is committed. Today: 194,480 list hosts and 15,291 threat names.
- Block answer: NODATA (no address, one SOA record, TTL 60 s). Thus a change of the allow list works within about 1 minute.
- Layer order: Self-test name, your allow list, malware hosts, never-block hosts, list hosts, all other names. The never-block hosts are the Twitch, YouTube and Kick hosts, `googleapis.com` and `gstatic.com` (but not `imasdk.googleapis.com`), and `hcaptcha.com`, each with its subdomains.
- Difference from the extension: DNS has no page context. The Shield also blocks list hosts on YouTube and Kick pages and in their apps, where the extension lets them through (plan section 3, risk 21).
- Permissions: `INTERNET`, `ACCESS_NETWORK_STATE`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_SYSTEM_EXEMPTED`, `POST_NOTIFICATIONS`. The build task `:app:verifyManifestPolicyDebug` (one task for each variant) checks the merged manifest.

## 2. Controls

| Control | What it does |
|---|---|
| Main screen switch | Shield on or off. The first time, Android shows the VPN dialog. |
| Mode | "Ads + threat" (default) or "Threat only". |
| Pause 10 min | Stops the list layer for 10 minutes. Malware blocking stays on. |
| Quick Settings tile | A tap moves On to Paused, Paused to Off, and Off to On. On a locked phone, Paused and Off ask for the unlock first. A long press opens the app. |
| Notification | "Protecting all apps", the blocks of today, "Pause 10 min" (or "Resume") and "Recent blocks". On a locked phone, "Pause 10 min" asks for the unlock first. |
| Recent blocks | The last 200 blocked names, in memory only. The debug build also writes each blocked name to logcat (section 5, O8). Tap a name to allow it. A malware name needs a second confirmation. |
| Allow list | Max 1,000 entries, the same format as the extension (`threatAllowDomains`). Export and import a JSON file. |
| Exclude apps | The Shield does not filter the apps that you select. |
| Self-test | Asks for `self-test.adgecko.test` (expected: "blocked") and `example.com` (expected: "resolved"). A third line tells if the lists are active, paused, off (Threat only), still loading or not active. Before the lists load, only the Self-test name is blocked. |
| Private DNS warning | Shows when Private DNS uses a hostname. Then apps send DNS past the Shield. It also names the DoH setting (section 7). |
| Upstream DNS (DoH) | An optional DoH URL. No URL saved: allowed queries go to the DNS servers of your network. With a saved URL: they go to that URL. The field never shows the saved URL: a line under it shows the host. Save and Clear. Section 7 has the steps. |
| About | The GPL-3.0 notice, the source commit, the data date and all licence texts. |

## 3. Build (developer)

Needs: JDK 21, Deno 2.9.8, the Android SDK (platform 36, build-tools 36.0.0) and `ANDROID_HOME`. Do not build inside the folder that Chrome loads as the unpacked extension (plan risk 18).

```bash
./android/gradlew -p android --no-daemon :shield-core:test :app:testDebugUnitTest :app:lintDebug :app:verifyManifestPolicyDebug :app:assembleDebug :app:assembleDebugAndroidTest :probe:assembleDebug :probe:assembleDebugAndroidTest
```

- If Deno is not on the PATH, add `-Padgecko.deno=<path to deno>`.
- The APK is `android/app/build/outputs/apk/debug/app-debug.apk`.
- CI (`.github/workflows/android.yml`) runs the same tasks and uploads the APK as the artifact `adgecko-shield-debug`. An emulator job runs the device tests on API 33 and API 36.
- After a change of the JS policy, run `deno run --no-lock --allow-read --allow-write=test/fixtures/android/vectors scripts/build-android-vectors.mjs` and commit the vector files.

## 4. Install on the phone (owner)

Before the install:

- On the PC, download the artifact `adgecko-shield-debug` from the Actions run of the draft pull request (GitHub needs a login). The file is `adgecko-shield-debug.zip`. GitHub keeps the artifact for 7 days. After that, a new CI run is necessary.
- On the phone, turn on USB debugging. On a Samsung phone, Auto Blocker also blocks USB commands, and USB debugging is greyed out while it is on (research, not checked on a phone). Pause Auto Blocker (or Advanced Protection: "Pause temporarily") only for the adb session. Turn it on again at the end of the session.
- Do not use a second VPN or DNS-blocker app at the same time. Android permits one VPN at a time.
- On the PC, `adb` must work. `adb` is in the Android SDK Platform-Tools from Google. Put its folder on the PATH, or run `adb.exe` from that folder.

PowerShell 5.1 commands. Run one command at a time.

```powershell
Set-Location "$HOME\Downloads"
```

```powershell
Expand-Archive -Path .\adgecko-shield-debug.zip -DestinationPath .\adgecko-shield -Force
```

```powershell
adb devices
```

```powershell
adb install -r .\adgecko-shield\app-debug.apk
```

If Android refuses the update with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, a new CI run used a new debug key. First export the allow list in the app. Then you can remove the old test build. This removes its settings. It is your decision.

```powershell
adb uninstall adgecko.shield
```

Start the app:

```powershell
adb shell am start -n adgecko.shield/.ui.MainActivity
```

Before each later update: turn the shield Off in the app. If Always-on VPN is on, turn it off for the update. Install. Then turn both on again. Reason: the Android 16 VPN-update fault can stop the network until a reboot (reported, status not known).

After the session: turn off USB debugging. Turn Auto Blocker or Advanced Protection on again.

## 5. Checks that only the owner can do (about 15 minutes)

All results are UNVERIFIED until the owner reports them.

- O1. Install as in section 4. Expected: "Success".
- O2. Open the app. Turn the shield On. Accept the VPN dialog. Allow notifications. Expected: a key icon and the notification "Protecting all apps".
- O3. Tap "Run Self-test". Expected: 3 lines: "1. self-test.adgecko.test: blocked", "2. example.com: resolved" and "3. Lists: active (194,480 list hosts, 15,291 threat names)." If line 3 says "still loading", wait some seconds and run the Self-test again. If line 3 says "NOT active", send the line (O8).
- O4. Read the Private DNS mode in the app, or with the command below. Expected: `off` or `opportunistic`. The command prints `null` when nobody changed the setting; `null` means the default, Automatic. If it is `hostname`, the app shows its warning. Changing the setting is your decision.

```powershell
adb shell settings get global private_dns_mode
```

- O5. Open one app with ad banners (a game or a free tool) for 2 minutes. Then open "Recent blocks". Expected: some names, and the app works.
- O6. Tap one entry and "Allow". Expected: that name works again within about 1 minute. Then exclude one app. Expected: that app is not filtered.
- O7. The shield is On. Tap the tile one time. Expected: the tile shows "Paused", and the notification shows "Paused until <time>. Threat blocking stays on." Tap the tile again. Expected: "Off", and the notification goes away. Tap the tile again. Expected: "On", and the notification "Protecting all apps". (The plan text "Off, On, then Pause" does not match the tile cycle; this order is correct.)
- O8. Send the log lines if a check fails. Stop the log with Ctrl+C.

```powershell
adb logcat -s AdgeckoShield:V
```

The debug build writes each blocked name to this log. Read the lines before you send them. Remove the names that you do not want to share.

```powershell
adb shell dumpsys activity services adgecko.shield
```

Exit rule for milestone 1: the owner reports O1 to O7, and no app that the owner needs stays broken (or Allow, Exclude or Pause fixed it).

## 6. Known limits (milestone 1)

- Host level only. The 18,422 scoped entries, the path rules and the hide rules stay in the browser extension.
- The data is a snapshot of `src/rules/` at the commit that CI built. The phone does not download lists (milestone 3).
- Private DNS with a hostname, apps with their own encrypted DNS, and a custom provider in Chrome's "Use secure DNS" bypass the Shield. To use a DoH provider with the Shield, use the DoH URL setting (section 7).
- Do not turn on "Block connections without VPN": the Shield routes only DNS.
- The debug key changes with each CI run. Each update thus needs an uninstall (owner decision OD-3).
- The lint check `ForegroundServicePermission` is suppressed for the VPN service. The platform lists `SCHEDULE_EXACT_ALARM` or `USE_EXACT_ALARM` as "any of" permissions for the service type `systemExempted`. The AOSP policy for Android 14 to 16 also accepts the app op `OP_ACTIVATE_VPN`, which the VPN consent dialog sets (checked in AOSP source on 2026-11-17, not on a phone). If Android refuses the type on the phone, the app shows the notice "Android refused the foreground service type systemExempted" and stays off (plan risk 11).

## 7. Use NextDNS or another DoH provider with the Shield

All phone behaviour in this section is UNVERIFIED until a run on the owner's phone proves it.

Why the Shield needs its own setting: Private DNS in hostname mode sends DNS from each app straight to the provider over TLS. The Shield sees no query then, and it blocks nothing. The Shield has a DoH upstream setting to avoid this. The Shield decides to block or to forward. It sends each forwarded query, encrypted, to the DoH URL of your provider. Blocked queries never leave the phone.

Steps:

1. Keep Private DNS on Automatic. Do not set a hostname. (The Android menu path differs by phone: Settings, then Network, then Private DNS.)
2. Copy the DoH URL of your provider. For NextDNS, open the Setup page of your profile. The URL has the form `https://dns.nextdns.io/<profile ID>`. The profile ID is private. Do not share the URL.
3. Open Adgecko Shield. Find the section "Upstream DNS (DoH)". Type the URL. Press Save. The app shows "Saved. Allowed queries go to <host> over DoH.", empties the field, and writes "Saved: DoH to <host>." under it. A text that is not an https URL gives "Not a valid https URL." An empty field gives "Type a DoH URL, or press Clear to stop DoH."
4. Check the result:
   - On the main screen, read the status line "Upstream: DoH <host>: A via DoH, P via network DNS". Open some pages. A goes up. P stays at 0, or close to 0 (see the list of reasons below).
   - Open the query log of your provider. The log shows the allowed queries of the phone. It shows no blocked query, because a blocked query never leaves the phone.
5. To stop using DoH, press Clear. The screen shows "Saved: none (network DNS)." The Shield then sends allowed queries to the DNS servers of your network again.

What the Shield does:

- It sends each allowed query as an HTTPS POST (RFC 8484, `application/dns-message`). Only an `https` URL is valid. The request has the fixed User-Agent `adgecko-shield`: it holds no version and no device data.
- One DoH try has a total time limit of 2.5 s, or less when the query has less time left. The Shield keeps 1 s of the 5 s deadline of a query for the network DNS path.
- A circuit breaker protects the query path. After 3 DoH failures in a row, the Shield uses the DNS servers of your network for 30 seconds. Then one query tries DoH again. If that query succeeds, DoH is on again. If it fails, the 30 s pause starts again. A DoH success resets the count of failures.
- "P via network DNS" counts each query that did not use DoH, for any reason. The text ", last reason R" names the reason of the last such query: `DoH host name`, `paused after failures`, `too little time left`, `answer larger than client limit`, or the code of a DoH failure, for example `HTTP 404`, `timeout` or `content type`. While the breaker is open, each query sets the reason to `paused after failures`. Thus the text ", last DoH failure F" names the code of the last real DoH failure, for example `UnknownHostException`, `SSLHandshakeException` or `HTTP 404`. It stays on the screen until the Shield starts again.
- The query for the DoH host itself, and a query with no usable name, always use the DNS servers of your network. The lookup of the DoH host thus never waits on DoH.
- If a DoH answer is larger than the UDP size that the app accepts (or larger than 65,507 bytes), the Shield uses the network DNS path for that query. The network DNS servers answer within the UDP size of the app. This is not a DoH failure. It counts as a DoH success and sets the count of failures to 0.
- The counts belong to the running Shield. A new URL, a network change or a restart of the Shield starts new counts. The status line shows the host of the saved URL also while the Shield is off, with the counts at 0.
- The screen and the debug log show the host only, never the full URL. The URL field is always empty: it never shows the saved URL. The URL is in the private settings of the app (no backup).
- A network with no DNS server can answer through DoH only when the host of the URL is an IP address. Else the Shield cannot look up the host of the URL without a DNS server.

Known limits (UNVERIFIED):

- The Shield must connect to the DoH host without its own filter. It opens each DoH connection with `Network.openConnection` of the real network, so the host lookup and the sockets do not use the Shield. The Shield has no `allowBypass()`. It is a premise that this works for the own package. If it does not, the count "via network DNS" goes up and the text "last DoH failure" shows the code of the failure.
- The total time limit stops the connect, the request and the read. It cannot stop the host lookup inside `Network.openConnection`. A slow lookup can use more than the DoH time. The query waits for the lookup. If time is left when the lookup ends, the network DNS path answers. If not, the query gets SERVFAIL when the lookup ends, which can be after 5 s.
- A kept connection that the server closed in the meantime can make one try fail. That try counts as a failure for the breaker.
- Apps with their own encrypted DNS, and a custom provider in Chrome's "Use secure DNS", still bypass the Shield.
- Only one DoH URL is possible. The Shield has no DoH list and no "DoH only" mode: after a failure it uses plain DNS, so your network can see those queries.
