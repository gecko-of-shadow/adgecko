// Directory display ads on Twitch. Hides the browse banner slot and in-grid
// Ad cards. Does not rewrite playback requests or the player.
function installTwitchDirectoryAds(target) {
  const BANNER_SELECTOR = '[data-a-target="browse-banner-ad-slot"]';
  const FEEDBACK_SELECTOR = 'button[aria-label="Leave feedback for this Ad"]';
  const STYLE_ID = "twitch-adblock-directory-ads";
  const CSS = [
    BANNER_SELECTOR,
    '[aria-label="Advertisement"]',
    FEEDBACK_SELECTOR,
  ].join(",") + "{display:none!important;}";

  function cardFor(node) {
    let current = node;
    for (let i = 0; i < 10 && current && current.parentElement; i++) {
      const parent = current.parentElement;
      if (parent.querySelector && parent.querySelector("video")) return current;
      const previews = parent.querySelectorAll
        ? parent.querySelectorAll('[data-a-target="preview-card-image-link"]')
        : [];
      if (previews.length > 1) return current;
      current = parent;
    }
    return current || node;
  }

  function hide(element) {
    if (!element || !element.style || typeof element.style.setProperty !== "function") return;
    if (element.querySelector && element.querySelector("video")) return;
    element.style.setProperty("display", "none", "important");
  }

  function sweep(root) {
    if (!root || typeof root.querySelectorAll !== "function") return;
    root.querySelectorAll(BANNER_SELECTOR).forEach(hide);
    root.querySelectorAll('[aria-label="Advertisement"]').forEach(hide);
    root.querySelectorAll(FEEDBACK_SELECTOR).forEach((button) => hide(cardFor(button)));
  }

  target.BANNER_SELECTOR = BANNER_SELECTOR;
  target.FEEDBACK_SELECTOR = FEEDBACK_SELECTOR;
  target.STYLE_ID = STYLE_ID;
  target.CSS = CSS;
  target.cardFor = cardFor;
  target.hideDirectoryAds = sweep;
}

function startTwitchDirectoryAds() {
  let host = "";
  try {
    host = location.hostname;
  } catch {
    return;
  }
  const name = String(host || "").toLowerCase();
  if (name !== "twitch.tv" && !name.endsWith(".twitch.tv")) return;
  const api = {};
  installTwitchDirectoryAds(api);
  const style = document.createElement("style");
  style.id = api.STYLE_ID;
  style.textContent = api.CSS;
  (document.documentElement || document.head || document).appendChild(style);
  api.hideDirectoryAds(document);
  if (typeof MutationObserver !== "function") return;
  const observer = new MutationObserver(() => api.hideDirectoryAds(document));
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

if (typeof document !== "undefined" && typeof location !== "undefined") {
  startTwitchDirectoryAds();
}
