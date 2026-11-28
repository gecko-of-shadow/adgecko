# Allow a site

[← Back to the README](../README.md)

Some websites break or refuse to work when ads are blocked. Try **Fix this site** first; if that is not enough, switch off blocking for that one website.

## Fix this site first

1. Open the website that broke and click the gecko icon in the toolbar.
2. Under **Something broke?** click **Fix this site**. This turns off only the extra filters for this site: hidden ad boxes and the page guards. Ad lists keep blocking. The window says this under the question.
3. Click **Reload page** in the window and look at the page. The window asks **Did that fix it?** (for a day it still asks the next time you open it).
   - **Yes** keeps the fix.
   - **No** turns those filters back on. On an ordinary site with the ad lists on, the window then offers **Test with the ad lists off** (see below). On YouTube and Twitch, or with the ad lists off, it suggests **Allow this site**.
4. While a kept fix is in force, the line under the site says **Protected – some filters off here (Fix this site)**, and the window shows **Undo fix** in place of **Fix this site**. Click **Undo fix** to turn those filters back on, then click **Reload page**. The settings page lists the site as **Fixed** with the same **Undo fix** button.

## Then test with the ad lists off

Use this when you are not sure that Adgecko causes the problem.

1. After **No**, click **Test with the ad lists off**. This allows the site (the same as **Allow this site** below) and asks **Did that fix it?** again.
2. The window says what is off on the page now, normally the ad lists, ad box hiding and the pop-up guard. It also says what stays on, normally malware blocking and the clipboard guard. The line follows your switches: a filter that you turned off before the test is never named as on. Frames from addresses outside the tested site (frames under it follow the page), for example a sign-in or captcha frame, keep their own filters, and the window says so.
3. Click **Reload page** and look at the page.
   - **Yes** keeps the allow. The site then shows **Allowed – not blocking here**, and **Block again** undoes it.
   - **No** blocks the site again. The window says that these filters are likely not the cause on the page itself, and that frames from addresses outside the tested site (frames under it follow the page) kept their filters. Adgecko's page scripts stay in the page while it is on, also on an allowed site. To rule out Adgecko fully, turn it off in `chrome://extensions`, reload the page, and turn it on again after the test.
4. A test that you do not answer ends after 24 hours: Adgecko blocks the site again. Until then the window shows **Allowed – not blocking here** and **Block again**. Adgecko checks at browser start, every 3 hours and when you open the window, so the end can come up to about 3 hours late if you do not open the window. If you want to keep the site allowed, answer **Yes**, or use **Allow this site**.

## Allow a website

1. Open the website you want to allow.
2. Click the gecko icon in the toolbar. A small window opens.
3. Click **Allow this site**.
4. The button now says **Block again**, and the line under the site says **Allowed – not blocking here**. On YouTube and Twitch the line says **Allowed – built-in YouTube ad blocking still runs** (or Twitch), because the site's own ad blocking does not stop for an Allow.
5. Click **Reload page** under the button, so the things that were blocked can load. The window never reloads the page by itself.

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
4. Click **Reload page**.

The settings page (the gear) lists each allowed site as **Allowed – not blocking here**, with a **Block again** button that does the same.

## A page Chrome says is blocked

Sometimes Chrome shows its own error page, "This page has been blocked by an extension", instead of the site. That happens when a filter list or the malware list blocks opening that site (mostly ad servers and known bad sites). **Allow this site** cannot help here: the blocked page is not a website the popup can see, and a typed address or bookmark has no "site you came from" to allow.

If you trust the site:

1. Click the gecko icon, then **Chrome says the page is blocked? Allow its domain**. The settings page opens with the cursor in the **Allow this domain** box. (The gear opens the same settings page.)
2. Type the site's domain (for example `example.com`), or paste the whole address: the extension keeps only the domain. Click **Allow this domain**.
3. Go back to the page and reload it.

The domain and all its subdomains are then never blocked, by the filter lists or the malware list. Remove it from the same list to undo. Public suffixes (`co.uk`) and big shared platforms are refused.

## If the button is grey

If the button is grey and does nothing, the window says why, in the status line under the site name or in the line under the button. Common reasons:

- The status line says **Off – turned off in settings.** The whole extension is switched off on the settings page (the gear). Turn it on first.
- It says **Open a normal http(s) page to allow it. Already on one? Reload it.** This means one of these:
  - You are on a Chrome page, like a new tab or `chrome://extensions`. Allowing only works on normal websites.
  - The page was already open before you installed or reloaded the extension. Reload the page, then open the window again.

## For developers

- Why some pages give no answer: [How the popup finds the page](how-it-works.md#how-the-popup-finds-the-page).
- Where allows are kept: the `storage` and `declarativeNetRequest` rows under [Permissions](permissions-and-privacy.md#permissions).
