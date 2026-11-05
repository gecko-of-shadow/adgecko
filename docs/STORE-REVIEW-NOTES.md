# Store review notes

Read this before any browser store submission. Nothing here has been submitted or reviewed by a store.

## Vendored eval in src/vendor/video-swap-new.user.js

The file is TwitchAdSolutions video-swap-new 1.55, vendored unchanged. It holds one `eval` call that runs, at line 169. An automated store check or a reviewer may flag it.

**What it evals.** Twitch's own worker code, not code from this project and not code from any list or server of ours. The script subclasses `window.Worker` and acts only on a worker whose blob URL origin ends in `.twitch.tv`. `getWasmWorkerJs` (line 208) reads that worker's source from its blob URL with a synchronous request. A new blob worker then installs the script's playlist and fetch hooks and passes that source to `eval`.

**Where it runs.** In that page-world blob worker. `manifest.json` loads the file as a content script on twitch.tv with `"world": "MAIN"`, so it runs as page code. It has no `chrome.*` access and no extension privileges. It is not `eval` in an extension context, and the extension's own pages keep the default Manifest V3 content security policy.

**What must happen first.** This must be reviewed against the current rules of each store before any submission. These notes do not say what a store will decide. The vendored file must stay unchanged unless that review calls for it.
