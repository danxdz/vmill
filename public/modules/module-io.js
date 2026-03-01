(() => {
  const CHANNEL_NAME = "vmill:canbus:v1";
  const STORAGE_KEY = "vmill:canbus:last-message";
  const listeners = new Set();
  let bc = null;

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

  function emit(type, payload = {}, source = "unknown") {
    const msg = makeEnvelope(type, payload, source);
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
        emitLocal(e.data);
      };
    } catch {}
  }

  function bindStorageFallback() {
    window.addEventListener("storage", (e) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      try {
        const msg = JSON.parse(e.newValue);
        emitLocal(msg);
      } catch {}
    });
  }

  openChannel();
  bindStorageFallback();

  const api = {
    emit,
    onMessage,
    channel: CHANNEL_NAME,
    protocol: "CANBus-v1",
  };
  window.CANBus = api;
  // Backward compatibility alias.
  window.VMillBus = api;
})();
