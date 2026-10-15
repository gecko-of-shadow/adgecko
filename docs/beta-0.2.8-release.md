This is a **beta**. It is not the stable download. v0.2.3 stays Latest.

The gecko on the toolbar is the same. While general blocking is on, its eyes glow. That glow is only a quiet “this is on” mark. It does not mean every ad is gone.

## Picture guide (beta features)

<img src="https://raw.githubusercontent.com/gecko-of-shadow/twitch-adblock/cursor/general-adblock-beta-6d96/docs/cards-beta-0.2.5/01-general-list-blocking.png" width="800" alt="General list blocking. Blocks many known ad servers on ordinary sites. This does not block every ad.">

<img src="https://raw.githubusercontent.com/gecko-of-shadow/twitch-adblock/cursor/general-adblock-beta-6d96/docs/cards-beta-0.2.5/02-hide-leftover-boxes.png" width="800" alt="Hide leftover boxes. Clears empty ad frames when the page can spare them. Some empty spots and some ads can still show.">

<img src="https://raw.githubusercontent.com/gecko-of-shadow/twitch-adblock/cursor/general-adblock-beta-6d96/docs/cards-beta-0.2.5/03-master-switch-glowing-eyes.png" width="800" alt="Master switch and glowing eyes. Eyes glow only as a quiet this is on mark. Does not turn Twitch, YouTube, or Kick playback filters off.">

<img src="https://raw.githubusercontent.com/gecko-of-shadow/twitch-adblock/cursor/general-adblock-beta-6d96/docs/cards-beta-0.2.5/04-allow-this-page.png" width="800" alt="Allow this page. Lets the open ordinary site through.">

<img src="https://raw.githubusercontent.com/gecko-of-shadow/twitch-adblock/cursor/general-adblock-beta-6d96/docs/cards-beta-0.2.5/05-update-lists.png" width="800" alt="Update lists. Manual only. In this beta it only remembers that you asked and does not download a new list yet.">

<img src="https://raw.githubusercontent.com/gecko-of-shadow/twitch-adblock/cursor/general-adblock-beta-6d96/docs/cards-beta-0.2.5/06-stream-sites-left-alone.png" width="800" alt="Stream sites stay out of the list. Twitch, YouTube, and Kick are skipped by general blocking.">

<img src="https://raw.githubusercontent.com/gecko-of-shadow/twitch-adblock/cursor/general-adblock-beta-6d96/docs/cards-beta-0.2.5/07-kick-player.png" width="800" alt="Kick player path. Site-specific Kick ad skip, not the general list. The ad may play if a skip is not safe. The general list still does not touch Kick.">

## What this beta adds

On ordinary websites:

- Many known ad servers are blocked, using a packed list (trimmed EasyList, EasyPrivacy, Peter Lowe’s list, and a malware-host list). Credit: The EasyList authors.
- Leftover ad boxes are hidden when the page can spare them. The hide stylesheet is web-accessible so the page can load it. Some empty spots and some ads can still show. This does not block every ad.
- Also blocked on ordinary sites: facebook.net, imasdk.googleapis.com, and fundingchoicesmessages.google.com. Requests from a Twitch, YouTube, or Kick frame stay allowed.
- General blocking starts **on**.
- The popup has a master on/off switch. It does not turn Twitch, YouTube, or Kick playback handling off.
- **Allow this page** lets the open ordinary site through.
- **Update lists** is on the popup. In this beta it only remembers that you asked. It does not download a new list yet. The lists in the zip are the ones that run. Nothing fetches on its own in the background.

Twitch, YouTube (including Music, Kids, and embeds), and Kick are left out of that general list, including the video addresses those players use.

YouTube in this zip includes the black-spinner fix from the stable line, and search results drop sponsored cards the same way Home does. A later playback policy is cleared the same way as the first one. Some starts still sat on a black loading screen for about 11 seconds after that, with the length already showing and the player already trying to play. This beta also clears that start-buffer wait, in the playback response and in the player response. A “Blocking ads” chip shows once per video for about 8 seconds. That chip is not the black spinner. YouTube’s own “Experiencing interruptions?” toast is removed when it appears, including when YouTube puts it back. Other toasts stay. Removing that toast does not start the picture by itself.

This zip also includes the Kick in-player ad try from beta v0.2.4: when Kick’s IVS player can jump back to the live stream, short ad breaks are skipped without muting or hiding the video. The general list still does not run on kick.com.

Debug still starts off. Copy debug still works on Twitch and YouTube, and the copied log names this build (0.2.8) instead of always saying 0.2.3.

Chrome may warn that this can block content on pages. Hiding leftover boxes also runs on ordinary sites, so Chrome may say it can change those pages. It does not run that hide on Twitch, YouTube, or Kick. The About text on the project is still gecko’s to rewrite. These notes do not replace that.

## Install

Keep scrolling for the zip under **Assets**. Download `twitch-adblock-0.2.8.zip`. Unzip it and load that folder in Chrome the same way as the stable build. You do not need the long picture guide again. This replaces the 0.2.7 beta. v0.2.3 stays the stable download.

Do not replace your stable v0.2.3 folder if you want the main download unchanged. This beta is a separate folder.
