(() => {
  const APP_KEY = "vmill:app-state:v1";
  const LEGACY_APP_KEYS = ["chrono_drawer_timeline_v5", "chrono_drawer_timeline_v4", "chrono_drawer_timeline_v3"];
  const ALL_APP_KEYS = [APP_KEY, ...LEGACY_APP_KEYS];
  const MODULE_KEY = "vmill:module-data:v1";
  const AUTH_TOKEN_KEY = "vmill:auth:token";
  const AUTH_USER_KEY = "vmill:auth:user";
  const SERVER_URL_KEY = "vmill:server:url";
  const SYNC_REV_KEY = "vmill:sync:rev";
  const SYNC_CLIENT_ID_KEY = "vmill:sync:client-id";
  // Hub ↔ server: long-poll style sync. Visible tab stays responsive; hidden tab backs off to save idle traffic.
  const SYNC_POLL_MS = 8000;
  const SYNC_POLL_HIDDEN_MS = 45000;
  const SYNC_POLL_OFFLINE_MS = 12000;
  const SYNC_POLL_AUTH_ERROR_MS = 30000;
  const SYNC_WRITE_DEBOUNCE_MS = 700;
  const SYNC_WRITE_MAX_WAIT_MS = 2600;
  const SYNC_PUSH_RETRY_MS = 2200;
  const SYNC_CONFLICT_BACKOFF_BASE_MS = 2500;
  const SYNC_CONFLICT_BACKOFF_MAX_MS = 45000;
  const SYNC_CONFLICT_ALERT_MS = 7000;
  const HTTP_TIMEOUT_MS = 8000;
  const TABLE_REMOTE_REFRESH_MS = 15000;
  const WINDOW_STORE_PREFIX = "__VMILL_STORE__:";
  const SYNC_ALERT_STYLE_ID = "vmillSyncAlertStyle";
  const SYNC_ALERT_ID = "vmillSyncAlert";
  const NS_ROUTE = "spacial_routes";
  const NS_ENTITY_TYPES = "global_entity_types";
  const NS_ENTITY_ITEMS = "global_entity_items";
  const NS_ENTITY_LINKS = "global_entity_links";
  const NS_STRUCTURE_RULES = "global_structure_rules";
  const NS_API_TABLE_PREFIX = "api_table:";
  const DEMO_PRESETS = {
    small: "chrono_examples_small.json",
    medium: "chrono_examples_medium.json",
    large: "chrono_examples_large.json",
  };
  const syncSubscribers = new Set();
  const IS_EMBEDDED_FRAME = (() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  })();
  const syncState = {
    initialized: false,
    online: false,
    serverUrl: "",
    revision: 0,
    dirtyApp: false,
    dirtyModules: false,
    applyingRemote: false,
    pollTimer: 0,
    pollInFlight: false,
    pushTimer: 0,
    pushQueued: false,
    pulling: false,
    pushing: false,
    clientId: "",
    dirtySince: 0,
    lastPushAt: 0,
    lastPullAt: 0,
    lastPollAt: 0,
    lastError: "",
    authError: false,
    conflictCount: 0,
    conflictBackoffUntil: 0,
    saveIssueActive: false,
    saveIssueSignature: "",
    tableCache: Object.create(null),
    tableInFlight: Object.create(null),
  };
  const crudState = {
    lastError: "",
  };

  function safeParse(raw, fallback) {
    try {
      const v = JSON.parse(raw);
      return v ?? fallback;
    } catch {
      return fallback;
    }
  }

  function readLs(key, fallback = "") {
    try {
      const v = localStorage.getItem(String(key || ""));
      return v == null ? fallback : v;
    } catch {
      return fallback;
    }
  }

  function writeLs(key, value) {
    try { localStorage.setItem(String(key || ""), String(value ?? "")); } catch {}
  }

  function normalizeServerUrl(raw) {
    const src = String(raw || "").trim();
    if (!src) return "";
    const withProtocol = /^[a-z]+:\/\//i.test(src) ? src : `http://${src}`;
    try {
      const u = new URL(withProtocol);
      return `${u.protocol}//${u.host}`;
    } catch {
      return "";
    }
  }

  function readAuthToken() {
    const raw = String(readLs(AUTH_TOKEN_KEY, "") || "").trim();
    if (!raw) return "";
    if (raw.startsWith("{")) {
      const parsed = safeParse(raw, null);
      return String(parsed?.token || "").trim();
    }
    return raw;
  }

  function authHeaders() {
    const token = readAuthToken();
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  }

  function readSyncRevision() {
    const n = Number(readLs(SYNC_REV_KEY, "0"));
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  }

  function writeSyncRevision(next) {
    const n = Number(next || 0);
    if (!Number.isFinite(n) || n < 0) return;
    syncState.revision = Math.floor(n);
    writeLs(SYNC_REV_KEY, String(syncState.revision));
  }

  function ensureSyncClientId() {
    let cid = String(readLs(SYNC_CLIENT_ID_KEY, "") || "").trim();
    if (!cid) {
      cid = `client_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      writeLs(SYNC_CLIENT_ID_KEY, cid);
    }
    syncState.clientId = cid;
    return cid;
  }

  function emitSyncStatus(extra = {}) {
    const payload = {
      online: !!syncState.online,
      serverUrl: String(syncState.serverUrl || ""),
      revision: Number(syncState.revision || 0),
      authError: !!syncState.authError,
      lastError: String(syncState.lastError || ""),
      dirtyApp: !!syncState.dirtyApp,
      dirtyModules: !!syncState.dirtyModules,
      dirtySince: Number(syncState.dirtySince || 0),
      pushing: !!syncState.pushing,
      pulling: !!syncState.pulling,
      conflictCount: Number(syncState.conflictCount || 0),
      conflictBackoffMs: Math.max(0, Number(syncState.conflictBackoffUntil || 0) - Date.now()),
      ...extra,
    };
    if (payload.lastError && !payload.error) payload.error = payload.lastError;
    for (const fn of syncSubscribers) {
      try { fn(payload); } catch {}
    }
    window.CANBus?.emit("data:sync:status", payload, "module-data");
    refreshSyncSaveAlert();
  }

  function ensureSyncAlertDom() {
    if (typeof document === "undefined") return null;
    if (!document.getElementById(SYNC_ALERT_STYLE_ID)) {
      const style = document.createElement("style");
      style.id = SYNC_ALERT_STYLE_ID;
      style.textContent = `
        #${SYNC_ALERT_ID}{
          position:fixed;
          right:10px;
          bottom:10px;
          z-index:2147483645;
          display:none;
          align-items:center;
          gap:8px;
          max-width:min(560px, calc(100vw - 20px));
          border:1px solid rgba(255,255,255,.24);
          border-radius:10px;
          padding:8px 10px;
          background:rgba(15,22,34,.95);
          color:#e6edf8;
          box-shadow:0 10px 24px rgba(0,0,0,.35);
          font:600 12px/1.3 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        }
        #${SYNC_ALERT_ID}.show{ display:flex; }
        #${SYNC_ALERT_ID}[data-level="error"]{
          border-color:rgba(255,125,147,.62);
          background:rgba(48,20,30,.94);
        }
        #${SYNC_ALERT_ID}[data-level="warn"]{
          border-color:rgba(255,211,122,.58);
          background:rgba(44,34,18,.94);
        }
        #${SYNC_ALERT_ID}[data-level="ok"]{
          border-color:rgba(126,231,162,.56);
          background:rgba(16,44,30,.92);
        }
        #${SYNC_ALERT_ID} .msg{
          min-width:0;
          flex:1 1 auto;
          overflow:hidden;
          text-overflow:ellipsis;
          white-space:nowrap;
        }
        #${SYNC_ALERT_ID} .act{
          border:1px solid rgba(255,255,255,.25);
          background:rgba(255,255,255,.05);
          color:inherit;
          border-radius:999px;
          padding:4px 9px;
          font:700 11px/1 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
          cursor:pointer;
          flex:0 0 auto;
        }
      `;
      document.head.appendChild(style);
    }
    let el = document.getElementById(SYNC_ALERT_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = SYNC_ALERT_ID;
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      el.innerHTML = `
        <div class="msg"></div>
        <button type="button" class="act" data-sync-alert-action="retry">Retry</button>
      `;
      const btn = el.querySelector('[data-sync-alert-action="retry"]');
      btn?.addEventListener("click", () => {
        void pushToServer(true);
      });
      document.body.appendChild(el);
    }
    return el;
  }

  function showSyncAlert(message, level = "warn") {
    if (!message) return;
    const el = ensureSyncAlertDom();
    if (!el) return;
    const msgEl = el.querySelector(".msg");
    if (msgEl) msgEl.textContent = String(message);
    el.setAttribute("data-level", String(level || "warn"));
    el.classList.add("show");
  }

  function hideSyncAlert() {
    if (typeof document === "undefined") return;
    const el = document.getElementById(SYNC_ALERT_ID);
    if (!el) return;
    el.classList.remove("show");
  }

  function currentSyncSaveIssue() {
    const dirty = !!(syncState.dirtyApp || syncState.dirtyModules);
    if (!dirty) return null;
    if (!syncState.online) {
      return { code: "offline", level: "error", message: "Changes are not saved. Server offline." };
    }
    if (syncState.authError) {
      return { code: "auth", level: "error", message: "Changes are not saved. Login expired." };
    }
    if (String(syncState.lastError || "").startsWith("push_failed")) {
      return { code: "push-failed", level: "error", message: "Save failed. Changes are still local only." };
    }
    const conflictWait = conflictBackoffRemainingMs();
    if (conflictWait >= SYNC_CONFLICT_ALERT_MS) {
      return { code: "conflict-backoff", level: "warn", message: "Save delayed by concurrent edits. Retrying automatically." };
    }
    return null;
  }

  function refreshSyncSaveAlert() {
    if (IS_EMBEDDED_FRAME) return;
    const issue = currentSyncSaveIssue();
    const nextSig = issue ? `${issue.code}|${issue.message}` : "";
    const prevSig = String(syncState.saveIssueSignature || "");
    const wasActive = !!syncState.saveIssueActive;
    const active = !!issue;
    syncState.saveIssueActive = active;
    syncState.saveIssueSignature = nextSig;

    if (active && issue) {
      showSyncAlert(issue.message, issue.level);
      if (nextSig !== prevSig) {
        window.CANBus?.emit("data:sync:save-failed", {
          code: issue.code,
          message: issue.message,
          dirtyApp: !!syncState.dirtyApp,
          dirtyModules: !!syncState.dirtyModules,
          serverUrl: String(syncState.serverUrl || ""),
          lastError: String(syncState.lastError || ""),
        }, "module-data");
      }
      return;
    }

    if (wasActive && !active) {
      showSyncAlert("Save recovered. All changes are syncing again.", "ok");
      window.CANBus?.emit("data:sync:save-recovered", {
        serverUrl: String(syncState.serverUrl || ""),
        revision: Number(syncState.revision || 0),
      }, "module-data");
      window.setTimeout(() => {
        if (!syncState.saveIssueActive) hideSyncAlert();
      }, 2800);
      return;
    }

    hideSyncAlert();
  }

  function getOperationRows(src) {
    if (Array.isArray(src?.operations)) return src.operations;
    if (Array.isArray(src?.jobs)) return src.jobs;
    return [];
  }

  function toInternalJobShape(raw) {
    const st = raw && typeof raw === "object" ? raw : {};
    if (!Array.isArray(st.jobs) && Array.isArray(st.operations)) st.jobs = st.operations.slice();
    if (!Object.prototype.hasOwnProperty.call(st, "activeJobId") && Object.prototype.hasOwnProperty.call(st, "activeOperationId")) {
      st.activeJobId = st.activeOperationId;
    }
    return st;
  }

  function toCanonicalOperationShape(raw) {
    const st = raw && typeof raw === "object" ? raw : {};
    if (!Array.isArray(st.operations) && Array.isArray(st.jobs)) st.operations = st.jobs.slice();
    if (!Object.prototype.hasOwnProperty.call(st, "activeOperationId")) {
      st.activeOperationId = st.activeJobId ?? null;
    }
    delete st.jobs;
    delete st.activeJobId;
    return st;
  }

  function attachLegacyJobAliases(raw) {
    const st = raw && typeof raw === "object" ? raw : {};
    try {
      if (!Object.getOwnPropertyDescriptor(st, "jobs")) {
        Object.defineProperty(st, "jobs", {
          configurable: true,
          enumerable: false,
          get() {
            return Array.isArray(st.operations) ? st.operations : [];
          },
          set(next) {
            st.operations = Array.isArray(next) ? next : [];
          },
        });
      }
      if (!Object.getOwnPropertyDescriptor(st, "activeJobId")) {
        Object.defineProperty(st, "activeJobId", {
          configurable: true,
          enumerable: false,
          get() {
            return st.activeOperationId ?? null;
          },
          set(next) {
            st.activeOperationId = next == null ? null : String(next || "");
          },
        });
      }
    } catch {}
    return st;
  }

  function isValidAppState(v) {
    return !!(
      v
      && typeof v === "object"
      && Array.isArray(v.stations)
      && (Array.isArray(v.operations) || Array.isArray(v.jobs))
    );
  }

  function normalizeProductsAndJobs(st) {
    st = toInternalJobShape(st);
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
      family: String(p?.family || p?.meta?.family || ""),
      parentProductId: String(p?.parentProductId || ""),
      parentQty: Number(p?.parentQty || p?.meta?.parentQty || 1) || 1,
      bomParents: normalizeBomParents(
        Array.isArray(p?.bomParents) && p.bomParents.length
          ? p.bomParents
          : (
            Array.isArray(p?.meta?.bomParents) && p.meta.bomParents.length
              ? p.meta.bomParents
              : (p?.parentProductId ? [{ parentProductId: p.parentProductId, qty: Number(p?.parentQty || p?.meta?.parentQty || 1) || 1 }] : [])
          )
      ),
      categoryIds: Array.isArray(p?.categoryIds) ? p.categoryIds.map((x) => String(x || "")).filter((x) => categoryIds.has(x)) : [],
      imageUrl: String(p?.imageUrl || ""),
      meta: normalizeMeta(p?.meta),
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
            family: "",
            parentProductId: "",
            parentQty: 1,
            bomParents: [],
            categoryIds: Array.isArray(job?.categoryIds)
              ? job.categoryIds.map((x) => String(x || "")).filter((x) => categoryIds.has(x))
              : [],
            imageUrl: "",
            meta: {},
          });
        }
        const prod = map.get(key);
        job.productId = prod.id;
        st.jobs[i] = job;
      }
      st.products = [...map.values()];
    }
    applyHydrogenDemoScenario(st);
    const productIds = new Set(st.products.map((p) => String(p?.id || "")).filter(Boolean));
    st.products = st.products.map((p) => {
      const meta = normalizeMeta(p?.meta);
      const family = String(p?.family || meta.family || "");
      const bomParents = normalizeBomParents(
        Array.isArray(p?.bomParents) && p.bomParents.length
          ? p.bomParents
          : (
            Array.isArray(meta?.bomParents) && meta.bomParents.length
              ? meta.bomParents
              : (p?.parentProductId ? [{ parentProductId: p.parentProductId, qty: Number(p?.parentQty || meta.parentQty || 1) || 1 }] : [])
          ),
        productIds,
        p?.id
      );
      const parentProductId = String(bomParents[0]?.parentProductId || "");
      const parentQty = Number(bomParents[0]?.qty || p?.parentQty || meta.parentQty || 1) || 1;
      return {
        ...p,
        family,
        bomParents,
        parentProductId,
        parentQty,
        meta: {
          ...meta,
          ...(family ? { family } : {}),
          bomParents,
          ...(parentQty > 0 ? { parentQty } : {}),
        },
      };
    });
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
      if (!j.name) j.name = "Operation";
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

  function stationScheduleSeed(index = 0) {
    const presets = [
      { scheduleProfile: "single_8x5", shiftStartHour: 8, workingMinutesPerDay: 8 * 60, workingDays: [1, 2, 3, 4, 5] },
      { scheduleProfile: "double_16x5", shiftStartHour: 6, workingMinutesPerDay: 16 * 60, workingDays: [1, 2, 3, 4, 5] },
      { scheduleProfile: "continuous_24x7", shiftStartHour: 0, workingMinutesPerDay: 24 * 60, workingDays: [0, 1, 2, 3, 4, 5, 6] },
    ];
    return { ...presets[Math.abs(Number(index || 0)) % presets.length], offDates: [] };
  }

  function suggestedPlanningForOperation(name = "", index = 0) {
    const text = String(name || "").trim().toLowerCase();
    if (text.includes("oven") || text.includes("cure") || text.includes("dry") || text.includes("batch")) {
      return { estimatedTimeMin: 360, estimatedQtyBase: 20 };
    }
    if (text.includes("weld")) return { estimatedTimeMin: 120, estimatedQtyBase: 5 };
    if (text.includes("deburr") || text.includes("grind") || text.includes("sand")) return { estimatedTimeMin: 70, estimatedQtyBase: 10 };
    if (text.includes("paint") || text.includes("coat") || text.includes("anodiz")) return { estimatedTimeMin: 85, estimatedQtyBase: 10 };
    if (text.includes("machine") && (text.includes("cycle") || text.includes("#"))) {
      return { estimatedTimeMin: 200, estimatedQtyBase: 10 };
    }
    if (text.includes("machine")) return { estimatedTimeMin: 240, estimatedQtyBase: 10 };
    if (text.includes("prep") || text.includes("pick") || text.includes("kit")) return { estimatedTimeMin: 85, estimatedQtyBase: 10 };
    if (text.includes("assembly") || text.includes("align") || text.includes("place")) return { estimatedTimeMin: 140, estimatedQtyBase: 10 };
    if (text.includes("inspect") || text.includes("check") || text.includes("qc")) return { estimatedTimeMin: 55, estimatedQtyBase: 10 };
    if (text.includes("finish") || text.includes("polish")) return { estimatedTimeMin: 90, estimatedQtyBase: 10 };
    if (text.includes("clean") || text.includes("wash")) return { estimatedTimeMin: 45, estimatedQtyBase: 10 };
    if (text.includes("label")) return { estimatedTimeMin: 30, estimatedQtyBase: 20 };
    if (text.includes("pack") || text.includes("ship")) return { estimatedTimeMin: 70, estimatedQtyBase: 20 };
    return { estimatedTimeMin: 110 + ((Math.abs(Number(index || 0)) % 4) * 45), estimatedQtyBase: 10 };
  }

  function normalizePlanningDefaults(state) {
    const st = state && typeof state === "object" ? state : {};
    if (Array.isArray(st.stations)) {
      st.stations = st.stations.map((station, index) => {
        const base = (station && typeof station === "object") ? { ...station } : {};
        const seed = stationScheduleSeed(index);
        const hasOverride = base.scheduleOverride === true || base.scheduleOverride === false
          ? !!base.scheduleOverride
          : !!(base.scheduleProfile || base.shiftStartHour != null || base.workingMinutesPerDay != null || (Array.isArray(base.workingDays) && base.workingDays.length) || (Array.isArray(base.offDates) && base.offDates.length));
        if (!base.scheduleProfile) base.scheduleProfile = seed.scheduleProfile;
        if (base.shiftStartHour == null) base.shiftStartHour = seed.shiftStartHour;
        if (base.workingMinutesPerDay == null) base.workingMinutesPerDay = seed.workingMinutesPerDay;
        if (!Array.isArray(base.workingDays) || !base.workingDays.length) base.workingDays = seed.workingDays.slice();
        if (!Array.isArray(base.offDates)) base.offDates = [];
        base.scheduleOverride = hasOverride;
        return base;
      });
    }
    const ops = getOperationRows(st);
    if (Array.isArray(ops)) {
      for (let i = 0; i < ops.length; i += 1) {
        const op = ops[i];
        if (!op || typeof op !== "object") continue;
        const suggestion = suggestedPlanningForOperation(op.name, i);
        const curEst = Number(op.estimatedTimeMin || 0);
        if (!Number.isFinite(curEst) || curEst <= 0 || curEst < 1) {
          op.estimatedTimeMin = suggestion.estimatedTimeMin;
        }
        if (!(Number(op.estimatedQtyBase) > 0)) op.estimatedQtyBase = suggestion.estimatedQtyBase;
        if (Array.isArray(op.elements)) {
          op.elements = op.elements.map((element, elIndex) => {
            const item = element && typeof element === "object" ? { ...element } : {};
            const elSuggestion = suggestedPlanningForOperation(item.name, elIndex);
            if (!(Number(item.estimatedTimeMin) > 0)) item.estimatedTimeMin = elSuggestion.estimatedTimeMin;
            if (!(Number(item.estimatedQtyBase) > 0)) item.estimatedQtyBase = elSuggestion.estimatedQtyBase;
            return item;
          });
        }
      }
    }
    return st;
  }

  function normalizeImportedAppState(v) {
    const src = (v && typeof v === "object" && v.app && typeof v.app === "object") ? v.app : v;
    if (!isValidAppState(src)) return null;
    const st = toInternalJobShape(safeParse(JSON.stringify(src), null));
    if (!isValidAppState(st)) return null;
    const normalized = normalizePlanningDefaults(normalizeProductsAndJobs(st));
    if (!normalized.activeProductId && normalized.products[0]) normalized.activeProductId = normalized.products[0].id;
    if (!normalized.activeJobId && normalized.jobs[0]) normalized.activeJobId = normalized.jobs[0].id;
    const canonical = toCanonicalOperationShape(normalized);
    return attachLegacyJobAliases(canonical);
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

  function moduleStateStamp(v) {
    const iso = String(v?.meta?.updatedAt || v?.meta?.createdAt || "");
    const ts = Date.parse(iso);
    return Number.isFinite(ts) ? ts : -1;
  }

  function statePayloadScore(v) {
    const products = Array.isArray(v?.products) ? v.products.length : 0;
    const stations = Array.isArray(v?.stations) ? v.stations.length : 0;
    const operations = getOperationRows(v);
    const opCount = operations.length;
    let cycles = 0;
    let elements = 0;
    for (const op of operations) cycles += Array.isArray(op?.cycles) ? op.cycles.length : 0;
    for (const op of operations) elements += Array.isArray(op?.elements) ? op.elements.length : 0;
    return (products * 1000000000) + (stations * 1000000) + (opCount * 1000) + (cycles * 10) + elements;
  }

  function hasPayloadData(v) {
    return statePayloadScore(v) > 0;
  }

  function chooseBestState(candidates) {
    if (!candidates.length) return null;
    const appCandidate = candidates.find((c) => String(c?.key || "") === APP_KEY) || null;
    if (appCandidate && hasPayloadData(appCandidate.state)) return appCandidate;
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
    const p1 = { id: uuid(), code: "P001", name: "Alpha Product", family: "", parentProductId: "", categoryIds: [c1.id], imageUrl: "" };
    const p2 = { id: uuid(), code: "P002", name: "Beta Product", family: "", parentProductId: p1.id, categoryIds: [c2.id], imageUrl: "" };
    const st1 = {
      id: uuid(),
      code: "S01",
      name: "Assembly Line A - Station 1",
      categoryIds: [c1.id],
      scheduleOverride: true,
      scheduleProfile: "single_8x5",
      shiftStartHour: 8,
      workingMinutesPerDay: 8 * 60,
      workingDays: [1, 2, 3, 4, 5],
      offDates: [],
    };
    const st2 = {
      id: uuid(),
      code: "S02",
      name: "Packaging Cell - Station 2",
      categoryIds: [c2.id],
      scheduleOverride: true,
      scheduleProfile: "double_16x5",
      shiftStartHour: 6,
      workingMinutesPerDay: 16 * 60,
      workingDays: [1, 2, 3, 4, 5],
      offDates: [],
    };
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
    return attachLegacyJobAliases(ensureStateMeta({
      activeProductId: p1.id,
      activeOperationId: job1.id,
      categories: [c1, c2],
      products: [p1, p2],
      stations: [st1, st2],
      operations: [job1, job2],
      actionTypes: defaultActionTypes(),
      ui: defaultUiState(),
    }));
  }

  function createEmptyAppState() {
    return attachLegacyJobAliases(ensureStateMeta({
      activeProductId: null,
      activeOperationId: null,
      categories: [],
      products: [],
      stations: [],
      operations: [],
      actionTypes: defaultActionTypes(),
      ui: defaultUiState(),
    }));
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
      const derivedMin = ms && Number.isFinite(ms) ? Math.max(0.01, Number((ms / 60000).toFixed(3))) : null;
      const explicitMin = Number(el?.estimatedTimeMin || 0);
      const suggestion = suggestedPlanningForOperation(el?.name, i);
      const estMin = explicitMin > 0
        ? explicitMin
        : ((derivedMin != null && derivedMin >= 10) ? derivedMin : suggestion.estimatedTimeMin);
      return {
        id: String(el?.id || uuid()),
        seq: (i + 1) * 10,
        name: String(el?.name || `Operation ${i + 1}`),
        stationCode: String(st?.code || ""),
        workstation: String(st?.name || ""),
        estimatedTimeMin: estMin,
        estimatedQtyBase: Math.max(1, Number(el?.estimatedQtyBase || suggestion.estimatedQtyBase || 1) || 1),
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
      productId: String(pd?.id || ""),
      stationId: String(j.stationId || st?.id || ""),
      jobName: String(j.name || "Operation"),
      stationLabel: st?.id ? `${st.code || "--"} - ${st.name || "Station"}` : "",
      routeName: sanitizeLegacyImportLabel(j.name || "Route", "Route"),
      revision: normalizeRouteRevision("A", "A"),
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
    const primary = normalizeImportedAppState(readRawJsonByKey(APP_KEY));
    if (primary) {
      if (syncMirrors) {
        const raw = JSON.stringify(primary);
        for (const key of ALL_APP_KEYS) {
          try { localStorage.setItem(key, raw); } catch {}
        }
        writeWindowAppState(primary);
      }
      return primary;
    }
    const candidates = [];
    for (const key of LEGACY_APP_KEYS) {
      const parsed = normalizeImportedAppState(readRawJsonByKey(key));
      if (!parsed) continue;
      candidates.push({ key, state: parsed, stamp: stateStamp(parsed) });
    }
    const fromWindow = readWindowAppState();
    if (fromWindow) candidates.push({ key: "__window_name__", state: fromWindow, stamp: stateStamp(fromWindow) });
    if (!candidates.length) {
      if (!seedIfMissing) return null;
      const seeded = createEmptyAppState();
      writeAppState(seeded);
      return seeded;
    }
    const best = chooseBestState(candidates);
    if (!best) {
      if (!seedIfMissing) return null;
      const seeded = createEmptyAppState();
      writeAppState(seeded);
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

  function writeAppState(next, options = {}) {
    const normalizedBase = normalizeImportedAppState(next);
    if (!normalizedBase) return;
    const normalized = ensureStateMeta(normalizedBase);
    const canonical = toCanonicalOperationShape(safeParse(JSON.stringify(normalized), {}));
    const raw = JSON.stringify(canonical);
    for (const key of ALL_APP_KEYS) {
      try { localStorage.setItem(key, raw); } catch {}
    }
    writeWindowAppState(canonical);
    if (options?.emit !== false) {
      window.CANBus?.emit("data:app:updated", { key: APP_KEY, mirrors: LEGACY_APP_KEYS.slice() }, "module-data");
    }
    if (!syncState.applyingRemote && options?.markDirty !== false) {
      markDirty("app", String(options?.reason || "app-write"));
    }
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
        const hasSnapshotShape = !!(
          parsed && typeof parsed === "object" && (
            parsed.app || parsed.modules || parsed.snapshot
            || parsed.state || (parsed.data && typeof parsed.data === "object" && (parsed.data.app || parsed.data.modules))
          )
        );
        if (hasSnapshotShape) {
          const imported = importJsonPayload(parsed, { seedRoutes: true, seedOverwrite: true, seedPrune: true });
          const appState = readAppState({ seedIfMissing: false }) || createEmptyAppState();
          return { state: appState, source: candidate, imported };
        }
        const normalized = normalizeImportedAppState(parsed);
        if (!normalized) {
          tries.push(`${candidate} -> invalid app/snapshot format`);
          continue;
        }
        const imported = importJsonPayload(normalized, { seedRoutes: true, seedOverwrite: true, seedPrune: true });
        const appState = readAppState({ seedIfMissing: false }) || normalized;
        return { state: appState, source: candidate, imported };
      } catch (err) {
        tries.push(`${candidate} -> ${err?.message || "fetch failed"}`);
      }
    }
    throw new Error(`Demo load failed for "${file}". Tried: ${tries.join(" | ")}`);
  }

  function ensureModuleState(st, options = {}) {
    const touchUpdated = options?.touchUpdated === true;
    const base = st && typeof st === "object" ? st : {};
    if (!base.meta || typeof base.meta !== "object") base.meta = {};
    const nowIso = new Date().toISOString();
    if (!base.meta.createdAt) base.meta.createdAt = nowIso;
    if (touchUpdated || !base.meta.updatedAt) base.meta.updatedAt = nowIso;
    if (!base.store || typeof base.store !== "object") base.store = {};
    return base;
  }

  function sanitizeLegacyImportLabel(raw, fallback = "") {
    let text = String(raw == null ? "" : raw).trim();
    if (!text) text = String(fallback == null ? "" : fallback).trim();
    if (!text) return "";
    text = text
      .replace(/\s*\((?:imp|import(?:ed)?)\)\s*$/i, "")
      .replace(/\s*[-|/]\s*(?:imp|import(?:ed)?)\s*$/i, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    return text || String(fallback == null ? "" : fallback).trim();
  }

  function normalizeRouteRevision(raw, fallback = "A") {
    const rev = String(raw == null ? "" : raw).trim() || String(fallback == null ? "A" : fallback).trim() || "A";
    if (String(rev).toUpperCase() === "IMP") return "A";
    return rev;
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
      productId: String(src.productId || ""),
      stationId: String(src.stationId || ""),
      jobName: String(src.jobName || ""),
      stationLabel: String(src.stationLabel || ""),
      routeName: sanitizeLegacyImportLabel(src.routeName || src.jobName || "Route", "Route"),
      revision: normalizeRouteRevision(src.revision || "A", "A"),
      productRef: String(src.productRef || ""),
      operations: Array.isArray(src.operations) ? src.operations.slice() : [],
      updatedAt: String(src.updatedAt || new Date().toISOString()),
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
    const operations = Array.isArray(app.operations) ? app.operations : [];
    const stationById = new Map((app.stations || []).map((s) => [String(s.id || ""), s]));
    const productById = new Map((app.products || []).map((p) => [String(p.id || ""), p]));
    const st = readModuleState();
    if (!Array.isArray(st.store[NS_ROUTE])) st.store[NS_ROUTE] = [];
    const routes = st.store[NS_ROUTE];
    const jobIds = new Set(jobs.map((j) => String(j?.id || "")).filter(Boolean));
    const operationProductIds = new Set(operations.map((op) => String(op?.productId || "")).filter(Boolean));
    let changed = 0;
    if (pruneMissing) {
      const before = routes.length;
      st.store[NS_ROUTE] = routes.filter((r) => {
        const rid = String(r?.jobId || "");
        const pid = String(r?.productId || "");
        if (rid) return jobIds.has(rid);
        if (pid) return operationProductIds.has(pid);
        return true;
      });
      if (st.store[NS_ROUTE].length !== before) changed += (before - st.store[NS_ROUTE].length);
    }
    const target = st.store[NS_ROUTE];
    if (jobs.length) {
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
    } else if (operations.length) {
      /**
       * Chrono cycle totalMs is often a few seconds per piece; treating that as "minutes" yields ~0.1 min
       * and unreal factory schedules. Prefer explicit estimatedTimeMin, else name-based shop minutes,
       * and only trust cycle averages when they already look like wall-clock minutes (>= ~5 min).
       */
      const avgOperationMin = (op, opIndex) => {
        const rawEst = Number(op?.estimatedTimeMin || 0);
        const hint = suggestedPlanningForOperation(String(op?.name || ""), opIndex).estimatedTimeMin;
        const cycles = Array.isArray(op?.cycles) ? op.cycles : [];
        let sum = 0;
        let count = 0;
        for (const cyc of cycles) {
          const ms = Number(cyc?.totalMs || 0);
          if (!Number.isFinite(ms) || ms <= 0) continue;
          sum += ms;
          count += 1;
        }
        const fromCyclesMin = count ? (sum / count) / 60000 : null;
        if (Number.isFinite(rawEst) && rawEst >= 3) {
          return Math.round(Math.max(3, rawEst));
        }
        if (fromCyclesMin != null && fromCyclesMin >= 5) {
          return Math.round(Math.max(5, fromCyclesMin));
        }
        if (fromCyclesMin != null && fromCyclesMin > 0) {
          const scaled = fromCyclesMin * 120;
          return Math.round(Math.max(hint, scaled, 25));
        }
        return Math.round(Math.max(25, hint));
      };
      const byProduct = new Map();
      for (const op of operations) {
        const pid = String(op?.productId || "");
        if (!pid) continue;
        if (!byProduct.has(pid)) byProduct.set(pid, []);
        byProduct.get(pid).push(op);
      }
      for (const [pid, ops] of byProduct.entries()) {
        const product = productById.get(pid) || {};
        const routeId = `routeplan_prod_${pid}`;
        const routeNameBase = String(product?.name || product?.code || "Route");
        const sorted = ops.slice().sort((a, b) => {
          const as = Number(a?.seq || 0);
          const bs = Number(b?.seq || 0);
          if (Number.isFinite(as) && Number.isFinite(bs) && as !== bs) return as - bs;
          return String(a?.name || "").localeCompare(String(b?.name || ""));
        });
        const routeOps = sorted.map((op, i) => {
          const station = stationById.get(String(op?.stationId || "")) || null;
          return {
            id: String(op?.id || uuid()),
            seq: Number.isFinite(Number(op?.seq || NaN)) ? Number(op.seq) : ((i + 1) * 10),
            name: String(op?.name || `Operation ${i + 1}`),
            stationCode: String(station?.code || ""),
            workstation: String(station?.name || ""),
            estimatedTimeMin: avgOperationMin(op, i),
            estimatedQtyBase: Math.max(1, Number(op?.estimatedQtyBase || 1) || 1),
            sampleSize: null,
            frequency: "",
            controlMethod: "",
            critical: false,
            notes: "",
            bubbles: [],
          };
        });
        const route = {
          id: routeId,
          jobId: "",
          productId: pid,
          stationId: "",
          jobName: String(routeNameBase || "Route"),
          stationLabel: "",
          routeName: sanitizeLegacyImportLabel(`${routeNameBase} Route`, "Route"),
          revision: normalizeRouteRevision("A", "A"),
          productRef: product?.id ? `${product.code || "--"} - ${product.name || "Product"}` : "",
          operations: routeOps,
          updatedAt: new Date().toISOString(),
        };
        const idx = target.findIndex((r) =>
          String(r?.id || "") === routeId || String(r?.productId || "") === pid
        );
        if (idx >= 0 && !overwrite) continue;
        if (idx >= 0) target[idx] = { ...target[idx], ...route, updatedAt: new Date().toISOString() };
        else target.push({ createdAt: new Date().toISOString(), ...route, updatedAt: new Date().toISOString() });
        changed += 1;
      }
    }
    if (changed > 0) {
      writeModuleState(st, {
        emit: options?.emit !== false,
        markDirty: options?.markDirty !== false,
        reason: options?.reason || "routes-seeded",
      });
    }
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
    const fromLs = ensureModuleState(safeParse(raw, {}), { touchUpdated: false });
    if (raw) return fromLs;
    const fromWinRaw = readWindowModuleState();
    if (!fromWinRaw) return fromLs;
    const fromWin = ensureModuleState(fromWinRaw, { touchUpdated: false });
    return fromWin;
  }

  function writeModuleState(next, options = {}) {
    const st = ensureModuleState(next, { touchUpdated: true });
    try { localStorage.setItem(MODULE_KEY, JSON.stringify(st)); } catch {}
    writeWindowModuleState(st);
    if (options?.emit !== false) {
      window.CANBus?.emit("data:module:updated", { key: MODULE_KEY }, "module-data");
    }
    if (!syncState.applyingRemote && options?.markDirty !== false) {
      markDirty("modules", String(options?.reason || "module-write"));
    }
    return st;
  }

  function upsertRecord(namespace, record) {
    const ns = String(namespace || "default");
    const st = readModuleState();
    if (!Array.isArray(st.store[ns])) st.store[ns] = [];
    const normalizedRoute = ns === NS_ROUTE ? normalizeRouteRecord(record) : null;
    const payload = normalizedRoute || { ...(record || {}) };
    const id = String(payload?.id || `${Date.now()}_${Math.random().toString(16).slice(2)}`);
    const idx = st.store[ns].findIndex((x) => String(x.id || "") === id);
    const next = { ...payload, id, updatedAt: new Date().toISOString() };
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
    const rows = Array.isArray(st.store[ns]) ? st.store[ns].slice() : [];
    if (ns === NS_ROUTE) return rows.map((row) => normalizeRouteRecord(row)).filter(Boolean);
    return rows;
  }

  function apiTableNamespace(table) {
    return `${NS_API_TABLE_PREFIX}${String(table || "").trim()}`;
  }

  function normalizeApiTableName(raw) {
    const key = String(raw || "").trim().toLowerCase();
    const map = {
      node: "nodes",
      nodes: "nodes",
      product: "products",
      products: "products",
      operation: "jobs",
      operations: "jobs",
      job: "jobs",
      jobs: "jobs",
      "chrono/session": "chrono_sessions",
      "chrono/sessions": "chrono_sessions",
      chrono_session: "chrono_sessions",
      chrono_sessions: "chrono_sessions",
      "chrono/event": "chrono_events",
      "chrono/events": "chrono_events",
      chrono_event: "chrono_events",
      chrono_events: "chrono_events",
      "spc/characteristic": "spc_characteristics",
      "spc/characteristics": "spc_characteristics",
      spc_characteristic: "spc_characteristics",
      spc_characteristics: "spc_characteristics",
      "spc/series": "spc_series",
      spc_series: "spc_series",
      "spc/measurement": "spc_measurements",
      "spc/measurements": "spc_measurements",
      spc_measurement: "spc_measurements",
      spc_measurements: "spc_measurements",
      user: "users",
      users: "users",
    };
    return map[key] || "";
  }

  function toSnakeKey(raw) {
    return String(raw || "")
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/[\s\-]+/g, "_")
      .toLowerCase();
  }

  function toCamelKey(raw) {
    const s = String(raw || "");
    return s.replace(/_([a-z0-9])/g, (_, ch) => String(ch || "").toUpperCase());
  }

  function firstRecordValue(rec, key) {
    if (!rec || typeof rec !== "object") return undefined;
    const k = String(key || "");
    if (k in rec) return rec[k];
    const snake = toSnakeKey(k);
    if (snake in rec) return rec[snake];
    const camel = toCamelKey(k);
    if (camel in rec) return rec[camel];
    return undefined;
  }

  function normalizeMeta(raw) {
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  }

  function normalizeBomParents(value, validProductIds = null, selfId = "") {
    const self = String(selfId || "");
    const map = new Map();
    const rows = Array.isArray(value) ? value : [];
    for (const row of rows) {
      const src = row && typeof row === "object" ? row : { parentProductId: row };
      const parentProductId = String(
        src.parentProductId
        || src.parentId
        || src.parent_id
        || src.productId
        || src.product_id
        || ""
      ).trim();
      if (!parentProductId || parentProductId === self) continue;
      if (validProductIds && !validProductIds.has(parentProductId)) continue;
      const qtyRaw = Number(src.qty ?? src.quantity ?? src.parentQty ?? 1);
      const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? Number(Number(qtyRaw).toFixed(4)) : 1;
      const unit = String(src.unit || src.uom || "ea").trim() || "ea";
      const note = String(src.note || src.notes || "").trim();
      const existing = map.get(parentProductId);
      if (existing) {
        existing.qty = Number(Number((existing.qty + qty)).toFixed(4));
        if (!existing.note && note) existing.note = note;
        if (!existing.unit && unit) existing.unit = unit;
      } else {
        map.set(parentProductId, { parentProductId, qty, unit, note });
      }
    }
    return [...map.values()];
  }

  function firstBomParentId(product) {
    const links = normalizeBomParents(product?.bomParents);
    if (links[0]?.parentProductId) return String(links[0].parentProductId);
    return String(product?.parentProductId || "");
  }

  function firstBomParentQty(product) {
    const links = normalizeBomParents(product?.bomParents);
    if (links[0]?.qty > 0) return Number(links[0].qty);
    const legacy = Number(product?.parentQty || product?.meta?.parentQty || 1);
    return Number.isFinite(legacy) && legacy > 0 ? legacy : 1;
  }

  function looksLikeGenericDemoProducts(products) {
    const generic = new Set([
      "alpha product", "beta product", "gamma product", "delta product", "epsilon product", "zeta product",
      "eta product", "theta product", "iota product", "kappa product", "lambda product", "mu product",
      "nu product", "xi product", "omicron product", "pi product",
    ]);
    const names = (Array.isArray(products) ? products : [])
      .map((p) => String(p?.name || "").trim().toLowerCase())
      .filter(Boolean);
    const matches = names.filter((name) => generic.has(name)).length;
    return matches >= Math.min(3, names.length || 0);
  }

  function applyHydrogenDemoScenario(st) {
    if (!Array.isArray(st?.products) || !st.products.length) return st;
    if (!looksLikeGenericDemoProducts(st.products)) return st;
    const templates = [
      { name: "Propulsion Unit Assembly", family: "sellable-assembly", parents: [] },
      { name: "Hydrogen Drive Motor", family: "end-assembly", parents: [{ code: "P001", qty: 1 }] },
      { name: "H2O Aluminum Battery Pack", family: "end-assembly", parents: [{ code: "P001", qty: 1 }] },
      { name: "Power Electronics Module", family: "subassembly", parents: [{ code: "P001", qty: 1 }] },
      { name: "Stator Core Assembly", family: "subassembly", parents: [{ code: "P002", qty: 1 }] },
      { name: "Rotor Shaft Assembly", family: "subassembly", parents: [{ code: "P002", qty: 1 }] },
      { name: "Cooling Manifold", family: "subassembly", parents: [{ code: "P002", qty: 1 }, { code: "P003", qty: 1 }] },
      { name: "Hydrogen Regulator Module", family: "subassembly", parents: [{ code: "P003", qty: 1 }] },
      { name: "Control Harness Kit", family: "component-kit", parents: [{ code: "P002", qty: 1 }, { code: "P003", qty: 1 }, { code: "P004", qty: 1 }] },
      { name: "Housing And Seal Kit", family: "component-kit", parents: [{ code: "P002", qty: 1 }, { code: "P003", qty: 1 }] },
      { name: "Aluminum Cell Cartridge", family: "consumable", parents: [{ code: "P003", qty: 8 }] },
      { name: "Water Activation Plate", family: "component", parents: [{ code: "P003", qty: 2 }] },
      { name: "Sensor And Safety Harness", family: "component-kit", parents: [{ code: "P004", qty: 1 }, { code: "P001", qty: 1 }] },
      { name: "Service Manifold Kit", family: "service", parents: [{ code: "P007", qty: 1 }] },
    ];
    const codeToId = new Map((st.products || []).map((p) => [String(p?.code || "").trim().toUpperCase(), String(p?.id || "")]));
    st.products = st.products.map((product, index) => {
      const tpl = templates[index];
      if (!tpl) return product;
      const bomParents = tpl.parents
        .map((rel) => {
          const parentProductId = codeToId.get(String(rel.code || "").toUpperCase()) || "";
          return parentProductId ? { parentProductId, qty: Number(rel.qty || 1), unit: "ea", note: "" } : null;
        })
        .filter(Boolean);
      const baseMeta = normalizeMeta(product?.meta);
      return {
        ...product,
        name: tpl.name,
        family: tpl.family,
        bomParents,
        parentProductId: String(bomParents[0]?.parentProductId || ""),
        parentQty: Number(bomParents[0]?.qty || 1),
        meta: {
          ...baseMeta,
          family: tpl.family,
          bomParents,
        },
      };
    });
    return st;
  }

  function apiProductFromLocal(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const family = String(firstRecordValue(src, "family") || "").trim();
    const baseMeta = normalizeMeta(firstRecordValue(src, "meta"));
    const bomParents = normalizeBomParents(
      Array.isArray(firstRecordValue(src, "bomParents")) ? firstRecordValue(src, "bomParents") : baseMeta?.bomParents,
      null,
      src?.id
    );
    const parentQty = Number(firstRecordValue(src, "parentQty") || baseMeta?.parentQty || firstBomParentQty({ bomParents })) || 1;
    const meta = {
      ...baseMeta,
      ...(family ? { family } : {}),
      bomParents,
      parentQty,
    };
    return {
      id: String(src.id || uuid()),
      code: String(firstRecordValue(src, "code") || ""),
      name: String(firstRecordValue(src, "name") || "Product"),
      parent_product_id: String(firstBomParentId({ ...src, bomParents }) || firstRecordValue(src, "parent_product_id") || firstRecordValue(src, "parentProductId") || ""),
      image_url: String(firstRecordValue(src, "image_url") || firstRecordValue(src, "imageUrl") || ""),
      meta,
    };
  }

  function localProductFromApi(raw, current = null) {
    const src = raw && typeof raw === "object" ? raw : {};
    const prev = current && typeof current === "object" ? current : {};
    const meta = normalizeMeta(firstRecordValue(src, "meta") || prev.meta || {});
    const productId = String(src.id || prev.id || uuid());
    const bomParents = normalizeBomParents(
      Array.isArray(firstRecordValue(src, "bomParents")) && firstRecordValue(src, "bomParents").length
        ? firstRecordValue(src, "bomParents")
        : (
          Array.isArray(meta?.bomParents) && meta.bomParents.length
            ? meta.bomParents
            : (
              firstRecordValue(src, "parent_product_id") || firstRecordValue(src, "parentProductId") || prev.parentProductId
                ? [{
                  parentProductId: String(firstRecordValue(src, "parent_product_id") || firstRecordValue(src, "parentProductId") || prev.parentProductId || ""),
                  qty: Number(firstRecordValue(src, "parentQty") || meta.parentQty || prev.parentQty || 1) || 1,
                }]
                : []
            )
        ),
      null,
      productId
    );
    const family = String(firstRecordValue(src, "family") || meta.family || prev.family || "");
    const parentProductId = String(firstBomParentId({ ...src, ...prev, bomParents }) || "");
    const parentQty = Number(firstBomParentQty({ ...src, ...prev, bomParents, parentQty: firstRecordValue(src, "parentQty") || meta.parentQty || prev.parentQty })) || 1;
    return {
      ...prev,
      id: productId,
      code: String(firstRecordValue(src, "code") || prev.code || ""),
      name: String(firstRecordValue(src, "name") || prev.name || "Product"),
      family,
      bomParents,
      parentProductId,
      parentQty,
      imageUrl: String(firstRecordValue(src, "image_url") || firstRecordValue(src, "imageUrl") || prev.imageUrl || ""),
      meta: {
        ...meta,
        ...(family ? { family } : {}),
        bomParents,
        parentQty,
      },
      updatedAt: String(firstRecordValue(src, "updated_at") || firstRecordValue(src, "updatedAt") || prev.updatedAt || ""),
    };
  }

  function apiJobFromLocal(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const nodeId = String(
      firstRecordValue(src, "node_id")
      || firstRecordValue(src, "nodeId")
      || firstRecordValue(src, "station_id")
      || firstRecordValue(src, "stationId")
      || ""
    );
    return {
      id: String(src.id || uuid()),
      name: String(firstRecordValue(src, "name") || "Operation"),
      node_id: nodeId,
      product_id: String(firstRecordValue(src, "product_id") || firstRecordValue(src, "productId") || ""),
      status: String(firstRecordValue(src, "status") || "active"),
      meta: normalizeMeta(firstRecordValue(src, "meta")),
    };
  }

  function localJobFromApi(raw, current = null) {
    const src = raw && typeof raw === "object" ? raw : {};
    const prev = current && typeof current === "object" ? current : {};
    const nodeId = String(firstRecordValue(src, "node_id") || firstRecordValue(src, "nodeId") || prev.nodeId || "");
    const stationIdFromSrc = String(firstRecordValue(src, "station_id") || firstRecordValue(src, "stationId") || "");
    const stationId = String(stationIdFromSrc || nodeId || prev.stationId || prev.nodeId || "");
    return {
      ...prev,
      id: String(src.id || prev.id || uuid()),
      name: String(firstRecordValue(src, "name") || prev.name || "Operation"),
      productId: String(firstRecordValue(src, "product_id") || firstRecordValue(src, "productId") || prev.productId || ""),
      nodeId,
      stationId,
      status: String(firstRecordValue(src, "status") || prev.status || "active"),
      meta: normalizeMeta(firstRecordValue(src, "meta") || prev.meta || {}),
      updatedAt: String(firstRecordValue(src, "updated_at") || firstRecordValue(src, "updatedAt") || prev.updatedAt || ""),
    };
  }

  function stableJson(v) {
    try {
      return JSON.stringify(v ?? {});
    } catch {
      return "";
    }
  }

  function normalizeRecordForCompare(v) {
    if (Array.isArray(v)) return v.map((x) => normalizeRecordForCompare(x));
    if (!v || typeof v !== "object") return v;
    const out = {};
    const keys = Object.keys(v).sort();
    for (const k of keys) {
      if (k === "updatedAt" || k === "createdAt") continue;
      out[k] = normalizeRecordForCompare(v[k]);
    }
    return out;
  }

  function recordsEquivalentLoose(a, b) {
    return stableJson(normalizeRecordForCompare(a)) === stableJson(normalizeRecordForCompare(b));
  }

  function normalizePayloadForServer(table, raw, id = "") {
    const src = raw && typeof raw === "object" ? { ...raw } : {};
    if (id && !src.id) src.id = id;
    if (table === "products") return apiProductFromLocal(src);
    if (table === "jobs") return apiJobFromLocal(src);
    if (table === "nodes") {
      return {
        ...src,
        id: String(src.id || id || uuid()),
        parent_id: firstRecordValue(src, "parent_id") ?? firstRecordValue(src, "parentId") ?? null,
        order_index: Number(firstRecordValue(src, "order_index") ?? firstRecordValue(src, "order") ?? 0) || 0,
        image_url: String(firstRecordValue(src, "image_url") || firstRecordValue(src, "imageUrl") || ""),
        type: String(firstRecordValue(src, "type") || "Custom"),
        name: String(firstRecordValue(src, "name") || "Node"),
        meta: normalizeMeta(firstRecordValue(src, "meta")),
      };
    }
    if ("meta_json" in src && !("meta" in src)) {
      src.meta = normalizeMeta(src.meta_json);
      delete src.meta_json;
    }
    if ("data_json" in src && !("data" in src)) {
      src.data = normalizeMeta(src.data_json);
      delete src.data_json;
    }
    return src;
  }

  function readLocalTable(table, params = {}) {
    if (table === "products") {
      const app = readAppState({ seedIfMissing: false }) || createEmptyAppState();
      const rows = (app.products || []).map((p) => apiProductFromLocal(p));
      return filterTableRows(rows, params);
    }
    if (table === "jobs") {
      const app = readAppState({ seedIfMissing: false }) || createEmptyAppState();
      const rows = (app.jobs || []).map((j) => apiJobFromLocal(j));
      return filterTableRows(rows, params);
    }
    return filterTableRows(listRecords(apiTableNamespace(table)), params);
  }

  function mergeLocalTableRecord(table, raw) {
    if (!raw || typeof raw !== "object") return null;
    if (table === "products") {
      const app = readAppState({ seedIfMissing: false }) || createEmptyAppState();
      if (!Array.isArray(app.products)) app.products = [];
      const id = String(raw.id || uuid());
      const idx = app.products.findIndex((x) => String(x?.id || "") === id);
      const prev = idx >= 0 ? app.products[idx] : null;
      const next = localProductFromApi({ ...raw, id }, prev);
      const changed = idx < 0 || !prev || (
        String(prev.code || "") !== String(next.code || "")
        || String(prev.name || "") !== String(next.name || "")
        || String(prev.parentProductId || "") !== String(next.parentProductId || "")
        || Number(prev.parentQty || 1) !== Number(next.parentQty || 1)
        || stableJson(prev.bomParents) !== stableJson(next.bomParents)
        || String(prev.imageUrl || "") !== String(next.imageUrl || "")
        || stableJson(prev.meta) !== stableJson(next.meta)
      );
      if (changed) {
        if (idx >= 0) app.products[idx] = { ...app.products[idx], ...next };
        else app.products.push(next);
        if (!app.activeProductId) app.activeProductId = next.id;
        writeAppState(app);
      }
      return apiProductFromLocal(next);
    }
    if (table === "jobs") {
      const app = readAppState({ seedIfMissing: false }) || createEmptyAppState();
      if (!Array.isArray(app.jobs)) app.jobs = [];
      const id = String(raw.id || uuid());
      const idx = app.jobs.findIndex((x) => String(x?.id || "") === id);
      const prev = idx >= 0 ? app.jobs[idx] : null;
      const next = localJobFromApi({ ...raw, id }, prev);
      const changed = idx < 0 || !prev || (
        String(prev.name || "") !== String(next.name || "")
        || String(prev.productId || "") !== String(next.productId || "")
        || String(prev.nodeId || "") !== String(next.nodeId || "")
        || String(prev.stationId || "") !== String(next.stationId || "")
        || String(prev.status || "") !== String(next.status || "")
        || stableJson(prev.meta) !== stableJson(next.meta)
      );
      if (changed) {
        if (idx >= 0) app.jobs[idx] = { ...app.jobs[idx], ...next };
        else app.jobs.push(next);
        if (!app.activeJobId) app.activeJobId = next.id;
        writeAppState(app);
      }
      return apiJobFromLocal(next);
    }
    const ns = apiTableNamespace(table);
    const id = String(raw?.id || "");
    if (id) {
      const prev = listRecords(ns).find((x) => String(x?.id || "") === id) || null;
      if (prev && recordsEquivalentLoose(prev, raw)) return prev;
    }
    return upsertRecord(ns, raw);
  }

  function removeLocalTableRecord(table, id) {
    const rid = String(id || "");
    if (!rid) return false;
    if (table === "products") {
      const app = readAppState({ seedIfMissing: false }) || createEmptyAppState();
      const before = Array.isArray(app.products) ? app.products.length : 0;
      app.products = (app.products || []).filter((x) => String(x?.id || "") !== rid);
      const validIds = new Set(app.products.map((x) => String(x?.id || "")).filter(Boolean));
      for (const product of app.products) {
        const existingLinks = normalizeBomParents(
          Array.isArray(product?.bomParents) && product.bomParents.length
            ? product.bomParents
            : (String(product?.parentProductId || "") ? [{ parentProductId: String(product.parentProductId || ""), qty: Number(product?.parentQty || product?.meta?.parentQty || 1) || 1 }] : []),
          null,
          product?.id
        );
        const nextBomParents = normalizeBomParents(existingLinks, validIds, product?.id)
          .filter((rel) => String(rel?.parentProductId || "") !== rid);
        if (stableJson(existingLinks) !== stableJson(nextBomParents) || String(product?.parentProductId || "") === rid) {
          product.bomParents = nextBomParents;
          product.parentProductId = String(nextBomParents[0]?.parentProductId || "");
          product.parentQty = Number(nextBomParents[0]?.qty || 1) || 1;
          product.meta = {
            ...normalizeMeta(product?.meta),
            ...(String(product?.family || "") ? { family: String(product.family || "") } : {}),
            bomParents: nextBomParents,
            parentQty: product.parentQty,
          };
        }
      }
      if (String(app.activeProductId || "") === rid) app.activeProductId = app.products[0]?.id || null;
      for (const job of (app.jobs || [])) {
        if (String(job?.productId || "") === rid) job.productId = "";
      }
      if (app.products.length !== before) {
        writeAppState(app);
        return true;
      }
      return false;
    }
    if (table === "jobs") {
      const app = readAppState({ seedIfMissing: false }) || createEmptyAppState();
      const before = Array.isArray(app.jobs) ? app.jobs.length : 0;
      app.jobs = (app.jobs || []).filter((x) => String(x?.id || "") !== rid);
      if (String(app.activeJobId || "") === rid) app.activeJobId = app.jobs[0]?.id || null;
      if (app.jobs.length !== before) {
        writeAppState(app);
        return true;
      }
      return false;
    }
    return deleteRecord(apiTableNamespace(table), rid);
  }

  function filterTableRows(rows, params = {}) {
    const list = Array.isArray(rows) ? rows.slice() : [];
    const filters = params && typeof params === "object" ? Object.entries(params) : [];
    if (!filters.length) return list;
    return list.filter((row) => {
      for (const [key, value] of filters) {
        if (value == null || value === "") continue;
        const got = firstRecordValue(row, key);
        if (String(got ?? "") !== String(value)) return false;
      }
      return true;
    });
  }

  function tableQueryString(params = {}) {
    const q = params && typeof params === "object" ? params : {};
    const usp = new URLSearchParams();
    for (const [key, value] of Object.entries(q)) {
      if (value == null || value === "") continue;
      usp.set(toSnakeKey(key), String(value));
    }
    const raw = usp.toString();
    return raw ? `?${raw}` : "";
  }

  function hasTableParams(params = {}) {
    const q = params && typeof params === "object" ? params : {};
    return Object.entries(q).some(([, value]) => !(value == null || value === ""));
  }

  function tableReqKey(table, params = {}) {
    return `${String(table || "").trim()}${tableQueryString(params)}`;
  }

  function clearTableFetchCache(table = "") {
    const wanted = String(table || "").trim();
    for (const key of Object.keys(syncState.tableCache || {})) {
      if (!wanted || key === wanted || key.startsWith(`${wanted}?`)) delete syncState.tableCache[key];
    }
  }

  function tableCacheFresh(reqKey) {
    const meta = syncState.tableCache?.[String(reqKey || "")];
    if (!meta || typeof meta !== "object") return false;
    const ts = Number(meta.ts || 0);
    const rev = Number(meta.rev || 0);
    if (!Number.isFinite(ts) || ts <= 0) return false;
    if (rev !== Number(syncState.revision || 0)) return false;
    return (Date.now() - ts) <= TABLE_REMOTE_REFRESH_MS;
  }

  async function fetchTableAndMerge(table, params = {}, options = {}) {
    const reqKey = tableReqKey(table, params);
    const force = options?.force === true;
    const awaitResult = options?.awaitResult === true;
    const captureError = options?.captureError === true;

    if (!syncState.online || !getServerUrl() || !readAuthToken()) return null;
    if (!force && tableCacheFresh(reqKey)) return null;

    const inFlight = syncState.tableInFlight?.[reqKey];
    if (inFlight) {
      if (awaitResult) {
        try { await inFlight; } catch {}
      }
      return null;
    }

    const task = (async () => {
      const remote = await requestTableApi("GET", table, "", null, params);
      const remoteItems = Array.isArray(remote.data?.items)
        ? remote.data.items
        : (table === "users" && Array.isArray(remote.data?.users) ? remote.data.users : null);
      if (!remote.ok || !Array.isArray(remoteItems)) {
        syncState.tableCache[reqKey] = {
          ts: Date.now(),
          rev: Number(syncState.revision || 0),
          ok: false,
        };
        if (captureError) crudState.lastError = String(remote?.data?.error || remote?.status || "");
        return null;
      }
      syncState.applyingRemote = true;
      try {
        for (const item of remoteItems) mergeLocalTableRecord(table, item);
      } finally {
        syncState.applyingRemote = false;
      }
      syncState.tableCache[reqKey] = {
        ts: Date.now(),
        rev: Number(syncState.revision || 0),
        ok: true,
        count: remoteItems.length,
      };
      return remoteItems.slice();
    })().finally(() => {
      delete syncState.tableInFlight[reqKey];
    });

    syncState.tableInFlight[reqKey] = task;
    if (!awaitResult) return null;
    try {
      return await task;
    } catch {
      return null;
    }
  }

  async function requestTableApi(method, table, id = "", payload = null, params = {}) {
    const baseUrl = getServerUrl();
    if (!syncState.online || !baseUrl || !readAuthToken()) {
      return { ok: false, status: 0, data: { error: "offline" } };
    }
    const rid = String(id || "").trim();
    const path = rid
      ? `${baseUrl}/api/${table}/${encodeURIComponent(rid)}`
      : `${baseUrl}/api/${table}${method === "GET" ? tableQueryString(params) : ""}`;
    const headers = { ...authHeaders() };
    const init = { method: String(method || "GET").toUpperCase(), cache: "no-store", headers };
    if (payload && init.method !== "GET") {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(payload);
    }
    const out = await fetchJson(path, init);
    if (out.status === 401 || out.status === 403) {
      syncState.authError = true;
      emitSyncStatus({ reason: "table-auth-failed", table, status: out.status });
    }
    return out;
  }

  async function list(tableName, params = {}) {
    const table = normalizeApiTableName(tableName);
    if (!table) return [];
    crudState.lastError = "";
    const localRows = readLocalTable(table, params);
    if (!syncState.online || !getServerUrl() || !readAuthToken()) return localRows;

    const hasFilters = hasTableParams(params);
    if (!localRows.length) {
      await fetchTableAndMerge(table, params, { force: true, awaitResult: true, captureError: true });
      return readLocalTable(table, params);
    }

    // Local-first for render loops; refresh server table in background only when stale.
    void fetchTableAndMerge(table, params, { force: false, awaitResult: false, captureError: false });
    if (hasFilters) return readLocalTable(table, params);
    return localRows;
  }

  async function create(tableName, payload = {}) {
    const table = normalizeApiTableName(tableName);
    if (!table) return null;
    crudState.lastError = "";
    const localPayload = normalizePayloadForServer(table, payload);
    const localItem = mergeLocalTableRecord(table, localPayload);
    const remote = await requestTableApi("POST", table, "", normalizePayloadForServer(table, localItem || localPayload));
    const remoteItem = remote.data?.item || remote.data?.user || null;
    clearTableFetchCache(table);
    if (!remote.ok || !remoteItem) {
      crudState.lastError = String(remote?.data?.error || remote?.status || "");
      return localItem;
    }
    return mergeLocalTableRecord(table, remoteItem);
  }

  async function update(tableName, id, patch = {}) {
    const table = normalizeApiTableName(tableName);
    const rid = String(id || "").trim();
    if (!table || !rid) return null;
    crudState.lastError = "";
    const mustServerFirst = table === "spc_measurements" || table === "chrono_events" || table === "chrono_sessions";
    if (mustServerFirst && syncState.online && getServerUrl() && readAuthToken()) {
      const remoteFirst = await requestTableApi("PUT", table, rid, normalizePayloadForServer(table, { ...(patch || {}), id: rid }, rid));
      const remoteFirstItem = remoteFirst.data?.item || remoteFirst.data?.user || null;
      clearTableFetchCache(table);
      if (!remoteFirst.ok || !remoteFirstItem) {
        crudState.lastError = String(remoteFirst?.data?.error || remoteFirst?.status || "");
        return null;
      }
      return mergeLocalTableRecord(table, remoteFirstItem);
    }
    const localRows = readLocalTable(table, {});
    const current = localRows.find((x) => String(x?.id || "") === rid) || { id: rid };
    const merged = { ...current, ...(patch && typeof patch === "object" ? patch : {}), id: rid };
    const localItem = mergeLocalTableRecord(table, normalizePayloadForServer(table, merged, rid));
    const remote = await requestTableApi("PUT", table, rid, normalizePayloadForServer(table, merged, rid));
    const remoteItem = remote.data?.item || remote.data?.user || null;
    clearTableFetchCache(table);
    if (!remote.ok || !remoteItem) {
      crudState.lastError = String(remote?.data?.error || remote?.status || "");
      return localItem;
    }
    return mergeLocalTableRecord(table, remoteItem);
  }

  async function remove(tableName, id) {
    const table = normalizeApiTableName(tableName);
    const rid = String(id || "").trim();
    if (!table || !rid) return false;
    crudState.lastError = "";
    const remote = await requestTableApi("DELETE", table, rid);
    if (remote.ok) {
      clearTableFetchCache(table);
      return removeLocalTableRecord(table, rid);
    }
    if (remote.status === 0) {
      clearTableFetchCache(table);
      return removeLocalTableRecord(table, rid);
    }
    crudState.lastError = String(remote?.data?.error || remote?.status || "");
    return false;
  }

  function getLastCrudError() {
    return String(crudState.lastError || "");
  }

  function slugId(raw, prefix = "id") {
    const s = String(raw || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return s || `${prefix}-${Date.now().toString(36)}`;
  }

  function coreRoleDefaultAttributes(role) {
    const r = String(role || "").trim().toLowerCase();
    const mk = (name, key, type = "string", required = false) => ({
      id: `core_${r}_${String(key || name || "").toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
      name: String(name || ""),
      key: String(key || name || ""),
      type: String(type || "string"),
      required: !!required,
      enabled: true,
      order: 0,
      core: true,
    });
    if (r === "product") {
      return [
        mk("Name", "name", "string", true),
        mk("Family", "family", "string", false),
        mk("Parent Product", "parentProductId", "string", false),
        mk("Image URL", "imageUrl", "string", false),
      ];
    }
    if (r === "station") {
      return [
        mk("Name", "name", "string", true),
        mk("Image URL", "imageUrl", "string", false),
      ];
    }
    if (r === "job") {
      return [
        mk("Name", "name", "string", true),
        mk("Station", "stationId", "string", true),
        mk("Product", "productId", "string", false),
        mk("Status", "status", "string", false),
        mk("Image URL", "imageUrl", "string", false),
      ];
    }
    return [];
  }

  function canonicalAttributeKey(attr) {
    return String(attr?.key || attr?.name || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  function mergeCoreRoleAttributes(rawAttrs, role) {
    const r = normalizeModuleRole(role, role);
    const own = normalizeEntityAttributes(rawAttrs).filter((attr) => {
      const key = canonicalAttributeKey(attr);
      if (!key) return true;
      if ((r === "product" || r === "station") && key === "code") return false;
      return true;
    });
    const defaults = normalizeEntityAttributes(coreRoleDefaultAttributes(role));
    if (!defaults.length) return own;
    const existingKeys = new Set(own.map((attr) => canonicalAttributeKey(attr)).filter(Boolean));
    const merged = own.slice();
    for (const row of defaults) {
      const key = canonicalAttributeKey(row);
      if (!key || existingKeys.has(key)) continue;
      merged.push({ ...row, order: merged.length });
      existingKeys.add(key);
    }
    return normalizeEntityAttributes(merged);
  }

  function baseEntityTypes() {
    return [
      {
        id: "product",
        code: "CAT001",
        nameSingular: "Product",
        namePlural: "Products",
        moduleRole: "product",
        icon: "box",
        attributes: coreRoleDefaultAttributes("product"),
        base: true,
        locked: false,
        allowManualItems: true,
      },
      {
        id: "station",
        code: "CAT002",
        nameSingular: "Station",
        namePlural: "Stations",
        moduleRole: "station",
        icon: "factory",
        attributes: coreRoleDefaultAttributes("station"),
        base: true,
        locked: false,
        allowManualItems: true,
      },
      {
        id: "job",
        code: "CAT003",
        nameSingular: "Operation",
        namePlural: "Operations",
        moduleRole: "job",
        icon: "clipboard",
        attributes: coreRoleDefaultAttributes("job"),
        base: true,
        locked: false,
        allowManualItems: true,
      },
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

  function normalizeModuleRole(rawRole, fallbackTypeId = "") {
    const src = String(rawRole || "").trim().toLowerCase();
    if (src) return src;
    const fallback = String(fallbackTypeId || "").trim().toLowerCase();
    if (!fallback) return "custom";
    if (["product", "station", "job", "route", "machine", "zone", "atelier", "site"].includes(fallback)) return fallback;
    return "custom";
  }

  function normalizeEntityAttributes(raw) {
    const rows = Array.isArray(raw) ? raw : [];
    const allowed = new Set(["string", "number", "boolean", "date", "timestamp", "text"]);
    const out = rows
      .map((row, idx) => {
        const parsedOrder = Number(row?.order);
        const order = Number.isFinite(parsedOrder) ? parsedOrder : idx;
        return {
        id: String(row?.id || uuid()),
        name: String(row?.name || "").trim(),
        type: allowed.has(String(row?.type || "string").toLowerCase())
          ? String(row?.type || "string").toLowerCase()
          : "string",
          required: !!row?.required,
          enabled: row?.enabled !== false,
          order,
          core: !!row?.core,
          key: String(row?.key || ""),
        };
      })
      .filter((row) => !!row.name);
    out.sort((a, b) => Number(a?.order || 0) - Number(b?.order || 0));
    return out.map((row, idx) => ({ ...row, order: idx }));
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
      moduleRole: normalizeModuleRole(src.moduleRole, id),
      description: String(src.description || ""),
      icon: String(src.icon || ""),
      imageUrl: String(src.imageUrl || ""),
      attributes: normalizeEntityAttributes(src.attributes),
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
      const byRoleIdx = typeRows.findIndex((x) => normalizeModuleRole(x?.moduleRole, x?.id) === base.moduleRole);
      const byIdIdx = typeRows.findIndex((x) => String(x?.id || "") === String(base.id || ""));
      const idx = byRoleIdx >= 0 ? byRoleIdx : byIdIdx;
      if (idx < 0) {
        typeRows.push({
          ...base,
          updatedAt: nowIso,
          createdAt: nowIso,
        });
        changed = true;
      } else {
        const prev = normalizeEntityType({ ...typeRows[idx] });
        const next = {
          ...typeRows[idx],
          id: String(typeRows[idx]?.id || base.id),
          code: normalizeTypeCode(typeRows[idx]?.code || base.code),
          moduleRole: normalizeModuleRole(base.moduleRole, base.id),
          base: true,
          locked: false,
          allowManualItems: true,
          nameSingular: String(typeRows[idx]?.nameSingular || base.nameSingular),
          namePlural: String(typeRows[idx]?.namePlural || base.namePlural),
          description: String(typeRows[idx]?.description || ""),
          attributes: mergeCoreRoleAttributes(typeRows[idx]?.attributes, base.moduleRole),
          updatedAt: nowIso,
        };
        const changedCore = !shallowEqualKeys(prev, next, ["code", "nameSingular", "namePlural", "moduleRole", "description", "id", "base", "locked", "allowManualItems"]);
        const changedAttrs = JSON.stringify(prev?.attributes || []) !== JSON.stringify(next?.attributes || []);
        if (changedCore || changedAttrs) {
          typeRows[idx] = next;
          changed = true;
        }
      }
    }

    for (let i = 0; i < typeRows.length; i += 1) {
      const row = typeRows[i] || {};
      const nextRole = normalizeModuleRole(row.moduleRole, row.id);
      const normAttrs = mergeCoreRoleAttributes(row?.attributes, nextRole);
      const attrsChanged = JSON.stringify(row?.attributes || []) !== JSON.stringify(normAttrs);
      if (String(row.moduleRole || "") !== nextRole || attrsChanged) {
        typeRows[i] = { ...row, moduleRole: nextRole, attributes: normAttrs, updatedAt: nowIso };
        changed = true;
      }
    }

    const app = readAppState({ seedIfMissing: false });
    if (app) {
      const resolveRoleTypeId = (role) => {
        const wanted = normalizeModuleRole(role, role);
        const byRole = typeRows.find((x) => normalizeModuleRole(x?.moduleRole, x?.id) === wanted) || null;
        return byRole?.id ? String(byRole.id || "") : "";
      };
      const productTypeId = resolveRoleTypeId("product");
      const stationTypeId = resolveRoleTypeId("station");
      const jobTypeId = resolveRoleTypeId("job");
      const sourceMap = [
        { typeId: productTypeId, rows: Array.isArray(app.products) ? app.products : [] },
        { typeId: stationTypeId, rows: Array.isArray(app.stations) ? app.stations : [] },
        { typeId: jobTypeId, rows: Array.isArray(app.jobs) ? app.jobs : [] },
      ].filter((cfg) => String(cfg.typeId || ""));
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
        upsertAppLink(productTypeId, parentId, productTypeId, productId, "parent");
      }
      for (const j of (app.jobs || [])) {
        const jobId = String(j?.id || "");
        const stationId = String(j?.stationId || "");
        const productId = String(j?.productId || "");
        if (jobId && stationId && validJobIds.has(jobId) && validStationIds.has(stationId)) {
          upsertAppLink(stationTypeId, stationId, jobTypeId, jobId, "contains");
        }
        if (jobId && productId && validJobIds.has(jobId) && validProductIds.has(productId)) {
          upsertAppLink(productTypeId, productId, jobTypeId, jobId, "has-job");
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

  function resolveEntityTypeByRole(role) {
    const wanted = normalizeModuleRole(role, "");
    const model = readStructureModel({ persist: false });
    const rows = Array.isArray(model?.types) ? model.types : [];
    if (!rows.length) return null;
    const exact = rows.find((t) => normalizeModuleRole(t?.moduleRole, t?.id) === wanted) || null;
    if (exact) return exact;
    return rows.find((t) => String(t?.id || "").toLowerCase() === wanted) || null;
  }

  function resolveEntityTypeIdByRole(role) {
    const row = resolveEntityTypeByRole(role);
    return row ? String(row.id || "") : "";
  }

  function getRoleLabels(role, fallbackSingular = "", fallbackPlural = "") {
    const row = resolveEntityTypeByRole(role);
    const singular = String(row?.nameSingular || fallbackSingular || role || "");
    const plural = String(row?.namePlural || fallbackPlural || (singular ? `${singular}s` : ""));
    return {
      role: String(role || ""),
      typeId: String(row?.id || ""),
      singular,
      plural,
    };
  }

  function listEntitiesByRole(role) {
    const typeId = resolveEntityTypeIdByRole(role);
    if (!typeId) return [];
    return listEntities(typeId);
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
    const explicitRole = String(typeRecord?.moduleRole || "").trim();
    const moduleRole = explicitRole
      ? normalizeModuleRole(explicitRole, typeId)
      : normalizeModuleRole(target[idx]?.moduleRole || normalized.moduleRole, typeId);
    const attributes = normalizeEntityAttributes(
      typeRecord?.attributes != null
        ? typeRecord.attributes
        : (target[idx]?.attributes || normalized.attributes || [])
    );
    const next = {
      createdAt: idx >= 0 ? target[idx]?.createdAt : new Date().toISOString(),
      ...normalized,
      id: typeId,
      code,
      moduleRole,
      attributes,
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
    const row = (model?.types || []).find((x) => String(x?.id || "") === id) || null;
    const role = normalizeModuleRole(row?.moduleRole, row?.id || "");
    if (role === "product" || role === "station" || role === "job") {
      const hasReplacement = (model?.types || []).some((x) =>
        String(x?.id || "") !== id &&
        normalizeModuleRole(x?.moduleRole, x?.id) === role
      );
      const app = readAppState({ seedIfMissing: false });
      const hasData =
        (role === "product" && Array.isArray(app?.products) && app.products.length > 0) ||
        (role === "station" && Array.isArray(app?.stations) && app.stations.length > 0) ||
        (role === "job" && Array.isArray(app?.jobs) && app.jobs.length > 0);
      if (hasData && !hasReplacement) return false;
    }
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
    const appState = toCanonicalOperationShape(
      safeParse(JSON.stringify(readAppState() || createEmptyAppState()), {})
    );
    return {
      exportedAt: new Date().toISOString(),
      app: appState,
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
    const batchedWriteOptions = {
      emit: false,
      markDirty: false,
      reason: String(options?.reason || "snapshot-import"),
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
        writeAppState(appPayload, batchedWriteOptions);
        result.importedApp = true;
      }
      if (modulesPayload) {
        writeModuleState(modulesPayload, batchedWriteOptions);
        result.importedModules = true;
      }
      if (result.importedApp && options?.seedRoutes !== false) {
        result.seededRoutes = seedRoutesForCurrentApp({
          overwrite: options?.seedOverwrite === true,
          pruneMissing: options?.seedPrune !== false,
          emit: false,
          markDirty: false,
          reason: batchedWriteOptions.reason,
        });
      }
    } else {
      const app = normalizeImportedAppState(src);
      if (app) {
        result.mode = "app";
        writeAppState(app, batchedWriteOptions);
        result.importedApp = true;
        if (options?.seedRoutes !== false) {
          result.seededRoutes = seedRoutesForState(app, {
            overwrite: options?.seedOverwrite === true,
            pruneMissing: options?.seedPrune !== false,
            emit: false,
            markDirty: false,
            reason: batchedWriteOptions.reason,
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
    if (result.importedApp) {
      window.CANBus?.emit("data:app:updated", { key: APP_KEY, mirrors: LEGACY_APP_KEYS.slice() }, "module-data");
      if (!syncState.applyingRemote) markDirty("app", batchedWriteOptions.reason);
    }
    if (result.importedModules || result.seededRoutes > 0) {
      window.CANBus?.emit("data:module:updated", { key: MODULE_KEY }, "module-data");
      if (!syncState.applyingRemote) markDirty("modules", batchedWriteOptions.reason);
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
      "productCode,productName,stationCode,stationName,operationName,cycleId,cycleAtIso,tag,totalMs,lapIndex,elementName,elementType,lapMs",
    ];
    const products = new Map((app?.products || []).map((p) => [p.id, p]));
    const stations = new Map((app?.stations || []).map((s) => [s.id, s]));
    for (const operation of (app?.jobs || [])) {
      const product = products.get(operation.productId) || {};
      const st = stations.get(operation.stationId) || {};
      for (const cyc of (operation.cycles || [])) {
        const laps = Array.isArray(cyc.laps) ? cyc.laps : [];
        for (let i = 0; i < laps.length; i++) {
          const l = laps[i] || {};
          const cols = [
            product.code || "",
            product.name || "",
            st.code || "",
            st.name || "",
            operation.name || "",
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

  function makeCsvForOperations() {
    return makeCsvForJobs();
  }

  function makeTextReport() {
    const app = readAppState();
    const modules = readModuleState();
    const categories = Array.isArray(app?.categories) ? app.categories : [];
    const products = Array.isArray(app?.products) ? app.products : [];
    const stations = Array.isArray(app?.stations) ? app.stations : [];
    const operations = Array.isArray(app?.jobs) ? app.jobs : [];
    const lines = [];
    lines.push("VMill Offline Backup Report");
    lines.push(`ExportedAt: ${new Date().toISOString()}`);
    lines.push(`Categories: ${categories.length}`);
    lines.push(`Products: ${products.length}`);
    lines.push(`Stations: ${stations.length}`);
    lines.push(`Operations: ${operations.length}`);
    lines.push("");
    for (const p of products) {
      const pOps = operations.filter((op) => String(op.productId || "") === String(p.id || ""));
      lines.push(`[Product] ${p.code || "-"} - ${p.name || "-"} | Operations: ${pOps.length}`);
    }
    lines.push("");
    for (const st of stations) {
      lines.push(`[Station] ${st.code || "-"} - ${st.name || "-"}`);
      const stOps = operations.filter((op) => String(op.stationId || "") === String(st.id || ""));
      for (const op of stOps) {
        const cycles = Array.isArray(op.cycles) ? op.cycles : [];
        lines.push(`  - Operation: ${op.name || "-"} | Cycles: ${cycles.length}`);
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

  function serverCandidates(preferred = "") {
    const out = [];
    const push = (v) => {
      const n = normalizeServerUrl(v);
      if (n && !out.includes(n)) out.push(n);
    };
    push(preferred);
    push(readLs(SERVER_URL_KEY, ""));
    if (location.protocol === "http:" || location.protocol === "https:") push(location.origin);
    push("http://localhost:8080");
    return out;
  }

  async function fetchJson(url, options = {}) {
    const timeoutMs = Math.max(500, Number(options?.timeoutMs || HTTP_TIMEOUT_MS));
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? window.setTimeout(() => {
      try { ctrl.abort(); } catch {}
    }, timeoutMs) : 0;
    const init = { ...options };
    delete init.timeoutMs;
    if (ctrl && !init.signal) init.signal = ctrl.signal;
    try {
      const res = await fetch(url, init);
      let data = null;
      try { data = await res.json(); } catch {}
      return { ok: !!res.ok, status: Number(res.status || 0), data: data && typeof data === "object" ? data : {} };
    } catch (err) {
      if (String(err?.name || "") === "AbortError") {
        return { ok: false, status: 0, data: { error: "timeout" } };
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function setOnlineState(nextOnline, reason = "", extra = {}) {
    const prev = !!syncState.online;
    syncState.online = !!nextOnline;
    if (!syncState.online && syncState.pushTimer) {
      clearTimeout(syncState.pushTimer);
      syncState.pushTimer = 0;
    }
    if (prev !== syncState.online) {
      if (syncState.pollTimer) {
        clearTimeout(syncState.pollTimer);
        syncState.pollTimer = 0;
      }
      if (syncState.initialized && !IS_EMBEDDED_FRAME) {
        schedulePoll(syncState.online ? 450 : SYNC_POLL_OFFLINE_MS);
      }
    }
    if (prev !== syncState.online || reason) {
      emitSyncStatus({ reason, ...extra });
    }
  }

  function computePollDelayMs() {
    if (!syncState.online) return SYNC_POLL_OFFLINE_MS;
    if (syncState.authError) return SYNC_POLL_AUTH_ERROR_MS;
    if (typeof document !== "undefined" && document.hidden && !syncState.dirtyApp && !syncState.dirtyModules) {
      return SYNC_POLL_HIDDEN_MS;
    }
    if (syncState.conflictBackoffUntil > Date.now() && (syncState.dirtyApp || syncState.dirtyModules)) {
      const remain = Math.max(0, Number(syncState.conflictBackoffUntil || 0) - Date.now());
      return Math.min(Math.max(1200, remain), 8000);
    }
    if (syncState.dirtyApp || syncState.dirtyModules || syncState.pushing || syncState.pulling) {
      return 1400;
    }
    return SYNC_POLL_MS;
  }

  function conflictBackoffRemainingMs() {
    return Math.max(0, Number(syncState.conflictBackoffUntil || 0) - Date.now());
  }

  function computeConflictBackoffDelayMs() {
    const attempt = Math.max(1, Number(syncState.conflictCount || 1));
    const base = SYNC_CONFLICT_BACKOFF_BASE_MS * (2 ** Math.max(0, attempt - 1));
    const bounded = Math.min(SYNC_CONFLICT_BACKOFF_MAX_MS, base);
    const jitter = 0.85 + (Math.random() * 0.3);
    return Math.max(SYNC_CONFLICT_BACKOFF_BASE_MS, Math.round(bounded * jitter));
  }

  function schedulePoll(delayMs = SYNC_POLL_MS) {
    if (IS_EMBEDDED_FRAME) return;
    if (syncState.pollTimer) clearTimeout(syncState.pollTimer);
    const wait = Math.max(250, Number(delayMs || 0));
    syncState.pollTimer = window.setTimeout(() => {
      syncState.pollTimer = 0;
      void pollServer();
    }, wait);
  }

  function ensurePollTimer() {
    if (IS_EMBEDDED_FRAME) return;
    if (syncState.pollTimer || syncState.pollInFlight) return;
    schedulePoll(400);
  }

  function markDirty(kind = "app", reason = "write") {
    const k = String(kind || "");
    if (k === "app" || k === "all") syncState.dirtyApp = true;
    if (k === "modules" || k === "all") syncState.dirtyModules = true;
    if (!syncState.dirtySince) syncState.dirtySince = Date.now();
    scheduleSyncPush(SYNC_WRITE_DEBOUNCE_MS);
    emitSyncStatus({
      reason,
      dirtyApp: syncState.dirtyApp,
      dirtyModules: syncState.dirtyModules,
    });
  }

  async function probeServer(baseUrl) {
    const url = normalizeServerUrl(baseUrl);
    if (!url) return false;
    try {
      const out = await fetchJson(`${url}/api/status`, { method: "GET", cache: "no-store" });
      return !!out.ok;
    } catch {
      return false;
    }
  }

  async function detectServer(preferred = "") {
    const candidates = serverCandidates(preferred);
    for (const baseUrl of candidates) {
      const ok = await probeServer(baseUrl);
      if (!ok) continue;
      syncState.serverUrl = baseUrl;
      writeLs(SERVER_URL_KEY, baseUrl);
      syncState.lastError = "";
      setOnlineState(true, "server-detected", { serverUrl: baseUrl });
      return true;
    }
    syncState.lastError = "server_unreachable";
    setOnlineState(false, "server-unreachable");
    return false;
  }

  function mergeRemoteSnapshot(workspace) {
    const remoteApp = normalizeImportedAppState(workspace?.app);
    const remoteModules = (workspace?.modules && typeof workspace.modules === "object")
      ? ensureModuleState(workspace.modules)
      : null;
    const localApp = readAppState({ seedIfMissing: false });
    const localModules = readModuleState();

    const remoteAppStamp = stateStamp(remoteApp);
    const localAppStamp = stateStamp(localApp);
    if (remoteApp && (!localApp || remoteAppStamp > localAppStamp)) {
      syncState.applyingRemote = true;
      try { writeAppState(remoteApp); } finally { syncState.applyingRemote = false; }
      syncState.dirtyApp = false;
    } else if (localApp && (!remoteApp || localAppStamp > remoteAppStamp)) {
      syncState.dirtyApp = true;
      if (!syncState.dirtySince) syncState.dirtySince = Date.now();
    }

    const remoteModStamp = moduleStateStamp(remoteModules);
    const localModStamp = moduleStateStamp(localModules);
    if (remoteModules && (!localModules || remoteModStamp > localModStamp)) {
      syncState.applyingRemote = true;
      try { writeModuleState(remoteModules); } finally { syncState.applyingRemote = false; }
      syncState.dirtyModules = false;
    } else if (localModules && (!remoteModules || localModStamp > remoteModStamp)) {
      syncState.dirtyModules = true;
      if (!syncState.dirtySince) syncState.dirtySince = Date.now();
    }
  }

  async function pullFromServer() {
    if (syncState.pulling || !syncState.online || !syncState.serverUrl) return false;
    const token = readAuthToken();
    if (!token) {
      syncState.lastError = "auth_missing";
      syncState.authError = true;
      emitSyncStatus({ reason: "pull-no-auth" });
      return false;
    }
    syncState.pulling = true;
    try {
      const out = await fetchJson(`${syncState.serverUrl}/api/sync/pull`, {
        method: "GET",
        cache: "no-store",
        headers: { ...authHeaders() },
      });
      if (out.status === 401 || out.status === 403) {
        syncState.lastError = "auth_failed";
        syncState.authError = true;
        emitSyncStatus({ reason: "pull-auth-failed" });
        return false;
      }
      if (!out.ok) return false;
      syncState.authError = false;
      syncState.lastError = "";
      writeSyncRevision(out.data?.rev || syncState.revision || 0);
      mergeRemoteSnapshot(out.data?.workspace || {});
      clearTableFetchCache();
      syncState.lastPullAt = Date.now();
      emitSyncStatus({ reason: "pull-ok", dirtyApp: syncState.dirtyApp, dirtyModules: syncState.dirtyModules });
      return true;
    } catch {
      syncState.lastError = "pull_failed";
      setOnlineState(false, "pull-failed");
      return false;
    } finally {
      syncState.pulling = false;
    }
  }

  async function pushToServer(force = false) {
    if (syncState.pushing) {
      syncState.pushQueued = true;
      return false;
    }
    if (!syncState.online || !syncState.serverUrl) return false;
    const token = readAuthToken();
    if (!token) {
      syncState.lastError = "auth_missing";
      syncState.authError = true;
      emitSyncStatus({ reason: "push-no-auth" });
      return false;
    }
    if (!force && !syncState.dirtyApp && !syncState.dirtyModules) return true;

    const payload = {
      client_id: ensureSyncClientId(),
      base_rev: Number(syncState.revision || 0),
    };
    if (syncState.dirtyApp || force) payload.app = readAppState({ seedIfMissing: false });
    if (syncState.dirtyModules || force) payload.modules = readModuleState();
    if (!("app" in payload) && !("modules" in payload)) return true;

    syncState.pushing = true;
    try {
      const out = await fetchJson(`${syncState.serverUrl}/api/sync/push`, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload),
      });
      if (out.status === 401 || out.status === 403) {
        syncState.lastError = "auth_failed";
        syncState.authError = true;
        emitSyncStatus({ reason: "push-auth-failed" });
        return false;
      }
      if (out.status === 409) {
        // Another client wrote newer state first. Pull latest snapshot, merge, and retry queued local deltas.
        syncState.authError = false;
        syncState.conflictCount = Math.min(8, Number(syncState.conflictCount || 0) + 1);
        const backoffMs = computeConflictBackoffDelayMs();
        syncState.conflictBackoffUntil = Date.now() + backoffMs;
        writeSyncRevision(out.data?.rev || syncState.revision || 0);
        await pullFromServer();
        if (syncState.dirtyApp || syncState.dirtyModules) scheduleSyncPush(backoffMs);
        emitSyncStatus({
          reason: "push-conflict",
          dirtyApp: syncState.dirtyApp,
          dirtyModules: syncState.dirtyModules,
          conflictBackoffMs: backoffMs,
        });
        return false;
      }
      if (!out.ok) {
        syncState.lastError = `push_failed_status_${Number(out.status || 0)}`;
        emitSyncStatus({
          reason: "push-failed-status",
          status: Number(out.status || 0),
          error: String(out?.data?.error || ""),
          dirtyApp: syncState.dirtyApp,
          dirtyModules: syncState.dirtyModules,
        });
        return false;
      }
      syncState.authError = false;
      syncState.lastError = "";
      syncState.conflictCount = 0;
      syncState.conflictBackoffUntil = 0;
      if (payload.app) syncState.dirtyApp = false;
      if (payload.modules) syncState.dirtyModules = false;
      if (!syncState.dirtyApp && !syncState.dirtyModules) syncState.dirtySince = 0;
      syncState.lastPushAt = Date.now();
      writeSyncRevision(out.data?.rev || syncState.revision || 0);
      emitSyncStatus({ reason: "push-ok", dirtyApp: syncState.dirtyApp, dirtyModules: syncState.dirtyModules });
      return true;
    } catch {
      syncState.lastError = "push_failed_network";
      setOnlineState(false, "push-failed");
      return false;
    } finally {
      syncState.pushing = false;
      if (syncState.pushQueued) {
        syncState.pushQueued = false;
        if (syncState.dirtyApp || syncState.dirtyModules) scheduleSyncPush(180);
      }
    }
  }

  function scheduleSyncPush(delayMs = SYNC_WRITE_DEBOUNCE_MS) {
    if (!syncState.dirtyApp && !syncState.dirtyModules) return;
    if (syncState.pushing) {
      syncState.pushQueued = true;
      return;
    }
    const now = Date.now();
    const dirtySince = Number(syncState.dirtySince || now);
    const elapsed = Math.max(0, now - dirtySince);
    let wait = Math.max(0, Number(delayMs || 0));
    if (elapsed >= SYNC_WRITE_MAX_WAIT_MS) wait = 0;
    const conflictRemain = conflictBackoffRemainingMs();
    if (conflictRemain > wait) wait = conflictRemain;
    if (syncState.pushTimer) clearTimeout(syncState.pushTimer);
    syncState.pushTimer = window.setTimeout(() => {
      syncState.pushTimer = 0;
      void (async () => {
        const ok = await pushToServer(false);
        if (!ok && (syncState.dirtyApp || syncState.dirtyModules)) {
          scheduleSyncPush(SYNC_PUSH_RETRY_MS);
        }
      })();
    }, wait);
  }

  async function pollServer() {
    if (!syncState.initialized || syncState.pollInFlight) return;
    syncState.pollInFlight = true;
    try {
      if (typeof document !== "undefined" && document.hidden && !syncState.dirtyApp && !syncState.dirtyModules && syncState.online) {
        return;
      }
      if (!syncState.online) {
        const online = await detectServer(syncState.serverUrl || readLs(SERVER_URL_KEY, ""));
        if (!online) return;
        await pullFromServer();
        if (syncState.dirtyApp || syncState.dirtyModules) await pushToServer(false);
        return;
      }
      const token = readAuthToken();
      if (!token) {
        syncState.authError = true;
        emitSyncStatus({ reason: "poll-no-auth" });
        return;
      }
      if ((syncState.dirtyApp || syncState.dirtyModules) && conflictBackoffRemainingMs() <= 0) {
        await pushToServer(false);
      }
      const out = await fetchJson(
        `${syncState.serverUrl}/api/sync/poll?since=${encodeURIComponent(String(syncState.revision || 0))}`,
        { method: "GET", cache: "no-store", headers: { ...authHeaders() } }
      );
      if (out.status === 401 || out.status === 403) {
        syncState.authError = true;
        emitSyncStatus({ reason: "poll-auth-failed" });
        return;
      }
      if (!out.ok) {
        syncState.lastError = "poll_failed";
        return;
      }
      syncState.authError = false;
      syncState.lastPollAt = Date.now();
      writeSyncRevision(out.data?.rev || syncState.revision || 0);
      if (out.data?.changed) await pullFromServer();
      if ((syncState.dirtyApp || syncState.dirtyModules) && conflictBackoffRemainingMs() <= 0) await pushToServer(false);
    } catch {
      syncState.lastError = "poll_failed";
      setOnlineState(false, "poll-failed");
    } finally {
      syncState.pollInFlight = false;
      if (!IS_EMBEDDED_FRAME && syncState.initialized) {
        schedulePoll(computePollDelayMs());
      }
    }
  }

  async function init(serverUrl = "") {
    ensureSyncClientId();
    writeSyncRevision(readSyncRevision());
    syncState.initialized = true;
    const online = await detectServer(serverUrl);
    if (online) {
      await pullFromServer();
      if (syncState.dirtyApp || syncState.dirtyModules) await pushToServer(false);
    }
    ensurePollTimer();
    emitSyncStatus({ reason: "init" });
    return {
      online: !!syncState.online,
      serverUrl: String(syncState.serverUrl || ""),
      revision: Number(syncState.revision || 0),
    };
  }

  function subscribe(fn) {
    if (typeof fn !== "function") return () => {};
    syncSubscribers.add(fn);
    try {
      fn({
        online: !!syncState.online,
        serverUrl: String(syncState.serverUrl || ""),
        revision: Number(syncState.revision || 0),
        authError: !!syncState.authError,
        lastError: String(syncState.lastError || ""),
        dirtyApp: !!syncState.dirtyApp,
        dirtyModules: !!syncState.dirtyModules,
        dirtySince: Number(syncState.dirtySince || 0),
        pushing: !!syncState.pushing,
        pulling: !!syncState.pulling,
        conflictCount: Number(syncState.conflictCount || 0),
        conflictBackoffMs: Math.max(0, Number(syncState.conflictBackoffUntil || 0) - Date.now()),
      });
    } catch {}
    return () => syncSubscribers.delete(fn);
  }

  function getSyncStatus() {
    return {
      online: !!syncState.online,
      serverUrl: String(syncState.serverUrl || ""),
      revision: Number(syncState.revision || 0),
      authError: !!syncState.authError,
      lastError: String(syncState.lastError || ""),
      dirtyApp: !!syncState.dirtyApp,
      dirtyModules: !!syncState.dirtyModules,
      dirtySince: Number(syncState.dirtySince || 0),
      pushing: !!syncState.pushing,
      pulling: !!syncState.pulling,
      conflictCount: Number(syncState.conflictCount || 0),
      conflictBackoffMs: Math.max(0, Number(syncState.conflictBackoffUntil || 0) - Date.now()),
      saveIssueActive: !!syncState.saveIssueActive,
      saveIssueCode: currentSyncSaveIssue()?.code || "",
      saveIssueMessage: currentSyncSaveIssue()?.message || "",
    };
  }

  async function syncNow(force = true) {
    if (!syncState.online || !syncState.serverUrl) return false;
    return pushToServer(!!force);
  }

  function isOnline() {
    return !!syncState.online;
  }

  function getServerUrl() {
    return String(syncState.serverUrl || readLs(SERVER_URL_KEY, "") || "");
  }

  window.VMillData = {
    keys: {
      APP_KEY,
      LEGACY_APP_KEYS,
      ALL_APP_KEYS,
      MODULE_KEY,
      NS_ROUTE,
      NS_ENTITY_TYPES,
      NS_ENTITY_ITEMS,
      NS_ENTITY_LINKS,
      NS_STRUCTURE_RULES,
      NS_API_TABLE_PREFIX,
      AUTH_TOKEN_KEY,
      AUTH_USER_KEY,
      SERVER_URL_KEY,
      SYNC_REV_KEY,
      SYNC_CLIENT_ID_KEY,
    },
    init,
    subscribe,
    getSyncStatus,
    syncNow,
    isOnline,
    getServerUrl,
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
    list,
    create,
    update,
    remove,
    getLastCrudError,
    upsertRecord,
    deleteRecord,
    listRecords,
    readStructureModel,
    listEntityTypes,
    resolveEntityTypeByRole,
    resolveEntityTypeIdByRole,
    getRoleLabels,
    upsertEntityType,
    deleteEntityType,
    listEntities,
    listEntitiesByRole,
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
    makeCsvForOperations,
    makeCsvForJobs,
    makeTextReport,
  };
  // Auto-init keeps legacy modules working without explicit boot calls.
  setTimeout(() => { void init(); }, 0);
})();
