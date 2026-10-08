(function () {
  const SOURCE = "twitch-adblock-debug";
  const status = document.getElementById("status");
  const onButton = document.getElementById("debug-on");
  const offButton = document.getElementById("debug-off");
  const copyButton = document.getElementById("copy-debug");
  let generation = 0;
  let latest = null;

  function render(state) {
    latest = state;
    if (!state) {
      status.textContent = "Open a Twitch or YouTube tab, then try again.";
      onButton.setAttribute("aria-pressed", "false");
      offButton.setAttribute("aria-pressed", "true");
      return;
    }
    const where = state.host ? " on " + state.host : "";
    status.textContent = state.on
      ? "Debug is ON" + where + ". Copy keeps the log on this device."
      : "Debug is OFF" + where + ". Playback is unchanged.";
    onButton.setAttribute("aria-pressed", state.on ? "true" : "false");
    offButton.setAttribute("aria-pressed", state.on ? "false" : "true");
  }

  chrome.runtime.onMessage.addListener((message) => {
    try {
      if (!message || message.source !== SOURCE || message.type !== "state") return;
      if (message.gen !== generation) return;
      if (!latest || (message.text || "").length >= (latest.text || "").length) render(message);
    } catch {
      status.textContent = "Debug popup hit an error. Playback is unchanged.";
    }
  });

  function send(type, on) {
    const gen = ++generation;
    latest = null;
    status.textContent = "Checking this tab…";
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      void chrome.runtime.lastError;
      const tab = tabs && tabs[0];
      if (!tab || tab.id == null) {
        if (gen === generation) render(null);
        return;
      }
      // Top frame only: the player lives there, and child frames keep their own rings.
      chrome.tabs.sendMessage(tab.id, { source: SOURCE, type, on: on === true, gen }, { frameId: 0 }, () => {
        void chrome.runtime.lastError;
      });
      setTimeout(() => {
        if (gen === generation && !latest) render(null);
      }, 400);
    });
  }

  function copyText() {
    if (latest && latest.text) return latest.text;
    return "twitch-adblock 0.1.19 debug\non=false\n(no events)";
  }

  function markCopied(ok) {
    status.textContent = ok ? "Copied debug log." : "Could not copy. Playback is unchanged.";
  }

  onButton.addEventListener("click", () => send("set", true));
  offButton.addEventListener("click", () => send("set", false));
  copyButton.addEventListener("click", () => {
    const text = copyText();
    const done = navigator.clipboard && navigator.clipboard.writeText
      ? navigator.clipboard.writeText(text)
      : Promise.reject();
    done.then(() => markCopied(true)).catch(() => {
      try {
        const area = document.createElement("textarea");
        area.value = text;
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand("copy");
        area.remove();
        markCopied(ok);
      } catch {
        markCopied(false);
      }
    });
  });

  send("get");
})();
