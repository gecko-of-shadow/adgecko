# Allow a site

[← Back to the README](../README.md)

Some websites break or refuse to work when ads are blocked. Try **Fix this site** first; if that is not enough, switch off blocking for that one website.

## Fix this site first

1. Open the website that broke and click the gecko icon in the toolbar.
2. Under **Something broke?** click **Fix this site**. This turns off only the extra filters for this site: hidden ad boxes and the page guards. Ad lists keep blocking.
3. Reload the page and look. The window asks **Did that fix it?** (it still asks the next time you open it).
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

- On that website, the extension stops blocking from the ad lists and stops hiding ad boxes.
- It counts for the whole website address (for example every page on `https://www.example.com`), not only the page you are on.
- Other addresses of the same site count separately. For example `example.com` without `www`, or `shop.example.com`. Allow each one you need.
- Chrome remembers it. It stays until you undo it.
- If you remove the extension, or load a new copy from a different folder, the allowed sites are forgotten. Allow them again.
- Known malware sites stay blocked (the threat tier). The settings page has an **Allow this domain** box for that.
- On Twitch, YouTube and Kick, allowing turns off only this extension's own helpers there; their built-in ad blocking always keeps running.

## Undo it

1. Open the same website.
2. Click the gecko icon.
3. Click **Block again**. It goes back to **Allow this site**.
4. Reload the page.

## If the button is grey

If the button is grey and does nothing, the line under it says why. Common reasons:

- The status line says **Off – turned off in settings.** The whole extension is switched off on the settings page (the gear). Turn it on first.
- It says **Open a normal http(s) page to allow it. Already on one? Reload it.** This means one of these:
  - You are on a Chrome page, like a new tab or `chrome://extensions`. Allowing only works on normal websites.
  - The page was already open before you installed or reloaded the extension. Reload the page, then open the window again.

The 0.2.21 zip came out before the "Allow this page" fix, so in that copy the button always stays grey. A copy from **Download ZIP** has the fix.

## For developers

- Why some pages give no answer: [How the popup finds the page](how-it-works.md#how-the-popup-finds-the-page).
- Where allows are kept: the `storage` and `declarativeNetRequest` rows under [Permissions](permissions-and-privacy.md#permissions).
