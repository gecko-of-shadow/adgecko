<div align="center">

# 🦎 twitch-adblock

<img src="icons/icon128-working.png" width="128" height="128" alt="Gecko Adblock icon: a neon purple gecko head on a dark rounded square, its tongue snapping a cluster of pixel squares (an ad)">

**A Chrome extension (Manifest V3, version 0.2.21) that blocks ads on Twitch, YouTube, Kick, and other websites.**<br>
It works inside Chrome: no separate program, no account.

<img src="icons/icon48-working.png" width="48" height="48" alt="Toolbar icon while ordinary-site blocking is on: purple gecko, the pixel ad at its tongue lit up bright"> &nbsp; <img src="icons/icon48-off.png" width="48" height="48" alt="Toolbar icon while ordinary-site blocking is off: the same gecko in grey, pixel ad not lit">

<sub>The toolbar gecko is purple with the pixel "ad" at its tongue lit up while blocking on ordinary sites is on, and grey when it is off. Twitch, YouTube, and Kick filters keep running either way. How the art was chosen: <a href="docs/design/README.md">docs/design</a>.</sub>

[Install](#install) · [How to use](#how-to-use) · [Privacy](#privacy) · [Troubleshooting](#troubleshooting) · [Docs](#links)

</div>

## What it does and doesn't do

- ✅ Blocks video ads on Twitch, YouTube, and Kick.
- ✅ Blocks ads on other websites using public ad lists, and hides the empty boxes the ads leave behind.
- ✅ Blocks sites that public malware lists name as known-bad, on every page (also inside Twitch, YouTube and Kick pages), without ever blocking those sites' own servers. [Details](docs/threat-tier.md)
- ✅ Stops pages from putting a shell command into your clipboard (the "paste this into Run to verify you" trick). Pop-ups opened without a click can be blocked too (off by default).
- ❌ Phishing pages are only blocked when one of these public lists names them; Chrome's own Safe Browsing stays your main phishing protection.
- ❌ Ads that are part of the video itself still play. Example: a YouTuber reading out a sponsor.
- ❌ On Twitch, the picture can drop to lower quality for a moment during an ad break. The stream keeps playing.
- ❌ Sometimes a Twitch ad still shows, when no ad-free copy of the stream is available.
- ❌ On Kick, some ads still play. It only skips an ad when it can do that safely.
- ❌ YouTube Music and YouTube Kids are not covered.

## Install

1. Get the files and unzip them. Pick one:
   - **Release zip:** [twitch-adblock-0.2.21.zip](https://github.com/gecko-of-shadow/twitch-adblock/releases/download/v0.2.21/twitch-adblock-0.2.21.zip) ([release v0.2.21](https://github.com/gecko-of-shadow/twitch-adblock/releases/tag/v0.2.21), [all releases](https://github.com/gecko-of-shadow/twitch-adblock/releases)). The 0.2.21 zip came out before the "Allow this page" fix, so in that copy the button always stays grey.
   - **Newest code:** click the green **Code** button on this page, then **Download ZIP**. A copy from **Download ZIP** has the fix. It may be newer than the last numbered release; Chrome still shows the version number of that release.
2. In Chrome, type `chrome://extensions` in the address bar and press Enter. If you had an older copy loaded, remove it first.
3. Turn on **Developer mode** (top right). This switch lets Chrome add an extension from a folder on your computer.
4. Click **Load unpacked** and pick the unzipped folder: the one with `manifest.json` directly inside it. Keep the folder where it is. Chrome runs the extension from that folder.
5. Optional: click the puzzle-piece icon next to the address bar, then the pin next to **twitch-adblock**. The gecko then stays visible in your toolbar (the row of icons to the right of the address bar).

## How to use

Nothing to set up: it works as soon as it is installed.

1. Click the gecko in the toolbar. A small window shows the site and one line: **✅ Protected**, or **Allowed – not blocking here**.
2. **Something broke?** Click **Fix this site**. It turns off the extra filters for this site only (hidden boxes and the page guards). Reload the page and look, then answer **Did that fix it?** **Yes** keeps it. **No** turns them back on and suggests the next step.
3. Still broken? Click **Allow this site**: nothing is blocked on this site any more. The button turns into **Block again** to undo it.
4. **Show more** has the list status and the version. The gear opens the settings page with every switch, the per-site list, the list update button and the popup theme (purple or high contrast).

A small magenta dot on the gecko means a page guard just blocked something on that tab (for example a page trying to put a command into your clipboard). Open the window to see what; the dot then goes away (it also goes away when the tab opens another page). There are no pop-ups or counters.

An allow counts for the whole website address and stays until you undo it. Details: [docs/allow-a-page.md](docs/allow-a-page.md)

## Privacy

- No tracking: it does not send your browsing history anywhere.
- No account, and no analytics call of its own. Settings stay in Chrome's storage on this browser.
- Every 3 hours it checks eight public filter lists over HTTPS without cookies (a real download at most every 12 hours). The sites it contacts are: `easylist.to`, `pgl.yoyo.org`, `malware-filter.gitlab.io`, `ublockorigin.github.io`, `easylist-downloads.adblockplus.org` and `secure.fanboy.co.nz` (EasyList mirrors, only if the first try fails), `raw.githubusercontent.com` (HaGeZi and Dandelion Sprout lists only) and `filters.adtidy.org`. Those sites see the list address and your IP address. The page you are visiting is not part of that address.
- The clipboard guard looks at the text a page tries to copy only inside your browser. Nothing is sent anywhere.
- The one Curben list we use: URLhaus data, no OpenPhish. curbengh's urlhaus-filter (abuse.ch URLhaus malware hosts, CC0) is the only list from Curben's malware-filter project, kept by owner decision #18b; his phishing list and every OpenPhish source stay out. [Details](docs/threat-tier.md#where-the-hosts-come-from)
- On Twitch, it asks Twitch for ad-free copies of the stream. Those requests go to Twitch.

Full details, permissions, and the list sites: [docs/permissions-and-privacy.md](docs/permissions-and-privacy.md)

## Troubleshooting

- **"Allow this site" is grey?** The line under it says why. Common reasons:
  - *Off – turned off in settings.* The whole extension is switched off on the settings page.
  - *Open a normal http(s) page to allow it. Already on one? Reload it.* Chrome's own pages cannot be allowed. On a normal website, the page was open before you installed or reloaded the extension: reload it, then open the window again.
- **A copy button on a website does not copy a command?** The clipboard guard stops pages from writing commands like `powershell ...` or `curl ... | sh` unless you copy them yourself: select the text and press Ctrl+C. Documentation sites such as GitHub are trusted. Or use **Fix this site**.
- **Blocked things still missing after you allow a site?** Reload the page.
- **Loading a new copy?** Remove the old one first. Removing the extension, or loading a copy from a different folder, forgets the allowed sites, so allow them again.

## License and brand

- The code is open source under the GNU General Public License version 3 ([LICENSE](LICENSE)). Copyright (C) 2026 gecko-of-shadow.
- Parts made by others keep their own licences: TwitchAdSolutions (MIT), uBlock Origin and uAssets (GPLv3), the EasyList authors' lists, and the other filter lists, including the one Curben list used (curbengh's urlhaus-filter: URLhaus data, CC0). Details: [docs/credits.md](docs/credits.md) and [src/rules/LICENSES.md](src/rules/LICENSES.md).
- **Brand:** the name "Gecko Adblock" and the gecko icon are gecko-of-shadow's brand. They are not covered by the code licence: if you share a changed copy, give it your own name and icon. This is not a trademark claim beyond that.

## Links

- **Docs:** [How it works](docs/how-it-works.md) · [Allow a site](docs/allow-a-page.md) · [Permissions and privacy](docs/permissions-and-privacy.md) · [Threat tier](docs/threat-tier.md) · [Signed threat feed setup](docs/feed-setup.md)
- **Permissions:** exactly `storage`, `declarativeNetRequest`, `alarms`, and the listed hosts (all for downloading public filter lists). [Full list](docs/permissions-and-privacy.md#permissions)
- **Credits and licenses:** TwitchAdSolutions (MIT), uBlock Origin and uAssets (GPLv3), the EasyList authors and the other lists. [Details and license files](docs/credits.md) · [LICENSE](LICENSE)
- **Development:** there is no build step. From a git clone, load the repository root (the directory that contains `manifest.json`); `docs/`, `test/`, and `scripts/` are not part of the running extension. The version is the `version` field in `manifest.json`. The release zip root is `manifest.json`, `src/`, and `icons/`, and `scripts/pack-zip.sh` writes `twitch-adblock-<version>.zip` containing the same three.

<details>
<summary>Development commands</summary>

```bash
deno test --no-lock --allow-read --allow-run --allow-env test/
bash scripts/release-gate.sh
bash scripts/pack-zip.sh
```

</details>
