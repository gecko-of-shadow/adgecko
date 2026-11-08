# Allow a site

[← Back to the README](../README.md)

Some websites break or refuse to work when ads are blocked. Try **Fix this site** first; if that is not enough, switch off blocking for that one website.

## Fix this site first

1. Open the website that broke and click the gecko icon in the toolbar.
2. Under **Something broke?** click **Fix this site**. This turns off only the extra filters for this site: hidden ad boxes and the page guards. Ad lists keep blocking.
3. Reload the page and look. The window asks **Did that fix it?** (for a day it still asks the next time you open it).
   - **Yes** keeps the fix.
   - **No** turns those filters back on and suggests **Allow this site**.

## Allow a website

1. Open the website you want to allow.
2. Click the gecko icon in the toolbar. A small window opens.
3. Click **Allow this site**.
4. The button now says **Block again**, and the line under the site says **Allowed – not blocking here**.
5. Reload the page, so the things that were blocked can load.

When the window opens, the site line may say **Checking this page…** for a moment while it asks the page for its address.

## What allowing changes

- On that website, the extension stops blocking from the ad lists, stops hiding ad boxes, and turns off the pop-up guard. The clipboard guard stays on.
- It counts for the whole website address (for example every page on `https://www.example.com`), not only the page you are on.
- Other addresses of the same site count separately. For example `example.com` without `www`, or `shop.example.com`. Allow each one you need.
- Chrome remembers it. It stays until you undo it.
- If you remove the extension, or load a new copy from a different folder, the allowed sites are forgotten. Allow them again.
- Known malware sites stay blocked (the threat tier). The settings page has an **Allow this domain** box for that (see below).
- On Twitch and YouTube, allowing turns off only this extension's own helpers there; their built-in ad blocking keeps running. On YouTube that includes the reload of a stuck video start. On Kick, it also stops the in-stream ad skip.

## Undo it

1. Open the same website.
2. Click the gecko icon.
3. Click **Block again**. It goes back to **Allow this site**.
4. Reload the page.

## A page Chrome says is blocked

Sometimes Chrome shows its own error page, "This page has been blocked by an extension", instead of the site. That happens when a filter list or the malware list blocks opening that site (mostly ad servers and known bad sites). The popup cannot help here: the blocked page is not a website it can see, and a typed address or bookmark has no "site you came from" to allow.

If you trust the site:

1. Click the gecko icon, then the gear (or open the extension's options) to open the settings page.
2. Under **Allow this domain**, type the site's domain (for example `example.com`, without `https://`) and click **Allow this domain**.
3. Go back to the page and reload it.

The domain and all its subdomains are then never blocked, by the filter lists or the malware list. Remove it from the same list to undo. Public suffixes (`co.uk`) and big shared platforms are refused.

## If the button is grey

If the button is grey and does nothing, the window says why, in the status line under the site name or in the line under the button. Common reasons:

- The status line says **Off – turned off in settings.** The whole extension is switched off on the settings page (the gear). Turn it on first.
- It says **Open a normal http(s) page to allow it. Already on one? Reload it.** This means one of these:
  - You are on a Chrome page, like a new tab or `chrome://extensions`. Allowing only works on normal websites.
  - The page was already open before you installed or reloaded the extension. Reload the page, then open the window again.

A copy from **Download ZIP** has the fix.

## For developers

- Why some pages give no answer: [How the popup finds the page](how-it-works.md#how-the-popup-finds-the-page).
- Where allows are kept: the `storage` and `declarativeNetRequest` rows under [Permissions](permissions-and-privacy.md#permissions).
