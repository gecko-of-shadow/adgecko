<div align="center">

# 🦎 Adgecko

<img src="icons/icon128-working.png" width="128" height="128" alt="Adgecko icon: a neon purple gecko head on a dark rounded square, its tongue snapping a cluster of pixel squares (an ad)">

**A Chrome extension (Manifest V3) that blocks ads on Twitch, YouTube, Kick and other websites, blocks known malware sites, and stops pages from copying shell commands into your clipboard.**<br>
Current version: 0.3.7. It runs inside Chrome (version 137 or newer): no separate program, no account.<br>
Get it: download `adgecko-0.3.7.zip` from the newest release, [Adgecko 0.3.7](https://github.com/gecko-of-shadow/adgecko/releases/tag/v0.3.7). Then load it into Chrome (see [Install](#install)).

[Features](#features) · [Install](#install) · [How to use](#how-to-use) · [Privacy and permissions](#privacy-and-permissions) · [Troubleshooting](#troubleshooting) · [Development](#development) · [License](#license-and-brand)

</div>

## Features

- ✅ Blocks video ads on Twitch, YouTube and Kick (see the limits below).
- ✅ Blocks ads on other websites with public ad lists, and hides the empty boxes that the ads leave behind.
- ✅ Blocks sites that public malware lists name as known-bad, on every page, without blocking the servers of Twitch, YouTube and Kick themselves. [Details](docs/threat-tier.md)
- ✅ Stops pages from putting a shell command into your clipboard (the "paste this into Run to verify you" trick).
- ✅ Optional pop-up guard: blocks pop-ups opened without a click (off by default).

### Limits

- ❌ Phishing pages are blocked only when a public list names them. Chrome's Safe Browsing stays your main phishing protection.
- ❌ Ads that are part of the video itself still play (for example, a sponsor read).
- ❌ On Twitch, the picture can drop to lower quality for a moment during an ad break, and an ad can still show when no ad-free copy of the stream is available.
- ❌ On Kick, some ads still play. Adgecko skips an ad only when it can do that safely.
- ❌ YouTube Music and YouTube Kids are not covered.
- ❌ YouTube videos embedded in other websites are not covered: the YouTube ad scripts run only on the YouTube site itself. On those players, only the network block rules apply.

## Install

Adgecko is not on the Chrome Web Store. You load it into Chrome yourself:

1. Get the files and unzip them. Pick one:
   - **Release zip:** `adgecko-<version>.zip` from the [latest release](https://github.com/gecko-of-shadow/adgecko/releases/latest) ([all releases](https://github.com/gecko-of-shadow/adgecko/releases)).
   - **Newest code:** the green **Code** button on this page, then **Download ZIP**. This can be newer than the last release; Chrome shows the version from `manifest.json`.
2. In Chrome, open `chrome://extensions`. If an older copy is loaded, remove it first.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and pick the unzipped folder (the one with `manifest.json` directly inside it). Keep the folder where it is: Chrome runs the extension from it.
5. Optional: click the puzzle-piece icon next to the address bar, then the pin next to **Adgecko**.

Removing the extension, or loading a copy from a different folder, forgets your allowed sites.

## How to use

It works as soon as it is installed. Click the gecko in the toolbar to open the popup.

- **Status line:** **✅ Protected**, **Allowed – not blocking here**, or **Protected – some filters off here (Fix this site)**. On YouTube and Twitch, an allowed site shows **Allowed – built-in YouTube ad blocking still runs** (or Twitch). With the ad lists off, it shows **Ad lists off – turned off in settings**.
- **Something broke?** Click **Fix this site**. It turns off the hidden ad boxes and the page guards for this site only. A line in the popup says what is off on the page and what is still on, for example the ad lists. Frames from addresses outside the tested site (frames under it follow the page) keep their own filters, and the line says so. Click **Reload page**, then answer **Did that fix it?** **Yes** keeps the fix (**Undo fix** removes it). **No** turns the filters back on and offers **Test with the ad lists off**.
- **Test with the ad lists off** is the second test. It allows this site (the same as **Allow this site**) and asks **Did that fix it?** again. The popup says what stays on, for example malware blocking and the clipboard guard, and that frames from addresses outside the tested site (frames under it follow the page) keep their own filters. **Yes** keeps the allow. **No** blocks again and tells you that these filters are likely not the cause. To rule out Adgecko fully, turn it off in `chrome://extensions` and reload the page. A test that you do not answer ends after 24 hours: Adgecko blocks the site again. Until then the popup shows **Allowed – not blocking here** with **Block again**.
- **Still broken?** Click **Allow this site**. The ad lists stop blocking what this site loads, ad boxes are no longer hidden, and the pop-up guard is off on this site. The clipboard guard stays on, known malware sites stay blocked, and the built-in Twitch and YouTube ad blocking keeps running. **Block again** undoes it. An allow counts for the whole site address and stays until you undo it. [Details](docs/allow-a-page.md)
- **Chrome says "This page has been blocked by an extension"** for a site you trust? Click the gecko, then **Chrome says the page is blocked? Allow its domain**. It opens the **Allow this domain** box on the settings page. [Details](docs/allow-a-page.md#a-page-chrome-says-is-blocked)
- **Show more** has the list status and the version. The gear opens the settings page: every switch, the per-site list, the list update button and the popup look (Automatic, Purple or High contrast).
- The popup never reloads a page by itself. Use **Reload page**.

**Toolbar icon:**

<img src="icons/icon48-working.png" width="48" height="48" alt="Toolbar icon while ordinary-site blocking is on: purple gecko, the pixel ad at its tongue lit up bright"> &nbsp; <img src="icons/icon48-off.png" width="48" height="48" alt="Toolbar icon while ordinary-site blocking is off: the same gecko in grey, pixel ad not lit">

- Purple, with the pixel "ad" lit: blocking on ordinary sites is on.
- Grey: blocking on ordinary sites is off. If only the list blocking switch is off, the Twitch, YouTube and Kick filters keep running.
- The master switch on the settings page stops every switchable feature. The vendored Twitch stream swap, the uBlock Origin YouTube scripts, the YouTube network rules and the two YouTube hide sheets keep running until you turn the extension off in `chrome://extensions`.
- A small magenta dot: a page guard blocked something on that tab. Open the popup to see what. The dot then goes away.

How the art was chosen: [docs/design](docs/design/README.md).

## Privacy and permissions

- No tracking, no account and no analytics. Settings stay in Chrome's storage in this browser.
- Every 3 hours it checks eight public filter lists over HTTPS without cookies (a real download at most every 12 hours). A fresh install downloads the lists at once, and **Update lists** on the settings page downloads them when you click it.
- The sites it contacts are `easylist.to`, `pgl.yoyo.org`, `malware-filter.gitlab.io`, `ublockorigin.github.io`, `easylist-downloads.adblockplus.org` and `secure.fanboy.co.nz` (EasyList mirrors, only if the first try fails), `raw.githubusercontent.com` (HaGeZi and Dandelion Sprout lists only) and `filters.adtidy.org`. Those sites see the list address and your IP address, not the page you visit.
- The clipboard guard checks text inside your browser only. Nothing is sent anywhere.
- Only one list comes from Curben's malware-filter project: curbengh's urlhaus-filter (abuse.ch URLhaus malware hosts, CC0). His phishing list and every OpenPhish source are not used. [Details](docs/threat-tier.md#where-the-hosts-come-from)
- On Twitch, it asks Twitch for ad-free copies of the stream. Those requests go to Twitch.
- **Permissions:** the API permissions `storage`, `declarativeNetRequest` and `alarms`, and host permissions for the list sites above only (to download the lists). The content scripts also run on all http and https websites (hide rules and page guards), so Chrome shows "Read and change all your data on all websites". Page content stays in your browser. [Site access](docs/permissions-and-privacy.md#site-access)

Full details: [docs/permissions-and-privacy.md](docs/permissions-and-privacy.md)

## Troubleshooting

- **"Allow this site" is grey?** The popup says why:
  - *Off – turned off in settings.* The master switch on the settings page is off (see "Toolbar icon" above for what keeps running).
  - *Open a normal http(s) page to allow it. Already on one? Reload it.* Chrome's own pages cannot be allowed. A normal page that was open before you installed or reloaded the extension must be reloaded.
  - *Malware blocking only – ad scripts don't run on this site.* Shown on YouTube Music, YouTube Studio, YouTube TV, YouTube Kids and youtube-nocookie pages.
- **A copy button does not copy a command?** The clipboard guard stops pages from writing commands such as `powershell ...` or `curl ... | sh`. Select the text and press Ctrl+C yourself. Documentation sites such as GitHub are trusted. Or use **Fix this site** (on an allowed site, click **Block again** first, because Allow leaves the clipboard guard on).
- **A copy lost its formatting?** Since 0.3.6, the clipboard guard copies plain text only on ordinary sites, because it writes the exact text that it checked. Trusted documentation sites keep the formatting. For formatted copies on a site, use **Fix this site**, or turn off the clipboard guard on the settings page.
- **Blocked things still missing after you allow a site?** Reload the page.
- **Loading a new copy?** Remove the old one first, then allow your sites again.

## Development

- There is no build step. From a git clone, load the repository root (the folder with `manifest.json`) with **Load unpacked**. `docs/`, `test/` and `scripts/` are not part of the running extension.
- The version is the `version` field in `manifest.json`. `scripts/pack-zip.sh` writes `adgecko-<version>.zip`, with `manifest.json`, `src/` and `icons/` at its root.
- Releases come from GitHub Actions (**Actions** -> **release** -> **Run workflow**, on `main`). The release notes are the matching `CHANGELOG.md` section.
- To update the vendored Twitch script and the uBlock Origin YouTube filters, see [docs/UPDATING-DEPENDENCIES.md](docs/UPDATING-DEPENDENCIES.md).
- The code is described in the [codebase map](.planning/codebase/README.md). Coding agents start at [CLAUDE.md](CLAUDE.md).

Tests and checks (need [Deno](https://deno.com/), Python 3, Bash and ripgrep):

```bash
deno test --no-lock --allow-read --allow-run --allow-env test/
bash scripts/release-gate.sh
bash scripts/pack-zip.sh
```

## License and brand

- The code is open source under the GNU General Public License version 3 ([LICENSE](LICENSE)). Copyright (C) 2026 gecko-of-shadow.
- Parts made by others keep their own licences: TwitchAdSolutions (MIT), uBlock Origin and uAssets (GPLv3), the EasyList authors' lists, and the other filter lists, including the one Curben list used (curbengh's urlhaus-filter: URLhaus data, CC0). Details: [docs/credits.md](docs/credits.md) and [src/rules/LICENSES.md](src/rules/LICENSES.md).
- **Brand:** the name "Adgecko" and the gecko icon are gecko-of-shadow's brand. They are not covered by the code licence: if you share a changed copy, give it your own name and icon. This is not a trademark claim beyond that.

## Links

- **Docs:** [How it works](docs/how-it-works.md) · [Allow a site](docs/allow-a-page.md) · [Permissions and privacy](docs/permissions-and-privacy.md) · [Threat tier](docs/threat-tier.md) · [Signed threat feed setup](docs/feed-setup.md) · [Updating dependencies](docs/UPDATING-DEPENDENCIES.md)
- **Project:** [Changelog](CHANGELOG.md) · [To do](TODO.md) · [Handoff](HANDOFF.md) · [Codebase map](.planning/codebase/README.md) · [Releases](https://github.com/gecko-of-shadow/adgecko/releases)
