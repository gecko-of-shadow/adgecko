# Allow a page

[← Back to the README](../README.md)

Some websites break or refuse to work when ads are blocked. You can switch off blocking for one website.

## Allow a website

1. Open the website you want to allow.
2. Click the gecko icon in the toolbar. A small window opens.
3. Click **Allow this page**.
4. The button now says **Blocking this page** and is highlighted. That label means the site is now allowed. The line under it says **Allowed for this site:** and the site address.
5. Reload the page, so the things that were blocked can load.

When the window opens, the line under the button may say **Checking this page…** for a moment while it asks the page for its address.

## What allowing changes

- On that website, the extension stops blocking from the ad lists and stops hiding ad boxes.
- It counts for the whole website address (for example every page on `https://www.example.com`), not only the page you are on.
- Other addresses of the same site count separately. For example `example.com` without `www`, or `shop.example.com`. Allow each one you need.
- Chrome remembers it. It stays until you undo it.
- If you remove the extension, or load a new copy from a different folder, the allowed sites are forgotten. Allow them again.
- Twitch, YouTube, and Kick are not affected. Their ad filters always keep running.

## Undo it

1. Open the same website.
2. Click the gecko icon.
3. Click **Blocking this page**. It goes back to **Allow this page**.
4. Reload the page.

## If the button is grey

If the button is grey and does nothing, the line under it says why. Common reasons:

- It says **Turn general blocking on to change page allows.** The **Block ads on ordinary sites** switch in the same window is off. Turn it on first.
- It says **Open a normal http(s) page to allow it. Already on one? Reload it.** This means one of these:
  - You are on Twitch, YouTube, or Kick. Allowing does not work there.
  - You are on a Chrome page, like a new tab or `chrome://extensions`. Allowing only works on normal websites.
  - The page was already open before you installed or reloaded the extension. Reload the page, then open the window again.

The 0.2.21 zip came out before the "Allow this page" fix, so in that copy the button always stays grey. A copy from **Download ZIP** has the fix.

## For developers

- Why some pages give no answer: [How the popup finds the page](how-it-works.md#how-the-popup-finds-the-page).
- Where allows are kept: the `storage` and `declarativeNetRequest` rows under [Permissions](permissions-and-privacy.md#permissions).
