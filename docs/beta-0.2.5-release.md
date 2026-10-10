This is a **beta**. It is not the stable download. v0.2.3 stays Latest.

The gecko on the toolbar is the same. While general blocking is on, its eyes glow. That glow is only a quiet “this is on” mark. It does not mean every ad is gone.

## What this beta adds

On ordinary websites:

- Many known ad servers are blocked, using a packed list (trimmed EasyList, EasyPrivacy, Peter Lowe’s list, and a malware-host list). Credit: The EasyList authors.
- Leftover ad boxes are hidden when the page can spare them. Some empty spots and some ads can still show. This does not block every ad.
- General blocking starts **on**.
- The popup has a master on/off switch. It does not turn Twitch or YouTube ad handling off.
- **Allow this page** lets the open ordinary site through.
- **Update lists** is on the popup. In this beta it only remembers that you asked. It does not download a new list yet. The lists in the zip are the ones that run. Nothing fetches on its own in the background.

Twitch, YouTube (including Music, Kids, and embeds), and Kick are left out of that general list, including the video addresses those players use. Twitch and YouTube in this zip match the stable build. Their scripts were not edited.

This zip does **not** include the Kick player try from beta v0.2.4. If you want that Kick try, keep the older beta zip. kick.com is still skipped by the new list.

Debug still starts off. Copy debug still works on Twitch and YouTube.

Chrome may warn that this can block content on pages. Hiding leftover boxes also runs on ordinary sites, so Chrome may say it can change those pages. It does not run that hide on Twitch, YouTube, or Kick. The About text on the project is still gecko’s to rewrite. These notes do not replace that.

## What it should be able to do later

- Pressing **Update lists** should bring in a fresh list, still only when you ask.
- The Kick player try from v0.2.4 can come back in a later beta, still without the general list touching Kick.
- Leftover-box hiding can get better. It still will not be a promise that every ad is gone.
- The safety sentences on the main page can be rewritten once gecko picks the words.

## Install

Keep scrolling for the zip under **Assets**. Download `twitch-adblock-0.2.5.zip`. Unzip it and load that folder in Chrome the same way as the stable build. You do not need the long picture guide again.

Do not replace your stable v0.2.3 folder if you want the main download unchanged. This beta is a separate folder.
