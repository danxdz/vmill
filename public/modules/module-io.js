(() => {
  const CHANNEL_NAME = "vmill:canbus:v1";
  const STORAGE_KEY = "vmill:canbus:last-message";
  const LOGGER_KEY = "vmill:logger:entries:v1";
  const LOGGER_MAX = 1800;
  const LOGGER_VERBOSE_KEY = "vmill:logger:verbose:v1";
  const listeners = new Set();
  let bc = null;
  let lastSyncSignature = "";
  let lastHubReadyLoggedAt = 0;
  const seenIds = new Map();

  function safeParse(raw, fallback) {
    try {
      const parsed = JSON.parse(String(raw || ""));
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function makeEnvelope(type, payload, source) {
    return {
      id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      ts: nowIso(),
      type: String(type || "event"),
      source: String(source || "unknown"),
      payload: payload ?? {},
    };
  }

  function emitLocal(msg) {
    for (const fn of listeners) {
      try {
        fn(msg);
      } catch {}
    }
  }

  function keepSeen(id) {
    const key = String(id || "");
    if (!key) return false;
    const now = Date.now();
    const prev = Number(seenIds.get(key) || 0);
    seenIds.set(key, now);
    for (const [k, ts] of seenIds) {
      if ((now - Number(ts || 0)) > 120000) seenIds.delete(k);
    }
    return prev > 0;
  }

  function levelFromMessage(msg) {
    const type = String(msg?.type || "").toLowerCase();
    const payload = msg?.payload && typeof msg.payload === "object" ? msg.payload : {};
    const payloadLevel = String(payload?.level || "").toLowerCase();
    if (payloadLevel === "error") return "error";
    if (payloadLevel === "warn" || payloadLevel === "warning") return "warn";
    if (payloadLevel === "info") return "info";
    const serialized = JSON.stringify(payload || {});
    if (
      type.includes("error")
      || type.includes("fail")
      || type.includes("exception")
      || serialized.includes("error")
      || serialized.includes("exception")
      || serialized.includes("failed")
    ) return "error";
    if (
      type.includes("warn")
      || type.includes("block")
      || type.includes("deny")
      || serialized.includes("warning")
      || serialized.includes("blocked")
    ) return "warn";
    if (type === "data:sync:status" && (payload?.online === false || payload?.error)) return "warn";
    return "info";
  }

  function categoryFromMessage(msg) {
    const type = String(msg?.type || "");
    if (!type) return "event";
    const head = type.split(":")[0] || "event";
    if (head === "vmill") return "system";
    return head;
  }

  function summarizeMessage(msg) {
    const type = String(msg?.type || "");
    const p = msg?.payload && typeof msg.payload === "object" ? msg.payload : {};
    if (type === "ocr:server:log") {
      const lvl = String(p?.level || "INFO").toUpperCase();
      const text = String(p?.message || "").trim();
      return text ? `[${lvl}] ${text}` : `[${lvl}] OCR server log`;
    }
    if (type === "ocr:server:status") {
      const server = String(p?.serverUrl || "");
      const err = String(p?.error || "");
      return ["offline", server, err].filter(Boolean).join(" | ");
    }
    if (type === "auth:changed") {
      const user = p?.user?.username || p?.user?.name || "";
      return p?.loggedIn ? `login ${user || "user"}` : "logout";
    }
    if (type === "data:sync:status") {
      const flag = p?.online ? "online" : "offline";
      const server = String(p?.serverUrl || "");
      const err = String(p?.error || "");
      return [flag, server, err].filter(Boolean).join(" | ");
    }
    if (type === "data:app:updated") return "app state updated";
    if (type === "data:module:updated") return "module data updated";
    if (type === "shop:tree:changed") return String(p?.reason || "shop tree changed");
    if (type === "theme:changed") return "theme changed";
    if (type === "lang:changed") return `lang ${String(p?.lang || "")}`.trim();
    if (type === "hub:backup:imported") return "backup imported";
    if (type === "hub:backup:exported") return "backup exported";
    if (type === "hub:ready") return "hub ready";
    return type || "event";
  }

  function shouldLogMessage(msg, direction = "emit") {
    const type = String(msg?.type || "");
    if (!type) return false;
    const verbose = String(localStorage.getItem(LOGGER_VERBOSE_KEY) || "") === "1";
    const now = Date.now();
    // Reduce duplicated network chatter mirrored from other tabs.
    if (String(direction || "") === "rx" && (type === "data:sync:status" || type === "hub:ready")) {
      return false;
    }
    // Keep logger focused on actionable entries by default.
    if (!verbose && (type === "data:app:updated" || type === "data:module:updated")) {
      return false;
    }
    if (type === "hub:ready") {
      if ((now - Number(lastHubReadyLoggedAt || 0)) < 300000) return false;
      lastHubReadyLoggedAt = now;
      return true;
    }
    if (type === "data:sync:status") {
      const p = msg?.payload && typeof msg.payload === "object" ? msg.payload : {};
      const sig = `${p?.online ? 1 : 0}|${String(p?.serverUrl || "")}|${String(p?.error || "")}`;
      // Only keep meaningful state transitions; drop periodic heartbeat duplicates.
      if (sig === lastSyncSignature) return false;
      lastSyncSignature = sig;
      return true;
    }
    return true;
  }

  function readLogs() {
    const raw = safeParse(localStorage.getItem(LOGGER_KEY), []);
    return Array.isArray(raw) ? raw : [];
  }

  function writeLogs(entries) {
    const rows = Array.isArray(entries) ? entries : [];
    const clipped = rows.slice(-LOGGER_MAX);
    try { localStorage.setItem(LOGGER_KEY, JSON.stringify(clipped)); } catch {}
    return clipped;
  }

  function clearLogs() {
    writeLogs([]);
    window.dispatchEvent(new CustomEvent("vmill:logger:cleared"));
  }

  function recordMessage(msg, direction = "emit") {
    if (!msg || typeof msg !== "object") return null;
    if (!shouldLogMessage(msg, direction)) return null;
    const payload = msg.payload && typeof msg.payload === "object" ? msg.payload : {};
    let payloadPreview = "";
    try {
      payloadPreview = JSON.stringify(payload);
    } catch {
      payloadPreview = "";
    }
    if (payloadPreview.length > 2200) payloadPreview = `${payloadPreview.slice(0, 2200)}...(truncated)`;
    const entry = {
      id: String(msg.id || `${Date.now()}_${Math.random().toString(16).slice(2)}`),
      ts: String(msg.ts || nowIso()),
      type: String(msg.type || "event"),
      source: String(msg.source || "unknown"),
      level: levelFromMessage(msg),
      category: categoryFromMessage(msg),
      direction: String(direction || "emit"),
      summary: summarizeMessage(msg),
      payloadPreview,
      payload,
    };
    const next = readLogs();
    next.push(entry);
    writeLogs(next);
    window.dispatchEvent(new CustomEvent("vmill:logger:new", { detail: { entry } }));
    return entry;
  }

  function emit(type, payload = {}, source = "unknown") {
    const msg = makeEnvelope(type, payload, source);
    keepSeen(msg.id);
    recordMessage(msg, "emit");
    emitLocal(msg);
    if (bc) {
      try {
        bc.postMessage(msg);
      } catch {}
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(msg));
    } catch {}
    return msg;
  }

  function onMessage(fn) {
    if (typeof fn !== "function") return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function openChannel() {
    if (!("BroadcastChannel" in window)) return;
    try {
      bc = new BroadcastChannel(CHANNEL_NAME);
      bc.onmessage = (e) => {
        if (!e || !e.data) return;
        const msg = e.data;
        if (keepSeen(msg?.id)) return;
        recordMessage(msg, "rx");
        emitLocal(msg);
      };
    } catch {}
  }

  function bindStorageFallback() {
    window.addEventListener("storage", (e) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      try {
        const msg = JSON.parse(e.newValue);
        if (keepSeen(msg?.id)) return;
        recordMessage(msg, "rx");
        emitLocal(msg);
      } catch {}
    });
  }

  openChannel();
  bindStorageFallback();

  const api = {
    emit,
    onMessage,
    getLogs: () => readLogs().slice(),
    clearLogs,
    logger: {
      key: LOGGER_KEY,
      max: LOGGER_MAX,
      read: () => readLogs().slice(),
      clear: clearLogs,
    },
    channel: CHANNEL_NAME,
    protocol: "CANBus-v1",
  };
  window.CANBus = api;
  // Backward compatibility alias.
  window.VMillBus = api;
})();
