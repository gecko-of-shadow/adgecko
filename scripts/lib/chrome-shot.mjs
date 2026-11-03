// Render HTML to PNG with a local Chrome / Chrome for Testing over the DevTools
// protocol (no Playwright, nothing installed). Used by scripts/build-icons.mjs
// when CHROME_PATH is set, and by maintainer screenshot scripts.
//
//   const shot = await openChrome(process.env.CHROME_PATH);
//   const png = await shot.render(html, { width: 48, height: 48, transparent: true });
//   await shot.close();
//
// Node 22+ (global WebSocket). The browser runs headless with a throwaway
// profile in the OS temp folder and only ever loads the HTML it is given.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function openChrome(executablePath, extraArgs = []) {
  if (!executablePath || !fs.existsSync(executablePath)) {
    throw new Error(`Chrome not found: ${executablePath || "(CHROME_PATH not set)"}`);
  }
  if (typeof WebSocket !== "function") throw new Error("needs a global WebSocket (Node 22+)");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "gecko-shot-"));
  const proc = spawn(executablePath, [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-color-profile=srgb",
    ...extraArgs,
    "about:blank",
  ], { stdio: "ignore" });

  const portFile = path.join(profile, "DevToolsActivePort");
  let wsPath = "";
  for (let i = 0; i < 200 && !wsPath; i++) {
    await sleep(50);
    if (fs.existsSync(portFile)) {
      const [port, p] = fs.readFileSync(portFile, "utf8").split(/\r?\n/);
      if (port && p) wsPath = `ws://127.0.0.1:${port}${p}`;
    }
  }
  if (!wsPath) {
    proc.kill();
    throw new Error("Chrome did not open its DevTools port");
  }

  const ws = new WebSocket(wsPath);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error("DevTools connection failed"));
  });
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(msg.error.message));
      else res(msg.result);
    } else if (msg.method) {
      for (const l of listeners) l(msg);
    }
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((res, rej) => {
      const id = nextId++;
      pending.set(id, { res, rej });
      ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });
  const waitEvent = (method, sessionId, ms = 10000) =>
    new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`timeout waiting for ${method}`)), ms);
      listeners.push(function l(msg) {
        if (msg.method === method && (!sessionId || msg.sessionId === sessionId)) {
          clearTimeout(t);
          listeners.splice(listeners.indexOf(l), 1);
          res(msg.params);
        }
      });
    });

  async function newPage({ width, height, scale = 1, transparent = false, media = [] }) {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Page.enable", {}, sessionId);
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false }, sessionId);
    if (transparent) {
      await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } }, sessionId);
    }
    if (media.length) await send("Emulation.setEmulatedMedia", { features: media }, sessionId);
    return { targetId, sessionId };
  }

  async function render(html, { width, height, scale = 1, transparent = false, media = [] }) {
    const { targetId, sessionId } = await newPage({ width, height, scale, transparent, media });
    try {
      const { frameTree } = await send("Page.getFrameTree", {}, sessionId);
      const loaded = waitEvent("Page.loadEventFired", sessionId);
      await send("Page.setDocumentContent", { frameId: frameTree.frame.id, html }, sessionId);
      await Promise.race([loaded, sleep(1500)]);
      await sleep(50);
      const { data } = await send("Page.captureScreenshot", {
        format: "png",
        clip: { x: 0, y: 0, width, height, scale: 1 },
        captureBeyondViewport: false,
      }, sessionId);
      return Buffer.from(data, "base64");
    } finally {
      await send("Target.closeTarget", { targetId });
    }
  }

  async function close() {
    try { ws.close(); } catch { /* already closed */ }
    proc.kill();
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold a file */ }
  }

  return { render, send, waitEvent, newPage, close };
}
