(() => {
  const APP_KEY = "vmill:app-state:v1";
  const LEGACY_APP_KEYS = ["chrono_drawer_timeline_v5", "chrono_drawer_timeline_v4", "chrono_drawer_timeline_v3"];
  const ALL_APP_KEYS = [APP_KEY, ...LEGACY_APP_KEYS];
  const MODULE_KEY = "vmill:module-data:v1";
  const WINDOW_STORE_PREFIX = "__VMILL_STORE__:";
  const NS_ROUTE = "spacial_routes";
  const NS_ENTITY_TYPES = "global_entity_types";
  const NS_ENTITY_ITEMS = "global_entity_items";
  const NS_ENTITY_LINKS = "global_entity_links";
  const NS_STRUCTURE_RULES = "global_structure_rules";
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
    if (!Array.isArray(st.categories)) st.categories = [];
    st.categories = st.categories.map((c, idx) => ({
      id: String(c?.id || uuid()),
      code: String(c?.code || `CAT${String(idx + 1).padStart(3, "0")}`),
      name: String(c?.name || `Category ${idx + 1}`),
      parentCategoryId: String(c?.parentCategoryId || ""),
    }));
    const categoryIds = new Set(st.categories.map((c) => String(c?.id || "")).filter(Boolean));
    if (!Array.isArray(st.stations)) st.stations = [];
    st.stations = st.stations.map((s, idx) => ({
      id: String(s?.id || uuid()),
      code: String(s?.code || `S${String(idx + 1).padStart(2, "0")}`),
      name: String(s?.name || `Station ${idx + 1}`),
      categoryIds: Array.isArray(s?.categoryIds)
        ? s.categoryIds.map((x) => String(x || "")).filter((x) => categoryIds.has(x))
        : [],
      imageUrl: String(s?.imageUrl || ""),
    }));
    if (!Array.isArray(st.products)) st.products = [];
    st.products = st.products.map((p, idx) => ({
      id: String(p?.id || uuid()),
      code: String(p?.code || `P${String(idx + 1).padStart(3, "0")}`),
      name: String(p?.name || `Product ${idx + 1}`),
      parentProductId: String(p?.parentProductId || ""),
      categoryIds: Array.isArray(p?.categoryIds) ? p.categoryIds.map((x) => String(x || "")).filter((x) => categoryIds.has(x)) : [],
      imageUrl: String(p?.imageUrl || ""),
    }));
    if (!Array.isArray(st.jobs)) st.jobs = [];
    if (!st.products.length && st.jobs.length) {
      const map = new Map();
      for (let i = 0; i < st.jobs.length; i++) {
        const job = st.jobs[i] || {};
        const rawPid = String(job?.productId || job?.product?.id || "").trim();
        const rawCode = String(job?.productCode || job?.product?.code || "").trim();
        const rawName = String(job?.productName || job?.product?.name || "").trim();
        const key = rawPid || rawCode || rawName || `auto:${String(job?.stationId || i)}`;
        if (!map.has(key)) {
          const n = map.size + 1;
          const baseName = rawName || String(job?.name || "").split("#")[0].trim();
          const code = rawCode || `P${String(n).padStart(3, "0")}`;
          map.set(key, {
            id: uuid(),
            code,
            name: baseName ? `${baseName} Product` : `Product ${n}`,
            parentProductId: "",
            categoryIds: Array.isArray(job?.categoryIds)
              ? job.categoryIds.map((x) => String(x || "")).filter((x) => categoryIds.has(x))
              : [],
            imageUrl: "",
          });
        }
        const prod = map.get(key);
        job.productId = prod.id;
        st.jobs[i] = job;
      }
      st.products = [...map.values()];
    }
    const productIds = new Set(st.products.map((p) => String(p?.id || "")).filter(Boolean));
    const productByCode = new Map(st.products.map((p) => [String(p?.code || "").toLowerCase(), String(p?.id || "")]));
    const productByName = new Map(st.products.map((p) => [String(p?.name || "").toLowerCase(), String(p?.id || "")]));
    const stationById = new Map(st.stations.map((s) => [String(s?.id || ""), s]));
    if (!productIds.has(String(st.activeProductId || ""))) st.activeProductId = st.products[0]?.id || null;
    const fallbackStationId = Array.isArray(st.stations) && st.stations.length
      ? String(st.stations[0]?.id || "")
      : "";
    const pickProductForJob = (job) => {
      const pid = String(job?.productId || "").trim();
      if (pid && productIds.has(pid)) return pid;
      const nestedPid = String(job?.product?.id || "").trim();
      if (nestedPid && productIds.has(nestedPid)) return nestedPid;
      const productRef = String(job?.product || "").trim();
      if (productRef && productIds.has(productRef)) return productRef;
      const fromCode = String(
        job?.productCode
        || job?.product?.code
        || (!productIds.has(productRef) ? productRef : "")
      ).trim().toLowerCase();
      if (fromCode && productByCode.has(fromCode)) return String(productByCode.get(fromCode) || "");
      const fromName = String(job?.productName || job?.product?.name || "").trim().toLowerCase();
      if (fromName && productByName.has(fromName)) return String(productByName.get(fromName) || "");

      const jobCats = new Set(
        Array.isArray(job?.categoryIds)
          ? job.categoryIds.map((x) => String(x || "")).filter((x) => categoryIds.has(x))
          : []
      );
      const scoreProduct = (prod, cats) => {
        if (!cats.size) return 0;
        let score = 0;
        for (const cid of (prod?.categoryIds || [])) if (cats.has(String(cid || ""))) score += 1;
        return score;
      };
      let bestId = "";
      let bestScore = 0;
      for (const prod of st.products) {
        const score = scoreProduct(prod, jobCats);
        if (score > bestScore) {
          bestScore = score;
          bestId = String(prod?.id || "");
        }
      }
      if (bestId) return bestId;

      const station = stationById.get(String(job?.stationId || ""));
      const stCats = new Set(
        Array.isArray(station?.categoryIds)
          ? station.categoryIds.map((x) => String(x || "")).filter((x) => categoryIds.has(x))
          : []
      );
      bestId = "";
      bestScore = 0;
      for (const prod of st.products) {
        const score = scoreProduct(prod, stCats);
        if (score > bestScore) {
          bestScore = score;
          bestId = String(prod?.id || "");
        }
      }
      if (bestId) return bestId;
      return String(st.activeProductId || st.products[0]?.id || "");
    };
    for (const j of (st.jobs || [])) {
      if (!j.id) j.id = uuid();
      if (!j.name) j.name = "Job";
      if (!j.stationId && fallbackStationId) j.stationId = fallbackStationId;
      if (!Array.isArray(j.elements)) j.elements = [];
      if (!Array.isArray(j.cycles)) j.cycles = [];
      j.cycles = j.cycles.map((cy) => {
        const c = (cy && typeof cy === "object") ? { ...cy } : {};
        const lapsRaw = Array.isArray(c.laps) ? c.laps : [];
        c.laps = lapsRaw.map((lap) => ({
          elementId: String(lap?.elementId || ""),
          name: String(lap?.name || ""),
          type: String(lap?.type || ""),
          ms: Math.max(0, Number(lap?.ms || 0)),
        }));
        if (!c.id) c.id = uuid();
        if (!c.atIso) c.atIso = new Date().toISOString();
        if (!c.tag) c.tag = "Normal";
        if (c.note == null) c.note = "";
        const sumMs = c.laps.reduce((a, l) => a + Number(l?.ms || 0), 0);
        const totalMs = Number(c.totalMs || 0);
        c.totalMs = Number.isFinite(totalMs) && totalMs > 0 ? totalMs : sumMs;
        return c;
      });
      if (!Array.isArray(j.categoryIds)) j.categoryIds = [];
      j.categoryIds = j.categoryIds.map((x) => String(x || "")).filter((x) => categoryIds.has(x));
      j.productId = pickProductForJob(j);
    }
    if (!String(st.activeProductId || "") && st.products[0]) st.activeProductId = st.products[0].id;
    if (!String(st.activeJobId || "") && st.jobs[0]) st.activeJobId = st.jobs[0].id;
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
    const c1 = { id: uuid(), code: "CAT001", name: "Assembly", parentCategoryId: "" };
    const c2 = { id: uuid(), code: "CAT002", name: "Packaging", parentCategoryId: "" };
    const p1 = { id: uuid(), code: "P001", name: "Alpha Product", parentProductId: "", categoryIds: [c1.id], imageUrl: "" };
    const p2 = { id: uuid(), code: "P002", name: "Beta Product", parentProductId: p1.id, categoryIds: [c2.id], imageUrl: "" };
    const st1 = { id: uuid(), code: "S01", name: "Assembly Line A - Station 1", categoryIds: [c1.id] };
    const st2 = { id: uuid(), code: "S02", name: "Packaging Cell - Station 2", categoryIds: [c2.id] };
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
      categoryIds: [c1.id],
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
      categoryIds: [c2.id],
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
      categories: [c1, c2],
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
      categories: [],
      products: [],
      stations: [],
      jobs: [],
      actionTypes: defaultActionTypes(),
      ui: defaultUiState(),
    });
  }

  function avgElementMs(job, elementId) {
    const eid = String(elementId || "");
    if (!eid || !Array.isArray(job?.cycles)) return null;
    let sum = 0;
    let count = 0;
    for (const cyc of job.cycles) {
      for (const lap of (cyc?.laps || [])) {
        if (String(lap?.elementId || "") !== eid) continue;
        const ms = Number(lap?.ms || 0);
        if (!Number.isFinite(ms) || ms <= 0) continue;
        sum += ms;
        count += 1;
      }
    }
    if (!count) return null;
    return sum / count;
  }

  function buildRouteForJob(job, station, product) {
    const j = job && typeof job === "object" ? job : {};
    const st = station && typeof station === "object" ? station : {};
    const pd = product && typeof product === "object" ? product : {};
    const elements = Array.isArray(j.elements) ? j.elements : [];
    const ops = elements.map((el, i) => {
      const ms = avgElementMs(j, el?.id);
      const estMin = ms && Number.isFinite(ms) ? Math.max(0.01, Number((ms / 60000).toFixed(3))) : null;
      return {
        id: String(el?.id || uuid()),
        seq: (i + 1) * 10,
        name: String(el?.name || `Operation ${i + 1}`),
        stationCode: String(st?.code || ""),
        workstation: String(st?.name || ""),
        estimatedTimeMin: estMin,
        sampleSize: null,
        frequency: "",
        controlMethod: "",
        critical: false,
        notes: "",
        bubbles: [],
      };
    });
    return {
      id: `routeplan_${String(j.id || uuid())}`,
      jobId: String(j.id || ""),
      stationId: String(j.stationId || st?.id || ""),
      jobName: String(j.name || "Job"),
      stationLabel: st?.id ? `${st.code || "--"} - ${st.name || "Station"}` : "",
      routeName: String(j.name || "Route"),
      revision: "A",
      productRef: pd?.id ? `${pd.code || "--"} - ${pd.name || "Product"}` : "",
      operations: ops,
      updatedAt: new Date().toISOString(),
    };
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
    const syncMirrors = options?.syncMirrors === true;
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
      seedRoutesForState(seeded, { overwrite: false, pruneMissing: false });
      return seeded;
    }
    const best = chooseBestState(candidates);
    if (!best) {
      if (!seedIfMissing) return null;
      const seeded = createDefaultAppState();
      writeAppState(seeded);
      seedRoutesForState(seeded, { overwrite: false, pruneMissing: false });
      return seeded;
    }
    // Keep read path side-effect free by default.
    // Mirror sync can be explicitly requested for legacy migration flows.
    if (syncMirrors) {
      const raw = JSON.stringify(best.state);
      for (const key of ALL_APP_KEYS) {
        try { localStorage.setItem(key, raw); } catch {}
      }
      writeWindowAppState(best.state);
    }
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
    seedRoutesForState(seeded, { overwrite: true, pruneMissing: true });
    return seeded;
  }

  function clearAppStateToEmpty() {
    clearAppStateStorage();
    const empty = createEmptyAppState();
    writeAppState(empty);
    return empty;
  }

  function resetAllData(options = {}) {
    const withRoutes = options?.withRoutes !== false;
    const app = resetAppStateToDefault();
    const st = readModuleState();
    st.store = {};
    writeModuleState(st);
    const seededRoutes = withRoutes ? seedRoutesForState(app, { overwrite: true, pruneMissing: true }) : 0;
    return { app, seededRoutes };
  }

  function clearAllData() {
    const app = clearAppStateToEmpty();
    const st = readModuleState();
    st.store = {};
    writeModuleState(st);
    return { app };
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
        seedRoutesForState(normalized, { overwrite: true, pruneMissing: true });
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

  function normalizeRouteRecord(input) {
    if (!input || typeof input !== "object") return null;
    const src = { ...input };
    const jobId = String(src.jobId || "").trim();
    const id = String(src.id || (jobId ? `routeplan_${jobId}` : `routeplan_${uuid()}`)).trim();
    if (!id) return null;
    return {
      ...src,
      id,
      jobId,
      stationId: String(src.stationId || ""),
      jobName: String(src.jobName || ""),
      stationLabel: String(src.stationLabel || ""),
      routeName: String(src.routeName || src.jobName || "Route"),
      revision: String(src.revision || "A"),
      productRef: String(src.productRef || ""),
      operations: Array.isArray(src.operations) ? src.operations.slice() : [],
      updatedAt: new Date().toISOString(),
    };
  }

  function importRouteRecords(records, options = {}) {
    const replace = options?.replace === true;
    const rows = Array.isArray(records) ? records : [records];
    const normalized = rows.map(normalizeRouteRecord).filter(Boolean);
    if (!normalized.length) return 0;
    const st = readModuleState();
    if (!Array.isArray(st.store[NS_ROUTE]) || replace) st.store[NS_ROUTE] = [];
    const target = Array.isArray(st.store[NS_ROUTE]) ? st.store[NS_ROUTE] : [];
    for (const rec of normalized) {
      const recJobId = String(rec.jobId || "");
      const idx = target.findIndex((x) =>
        String(x?.id || "") === String(rec.id || "") ||
        (recJobId && String(x?.jobId || "") === recJobId)
      );
      if (idx >= 0) {
        target[idx] = { ...target[idx], ...rec, updatedAt: new Date().toISOString() };
      } else {
        target.push({ createdAt: new Date().toISOString(), ...rec, updatedAt: new Date().toISOString() });
      }
    }
    st.store[NS_ROUTE] = target;
    writeModuleState(st);
    return normalized.length;
  }

  function seedRoutesForState(appState, options = {}) {
    const overwrite = options?.overwrite === true;
    const pruneMissing = options?.pruneMissing === true;
    const app = normalizeImportedAppState(appState);
    if (!app) return 0;
    const jobs = Array.isArray(app.jobs) ? app.jobs : [];
    const stationById = new Map((app.stations || []).map((s) => [String(s.id || ""), s]));
    const productById = new Map((app.products || []).map((p) => [String(p.id || ""), p]));
    const st = readModuleState();
    if (!Array.isArray(st.store[NS_ROUTE])) st.store[NS_ROUTE] = [];
    const routes = st.store[NS_ROUTE];
    const jobIds = new Set(jobs.map((j) => String(j?.id || "")).filter(Boolean));
    let changed = 0;
    if (pruneMissing) {
      const before = routes.length;
      st.store[NS_ROUTE] = routes.filter((r) => {
        const rid = String(r?.jobId || "");
        return !rid || jobIds.has(rid);
      });
      if (st.store[NS_ROUTE].length !== before) changed += (before - st.store[NS_ROUTE].length);
    }
    const target = st.store[NS_ROUTE];
    for (const job of jobs) {
      const jid = String(job?.id || "");
      if (!jid) continue;
      const idx = target.findIndex((r) =>
        String(r?.jobId || "") === jid || String(r?.id || "") === `routeplan_${jid}`
      );
      if (idx >= 0 && !overwrite) continue;
      const station = stationById.get(String(job?.stationId || "")) || null;
      const product = productById.get(String(job?.productId || "")) || null;
      const route = buildRouteForJob(job, station, product);
      if (idx >= 0) target[idx] = { ...target[idx], ...route, updatedAt: new Date().toISOString() };
      else target.push({ createdAt: new Date().toISOString(), ...route, updatedAt: new Date().toISOString() });
      changed += 1;
    }
    if (changed > 0) writeModuleState(st);
    return changed;
  }

  function seedRoutesForCurrentApp(options = {}) {
    const app = readAppState({ seedIfMissing: false });
    if (!app) return 0;
    return seedRoutesForState(app, options);
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

  function slugId(raw, prefix = "id") {
    const s = String(raw || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return s || `${prefix}-${Date.now().toString(36)}`;
  }

  function baseEntityTypes() {
    return [
      { id: "product", code: "CAT001", nameSingular: "Product", namePlural: "Products", base: true, locked: true, allowManualItems: false },
      { id: "station", code: "CAT002", nameSingular: "Station", namePlural: "Stations", base: true, locked: true, allowManualItems: false },
      { id: "job", code: "CAT003", nameSingular: "Job", namePlural: "Jobs", base: true, locked: true, allowManualItems: false },
    ];
  }

  function normalizeTypeCode(raw) {
    const s = String(raw || "").trim().toUpperCase();
    if (!s) return "";
    const m = s.match(/^CAT(\d+)$/);
    if (m) return `CAT${String(Number(m[1] || "0")).padStart(3, "0")}`;
    return s;
  }

  function nextTypeCode(rows) {
    let max = 0;
    for (const row of (rows || [])) {
      const code = normalizeTypeCode(row?.code);
      const m = code.match(/^CAT(\d+)$/);
      if (!m) continue;
      max = Math.max(max, Number(m[1] || "0"));
    }
    return `CAT${String(max + 1).padStart(3, "0")}`;
  }

  function shallowEqualKeys(a, b, keys) {
    for (const k of (keys || [])) {
      if (String(a?.[k] ?? "") !== String(b?.[k] ?? "")) return false;
    }
    return true;
  }

  function normalizeEntityType(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const id = slugId(src.id || src.typeId || src.nameSingular || src.namePlural, "type");
    const code = normalizeTypeCode(src.code || "");
    return {
      id,
      code,
      nameSingular: String(src.nameSingular || src.name || id),
      namePlural: String(src.namePlural || `${String(src.nameSingular || src.name || id)}s`),
      description: String(src.description || ""),
      base: !!src.base,
      locked: !!src.locked,
      allowManualItems: src.allowManualItems !== false,
      updatedAt: new Date().toISOString(),
    };
  }

  function normalizeEntityItem(raw, typeId) {
    const src = raw && typeof raw === "object" ? raw : {};
    const id = String(src.id || src.sourceId || uuid());
    return {
      id,
      typeId: String(typeId || src.typeId || ""),
      source: String(src.source || "custom"),
      sourceId: String(src.sourceId || src.id || ""),
      code: String(src.code || ""),
      name: String(src.name || src.label || id),
      imageUrl: String(src.imageUrl || ""),
      meta: (src.meta && typeof src.meta === "object") ? src.meta : {},
      updatedAt: new Date().toISOString(),
    };
  }

  function normalizeEntityLink(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const fromTypeId = String(src.fromTypeId || "");
    const fromId = String(src.fromId || "");
    const toTypeId = String(src.toTypeId || "");
    const toId = String(src.toId || "");
    const relation = String(src.relation || "uses");
    const tupleId = `${fromTypeId}:${fromId}->${toTypeId}:${toId}:${relation}`;
    return {
      id: String(src.id || tupleId || uuid()),
      fromTypeId,
      fromId,
      toTypeId,
      toId,
      relation,
      note: String(src.note || ""),
      updatedAt: new Date().toISOString(),
    };
  }

  function normalizeStructureRule(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const parentTypeId = String(src.parentTypeId || src.fromTypeId || "").trim();
    const childTypeId = String(src.childTypeId || src.toTypeId || "").trim();
    const relation = String(src.relation || "contains").trim() || "contains";
    const id = String(src.id || `${parentTypeId}->${childTypeId}:${relation}` || uuid());
    return {
      id,
      parentTypeId,
      childTypeId,
      relation,
      label: String(src.label || `${parentTypeId} ${relation} ${childTypeId}`),
      allowManyChildren: src.allowManyChildren !== false,
      allowManyParents: src.allowManyParents !== false,
      note: String(src.note || ""),
      updatedAt: new Date().toISOString(),
    };
  }

  function ensureStructureModel(options = {}) {
    const persist = options?.persist !== false;
    const st = readModuleState();
    if (!Array.isArray(st.store[NS_ENTITY_TYPES])) st.store[NS_ENTITY_TYPES] = [];
    if (!Array.isArray(st.store[NS_ENTITY_ITEMS])) st.store[NS_ENTITY_ITEMS] = [];
    if (!Array.isArray(st.store[NS_ENTITY_LINKS])) st.store[NS_ENTITY_LINKS] = [];
    if (!Array.isArray(st.store[NS_STRUCTURE_RULES])) st.store[NS_STRUCTURE_RULES] = [];
    let changed = false;

    const typeRows = st.store[NS_ENTITY_TYPES];
    let itemRows = st.store[NS_ENTITY_ITEMS];
    const linkRows = st.store[NS_ENTITY_LINKS];
    let ruleRows = st.store[NS_STRUCTURE_RULES];
    const nowIso = new Date().toISOString();

    for (const base of baseEntityTypes()) {
      const idx = typeRows.findIndex((x) => String(x?.id || "") === String(base.id || ""));
      const normalized = normalizeEntityType(base);
      if (idx < 0) {
        typeRows.push({ createdAt: nowIso, ...normalized });
        changed = true;
      } else {
        const prev = normalizeEntityType({ ...base, ...typeRows[idx] });
        const next = {
          ...typeRows[idx],
          id: base.id,
          code: normalizeTypeCode(typeRows[idx]?.code || base.code),
          base: true,
          locked: true,
          allowManualItems: false,
          nameSingular: String(typeRows[idx]?.nameSingular || base.nameSingular),
          namePlural: String(typeRows[idx]?.namePlural || base.namePlural),
          description: String(typeRows[idx]?.description || ""),
          updatedAt: nowIso,
        };
        if (!shallowEqualKeys(prev, next, ["code", "nameSingular", "namePlural", "description", "id", "base", "locked", "allowManualItems"])) {
          typeRows[idx] = next;
          changed = true;
        }
      }
    }

    const app = readAppState({ seedIfMissing: false });
    if (app) {
      const sourceMap = [
        { typeId: "product", rows: Array.isArray(app.products) ? app.products : [] },
        { typeId: "station", rows: Array.isArray(app.stations) ? app.stations : [] },
        { typeId: "job", rows: Array.isArray(app.jobs) ? app.jobs : [] },
      ];
      for (const cfg of sourceMap) {
        const liveIds = new Set();
        for (const src of cfg.rows) {
          const sourceId = String(src?.id || "");
          if (!sourceId) continue;
          liveIds.add(sourceId);
          const next = normalizeEntityItem({
            id: sourceId,
            source: "app",
            sourceId,
            code: String(src?.code || ""),
            name: String(src?.name || cfg.typeId),
            imageUrl: String(src?.imageUrl || ""),
            meta: {
              categoryIds: Array.isArray(src?.categoryIds) ? src.categoryIds.slice() : [],
              parentId: String(src?.parentProductId || src?.stationId || src?.productId || ""),
            },
          }, cfg.typeId);
          const idx = itemRows.findIndex((x) =>
            String(x?.typeId || "") === cfg.typeId &&
            (String(x?.sourceId || "") === sourceId || (String(x?.source || "") === "app" && String(x?.id || "") === sourceId))
          );
          if (idx < 0) {
            itemRows.push({ createdAt: nowIso, ...next });
            changed = true;
          } else {
            const prev = itemRows[idx] || {};
            const merged = {
              ...prev,
              id: sourceId,
              typeId: cfg.typeId,
              source: "app",
              sourceId,
              code: next.code,
              name: next.name,
              imageUrl: next.imageUrl,
              meta: next.meta,
              updatedAt: nowIso,
            };
            if (!shallowEqualKeys(prev, merged, ["id", "typeId", "source", "sourceId", "code", "name", "imageUrl"])) {
              itemRows[idx] = merged;
              changed = true;
            }
          }
        }
        const before = itemRows.length;
        st.store[NS_ENTITY_ITEMS] = itemRows.filter((x) => {
          if (String(x?.typeId || "") !== cfg.typeId) return true;
          if (String(x?.source || "") !== "app") return true;
          const sid = String(x?.sourceId || x?.id || "");
          return liveIds.has(sid);
        });
        itemRows = st.store[NS_ENTITY_ITEMS];
        if (st.store[NS_ENTITY_ITEMS].length !== before) {
          changed = true;
        }
      }

      // Rebuild app-derived dependency links from canonical app state.
      const validProductIds = new Set((app.products || []).map((p) => String(p?.id || "")).filter(Boolean));
      const validStationIds = new Set((app.stations || []).map((s) => String(s?.id || "")).filter(Boolean));
      const validJobIds = new Set((app.jobs || []).map((j) => String(j?.id || "")).filter(Boolean));
      const appLinkIds = new Set();
      const upsertAppLink = (fromTypeId, fromId, toTypeId, toId, relation) => {
        const aType = String(fromTypeId || "");
        const aId = String(fromId || "");
        const bType = String(toTypeId || "");
        const bId = String(toId || "");
        const rel = String(relation || "uses");
        if (!aType || !aId || !bType || !bId) return;
        const id = `app:${aType}:${aId}->${bType}:${bId}:${rel}`;
        appLinkIds.add(id);
        const idx = linkRows.findIndex((x) => String(x?.id || "") === id);
        const next = {
          id,
          fromTypeId: aType,
          fromId: aId,
          toTypeId: bType,
          toId: bId,
          relation: rel,
          note: "",
          updatedAt: nowIso,
        };
        if (idx < 0) {
          linkRows.push({ createdAt: nowIso, ...next });
          changed = true;
          return;
        }
        const prev = linkRows[idx] || {};
        if (!shallowEqualKeys(prev, next, ["id", "fromTypeId", "fromId", "toTypeId", "toId", "relation"])) {
          linkRows[idx] = { ...prev, ...next };
          changed = true;
        }
      };

      for (const p of (app.products || [])) {
        const productId = String(p?.id || "");
        const parentId = String(p?.parentProductId || "");
        if (!productId || !parentId) continue;
        if (!validProductIds.has(productId) || !validProductIds.has(parentId)) continue;
        upsertAppLink("product", parentId, "product", productId, "parent");
      }
      for (const j of (app.jobs || [])) {
        const jobId = String(j?.id || "");
        const stationId = String(j?.stationId || "");
        const productId = String(j?.productId || "");
        if (jobId && stationId && validJobIds.has(jobId) && validStationIds.has(stationId)) {
          upsertAppLink("station", stationId, "job", jobId, "contains");
        }
        if (jobId && productId && validJobIds.has(jobId) && validProductIds.has(productId)) {
          upsertAppLink("product", productId, "job", jobId, "has-job");
        }
      }
      const beforeAppLinks = linkRows.length;
      st.store[NS_ENTITY_LINKS] = linkRows.filter((x) => {
        const id = String(x?.id || "");
        if (!id.startsWith("app:")) return true;
        return appLinkIds.has(id);
      });
      if (st.store[NS_ENTITY_LINKS].length !== beforeAppLinks) changed = true;
    }

    const typeIds = new Set((st.store[NS_ENTITY_TYPES] || []).map((x) => String(x?.id || "")).filter(Boolean));
    const itemKey = (it) => `${String(it?.typeId || "")}::${String(it?.id || "")}`;
    const itemKeys = new Set((st.store[NS_ENTITY_ITEMS] || []).map(itemKey));
    const beforeLinks = st.store[NS_ENTITY_LINKS].length;
    st.store[NS_ENTITY_LINKS] = (st.store[NS_ENTITY_LINKS] || []).map((x) => normalizeEntityLink(x)).filter((x) => {
      if (!x.fromTypeId || !x.toTypeId || !x.fromId || !x.toId) return false;
      if (!typeIds.has(x.fromTypeId) || !typeIds.has(x.toTypeId)) return false;
      return itemKeys.has(`${x.fromTypeId}::${x.fromId}`) && itemKeys.has(`${x.toTypeId}::${x.toId}`);
    });
    if (st.store[NS_ENTITY_LINKS].length !== beforeLinks) changed = true;

    const beforeRules = ruleRows.length;
    st.store[NS_STRUCTURE_RULES] = ruleRows
      .map((x) => normalizeStructureRule(x))
      .filter((x) => x.parentTypeId && x.childTypeId && x.parentTypeId !== x.childTypeId)
      .filter((x) => typeIds.has(x.parentTypeId) && typeIds.has(x.childTypeId));
    ruleRows = st.store[NS_STRUCTURE_RULES];
    if (ruleRows.length !== beforeRules) changed = true;

    if (changed && persist) writeModuleState(st);
    return {
      types: Array.isArray(st.store[NS_ENTITY_TYPES]) ? st.store[NS_ENTITY_TYPES].slice() : [],
      items: Array.isArray(st.store[NS_ENTITY_ITEMS]) ? st.store[NS_ENTITY_ITEMS].slice() : [],
      links: Array.isArray(st.store[NS_ENTITY_LINKS]) ? st.store[NS_ENTITY_LINKS].slice() : [],
      rules: Array.isArray(st.store[NS_STRUCTURE_RULES]) ? st.store[NS_STRUCTURE_RULES].slice() : [],
    };
  }

  function readStructureModel(options = {}) {
    return ensureStructureModel(options);
  }

  function listEntityTypes() {
    const model = readStructureModel();
    return model.types.slice().sort((a, b) =>
      String(a?.namePlural || a?.id || "").localeCompare(String(b?.namePlural || b?.id || ""))
    );
  }

  function upsertEntityType(typeRecord) {
    const normalized = normalizeEntityType(typeRecord);
    const model = ensureStructureModel({ persist: false });
    const existingRows = Array.isArray(model?.types) ? model.types.slice() : [];
    const st = readModuleState();
    if (!Array.isArray(st.store[NS_ENTITY_TYPES])) st.store[NS_ENTITY_TYPES] = [];
    const target = st.store[NS_ENTITY_TYPES];
    const idx = target.findIndex((x) => String(x?.id || "") === String(normalized.id || ""));
    const existing = idx >= 0 ? target[idx] : null;
    if (existing?.locked) {
      const lockedCode = normalizeTypeCode(typeRecord?.code || existing.code || normalized.code || "");
      target[idx] = {
        ...existing,
        code: lockedCode || normalizeTypeCode(existing.code || normalized.code || ""),
        nameSingular: String(typeRecord?.nameSingular || existing.nameSingular || existing.id),
        namePlural: String(typeRecord?.namePlural || existing.namePlural || `${existing.nameSingular || existing.id}s`),
        description: String(typeRecord?.description || existing.description || ""),
        updatedAt: new Date().toISOString(),
      };
      writeModuleState(st);
      return target[idx];
    }
    let code = normalizeTypeCode(typeRecord?.code || target[idx]?.code || normalized.code || "");
    if (!code) code = nextTypeCode(existingRows);
    if (existingRows.some((x) => String(x?.id || "") !== String(normalized.id || "") && normalizeTypeCode(x?.code) === code)) {
      code = nextTypeCode(existingRows);
    }
    const hasExplicitId = !!String(typeRecord?.id || typeRecord?.typeId || "").trim();
    let typeId = String(normalized.id || "");
    if (!hasExplicitId && idx < 0) {
      const m = code.match(/^CAT(\d+)$/);
      typeId = m ? `cat${String(Number(m[1] || "0")).padStart(3, "0")}` : typeId;
    }
    if (existingRows.some((x) => String(x?.id || "") !== String(normalized.id || "") && String(x?.id || "") === typeId)) {
      let n = 2;
      const baseId = typeId;
      while (existingRows.some((x) => String(x?.id || "") === typeId)) {
        typeId = `${baseId}-${n++}`;
      }
    }
    const next = {
      createdAt: idx >= 0 ? target[idx]?.createdAt : new Date().toISOString(),
      ...normalized,
      id: typeId,
      code,
      base: false,
      locked: false,
      allowManualItems: true,
      updatedAt: new Date().toISOString(),
    };
    if (idx >= 0) target[idx] = { ...target[idx], ...next };
    else target.push(next);
    writeModuleState(st);
    return next;
  }

  function deleteEntityType(typeId) {
    const id = String(typeId || "");
    if (!id) return false;
    const model = ensureStructureModel({ persist: false });
    const locked = model.types.find((x) => String(x?.id || "") === id)?.locked;
    if (locked) return false;
    const st = readModuleState();
    if (!Array.isArray(st.store[NS_ENTITY_TYPES])) return false;
    const beforeTypes = st.store[NS_ENTITY_TYPES].length;
    st.store[NS_ENTITY_TYPES] = st.store[NS_ENTITY_TYPES].filter((x) => String(x?.id || "") !== id);
    if (Array.isArray(st.store[NS_ENTITY_ITEMS])) {
      st.store[NS_ENTITY_ITEMS] = st.store[NS_ENTITY_ITEMS].filter((x) => String(x?.typeId || "") !== id);
    }
    if (Array.isArray(st.store[NS_ENTITY_LINKS])) {
      st.store[NS_ENTITY_LINKS] = st.store[NS_ENTITY_LINKS].filter((x) =>
        String(x?.fromTypeId || "") !== id && String(x?.toTypeId || "") !== id
      );
    }
    if (Array.isArray(st.store[NS_STRUCTURE_RULES])) {
      st.store[NS_STRUCTURE_RULES] = st.store[NS_STRUCTURE_RULES].filter((x) =>
        String(x?.parentTypeId || "") !== id && String(x?.childTypeId || "") !== id
      );
    }
    if (st.store[NS_ENTITY_TYPES].length === beforeTypes) return false;
    writeModuleState(st);
    return true;
  }

  function listEntities(typeId = "") {
    const model = readStructureModel();
    const id = String(typeId || "");
    const rows = model.items.slice();
    if (!id) return rows;
    return rows.filter((x) => String(x?.typeId || "") === id);
  }

  function upsertEntityItem(itemRecord) {
    const typeId = String(itemRecord?.typeId || "");
    if (!typeId) return null;
    const model = ensureStructureModel({ persist: false });
    const type = model.types.find((x) => String(x?.id || "") === typeId) || null;
    if (!type) return null;
    if (type.locked && type.allowManualItems === false && String(itemRecord?.source || "custom") !== "app") return null;
    const next = normalizeEntityItem(itemRecord, typeId);
    if (type.locked && String(next.source || "") === "app") return null;
    const st = readModuleState();
    if (!Array.isArray(st.store[NS_ENTITY_ITEMS])) st.store[NS_ENTITY_ITEMS] = [];
    const rows = st.store[NS_ENTITY_ITEMS];
    const idx = rows.findIndex((x) =>
      String(x?.typeId || "") === typeId &&
      (String(x?.id || "") === String(next.id || "") || (next.sourceId && String(x?.sourceId || "") === String(next.sourceId || "")))
    );
    const payload = {
      createdAt: idx >= 0 ? rows[idx]?.createdAt : new Date().toISOString(),
      ...next,
      source: "custom",
      sourceId: String(next.sourceId || next.id || ""),
      updatedAt: new Date().toISOString(),
    };
    if (idx >= 0) rows[idx] = { ...rows[idx], ...payload };
    else rows.push(payload);
    writeModuleState(st);
    return payload;
  }

  function deleteEntityItem(typeId, itemId) {
    const tid = String(typeId || "");
    const iid = String(itemId || "");
    if (!tid || !iid) return false;
    const st = readModuleState();
    if (!Array.isArray(st.store[NS_ENTITY_ITEMS])) return false;
    const existing = st.store[NS_ENTITY_ITEMS].find((x) => String(x?.typeId || "") === tid && String(x?.id || "") === iid);
    if (!existing || String(existing?.source || "") === "app") return false;
    const before = st.store[NS_ENTITY_ITEMS].length;
    st.store[NS_ENTITY_ITEMS] = st.store[NS_ENTITY_ITEMS].filter((x) => !(String(x?.typeId || "") === tid && String(x?.id || "") === iid));
    if (Array.isArray(st.store[NS_ENTITY_LINKS])) {
      st.store[NS_ENTITY_LINKS] = st.store[NS_ENTITY_LINKS].filter((x) =>
        !(String(x?.fromTypeId || "") === tid && String(x?.fromId || "") === iid) &&
        !(String(x?.toTypeId || "") === tid && String(x?.toId || "") === iid)
      );
    }
    if (st.store[NS_ENTITY_ITEMS].length === before) return false;
    writeModuleState(st);
    return true;
  }

  function listEntityLinks(filter = {}) {
    const model = readStructureModel();
    let rows = model.links.slice();
    if (filter && typeof filter === "object") {
      if (filter.fromTypeId) rows = rows.filter((x) => String(x?.fromTypeId || "") === String(filter.fromTypeId));
      if (filter.fromId) rows = rows.filter((x) => String(x?.fromId || "") === String(filter.fromId));
      if (filter.toTypeId) rows = rows.filter((x) => String(x?.toTypeId || "") === String(filter.toTypeId));
      if (filter.toId) rows = rows.filter((x) => String(x?.toId || "") === String(filter.toId));
      if (filter.relation) rows = rows.filter((x) => String(x?.relation || "") === String(filter.relation));
    }
    return rows;
  }

  function upsertEntityLink(linkRecord) {
    const next = normalizeEntityLink(linkRecord);
    if (!next.fromTypeId || !next.toTypeId || !next.fromId || !next.toId) return null;
    const model = ensureStructureModel({ persist: false });
    const itemKeys = new Set(model.items.map((it) => `${String(it?.typeId || "")}::${String(it?.id || "")}`));
    if (!itemKeys.has(`${next.fromTypeId}::${next.fromId}`)) return null;
    if (!itemKeys.has(`${next.toTypeId}::${next.toId}`)) return null;
    const st = readModuleState();
    if (!Array.isArray(st.store[NS_ENTITY_LINKS])) st.store[NS_ENTITY_LINKS] = [];
    const rows = st.store[NS_ENTITY_LINKS];
    const idx = rows.findIndex((x) =>
      String(x?.id || "") === String(next.id || "") ||
      (
        String(x?.fromTypeId || "") === next.fromTypeId &&
        String(x?.fromId || "") === next.fromId &&
        String(x?.toTypeId || "") === next.toTypeId &&
        String(x?.toId || "") === next.toId &&
        String(x?.relation || "") === next.relation
      )
    );
    const payload = {
      createdAt: idx >= 0 ? rows[idx]?.createdAt : new Date().toISOString(),
      ...next,
      updatedAt: new Date().toISOString(),
    };
    if (idx >= 0) rows[idx] = { ...rows[idx], ...payload };
    else rows.push(payload);
    writeModuleState(st);
    return payload;
  }

  function deleteEntityLink(linkOrId) {
    const st = readModuleState();
    if (!Array.isArray(st.store[NS_ENTITY_LINKS])) return false;
    const before = st.store[NS_ENTITY_LINKS].length;
    if (typeof linkOrId === "string" || typeof linkOrId === "number") {
      const id = String(linkOrId || "");
      st.store[NS_ENTITY_LINKS] = st.store[NS_ENTITY_LINKS].filter((x) => String(x?.id || "") !== id);
    } else {
      const src = linkOrId && typeof linkOrId === "object" ? linkOrId : {};
      const fromTypeId = String(src.fromTypeId || "");
      const fromId = String(src.fromId || "");
      const toTypeId = String(src.toTypeId || "");
      const toId = String(src.toId || "");
      const relation = String(src.relation || "");
      st.store[NS_ENTITY_LINKS] = st.store[NS_ENTITY_LINKS].filter((x) => !(
        String(x?.fromTypeId || "") === fromTypeId &&
        String(x?.fromId || "") === fromId &&
        String(x?.toTypeId || "") === toTypeId &&
        String(x?.toId || "") === toId &&
        (!relation || String(x?.relation || "") === relation)
      ));
    }
    if (st.store[NS_ENTITY_LINKS].length === before) return false;
    writeModuleState(st);
    return true;
  }

  function listStructureRules(filter = {}) {
    const model = readStructureModel();
    let rows = Array.isArray(model?.rules) ? model.rules.slice() : [];
    if (filter && typeof filter === "object") {
      if (filter.parentTypeId) rows = rows.filter((x) => String(x?.parentTypeId || "") === String(filter.parentTypeId));
      if (filter.childTypeId) rows = rows.filter((x) => String(x?.childTypeId || "") === String(filter.childTypeId));
      if (filter.relation) rows = rows.filter((x) => String(x?.relation || "") === String(filter.relation));
    }
    return rows;
  }

  function upsertStructureRule(ruleRecord) {
    const next = normalizeStructureRule(ruleRecord);
    if (!next.parentTypeId || !next.childTypeId) return null;
    if (next.parentTypeId === next.childTypeId) return null;
    const model = ensureStructureModel({ persist: false });
    const typeIds = new Set((model?.types || []).map((x) => String(x?.id || "")).filter(Boolean));
    if (!typeIds.has(next.parentTypeId) || !typeIds.has(next.childTypeId)) return null;
    const st = readModuleState();
    if (!Array.isArray(st.store[NS_STRUCTURE_RULES])) st.store[NS_STRUCTURE_RULES] = [];
    const rows = st.store[NS_STRUCTURE_RULES];
    const idx = rows.findIndex((x) =>
      String(x?.id || "") === String(next.id || "") ||
      (
        String(x?.parentTypeId || "") === next.parentTypeId &&
        String(x?.childTypeId || "") === next.childTypeId &&
        String(x?.relation || "") === next.relation
      )
    );
    const payload = {
      createdAt: idx >= 0 ? rows[idx]?.createdAt : new Date().toISOString(),
      ...next,
      updatedAt: new Date().toISOString(),
    };
    if (idx >= 0) rows[idx] = { ...rows[idx], ...payload };
    else rows.push(payload);
    writeModuleState(st);
    return payload;
  }

  function deleteStructureRule(ruleOrId) {
    const st = readModuleState();
    if (!Array.isArray(st.store[NS_STRUCTURE_RULES])) return false;
    const before = st.store[NS_STRUCTURE_RULES].length;
    if (typeof ruleOrId === "string" || typeof ruleOrId === "number") {
      const id = String(ruleOrId || "");
      st.store[NS_STRUCTURE_RULES] = st.store[NS_STRUCTURE_RULES].filter((x) => String(x?.id || "") !== id);
    } else {
      const src = ruleOrId && typeof ruleOrId === "object" ? ruleOrId : {};
      const parentTypeId = String(src.parentTypeId || src.fromTypeId || "");
      const childTypeId = String(src.childTypeId || src.toTypeId || "");
      const relation = String(src.relation || "");
      st.store[NS_STRUCTURE_RULES] = st.store[NS_STRUCTURE_RULES].filter((x) => !(
        String(x?.parentTypeId || "") === parentTypeId &&
        String(x?.childTypeId || "") === childTypeId &&
        (!relation || String(x?.relation || "") === relation)
      ));
    }
    if (st.store[NS_STRUCTURE_RULES].length === before) return false;
    writeModuleState(st);
    return true;
  }

  function nodeKey(typeId, id) {
    const t = String(typeId || "").trim();
    const i = String(id || "").trim();
    if (!t || !i) return "";
    return `${t}::${i}`;
  }

  function parseNodeKey(key) {
    const s = String(key || "");
    const idx = s.indexOf("::");
    if (idx <= 0) return { typeId: "", id: "" };
    return { typeId: s.slice(0, idx), id: s.slice(idx + 2) };
  }

  function resolveLinkedItems(startTypeId, startId, targetTypeId = "", options = {}) {
    const fromType = String(startTypeId || "").trim();
    const fromId = String(startId || "").trim();
    const targetType = String(targetTypeId || "").trim();
    if (!fromType || !fromId) return [];
    const includeStart = options?.includeStart === true;
    const bidirectional = options?.bidirectional !== false;
    const maxDepth = Math.max(1, Math.min(20, Number(options?.maxDepth || 8)));

    const model = readStructureModel({ persist: false });
    const links = Array.isArray(model?.links) ? model.links : [];
    const adj = new Map();
    const addEdge = (aType, aId, bType, bId, relation = "") => {
      const aKey = nodeKey(aType, aId);
      if (!aKey) return;
      if (!adj.has(aKey)) adj.set(aKey, []);
      adj.get(aKey).push({
        typeId: String(bType || ""),
        id: String(bId || ""),
        relation: String(relation || ""),
      });
    };
    for (const ln of links) {
      const aType = String(ln?.fromTypeId || "");
      const aId = String(ln?.fromId || "");
      const bType = String(ln?.toTypeId || "");
      const bId = String(ln?.toId || "");
      const relation = String(ln?.relation || "");
      if (!aType || !aId || !bType || !bId) continue;
      addEdge(aType, aId, bType, bId, relation);
      if (bidirectional) addEdge(bType, bId, aType, aId, relation);
    }

    const startKey = nodeKey(fromType, fromId);
    if (!startKey) return [];
    const queue = [{ key: startKey, depth: 0 }];
    const seen = new Set([startKey]);
    const out = new Map();

    if (includeStart && (!targetType || fromType === targetType)) {
      out.set(startKey, { typeId: fromType, id: fromId, depth: 0, relation: "" });
    }

    while (queue.length) {
      const cur = queue.shift();
      if (!cur) break;
      if (cur.depth >= maxDepth) continue;
      const nextRows = adj.get(cur.key) || [];
      for (const next of nextRows) {
        const nk = nodeKey(next.typeId, next.id);
        if (!nk || seen.has(nk)) continue;
        seen.add(nk);
        queue.push({ key: nk, depth: cur.depth + 1 });
        if (!targetType || String(next.typeId || "") === targetType) {
          out.set(nk, {
            typeId: String(next.typeId || ""),
            id: String(next.id || ""),
            depth: cur.depth + 1,
            relation: String(next.relation || ""),
          });
        }
      }
    }
    return [...out.values()];
  }

  function resolveLinkedIds(startTypeId, startId, targetTypeId = "", options = {}) {
    return resolveLinkedItems(startTypeId, startId, targetTypeId, options).map((x) => String(x?.id || "")).filter(Boolean);
  }

  function exportAllSnapshot() {
    return {
      exportedAt: new Date().toISOString(),
      app: readAppState(),
      modules: readModuleState(),
    };
  }

  function importJsonPayload(payload, options = {}) {
    if (!payload || (typeof payload !== "object" && !Array.isArray(payload))) {
      throw new Error("Invalid JSON payload.");
    }
    const src = (payload && typeof payload === "object" && payload.snapshot && typeof payload.snapshot === "object")
      ? payload.snapshot
      : payload;
    const result = {
      mode: "",
      importedApp: false,
      importedModules: false,
      importedRoutes: 0,
      seededRoutes: 0,
    };
    if (Array.isArray(src)) {
      result.mode = "routes-array";
      result.importedRoutes = importRouteRecords(src, { replace: options?.replaceRoutes === true });
    } else if (
      src.app || src.modules
      || src.state
      || (src.data && typeof src.data === "object" && (src.data.app || src.data.modules))
    ) {
      result.mode = "snapshot";
      const appPayload = src.app || src.state || src.data?.app || null;
      const modulesPayload = src.modules || src.data?.modules || null;
      if (appPayload) {
        writeAppState(appPayload);
        result.importedApp = true;
      }
      if (modulesPayload) {
        writeModuleState(modulesPayload);
        result.importedModules = true;
      }
      if (result.importedApp && options?.seedRoutes !== false) {
        result.seededRoutes = seedRoutesForCurrentApp({
          overwrite: options?.seedOverwrite === true,
          pruneMissing: options?.seedPrune !== false,
        });
      }
    } else {
      const app = normalizeImportedAppState(src);
      if (app) {
        result.mode = "app";
        writeAppState(app);
        result.importedApp = true;
        if (options?.seedRoutes !== false) {
          result.seededRoutes = seedRoutesForState(app, {
            overwrite: options?.seedOverwrite === true,
            pruneMissing: options?.seedPrune !== false,
          });
        }
      } else if (Array.isArray(src.routes)) {
        result.mode = "routes-object";
        result.importedRoutes = importRouteRecords(src.routes, { replace: options?.replaceRoutes === true });
      } else if (src.operations || src.jobId || src.routeName) {
        result.mode = "route";
        result.importedRoutes = importRouteRecords(src, { replace: options?.replaceRoutes === true });
      } else {
        throw new Error("Unsupported JSON structure. Expected app, snapshot, or route JSON.");
      }
    }
    window.CANBus?.emit("data:snapshot:imported", result, "module-data");
    return result;
  }

  function importAllSnapshot(snapshot, options = {}) {
    return importJsonPayload(snapshot, options);
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
    const categories = Array.isArray(app?.categories) ? app.categories : [];
    const products = Array.isArray(app?.products) ? app.products : [];
    const stations = Array.isArray(app?.stations) ? app.stations : [];
    const jobs = Array.isArray(app?.jobs) ? app.jobs : [];
    const lines = [];
    lines.push("VMill Offline Backup Report");
    lines.push(`ExportedAt: ${new Date().toISOString()}`);
    lines.push(`Categories: ${categories.length}`);
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
    keys: { APP_KEY, LEGACY_APP_KEYS, ALL_APP_KEYS, MODULE_KEY, NS_ROUTE, NS_ENTITY_TYPES, NS_ENTITY_ITEMS, NS_ENTITY_LINKS, NS_STRUCTURE_RULES },
    readAppState,
    writeAppState,
    createDefaultAppState,
    createEmptyAppState,
    resetAppStateToDefault,
    clearAppStateToEmpty,
    resetAllData,
    clearAllData,
    loadDemoAppState,
    normalizeImportedAppState,
    seedRoutesForState,
    seedRoutesForCurrentApp,
    importRouteRecords,
    importJsonPayload,
    readModuleState,
    writeModuleState,
    upsertRecord,
    deleteRecord,
    listRecords,
    readStructureModel,
    listEntityTypes,
    upsertEntityType,
    deleteEntityType,
    listEntities,
    upsertEntityItem,
    deleteEntityItem,
    listEntityLinks,
    upsertEntityLink,
    deleteEntityLink,
    listStructureRules,
    upsertStructureRule,
    deleteStructureRule,
    resolveLinkedItems,
    resolveLinkedIds,
    exportAllSnapshot,
    importAllSnapshot,
    makeCsvForJobs,
    makeTextReport,
  };
})();
