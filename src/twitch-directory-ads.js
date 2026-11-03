// Directory display ads on Twitch. Hides the browse banner slot and in-grid
// Ad cards. Does not rewrite playback requests or the player.
function installTwitchDirectoryAds(target) {
  const BANNER_SELECTOR = '[data-a-target="browse-banner-ad-slot"]';
  const FEEDBACK_SELECTOR = 'button[aria-label="Leave feedback for this Ad"]';
  const STYLE_ID = "gk-t1"; // neutral id (no product name in the page)
  const CSS = [
    BANNER_SELECTOR,
    '[aria-label="Advertisement"]',
    FEEDBACK_SELECTOR,
  ].join(",") + "{display:none!important;}";

  // Climb from the feedback button to the ad card: stop at the first ancestor
  // whose parent holds a video or several preview cards. If no such boundary
  // is found (e.g. the ad video was blocked and the page uses category tiles,
  // as on /directory), return null instead of a page-wide container.
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
    return null;
  }

  function isPageRoot(el) {
    const tag = String(el.tagName || "").toLowerCase();
    if (tag === "html" || tag === "body" || tag === "main") return true;
    return el.id === "root" || (el.matches && el.matches('[data-a-target="root-scroller"],.root-scrollable'));
  }

  function hide(element) {
    if (!element || isPageRoot(element) || !element.style || typeof element.style.setProperty !== "function") return;
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
  // Feature switch "twitchDisplay" (src/settings/features.js): on until
  // storage says otherwise; live (storage.onChanged). Hidden cards stay hidden
  // until the next load; the sheet and the observer stop at once.
  let on = true;
  watchSwitch((next) => {
    on = next;
    if (!on && style.isConnected) style.remove();
    if (on && !style.isConnected) (document.documentElement || document.head || document).appendChild(style);
  });
  if (typeof MutationObserver !== "function") return;
  const observer = new MutationObserver(() => {
    if (on) api.hideDirectoryAds(document);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

function watchSwitch(onChange) {
  const F = typeof globalThis !== "undefined" ? globalThis.GeckoFeatures : null;
  if (!F || typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return;
  const read = () => {
    try {
      chrome.storage.local.get(["settings", "siteOverrides"], (s) => {
        void chrome.runtime.lastError;
        try {
          onChange(F.resolve(s && s.settings, s && s.siteOverrides, location.hostname).twitchDisplay !== false);
        } catch {
          // stays on
        }
      });
    } catch {
      // stays on
    }
  };
  read();
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes && (changes.settings || changes.siteOverrides)) read();
    });
  } catch {
    // no live updates
  }
}

if (typeof document !== "undefined" && typeof location !== "undefined") {
  startTwitchDirectoryAds();
}
