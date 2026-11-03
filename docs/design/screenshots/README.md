# Popup and settings screenshots (2026-11-03)

Real screenshots for review, not mockups. Taken in Chrome for Testing 155
(headless, 1x scale) with the unpacked extension from this branch:

- a local test page was served as `http://example.test:<port>/` (a
  host-resolver rule pointed `example.test` at 127.0.0.1; no real site was
  opened);
- the **real toolbar popup** was opened with `chrome.action.openPopup()` from
  the extension's own service worker, so it found the site through its
  content script exactly as it does for a person;
- each state was reached through the extension's own storage keys and by
  clicking the popup's own buttons; nothing in the popup was stubbed;
- forced colours and `prefers-contrast: more` were emulated with the DevTools
  protocol (`Emulation.setEmulatedMedia`). In forced-colours mode Chrome used
  its default light system palette (Canvas white, CanvasText black); a real
  Windows contrast theme supplies its own colours.

The popup is 300 px wide. Files are named `popup-<state>-<theme>.png`.

## States

| State | What it shows |
|---|---|
| `protected` | Normal page: "✅ Protected", Something broke? card with Fix this site, Allow this site, folded Show more. |
| `first-open` | The one-time "You're protected" card (shown on the very first open only). |
| `allowed` | After Allow this site: "Allowed – not blocking here", **Block again**, Fix disabled with its note. |
| `fix-asked` | After Fix this site: "Did that fix it? Reload the page and look." with Yes / No (Yes has keyboard focus). |
| `show-more` | Show more unfolded: list status, threat feed status, version, EasyList credit. |
| `extension-off` | Whole extension switched off in settings: grey icon, "Off – turned off in settings", buttons disabled. |
| `alert` | The magenta-dot state: a page guard blocked a clipboard command on this tab; Show more says what was blocked (opening the popup clears the dot on the toolbar icon, which is not part of the popup). |

## Themes

| Suffix | Theme |
|---|---|
| `-purple` | Purple (default), "Popup look" = Purple. |
| `-contrast` | High contrast picked by hand ("Popup look" = High contrast): white gecko, yellow buttons with a white ring. |
| `-forced` | "Popup look" = Automatic with forced colours emulated: system colours. |

Also:

| File | What it shows |
|---|---|
| `probe-prefers-contrast-auto.png` | "Automatic" + `prefers-contrast: more`: high contrast turns on by itself. |
| `probe-prefers-contrast-purple-picked.png` | "Purple" picked + `prefers-contrast: more`: stays purple (an explicit choice wins). |
| `settings-purple.png`, `settings-contrast.png`, `settings-forced.png` | The settings page (gear) in the same three themes. |

No personal data: the only site is the fake `example.test`.
