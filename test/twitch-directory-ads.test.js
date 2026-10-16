import source from "../src/twitch-directory-ads.js" with { type: "text" };
import manifest from "../manifest.json" with { type: "json" };

function assert(condition, label) {
  if (!condition) throw new Error(label || "assertion failed");
}

function assertEquals(actual, expected, label) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${label || "expected equal"}\n${left}\n${right}`);
}

const api = {};
const install = new Function(`${source}\nreturn installTwitchDirectoryAds;`)();
install(api);

Deno.test("directory cosmetic targets the banner slot and grid Ad cards only", () => {
  assert(api.CSS.includes('[data-a-target="browse-banner-ad-slot"]'), "top banner slot");
  assert(api.CSS.includes("display:none!important") || api.CSS.includes("display: none !important"), "slot is hidden");
  assert(source.includes('Leave feedback for this Ad'), "grid Ad feedback control");
  assert(!source.includes("video-swap-new"), "does not edit the player script");
  assert(!source.includes("gql.twitch.tv"), "does not rewrite gql");
  assert(!/video\.pause|currentTime/.test(source), "does not drive the player");
});

Deno.test("a grid Ad card is the node above the shared stream grid", () => {
  function node(attrs, children) {
    const el = {
      attrs,
      children,
      parentElement: null,
      querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
      },
      querySelectorAll(selector) {
        const found = [];
        for (const child of this.children) {
          if (selector === '[data-a-target="preview-card-image-link"]' && child.attrs.target === "preview-card-image-link") {
            found.push(child);
          }
          if (selector === "video" && child.attrs.tag === "video") found.push(child);
          found.push(...child.querySelectorAll(selector));
        }
        return found;
      },
    };
    for (const child of children) child.parentElement = el;
    return el;
  }
  const adCard = node({ target: "ad-card" }, [node({ target: "ad-label" }, [])]);
  const stream = node({ target: "stream" }, [node({ target: "preview-card-image-link" }, [])]);
  const other = node({ target: "stream-2" }, [node({ target: "preview-card-image-link" }, [])]);
  const grid = node({ target: "grid" }, [adCard, stream, other]);
  const label = adCard.children[0];
  assert(api.cardFor(label) === adCard, "grid Ad card");
  const player = node({ tag: "video" }, []);
  const watch = node({ target: "player" }, [player, node({ target: "ad-label" }, [])]);
  assert(api.cardFor(watch.children[1]) === watch.children[1], "do not climb into the player");
});

Deno.test("manifest runs directory cosmetic on Twitch pages only", () => {
  const script = manifest.content_scripts.find((entry) => (entry.js || []).includes("src/twitch-directory-ads.js"));
  assert(script, "directory content script");
  assertEquals(script.matches.slice().sort(), ["*://*.twitch.tv/*", "*://twitch.tv/*"]);
  assertEquals(script.run_at, "document_start");
  assert(script.world !== "MAIN", "stay out of the player world");
  const general = manifest.content_scripts.find((entry) => (entry.js || []).includes("src/cosmetic.js"));
  assert((general.exclude_matches || []).includes("*://twitch.tv/*"), "full EasyList sheet stays off Twitch");
});

Deno.test("directory page: a feedback button with no card boundary never hides the page", () => {
  function node(tagName, children, id) {
    const el = { tagName, id: id || "", children, parentElement: null, hidden: false,
      style: { setProperty(k, v) { if (k === "display" && v === "none") el.hidden = true; } },
      matches() { return false; },
      querySelector(s) { return this.querySelectorAll(s)[0] || null; },
      querySelectorAll(s) {
        const out = [];
        for (const c of this.children) {
          if (s === 'button[aria-label="Leave feedback for this Ad"]' && c.tagName === "BUTTON") out.push(c);
          out.push(...c.querySelectorAll(s));
        }
        return out;
      } };
    for (const c of children) c.parentElement = el;
    return el;
  }
  const button = node("BUTTON", []);
  const tiles = node("DIV", [node("DIV", [button]), node("DIV", [])]);
  const root = node("DIV", [tiles], "root");
  const body = node("BODY", [root]);
  const html = node("HTML", [body]);
  assert(api.cardFor(button) === null, "no boundary -> no card");
  api.hideDirectoryAds(html);
  for (const el of [html, body, root, tiles]) assert(!el.hidden, `${el.tagName} must stay visible`);
});
