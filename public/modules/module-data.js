(() => {
  const APP_KEY = "vmill:app-state:v1";
  const LEGACY_APP_KEYS = ["chrono_drawer_timeline_v5", "chrono_drawer_timeline_v4", "chrono_drawer_timeline_v3"];
  const ALL_APP_KEYS = [APP_KEY, ...LEGACY_APP_KEYS];
  const MODULE_KEY = "vmill:module-data:v1";
  const WINDOW_STORE_PREFIX = "__VMILL_STORE__:";
  const DEMO_PRESETS = {
    small: "chrono_examples_small.json",
    medium: "chrono_examples_medium.json",
    large: "chrono_examples_large.json",
  };

  function safeParse(raw, fallback) {
    try {
      const v = JSON.parse(raw);
      return v ?? fallback;
    } catch {
      return fallback;
    }
  }

  function isValidAppState(v) {
    return !!(v && typeof v === "object" && Array.isArray(v.stations) && Array.isArray(v.jobs));
  }

  function normalizeProductsAndJobs(st) {
    if (!isValidAppState(st)) return st;
    if (!Array.isArray(st.products)) st.products = [];
    st.products = st.products.map((p, idx) => ({
      id: String(p?.id || uuid()),
      code: String(p?.code || `P${String(idx + 1).padStart(3, "0")}`),
      name: String(p?.name || `Product ${idx + 1}`),
      parentProductId: String(p?.parentProductId || ""),
      imageUrl: String(p?.imageUrl || ""),
    }));
    if (!st.products.length && Array.isArray(st.jobs) && st.jobs.length) {
      st.products = [{ id: uuid(), code: "P001", name: "Default Product", parentProductId: "", imageUrl: "" }];
    }
    const productIds = new Set(st.products.map((p) => String(p?.id || "")).filter(Boolean));
    if (!productIds.has(String(st.activeProductId || ""))) st.activeProductId = st.products[0]?.id || null;
    const fallbackStationId = Array.isArray(st.stations) && st.stations.length
      ? String(st.stations[0]?.id || "")
      : "";
    for (const j of (st.jobs || [])) {
      if (!j.stationId && fallbackStationId) j.stationId = fallbackStationId;
      if (!Array.isArray(j.cycles)) j.cycles = [];
      const pid = String(j?.productId || "");
      if (!pid || !productIds.has(pid)) j.productId = st.products[0]?.id || "";
    }
    return st;
  }

  function normalizeImportedAppState(v) {
    const src = (v && typeof v === "object" && v.app && typeof v.app === "object") ? v.app : v;
    if (!isValidAppState(src)) return null;
    const st = safeParse(JSON.stringify(src), null);
    if (!isValidAppState(st)) return null;
    normalizeProductsAndJobs(st);
    if (!st.activeProductId && st.products[0]) st.activeProductId = st.products[0].id;
    if (!st.activeJobId && st.jobs[0]) st.activeJobId = st.jobs[0].id;
    return st;
  }

  function readRawJsonByKey(key) {
    let raw = null;
    try { raw = localStorage.getItem(String(key || "")); } catch {}
    if (!raw) return null;
    return safeParse(raw, null);
  }

  function readWindowStore() {
    const raw = String(window.name || "");
    if (!raw.startsWith(WINDOW_STORE_PREFIX)) return {};
    const parsed = safeParse(raw.slice(WINDOW_STORE_PREFIX.length), {});
    return parsed && typeof parsed === "object" ? parsed : {};
  }

  function writeWindowStore(next) {
    try {
      const payload = (next && typeof next === "object") ? next : {};
      window.name = `${WINDOW_STORE_PREFIX}${JSON.stringify(payload)}`;
    } catch {}
  }

  function readWindowAppState() {
    const store = readWindowStore();
    return normalizeImportedAppState(store?.app);
  }

  function writeWindowAppState(next) {
    const store = readWindowStore();
    store.app = next;
    writeWindowStore(store);
  }

  function clearWindowAppState() {
    const store = readWindowStore();
    if (!("app" in store)) return;
    delete store.app;
    writeWindowStore(store);
  }

  function readWindowModuleState() {
    const store = readWindowStore();
    return (store?.modules && typeof store.modules === "object") ? store.modules : null;
  }

  function writeWindowModuleState(next) {
    const store = readWindowStore();
    store.modules = next;
    writeWindowStore(store);
  }

  function stateStamp(v) {
    const iso = String(v?.meta?.updatedAt || v?.meta?.createdAt || "");
    const ts = Date.parse(iso);
    return Number.isFinite(ts) ? ts : -1;
  }

  function statePayloadScore(v) {
    const stations = Array.isArray(v?.stations) ? v.stations.length : 0;
    const jobs = Array.isArray(v?.jobs) ? v.jobs.length : 0;
    let cycles = 0;
    for (const j of (v?.jobs || [])) cycles += Array.isArray(j?.cycles) ? j.cycles.length : 0;
    return (stations * 1000000) + (jobs * 1000) + cycles;
  }

  function hasPayloadData(v) {
    return statePayloadScore(v) > 0;
  }

  function chooseBestState(candidates) {
    if (!candidates.length) return null;
    const nonEmpty = candidates.filter((c) => hasPayloadData(c.state));
    const pool = nonEmpty.length ? nonEmpty : candidates;
    let best = pool[0];
    for (let i = 1; i < pool.length; i++) {
      const c = pool[i];
      if (c.stamp > best.stamp) best = c;
      else if (c.stamp === best.stamp) {
        const cScore = statePayloadScore(c.state);
        const bScore = statePayloadScore(best.state);
        if (cScore > bScore) best = c;
        else if (cScore === bScore && c.key === APP_KEY && best.key !== APP_KEY) best = c;
      }
    }
    return best;
  }

  function ensureStateMeta(next) {
    if (!next || typeof next !== "object") return next;
    const st = { ...next };
    const nowIso = new Date().toISOString();
    const meta = (st.meta && typeof st.meta === "object") ? { ...st.meta } : {};
    if (!meta.createdAt) meta.createdAt = nowIso;
    meta.updatedAt = nowIso;
    st.meta = meta;
    return st;
  }

  function uuid() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  function defaultActionTypes() {
    return [
      { id: "MACHINE", name: "Tech", color: "#7f8790", lane: "1", laneOrder: 1, heightPx: 30, z: 5, opacity: 0.9, underlayTypeId: "", stackFlow: true, resourceMode: "MACHINE" },
      { id: "HUMAN", name: "Human", color: "#ffd24a", lane: "1", laneOrder: 1, heightPx: 15, z: 20, opacity: 1.0, underlayTypeId: "", stackFlow: true, resourceMode: "HUMAN" },
      { id: "HUMAN+MACHINE", name: "Human+Tech", color: "#ffd24a", lane: "1", laneOrder: 1, heightPx: 30, z: 25, opacity: 1.0, underlayTypeId: "MACHINE", stackFlow: true, resourceMode: "BOTH" },
      { id: "IDLE", name: "Idle", color: "#4c73ff", lane: "idle", laneOrder: 2, heightPx: 6, z: 12, opacity: 0.8, underlayTypeId: "", stackFlow: true, resourceMode: "LANE" },
    ];
  }

  function defaultUiState() {
    return {
      uiScale: 1,
      leftPanelVisible: true,
      jobsPanelCollapsed: false,
      collapsedStations: {},
      timelineSameBase: true,
      layoutMode: "horizontal",
      jobsPanelWidth: 360,
      themeBg: "#0b0c10",
      themeText: "#e8e8e8",
      themeAccent: "#4c73ff",
      themeHeaderBg: "#101521",
      themeHeaderText: "#e8e8e8",
      timeDisplayUnit: "s",
      timeResolutionSec: 0.001,
      drawerPrefVersion: 2,
      drawerSections: {
        job: false,
        elements: false,
        actionTypes: false,
        view: false,
        backup: false,
      },
      panels: {
        timer: true,
        kpi: true,
        timeline: true,
        cycles: true,
      },
      panelOrder: ["timer", "kpi", "timeline", "cycles"],
    };
  }

  function createDefaultAppState() {
    const p1 = { id: uuid(), code: "P001", name: "Alpha Product", parentProductId: "", imageUrl: "" };
    const p2 = { id: uuid(), code: "P002", name: "Beta Product", parentProductId: p1.id, imageUrl: "" };
    const st1 = { id: uuid(), code: "S01", name: "Assembly Line A - Station 1" };
    const st2 = { id: uuid(), code: "S02", name: "Packaging Cell - Station 2" };
    const e1 = { id: uuid(), name: "Pick part", type: "HUMAN" };
    const e2 = { id: uuid(), name: "Place part", type: "HUMAN" };
    const e3 = { id: uuid(), name: "Machine cycle", type: "MACHINE" };
    const e4 = { id: uuid(), name: "Visual inspection", type: "HUMAN" };
    const e5 = { id: uuid(), name: "Pack unit", type: "HUMAN" };
    const job1 = {
      id: uuid(),
      productId: p1.id,
      stationId: st1.id,
      name: "Pick / Place / Machine",
      allowancePct: 12,
      ratingPct: 100,
      elements: [e1, e2, e3],
      cycles: [
        {
          id: uuid(),
          atIso: new Date(Date.now() - (1000 * 60 * 20)).toISOString(),
          tag: "Normal",
          note: "",
          laps: [
            { elementId: e1.id, name: e1.name, type: e1.type, ms: 1800 },
            { elementId: e2.id, name: e2.name, type: e2.type, ms: 1500 },
            { elementId: e3.id, name: e3.name, type: e3.type, ms: 6300 },
          ],
          totalMs: 9600,
        },
        {
          id: uuid(),
          atIso: new Date(Date.now() - (1000 * 60 * 16)).toISOString(),
          tag: "Normal",
          note: "",
          laps: [
            { elementId: e1.id, name: e1.name, type: e1.type, ms: 1700 },
            { elementId: e2.id, name: e2.name, type: e2.type, ms: 1400 },
            { elementId: e3.id, name: e3.name, type: e3.type, ms: 6500 },
          ],
          totalMs: 9600,
        },
      ],
    };
    const job2 = {
      id: uuid(),
      productId: p2.id,
      stationId: st2.id,
      name: "Inspect / Pack",
      allowancePct: 10,
      ratingPct: 100,
      elements: [e4, e5],
      cycles: [
        {
          id: uuid(),
          atIso: new Date(Date.now() - (1000 * 60 * 12)).toISOString(),
          tag: "Normal",
          note: "",
          laps: [
            { elementId: e4.id, name: e4.name, type: e4.type, ms: 2100 },
            { elementId: e5.id, name: e5.name, type: e5.type, ms: 1900 },
          ],
          totalMs: 4000,
        },
      ],
    };
    return ensureStateMeta({
      activeProductId: p1.id,
      activeJobId: job1.id,
      products: [p1, p2],
      stations: [st1, st2],
      jobs: [job1, job2],
      actionTypes: defaultActionTypes(),
      ui: defaultUiState(),
    });
  }

  function createEmptyAppState() {
    return ensureStateMeta({
      activeProductId: null,
      activeJobId: null,
      products: [],
      stations: [],
      jobs: [],
      actionTypes: defaultActionTypes(),
      ui: defaultUiState(),
    });
  }

  function clearAppStateStorage() {
    for (const key of ALL_APP_KEYS) {
      try { localStorage.removeItem(key); } catch {}
    }
    clearWindowAppState();
  }

  function demoCandidates(fileName) {
    const f = String(fileName || "").trim();
    if (!f) return [];
    const out = [];
    const push = (v) => {
      const s = String(v || "").trim();
      if (s && !out.includes(s)) out.push(s);
    };
    push(`/chrono/${f}`);
    push(`./chrono/${f}`);
    push(`../chrono/${f}`);
    push(`./${f}`);
    push(f);
    if (location.protocol === "file:") {
      const p = String(location.pathname || "").replace(/\\/g, "/");
      const inChrono = p.includes("/public/chrono/");
      const inPublicRoot = p.includes("/public/") && !inChrono;
      if (inChrono) push(`./${f}`);
      if (inPublicRoot) push(`./chrono/${f}`);
      push(`../chrono/${f}`);
      push(`./public/chrono/${f}`);
    }
    return out;
  }

  function readAppState(options = {}) {
    const seedIfMissing = options?.seedIfMissing !== false;
    const candidates = [];
    for (const key of ALL_APP_KEYS) {
      const parsed = normalizeImportedAppState(readRawJsonByKey(key));
      if (!parsed) continue;
      candidates.push({ key, state: parsed, stamp: stateStamp(parsed) });
    }
    const fromWindow = readWindowAppState();
    if (fromWindow) candidates.push({ key: "__window_name__", state: fromWindow, stamp: stateStamp(fromWindow) });
    if (!candidates.length) {
      if (!seedIfMissing) return null;
      const seeded = createDefaultAppState();
      writeAppState(seeded);
      return seeded;
    }
    const best = chooseBestState(candidates);
    if (!best) {
      if (!seedIfMissing) return null;
      const seeded = createDefaultAppState();
      writeAppState(seeded);
      return seeded;
    }
    const raw = JSON.stringify(best.state);
    for (const key of ALL_APP_KEYS) {
      try { localStorage.setItem(key, raw); } catch {}
    }
    writeWindowAppState(best.state);
    return best.state;
  }

  function writeAppState(next) {
    const normalizedBase = normalizeImportedAppState(next);
    if (!normalizedBase) return;
    const normalized = ensureStateMeta(normalizedBase);
    const raw = JSON.stringify(normalized);
    for (const key of ALL_APP_KEYS) {
      try { localStorage.setItem(key, raw); } catch {}
    }
    writeWindowAppState(normalized);
    window.CANBus?.emit("data:app:updated", { key: APP_KEY, mirrors: LEGACY_APP_KEYS.slice() }, "module-data");
  }

  function resetAppStateToDefault() {
    clearAppStateStorage();
    const seeded = createDefaultAppState();
    writeAppState(seeded);
    return seeded;
  }

  function clearAppStateToEmpty() {
    clearAppStateStorage();
    const empty = createEmptyAppState();
    writeAppState(empty);
    return empty;
  }

  async function loadDemoAppState(presetOrFile) {
    const key = String(presetOrFile || "").trim().toLowerCase();
    const file = DEMO_PRESETS[key] || String(presetOrFile || "").trim();
    if (!file) throw new Error("Missing demo preset/file.");
    const tries = [];
    for (const candidate of demoCandidates(file)) {
      try {
        const res = await fetch(candidate, { cache: "no-store" });
        if (!res.ok) {
          tries.push(`${candidate} -> HTTP ${res.status}`);
          continue;
        }
        const parsed = await res.json();
        const normalized = normalizeImportedAppState(parsed);
        if (!normalized) {
          tries.push(`${candidate} -> invalid app state format`);
          continue;
        }
        writeAppState(normalized);
        return { state: normalized, source: candidate };
      } catch (err) {
        tries.push(`${candidate} -> ${err?.message || "fetch failed"}`);
      }
    }
    throw new Error(`Demo load failed for "${file}". Tried: ${tries.join(" | ")}`);
  }

  function ensureModuleState(st) {
    const base = st && typeof st === "object" ? st : {};
    if (!base.meta) base.meta = {};
    if (!base.meta.createdAt) base.meta.createdAt = new Date().toISOString();
    base.meta.updatedAt = new Date().toISOString();
    if (!base.store || typeof base.store !== "object") base.store = {};
    return base;
  }

  function readModuleState() {
    let raw = null;
    try { raw = localStorage.getItem(MODULE_KEY); } catch {}
    const fromLs = ensureModuleState(safeParse(raw, {}));
    const fromWinRaw = readWindowModuleState();
    if (!fromWinRaw) return fromLs;
    const fromWin = ensureModuleState(fromWinRaw);
    const lsTs = Date.parse(String(fromLs?.meta?.updatedAt || ""));
    const winTs = Date.parse(String(fromWin?.meta?.updatedAt || ""));
    if (Number.isFinite(winTs) && (!Number.isFinite(lsTs) || winTs > lsTs)) return fromWin;
    return fromLs;
  }

  function writeModuleState(next) {
    const st = ensureModuleState(next);
    try { localStorage.setItem(MODULE_KEY, JSON.stringify(st)); } catch {}
    writeWindowModuleState(st);
    window.CANBus?.emit("data:module:updated", { key: MODULE_KEY }, "module-data");
    return st;
  }

  function upsertRecord(namespace, record) {
    const ns = String(namespace || "default");
    const st = readModuleState();
    if (!Array.isArray(st.store[ns])) st.store[ns] = [];
    const id = String(record?.id || `${Date.now()}_${Math.random().toString(16).slice(2)}`);
    const idx = st.store[ns].findIndex((x) => String(x.id || "") === id);
    const next = { ...(record || {}), id, updatedAt: new Date().toISOString() };
    if (idx >= 0) st.store[ns][idx] = { ...st.store[ns][idx], ...next };
    else st.store[ns].push({ createdAt: new Date().toISOString(), ...next });
    writeModuleState(st);
    return next;
  }

  function deleteRecord(namespace, id) {
    const ns = String(namespace || "default");
    const st = readModuleState();
    if (!Array.isArray(st.store[ns])) return false;
    const before = st.store[ns].length;
    st.store[ns] = st.store[ns].filter((x) => String(x.id || "") !== String(id || ""));
    if (st.store[ns].length !== before) {
      writeModuleState(st);
      return true;
    }
    return false;
  }

  function listRecords(namespace) {
    const ns = String(namespace || "default");
    const st = readModuleState();
    return Array.isArray(st.store[ns]) ? st.store[ns].slice() : [];
  }

  function exportAllSnapshot() {
    return {
      exportedAt: new Date().toISOString(),
      app: readAppState(),
      modules: readModuleState(),
    };
  }

  function importAllSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") throw new Error("Invalid snapshot format.");
    if (snapshot.app) writeAppState(snapshot.app);
    if (snapshot.modules) writeModuleState(snapshot.modules);
    window.CANBus?.emit("data:snapshot:imported", {}, "module-data");
  }

  function makeCsvForJobs() {
    const app = readAppState();
    const rows = [
      "productCode,productName,stationCode,stationName,jobName,cycleId,cycleAtIso,tag,totalMs,lapIndex,elementName,elementType,lapMs",
    ];
    const products = new Map((app?.products || []).map((p) => [p.id, p]));
    const stations = new Map((app?.stations || []).map((s) => [s.id, s]));
    for (const job of (app?.jobs || [])) {
      const product = products.get(job.productId) || {};
      const st = stations.get(job.stationId) || {};
      for (const cyc of (job.cycles || [])) {
        const laps = Array.isArray(cyc.laps) ? cyc.laps : [];
        for (let i = 0; i < laps.length; i++) {
          const l = laps[i] || {};
          const cols = [
            product.code || "",
            product.name || "",
            st.code || "",
            st.name || "",
            job.name || "",
            cyc.id || "",
            cyc.atIso || "",
            cyc.tag || "Normal",
            Number(cyc.totalMs || 0),
            i + 1,
            l.name || "",
            l.type || "",
            Number(l.ms || 0),
          ];
          rows.push(cols.map((x) => {
            const s = String(x ?? "");
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, "\"\"")}"` : s;
          }).join(","));
        }
      }
    }
    return rows.join("\n");
  }

  function makeTextReport() {
    const app = readAppState();
    const modules = readModuleState();
    const products = Array.isArray(app?.products) ? app.products : [];
    const stations = Array.isArray(app?.stations) ? app.stations : [];
    const jobs = Array.isArray(app?.jobs) ? app.jobs : [];
    const lines = [];
    lines.push("VMill Offline Backup Report");
    lines.push(`ExportedAt: ${new Date().toISOString()}`);
    lines.push(`Products: ${products.length}`);
    lines.push(`Stations: ${stations.length}`);
    lines.push(`Jobs: ${jobs.length}`);
    lines.push("");
    for (const p of products) {
      const pJobs = jobs.filter((j) => String(j.productId || "") === String(p.id || ""));
      lines.push(`[Product] ${p.code || "-"} - ${p.name || "-"} | Jobs: ${pJobs.length}`);
    }
    lines.push("");
    for (const st of stations) {
      lines.push(`[Station] ${st.code || "-"} - ${st.name || "-"}`);
      const stJobs = jobs.filter((j) => String(j.stationId || "") === String(st.id || ""));
      for (const j of stJobs) {
        const cycles = Array.isArray(j.cycles) ? j.cycles : [];
        lines.push(`  - Job: ${j.name || "-"} | Cycles: ${cycles.length}`);
      }
    }
    lines.push("");
    const namespaces = Object.keys(modules?.store || {});
    lines.push(`Module Namespaces: ${namespaces.length}`);
    for (const ns of namespaces) {
      const count = Array.isArray(modules.store[ns]) ? modules.store[ns].length : 0;
      lines.push(`  - ${ns}: ${count}`);
    }
    return lines.join("\n");
  }

  window.VMillData = {
    keys: { APP_KEY, LEGACY_APP_KEYS, ALL_APP_KEYS, MODULE_KEY },
    readAppState,
    writeAppState,
    createDefaultAppState,
    createEmptyAppState,
    resetAppStateToDefault,
    clearAppStateToEmpty,
    loadDemoAppState,
    normalizeImportedAppState,
    readModuleState,
    writeModuleState,
    upsertRecord,
    deleteRecord,
    listRecords,
    exportAllSnapshot,
    importAllSnapshot,
    makeCsvForJobs,
    makeTextReport,
  };
})();
