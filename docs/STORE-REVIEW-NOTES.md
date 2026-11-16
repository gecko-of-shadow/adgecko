# Store review notes

Read this before any browser store submission. Nothing here has been submitted or reviewed by a store.

## Vendored eval in src/vendor/video-swap-new.user.js

The file is TwitchAdSolutions video-swap-new 1.55, vendored unchanged. It holds one `eval` call that runs, at line 169. An automated store check or a reviewer may flag it.

**What it evals.** Twitch's own worker code, not code from this project and not code from any list or server of ours. The script subclasses `window.Worker` and acts only on a worker whose blob URL origin ends in `.twitch.tv`. `getWasmWorkerJs` (line 208) reads that worker's source from its blob URL with a synchronous request. A new blob worker then installs the script's playlist and fetch hooks and passes that source to `eval`.

**Where it runs.** In that page-world blob worker. `manifest.json` loads the file as a content script on twitch.tv with `"world": "MAIN"`, so it runs as page code. It has no `chrome.*` access and no extension privileges. It is not `eval` in an extension context, and the extension's own pages keep the default Manifest V3 content security policy.

**What must happen first.** This must be reviewed against the current rules of each store before any submission. These notes do not say what a store will decide. The vendored file must stay unchanged unless that review calls for it.

## Host access: content scripts on all websites

`host_permissions` in `manifest.json` names only the nine filter list hosts. But three `content_scripts` entries match `http://*/*` and `https://*/*`, and Chrome counts content-script matches as host access. Thus Chrome shows "Read and change all your data on all websites", and a store dashboard can ask for a host-permission justification.

**Why the extension needs it.** These scripts do the work on ordinary websites (Twitch, YouTube and Kick are excluded from these entries):

- `src/cosmetic.js` hides leftover ad boxes with the packed and downloaded hide rules. It also tells the popup the origin of the page, because the manifest does not request `tabs` or `activeTab`.
- `src/settings/flags.js` gets the per-site on/off switches.
- `src/guards/clipboard.js` and `src/guards/popups.js` run in the page (`"world": "MAIN"`, all frames). They stop a page from writing a shell command into the clipboard, and (when the user turns it on) they block pop-ups that open without a click.

A blocker cannot know before a page loads which pages have ads or a clipboard trick, so the scripts must match all http and https pages.

**What the scripts do not do.** They do not send page content, the page address or the clipboard text to a server. They send messages only to the extension's own service worker and popup. The only network requests of the extension go to the filter list hosts (and, once it is set up, the one signed threat feed host). See [permissions-and-privacy.md](permissions-and-privacy.md#site-access).

**Draft justification text (UNVERIFIED against the current store rules):** "Adgecko hides ad elements and blocks clipboard hijacking and unwanted pop-ups on the websites the user visits. Its content scripts must run on all http and https pages for this. They process the page only locally and send no page data to any server."

**What must happen first.** Review this text against the current rules of each store before any submission, as for the vendored eval above.
