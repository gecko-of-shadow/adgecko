// Isolated-world bridge for the temporary debug popup.
// Playback hooks stay in the page world and do not call chrome.*.
(function () {
  const SOURCE = "twitch-adblock-debug";

  window.addEventListener("message", (event) => {
    try {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== SOURCE || data.type !== "state") return;
      const text = typeof data.text === "string" ? data.text.slice(0, 20000) : "";
      chrome.runtime.sendMessage({
        source: SOURCE,
        type: "state",
        on: data.on === true,
        text,
        version: typeof data.version === "string" ? data.version.slice(0, 16) : "",
        host: location.hostname,
        gen: data.gen,
      }, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      // The popup can be closed. Playback does not depend on this bridge.
    }
  });

  function packagedVersion() {
    try {
      const version = chrome.runtime.getManifest().version;
      return typeof version === "string" ? version : "";
    } catch {
      return "";
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    try {
      if (!message || message.source !== SOURCE) return;
      if (message.type !== "set" && message.type !== "get") return;
      window.postMessage({
        source: SOURCE,
        type: message.type,
        on: message.on === true,
        gen: message.gen,
        version: packagedVersion(),
      }, "*");
    } catch {
      // Ignore a popup message the page cannot see yet.
    }
  });
})();
