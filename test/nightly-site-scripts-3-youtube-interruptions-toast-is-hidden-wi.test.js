// Repro: removeInterruptionsToast hides YouTube's singleton tp-yt-paper-toast#toast
// with hidden=true and inline display:none!important and never undoes it, so a
// later "Saved to Watch later" / "Link copied" message put into the same element
// stays invisible for the rest of the session (the CSS path uses :has() and
// re-evaluates; the JS path does not).
import source from "../src/youtube.js" with { type: "text" };
import { unwrapMain } from "./fixtures/main-source.mjs";

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

const api = {};
const installYoutubeAdblock = new Function(`${unwrapMain(source)}\nreturn installYoutubeAdblock;`)();
installYoutubeAdblock(api);

function matchesOne(node, selector) {
  if (selector === "yt-notification-action-renderer") return node.tag === "yt-notification-action-renderer";
  if (selector === "tp-yt-paper-toast") return node.tag === "tp-yt-paper-toast";
  if (selector === "tp-yt-paper-toast#toast") return node.tag === "tp-yt-paper-toast" && node.id === "toast";
  if (selector === "tp-yt-paper-toast.toast-button") {
    return node.tag === "tp-yt-paper-toast" && String(node.className).split(/\s+/).includes("toast-button");
  }
  const href = selector.match(/^a\[href\*="([^"]+)"\]$/);
  return Boolean(href && node.tag === "a" && String(node.href || "").includes(href[1]));
}
function matchesList(node, selector) {
  return String(selector).split(",").some((part) => matchesOne(node, part.trim()));
}
function walkNodes(node, out) {
  for (const child of node.children || []) {
    out.push(child);
    walkNodes(child, out);
  }
}
function el(tag, props) {
  const node = {
    nodeType: 1, tag, id: props.id || "", className: props.className || "",
    textContent: props.text || "", href: props.href || "",
    children: props.children || [], parent: null,
  };
  for (const child of node.children) child.parent = node;
  node.matches = (s) => matchesList(node, s);
  node.closest = (s) => {
    let c = node;
    while (c) { if (c.matches && c.matches(s)) return c; c = c.parent; }
    return null;
  };
  node.querySelector = (s) => { const all = []; walkNodes(node, all); return all.find((i) => matchesList(i, s)) || null; };
  node.querySelectorAll = (s) => { const all = []; walkNodes(node, all); return all.filter((i) => matchesList(i, s)); };
  node.hidden = false;
  const props2 = {};
  node.style = {
    setProperty(name, value, priority) { props2[name] = { value, priority }; },
    removeProperty(name) { const had = props2[name]; delete props2[name]; return had ? had.value : ""; },
    getPropertyValue(name) { return props2[name] ? props2[name].value : ""; },
  };
  return node;
}

Deno.test("a reused #toast shows the next message after the interruptions toast was hidden", () => {
  // YouTube's singleton toast element.
  const toast = el("tp-yt-paper-toast", { id: "toast", text: "Experiencing interruptions?" });
  const popup = el("ytd-popup-container", { children: [toast] });

  api.removeInterruptionsToast(popup);
  assert(toast.hidden === true, "precondition: the interruptions toast is hidden");
  assert(toast.style.getPropertyValue("display") === "none", "precondition: inline display:none");

  // User clicks Save to Watch later: YouTube reuses the same element.
  toast.textContent = "Saved to Watch later";
  // Later cosmeticSweep (observer / yt-navigate-finish).
  api.removeInterruptionsToast(popup);

  assert(!api.isInterruptionsToast(toast), "the reused toast is no longer the interruptions toast");
  assert(toast.hidden !== true, "the Saved toast must not stay hidden (hidden attribute still set)");
  assert(toast.style.getPropertyValue("display") !== "none",
    "the Saved toast must not keep inline display:none!important");
  assert(toast.style.getPropertyValue("pointer-events") !== "none",
    "the Saved toast must not keep inline pointer-events:none!important");
});
