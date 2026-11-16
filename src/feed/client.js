// Signed threat feed client: fetch, verify, apply as DNR session rules.
// DORMANT until configured (src/feed/config.js FEED_ORIGIN, src/feed/keys.js
// FEED_KEYS, and the origin in manifest host_permissions): then it does
// nothing at all and the packed `threat` ruleset is the threat tier.
//
// Data only: the feed can add block rules at 2,000,010 (never on protected
// stream hosts), drop them, kill them, or roll back; it can never run code.
// Dependencies are injected (the worker passes chrome-backed ones; tests pass
// fakes). Session rules are cleared on browser exit and extension update, so
// applyCached() runs at every worker start and on install. A worker wake
// with the right rules already in place writes nothing (review 2026-11-16
// WP-20).
(function (root) {
  const FETCH_TIMEOUT_MS = 15000;
  const SIG_CAP = 1024;
  const STATE_KEY = "feedState"; // small; the popup reads it
  const CACHE_KEY = "feedCache"; // verified bytes; worker only
  const PAUSE_KEY = "feedPaused"; // local "Pause threat feed" switch

  const C = () => root.GeckoFeedCanonical;
  const V = () => root.GeckoFeedVerify;
  const S = () => root.GeckoFeedSchema;
  const K = () => root.GeckoFeedCompile;

  // -> { ok: true, origin } or { ok: false, reason }
  function configured(deps) {
    const cfg = deps.config || {};
    const origin = cfg.FEED_ORIGIN || "";
    if (!origin) return { ok: false, reason: "no feed host set" };
    let u;
    try {
      u = new URL(origin);
    } catch {
      return { ok: false, reason: "FEED_ORIGIN is not a URL" };
    }
    if (u.protocol !== "https:" || u.origin !== origin) return { ok: false, reason: "FEED_ORIGIN must be a bare https origin" };
    if (!Object.keys((deps.keys && deps.keys.feedKeys) || {}).length) return { ok: false, reason: "no feed key pinned" };
    const hosts = ((deps.manifest && deps.manifest()) || {}).host_permissions || [];
    if (!hosts.includes(origin + "/*")) return { ok: false, reason: "feed host missing from manifest host_permissions" };
    return { ok: true, origin };
  }

  // Reads the body as a stream and stops (cancels) as soon as it passes the
  // cap, so a chunked body without Content-Length cannot fill memory (L-8).
  async function readCapped(res, cap, path) {
    const reader = res.body && typeof res.body.getReader === "function" ? res.body.getReader() : null;
    if (!reader) {
      const whole = new Uint8Array(await res.arrayBuffer());
      if (whole.length > cap) throw new Error(path + ": larger than " + cap + " bytes");
      return whole;
    }
    const parts = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > cap) {
        try {
          await reader.cancel();
        } catch {
          // already closed
        }
        throw new Error(path + ": larger than " + cap + " bytes");
      }
      parts.push(value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }

  async function fetchCapped(deps, origin, path, cap) {
    const url = origin + path;
    if (!url.startsWith("https://")) throw new Error("feed URL must be https");
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), deps.timeoutMs || FETCH_TIMEOUT_MS) : 0;
    try {
      // redirect "error": no redirect at all, so never to another host.
      const res = await deps.fetch(url, { cache: "no-store", credentials: "omit", redirect: "error", signal: ctrl ? ctrl.signal : undefined });
      if (!res || !res.ok) throw new Error(path + ": HTTP " + (res && res.status));
      if (res.url && new URL(res.url).origin !== origin) throw new Error(path + ": answered from another origin");
      const len = Number(res.headers && res.headers.get && res.headers.get("Content-Length"));
      if (len > cap) throw new Error(path + ": larger than " + cap + " bytes");
      return await readCapped(res, cap, path);
    } catch (e) {
      if (e && (e.name === "AbortError" || /abort/i.test(String(e.message)))) throw new Error(path + ": timeout");
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async function feedRuleIds(deps) {
    const rules = (await deps.getSessionRules()) || [];
    return rules.filter((r) => K().isFeedRuleId(r.id)).map((r) => r.id);
  }

  // Atomic replace of every feed session rule (one updateSessionRules call).
  async function replaceRules(deps, addRules) {
    const removeRuleIds = await feedRuleIds(deps);
    await deps.updateSessionRules({ removeRuleIds, addRules });
  }

  async function removeFeedRules(deps) {
    const removeRuleIds = await feedRuleIds(deps);
    if (removeRuleIds.length) await deps.updateSessionRules({ removeRuleIds, addRules: [] });
    return removeRuleIds.length;
  }

  function verifyOpts(deps, extra) {
    return Object.assign({
      feedKeys: deps.keys.feedKeys, killKeys: deps.keys.killKeys || {}, now: deps.now(),
      extensionVersion: deps.extensionVersion, protectedReason: deps.protectedReason,
    }, extra);
  }

  // Re-verify a cached entry ({ bytes (base64), sig }) without the serial
  // check; null when it no longer verifies or has expired.
  async function verifyCached(deps, entry) {
    if (!entry || !entry.bytes || !entry.sig) return null;
    let bytes;
    try {
      bytes = C().base64ToBytes(entry.bytes);
    } catch {
      return null;
    }
    const r = await V().verifyFeed(bytes, entry.sig, verifyOpts(deps, { storedSerial: 0 }));
    return r.ok && r.kind === "feed" ? r.doc : null;
  }

  const entryOf = (bytes, sig, doc) => ({ serial: doc.serial, bytes: C().bytesToBase64(bytes), sig, notAfter: doc.notAfter });

  async function setState(deps, patch) {
    try {
      await deps.setState(patch);
    } catch {
      // the next check writes again
    }
  }

  // Kill latch (security review M-4): a document signed by the KILL key stops
  // the feed until the extension itself is updated (an update can ship new
  // pinned keys). Until then nothing is fetched and no feed-key document is
  // accepted, so a stolen feed key cannot switch a killed feed back on. A
  // feed's own killFeed flag is not a latch (a later feed may lift it).
  function latched(st, deps) {
    return !!(st && st.killLatch && st.killedVersion === (deps.extensionVersion || ""));
  }
  const RELEASED = { killLatch: false, killed: false, killedVersion: "", lastError: "kill switch released by an extension update" };

  // Key rotation (review 2026-11-16 WP-11). The stored serial (and kill
  // serial) is bound to the key that signed it (serialKeyId, killSerialKeyId).
  // When an extension update removes that key from the pinned list, the
  // serial starts again at 0 and the saved files are dropped: else a serial at
  // the cap (2^31-1: a stolen key or a typo) refuses every file from the new
  // key for ever. A removed key cannot sign any more, so the reset gives it
  // nothing. While the key is still pinned, nothing is reset (also not when a
  // kill latch is released), so files signed before a kill stay refused.
  // State without a key id (older state) is not reset either.
  const hasKey = (keys, id) => !!id && Object.prototype.hasOwnProperty.call(keys || {}, id);
  async function forgetRemovedKeys(deps, st) {
    const patch = {};
    let note = "";
    if (st.serialKeyId && !hasKey(deps.keys.feedKeys, st.serialKeyId)) {
      Object.assign(patch, { serial: 0, appliedSerial: 0, notBefore: "", notAfter: "", serialKeyId: "", lastDocHash: "", lastDocNote: "" });
      note = "feed key " + st.serialKeyId + " is no longer pinned; serial reset";
      try {
        await deps.setCache({ current: null, previous: null });
      } catch {
        // the old files no longer verify anyway (unknown key id)
      }
    }
    if (st.killSerialKeyId && !hasKey(deps.keys.killKeys, st.killSerialKeyId)) {
      Object.assign(patch, { killSerial: 0, killSerialKeyId: "" });
      note = (note ? note + "; " : "") + "kill key " + st.killSerialKeyId + " is no longer pinned; kill serial reset";
    }
    if (!note) return st;
    patch.lastError = note;
    await setState(deps, patch);
    return Object.assign({}, st, patch);
  }

  // The packaged snapshot (src/rules/threat-snapshot.json) as rules.
  async function snapshotRules(deps) {
    const snap = await deps.loadSnapshot();
    const doc = S().validateSnapshot(snap, { protectedReason: deps.protectedReason });
    return K().compileFeed(Object.assign({ killFeed: false, dropRuleIds: [] }, doc)).rules;
  }

  // The snapshot is built from the packed threat set. When the user switched
  // the threat tier off, it is not used as the fallback (review 2026-11-16
  // WP-20): else the hosts the user switched off are blocked again.
  // deps.snapshotAllowed is optional (absent = allowed).
  async function snapshotAllowed(deps) {
    if (typeof deps.snapshotAllowed !== "function") return true;
    try {
      return (await deps.snapshotAllowed()) !== false;
    } catch {
      return true;
    }
  }

  // The rules applyCached() installs for a saved entry: its own rules, else
  // the snapshot (when allowed), else none.
  async function fallbackRules(deps, entry) {
    const doc = await verifyCached(deps, entry);
    if (doc) return K().compileFeed(doc).rules;
    return (await snapshotAllowed(deps)) ? snapshotRules(deps) : [];
  }

  // Cache write after the rule swap (review 2026-11-16 WP-20). When it throws
  // (QUOTA_BYTES), put back the rules of the saved file, so the live rules
  // match the cache and the state. Else the next worker start re-applies the
  // saved file and the live rules flip back without a record.
  async function commitCache(deps, next, cache) {
    try {
      await deps.setCache(next);
    } catch (e) {
      try {
        await replaceRules(deps, await fallbackRules(deps, cache.current));
      } catch {
        // the next check or worker start tries again
      }
      throw e;
    }
  }

  // SHA-256 (hex) of the file bytes and the signature text. Identifies the
  // last file that this client accepted (also a rollback document).
  async function sha256Hex(data) {
    const d = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
    return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  function docHash(bytes, sigText) {
    const sig = new TextEncoder().encode("\n" + sigText);
    const all = new Uint8Array(bytes.length + sig.length);
    all.set(bytes, 0);
    all.set(sig, bytes.length);
    return sha256Hex(all);
  }
  // Fingerprint of a saved cache entry (as stored: base64 bytes + sig).
  const entryHash = (entry) => entry && entry.bytes && entry.sig ? sha256Hex(new TextEncoder().encode(entry.bytes + "\n" + entry.sig)) : Promise.resolve("");

  // Worker wake (review 2026-11-16 WP-20): session rules survive a worker
  // restart. When the state says that the right rules are in place for this
  // extension version, the feed rule count matches and (for a feed file) the
  // saved file has the fingerprint of the applied one, applyCached() writes
  // nothing (no signature check, no rule swap, no state write). A browser
  // restart or an update clears the session rules or changes the version,
  // so the full path runs then. A saved file that expired since, or a
  // threat tier switch, also takes the full path.
  async function alreadyApplied(deps, st) {
    if (!st.appliedVersion || st.appliedVersion !== (deps.extensionVersion || "")) return false;
    if (st.status !== "active" && st.status !== "killed") return false;
    const count = (await feedRuleIds(deps)).length;
    if (count !== (st.ruleCount || 0)) return false;
    if (st.source === "feed") {
      const na = st.notAfter ? Date.parse(st.notAfter) : NaN;
      if (!(Number.isFinite(na) && deps.now() < na)) return false;
      // The saved file must still be the one that was applied (no change
      // and no damage since): else the full path verifies it again.
      const cur = ((await deps.getCache()) || {}).current;
      return !!st.appliedHash && (await entryHash(cur)) === st.appliedHash;
    }
    if (st.status !== "active") return false;
    if (st.source === "snapshot") return count > 0 && await snapshotAllowed(deps);
    if (st.source === "none") return count === 0 && !(await snapshotAllowed(deps));
    return false;
  }

  // Worker start / install: put the right session rules back.
  async function applyCached(deps) {
    const cfg = configured(deps);
    if (!cfg.ok) {
      const st = (await deps.getState()) || {};
      if (st.status !== "dormant" || st.reason !== cfg.reason) await setState(deps, { status: "dormant", reason: cfg.reason });
      return { ok: true, mode: "dormant", reason: cfg.reason };
    }
    if (await deps.getPaused()) {
      await removeFeedRules(deps);
      const pst = (await deps.getState()) || {};
      if (pst.status !== "paused" || pst.ruleCount) await setState(deps, { status: "paused", ruleCount: 0 });
      return { ok: true, mode: "paused" };
    }
    let st = (await deps.getState()) || {};
    if (st.killLatch && !latched(st, deps)) {
      await setState(deps, RELEASED);
      st = Object.assign({}, st, RELEASED);
    }
    if (!latched(st, deps)) st = await forgetRemovedKeys(deps, st);
    if (st.killed) {
      await removeFeedRules(deps);
      if (st.status !== "killed" || st.ruleCount) await setState(deps, { status: "killed", ruleCount: 0 });
      return { ok: true, mode: "killed" };
    }
    try {
      if (await alreadyApplied(deps, st)) return { ok: true, mode: "kept", rules: st.ruleCount || 0 };
    } catch {
      // fall through to the full apply
    }
    const cache = (await deps.getCache()) || {};
    const doc = await verifyCached(deps, cache.current);
    const version = deps.extensionVersion || "";
    try {
      if (doc) {
        const { rules, killed } = K().compileFeed(doc);
        await replaceRules(deps, rules);
        await setState(deps, { status: killed ? "killed" : "active", source: "feed", appliedSerial: doc.serial, ruleCount: rules.length, notAfter: doc.notAfter, appliedAt: deps.now(), appliedVersion: version, appliedHash: await entryHash(cache.current) });
        return { ok: true, mode: "cache", rules: rules.length };
      }
      const lastError = cache.current ? "saved feed expired or invalid; using the packed snapshot" : (st.lastError || "");
      if (!(await snapshotAllowed(deps))) {
        await removeFeedRules(deps);
        await setState(deps, { status: "active", source: "none", appliedSerial: 0, ruleCount: 0, appliedAt: deps.now(), appliedVersion: version, lastError: cache.current ? "saved feed expired or invalid" : (st.lastError || "") });
        return { ok: true, mode: "none", rules: 0 };
      }
      const rules = await snapshotRules(deps);
      await replaceRules(deps, rules);
      await setState(deps, { status: "active", source: "snapshot", appliedSerial: 0, ruleCount: rules.length, appliedAt: deps.now(), appliedVersion: version, lastError });
      return { ok: true, mode: "snapshot", rules: rules.length };
    } catch (e) {
      await setState(deps, { lastError: "apply: " + String(e && e.message || e) });
      return { ok: false, reason: String(e && e.message || e) };
    }
  }

  // The 3-hourly check (gecko-refresh alarm).
  async function checkFeed(deps) {
    const cfg = configured(deps);
    if (!cfg.ok) return { ok: true, ran: false, reason: "dormant: " + cfg.reason };
    if (await deps.getPaused()) {
      await removeFeedRules(deps);
      await setState(deps, { status: "paused", ruleCount: 0 });
      return { ok: true, ran: false, reason: "paused" };
    }
    const now = deps.now();
    let st = (await deps.getState()) || {};
    if (latched(st, deps)) {
      await removeFeedRules(deps);
      await setState(deps, { status: "killed", ruleCount: 0, lastCheckAt: now });
      return { ok: true, ran: false, reason: "killed with the kill key; off until the next extension version" };
    }
    if (st.killLatch) {
      await setState(deps, RELEASED);
      st = Object.assign({}, st, RELEASED);
    }
    st = await forgetRemovedKeys(deps, st);
    let bytes;
    let sigText;
    try {
      // Signature first (small), then the body.
      sigText = new TextDecoder().decode(await fetchCapped(deps, cfg.origin, deps.config.SIG_PATH, SIG_CAP));
      bytes = await fetchCapped(deps, cfg.origin, deps.config.FEED_PATH, C().MAX_FEED_BYTES);
    } catch (e) {
      await setState(deps, { lastError: "fetch: " + String(e && e.message || e), lastCheckAt: now });
      return { ok: false, ran: true, reason: String(e && e.message || e) };
    }
    // The publisher re-serves the same file between updates (the normal case).
    // Same bytes and signature as the saved, still-valid, applied file: record
    // a successful check. A same serial with other bytes still goes to
    // verifyFeed and is rejected there.
    try {
      const cur = ((await deps.getCache()) || {}).current;
      if (cur && cur.sig === sigText && cur.bytes === C().bytesToBase64(bytes) && st.source === "feed") {
        const same = await verifyCached(deps, cur);
        if (same && same.serial === st.serial && same.serial === st.appliedSerial) {
          await setState(deps, { lastError: "", lastCheckAt: now, fetchedAt: now });
          return { ok: true, ran: true, mode: "unchanged" };
        }
      }
    } catch {
      // fall through to the full check
    }
    // The same file as the last accepted one, but not the applied payload: a
    // rollback document (or an ignored rollback) that the publisher serves
    // again (review 2026-11-16 WP-20). It still verifies and has the stored
    // serial, so record a successful check, not a replay warning.
    let hash = "";
    try {
      hash = await docHash(bytes, sigText);
      if (st.lastDocHash && hash === st.lastDocHash) {
        const again = await V().verifyFeed(bytes, sigText, verifyOpts(deps, { storedSerial: 0 }));
        if (again.ok && again.kind === "feed" && again.doc.serial === st.serial) {
          await setState(deps, { lastError: st.lastDocNote || "", lastCheckAt: now, fetchedAt: now });
          return { ok: true, ran: true, mode: "unchanged" };
        }
      }
    } catch {
      // fall through to the full check
    }
    const msOf = (v) => {
      const t = v ? Date.parse(v) : 0;
      return Number.isFinite(t) ? t : 0;
    };
    const r = await V().verifyFeed(bytes, sigText, verifyOpts(deps, { storedSerial: st.serial || 0, storedKillSerial: st.killSerial || 0, storedNotBefore: msOf(st.notBefore), storedNotAfter: msOf(st.notAfter) }));
    if (!r.ok) {
      await setState(deps, { lastError: "rejected: " + r.error, lastCheckAt: now });
      return { ok: false, ran: true, reason: r.error };
    }
    try {
      if (r.kind === "kill") {
        await removeFeedRules(deps);
        // Forget the killed feed's saved files (follow-up review): after an
        // update releases the latch, nothing signed before the kill comes back.
        await deps.setCache({ current: null, previous: null });
        await setState(deps, { status: "killed", killed: true, killLatch: true, killedVersion: deps.extensionVersion || "", killSerial: r.doc.serial, killSerialKeyId: r.keyId, lastDocHash: "", lastDocNote: "", ruleCount: 0, lastError: "", lastCheckAt: now, fetchedAt: now });
        return { ok: true, ran: true, mode: "killed" };
      }
      const doc = r.doc;
      const cache = (await deps.getCache()) || {};
      if (doc.rollbackTo != null) {
        const docs = {};
        for (const slot of ["current", "previous"]) {
          const d = await verifyCached(deps, cache[slot]);
          if (d) docs[slot] = { serial: d.serial, doc: d };
        }
        const picked = K().resolveRollback(doc, docs);
        if (!picked) {
          const note = "rollback to " + doc.rollbackTo + " ignored: not stored";
          await setState(deps, { serial: doc.serial, serialKeyId: r.keyId, lastDocHash: hash, lastDocNote: note, lastError: note, lastCheckAt: now, fetchedAt: now });
          return { ok: false, ran: true, reason: "rollback target not stored" };
        }
        const { rules, killed } = K().compileFeed(picked.doc);
        await replaceRules(deps, rules);
        const pickedSlot = docs.current === picked ? "current" : "previous";
        const other = pickedSlot === "current" ? cache.previous : cache.current;
        await commitCache(deps, { current: cache[pickedSlot], previous: other || null }, cache);
        // A rolled-back document with killFeed reports "killed", not "active" (I-6).
        await setState(deps, { status: killed ? "killed" : "active", source: "feed", killed, serial: doc.serial, serialKeyId: r.keyId, appliedSerial: picked.serial, ruleCount: rules.length, notBefore: picked.doc.notBefore, notAfter: picked.doc.notAfter, appliedAt: now, appliedVersion: deps.extensionVersion || "", appliedHash: await entryHash(cache[pickedSlot]), lastDocHash: hash, lastDocNote: "", lastError: "", lastCheckAt: now, fetchedAt: now });
        return { ok: true, ran: true, mode: "rollback", serial: picked.serial };
      }
      const { rules, killed } = K().compileFeed(doc);
      // Rules first, storage second: if the rule update throws (quota), the
      // stored serial does not advance and the old rules stay active. If the
      // cache write throws, commitCache() puts the old rules back.
      await replaceRules(deps, rules);
      const entry = entryOf(bytes, sigText, doc);
      await commitCache(deps, { current: entry, previous: cache.current || null }, cache);
      await setState(deps, { status: killed ? "killed" : "active", source: "feed", killed, serial: doc.serial, serialKeyId: r.keyId, appliedSerial: doc.serial, ruleCount: rules.length, notBefore: doc.notBefore, notAfter: doc.notAfter, appliedAt: now, appliedVersion: deps.extensionVersion || "", appliedHash: await entryHash(entry), lastDocHash: hash, lastDocNote: "", lastError: "", lastCheckAt: now, fetchedAt: now });
      return { ok: true, ran: true, mode: killed ? "killed" : "applied", rules: rules.length };
    } catch (e) {
      await setState(deps, { lastError: "apply: " + String(e && e.message || e), lastCheckAt: now });
      return { ok: false, ran: true, reason: String(e && e.message || e) };
    }
  }

  // Status sentence stored as feedState.text (the popup shows it and adds the
  // age of the last check from feedState.fetchedAt).
  function statusText(state, paused) {
    const st = state || {};
    if (paused || st.status === "paused") return "Threat feed: paused (packed threat list still on).";
    if (!st.status || st.status === "dormant") return "Threat feed: not set up (packed threat list in use).";
    if (st.status === "killed") return "Threat feed: switched off by its publisher (packed threat list still on).";
    const err = st.lastError ? " Last problem: " + st.lastError + "." : "";
    if (st.source === "snapshot") return "Threat feed: using the packed snapshot (" + (st.ruleCount || 0) + " rules)." + err;
    if (st.source === "none") return "Threat feed: no valid feed file yet; the packed snapshot is not used because the threat tier is off." + err;
    return "Threat feed: serial " + (st.appliedSerial || st.serial || 0) + ", " + (st.ruleCount || 0) + " rules." + err;
  }

  root.GeckoFeedClient = Object.freeze({
    FETCH_TIMEOUT_MS, STATE_KEY, CACHE_KEY, PAUSE_KEY,
    configured, fetchCapped, applyCached, checkFeed, removeFeedRules, statusText,
  });
})(typeof self !== "undefined" ? self : globalThis);
