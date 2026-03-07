(() => {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (document.getElementById("vmillRadialShell")) return;

  const APP_KEY = "vmill:app-state:v1";
  const LEGACY_APP_KEYS = ["chrono_drawer_timeline_v5", "chrono_drawer_timeline_v4", "chrono_drawer_timeline_v3"];
  const APP_KEYS = [APP_KEY, ...LEGACY_APP_KEYS];
  const PREF_KEY = "vmill:module-manager:v1";
  const SHELL_JOB_KEY = "vmill:shell:job-id";
  const HUB_SCOPE_KEY = "vmill:hub-scope:v1";
  const HUB_SCOPE_TOOLBAR_KEY = "vmill:hub-scope-toolbar:v1";
  const SCOPE_DOCK_STYLE_KEY = "vmill:scope-dock-style:v1";
  const SCOPE_DOCK_UI_KEY = "vmill:scope-dock-ui:v1";
  const LOGGER_UI_KEY = "vmill:logger:ui:v1";
  const LOGGER_LOG_KEY = "vmill:logger:entries:v1";
  const ENABLE_RIGHT_RAIL = false;
  const RIGHT_RAIL_COLLAPSED_KEY = "vmill:shell:right-rail:collapsed:v1";

  function safeParse(raw, fallback) {
    try {
      const parsed = JSON.parse(String(raw || ""));
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }

  function normalizeHubScope(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const selectedSrc = src.selected && typeof src.selected === "object" ? src.selected : {};
    const selected = {};
    for (const [k, v] of Object.entries(selectedSrc)) {
      const typeId = String(k || "").trim();
      if (!typeId) continue;
      const itemId = String(v || "").trim();
      selected[typeId] = itemId && itemId !== "all" ? itemId : "all";
    }
    return {
      selected,
      openTypeId: String(src.openTypeId || "").trim(),
      query: String(src.query || ""),
    };
  }

  function readHubScope() {
    return normalizeHubScope(safeParse(localStorage.getItem(HUB_SCOPE_KEY), {}));
  }

  function writeHubScope(next) {
    const payload = normalizeHubScope(next);
    try { localStorage.setItem(HUB_SCOPE_KEY, JSON.stringify(payload)); } catch {}
    window.dispatchEvent(new CustomEvent("vmill:hub-scope:changed", { detail: { scope: payload } }));
    return payload;
  }

  function normalizeScopeToolbarPrefs(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const mode = String(src.mode || "").toLowerCase() === "all" ? "all" : "roots";
    const hiddenTypeIds = Array.isArray(src.hiddenTypeIds)
      ? [...new Set(src.hiddenTypeIds.map((x) => String(x || "").trim()).filter(Boolean))]
      : [];
    const orderTypeIds = Array.isArray(src.orderTypeIds)
      ? [...new Set(src.orderTypeIds.map((x) => String(x || "").trim()).filter(Boolean))]
      : [];
    return { mode, hiddenTypeIds, orderTypeIds };
  }

  function readScopeToolbarPrefs() {
    return normalizeScopeToolbarPrefs(safeParse(localStorage.getItem(HUB_SCOPE_TOOLBAR_KEY), {}));
  }

  function readScopeDockUi() {
    const raw = safeParse(localStorage.getItem(SCOPE_DOCK_UI_KEY), null);
    if (!raw || typeof raw !== "object" || !Object.prototype.hasOwnProperty.call(raw, "collapsed")) {
      return { collapsed: null };
    }
    return { collapsed: raw.collapsed === true };
  }

  function writeScopeDockUi(next) {
    const payload = { collapsed: !!next?.collapsed };
    try { localStorage.setItem(SCOPE_DOCK_UI_KEY, JSON.stringify(payload)); } catch {}
    return payload;
  }

  function normalizeScopeDockStyle(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const viewport = Math.max(640, window.innerWidth || 1440);
    const legacyMax = Number(src.maxWidth);
    const legacySelect = Number(src.selectWidth);
    const legacySearch = Number(src.searchMax);
    const baseWidthPct = Number(src.widthPct);
    const widthPctSeed = Number.isFinite(baseWidthPct) && baseWidthPct > 0
      ? baseWidthPct
      : (Number.isFinite(legacyMax) && legacyMax > 0 ? ((legacyMax / viewport) * 100) : 92);
    const widthPct = Math.max(65, Math.min(99, widthPctSeed));
    const estMaxPx = Math.max(720, Math.min(2000, Math.round((viewport * widthPct) / 100)));
    const baseSelectPct = Number(src.selectPct);
    const selectPctSeed = Number.isFinite(baseSelectPct) && baseSelectPct > 0
      ? baseSelectPct
      : (Number.isFinite(legacySelect) && legacySelect > 0 ? ((legacySelect / estMaxPx) * 100) : 14);
    const baseSearchPct = Number(src.searchPct);
    const searchPctSeed = Number.isFinite(baseSearchPct) && baseSearchPct > 0
      ? baseSearchPct
      : (Number.isFinite(legacySearch) && legacySearch > 0 ? ((legacySearch / estMaxPx) * 100) : 17);
    const selectPct = Math.max(10, Math.min(28, selectPctSeed));
    const searchPct = Math.max(12, Math.min(30, searchPctSeed));
    const maxWidth = Math.max(720, Math.min(2000, Math.round((viewport * widthPct) / 100)));
    const selectWidth = Math.max(108, Math.min(240, Math.round((maxWidth * selectPct) / 100)));
    const searchMax = Math.max(120, Math.min(360, Math.round((maxWidth * searchPct) / 100)));
    return {
      widthPct: Math.round(widthPct),
      selectPct: Math.round(selectPct),
      searchPct: Math.round(searchPct),
      maxWidth: Math.round(maxWidth),
      selectWidth: Math.round(selectWidth),
      searchMax: Math.round(searchMax),
    };
  }

  function readScopeDockStyle() {
    return normalizeScopeDockStyle(safeParse(localStorage.getItem(SCOPE_DOCK_STYLE_KEY), {}));
  }

  function applyScopeDockStyle(node) {
    if (!(node instanceof HTMLElement)) return;
    const style = readScopeDockStyle();
    node.style.setProperty("--vm-shell-scope-max-width", `${style.maxWidth}px`);
    node.style.setProperty("--vm-shell-scope-select-width", `${style.selectWidth}px`);
    node.style.setProperty("--vm-shell-scope-select-width-md", `${Math.max(108, style.selectWidth - 12)}px`);
    node.style.setProperty("--vm-shell-scope-search-max", `${style.searchMax}px`);
    const sideGap = Math.max(8, Math.min(80, Math.round((100 - style.widthPct) * 2)));
    node.style.setProperty("--vm-shell-scope-side-gap", `${sideGap}px`);
  }

  function isValidAppState(st) {
    return !!(st && typeof st === "object" && Array.isArray(st.stations) && Array.isArray(st.jobs));
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

  function readLocalAppState() {
    const candidates = [];
    for (const key of APP_KEYS) {
      const parsed = safeParse(localStorage.getItem(key), null);
      if (!isValidAppState(parsed)) continue;
      candidates.push({ key, state: parsed, stamp: stateStamp(parsed) });
    }
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
    return best.state;
  }

  function readAppState() {
    const fromApi = window.VMillData?.readAppState ? window.VMillData.readAppState() : null;
    if (isValidAppState(fromApi)) return fromApi;
    return readLocalAppState();
  }

  function writeAppState(next) {
    if (!next || typeof next !== "object") return;
    if (window.VMillData?.writeAppState) {
      window.VMillData.writeAppState(next);
      return;
    }
    const raw = JSON.stringify(next);
    for (const key of APP_KEYS) {
      try { localStorage.setItem(key, raw); } catch {}
    }
  }

  function readPrefs() {
    const parsed = safeParse(localStorage.getItem(PREF_KEY), {});
    const disabled = Array.isArray(parsed?.disabled)
      ? parsed.disabled.map((x) => String(x || "")).filter(Boolean)
      : [];
    return { disabled };
  }

  function pathKind(pathname) {
    const p = String(pathname || "");
    if (p.includes("/chrono/")) return "chrono";
    if (p.includes("/vmill_hub.html")) return "hub";
    if (p.includes("/SPaCial.html")) return "spacial";
    if (p.includes("/cnc_sim.html")) return "cnc-launch";
    return "root";
  }

  function routes() {
    const kind = pathKind(location.pathname);
    const isFile = location.protocol === "file:";
    if (isFile) {
      const p = String(location.pathname || "").replace(/\\\\/g, "/");
      const inChrono = p.includes("/public/chrono/");
      const inPublicRoot = p.includes("/public/") && !inChrono;
      if (inChrono) {
        return {
          hub: "../vmill_hub.html",
          cnc: "../../index.html",
          chrono: "./chrono.html",
          camera: "./chrono_camera.html",
          spacial: "../SPaCial.html",
          contas: "../contas_calc.html",
          shop: "../shop_tree.html",
          logger: "../logger.html",
          theme: "../theme_studio.html",
          translations: "../translation_studio.html",
        };
      }
      if (inPublicRoot) {
        return {
          hub: "./vmill_hub.html",
          cnc: "../index.html",
          chrono: "./chrono/chrono.html",
          camera: "./chrono/chrono_camera.html",
          spacial: "./SPaCial.html",
          contas: "./contas_calc.html",
          shop: "./shop_tree.html",
          logger: "./logger.html",
          theme: "./theme_studio.html",
          translations: "./translation_studio.html",
        };
      }
      return {
        hub: "./public/vmill_hub.html",
        cnc: "./index.html",
        chrono: "./public/chrono/chrono.html",
        camera: "./public/chrono/chrono_camera.html",
        spacial: "./public/SPaCial.html",
        contas: "./public/contas_calc.html",
        shop: "./public/shop_tree.html",
        logger: "./public/logger.html",
        theme: "./public/theme_studio.html",
        translations: "./public/translation_studio.html",
      };
    }
    if (kind === "chrono") {
      return {
        hub: "../vmill_hub.html",
        cnc: "/",
        chrono: "./chrono.html",
        camera: "./chrono_camera.html",
        spacial: "../SPaCial.html",
        contas: "../contas_calc.html",
        shop: "../shop_tree.html",
        logger: "../logger.html",
        theme: "../theme_studio.html",
        translations: "../translation_studio.html",
      };
    }
    return {
      hub: "/vmill_hub.html",
      cnc: "/",
      chrono: "/chrono/chrono.html",
      camera: "/chrono/chrono_camera.html",
      spacial: "/SPaCial.html",
      contas: "/contas_calc.html",
      shop: "/shop_tree.html",
      logger: "/logger.html",
      theme: "/theme_studio.html",
      translations: "/translation_studio.html",
    };
  }

  const ROUTES = routes();
  const MODULES = [
    { id: "hub", labelKey: "hub.dock.hub", fallback: "Hub", route: ROUTES.hub, fixed: true },
    { id: "cnc-sim", labelKey: "hub.dock.cnc", fallback: "CNC", route: ROUTES.cnc },
    { id: "chrono", labelKey: "hub.dock.chrono", fallback: "Chrono", route: ROUTES.chrono },
    { id: "chrono-camera", labelKey: "hub.dock.camera", fallback: "Camera", route: ROUTES.camera },
    { id: "spacial", labelKey: "hub.dock.spacial", fallback: "SPaCial", route: ROUTES.spacial },
    { id: "contas", labelKey: "hub.dock.contas", fallback: "Contas", route: ROUTES.contas },
    { id: "shop-tree", labelKey: "hub.dock.shopTree", fallback: "Shop", route: ROUTES.shop },
    { id: "can-bus", labelKey: "hub.dock.logger", fallback: "Logger", route: ROUTES.logger },
    { id: "theme", labelKey: "hub.dock.theme", fallback: "Theme", route: ROUTES.theme },
    { id: "translations", labelKey: "hub.top.translationsSettings", fallback: "i18n", route: ROUTES.translations },
  ];
  const IS_EMBEDDED_FRAME = (() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  })();

  function currentModuleId() {
    const p = String(location.pathname || "");
    if (p.includes("/vmill_hub.html")) return "hub";
    if (p.includes("/chrono/chrono_camera.html")) return "chrono-camera";
    if (p.includes("/chrono/chrono.html")) return "chrono";
    if (p.includes("/SPaCial.html")) return "spacial";
    if (p.includes("/contas_calc.html")) return "contas";
    if (p.includes("/shop_tree.html")) return "shop-tree";
    if (p.includes("/logger.html")) return "can-bus";
    if (p.includes("/theme_studio.html")) return "theme";
    if (p.includes("/translation_studio.html")) return "translations";
    if (p === "/" || p.endsWith("/index.html") || p.includes("/cnc_sim.html")) return "cnc-sim";
    return "unknown";
  }

  function applyModuleViewportFix() {
    const id = currentModuleId();
    if (id === "hub" || id === "cnc-sim" || id === "chrono-camera") return;
    if (document.getElementById("vmillModuleViewportFix")) return;
    const style = document.createElement("style");
    style.id = "vmillModuleViewportFix";
    style.textContent = `
      :root {
        height: 100% !important;
      }
      html, body {
        height: 100% !important;
        min-height: 100dvh !important;
      }
      body {
        margin: 0 !important;
        overflow-y: auto !important;
        overflow-x: hidden !important;
      }
      body.vmillShellHasTopDock {
        padding-top: var(--vm-shell-top-offset, 52px) !important;
      }
      body > .wrap,
      body > .layout,
      body > .container,
      body > .page,
      body > main,
      body > #app {
        min-height: 100dvh !important;
        width: 100% !important;
        max-width: none !important;
        margin: 0 !important;
        border-radius: 0 !important;
      }
    `;
    document.head.appendChild(style);
  }

  if (IS_EMBEDDED_FRAME) {
    applyModuleViewportFix();
    window.addEventListener("load", applyModuleViewportFix, { once: true });
    return;
  }

  function makeUrlWithCtx(baseHref, ctx) {
    if (!baseHref) return "#";
    if (!ctx?.jobId && !ctx?.stationId) return baseHref;
    try {
      const u = new URL(baseHref, location.href);
      if (ctx.stationId) u.searchParams.set("station", String(ctx.stationId));
      if (ctx.jobId) u.searchParams.set("job", String(ctx.jobId));
      if (ctx.handoff) u.searchParams.set("handoff", String(ctx.handoff));
      return u.href;
    } catch {
      return baseHref;
    }
  }

  function buildSpacialHandoff(job, station) {
    if (!job || !station) return "";
    const maxCycles = 180;
    const cycles = Array.isArray(job.cycles) ? job.cycles.slice(-maxCycles) : [];
    const payload = {
      v: 1,
      station: {
        id: station.id || "",
        code: station.code || "",
        name: station.name || "",
      },
      job: {
        id: job.id || "",
        stationId: job.stationId || station.id || "",
        name: job.name || tt("spacial.jobDefault", "Job"),
        cycles: cycles.map((c) => ({
          id: c?.id || "",
          totalMs: Number(c?.totalMs || 0),
          atIso: c?.atIso || "",
          tag: c?.tag || "Normal",
        })),
      },
      activeJobId: job.id || "",
      at: new Date().toISOString(),
    };
    try {
      return encodeURIComponent(JSON.stringify(payload));
    } catch {
      return "";
    }
  }

  function getCtxFromState() {
    const st = readAppState();
    const jobs = Array.isArray(st?.jobs) ? st.jobs : [];
    const stations = Array.isArray(st?.stations) ? st.stations : [];
    let jobId = String(localStorage.getItem(SHELL_JOB_KEY) || "");
    if (!jobId && st?.activeJobId) jobId = String(st.activeJobId);
    if (jobId && !jobs.some((j) => String(j.id || "") === jobId)) jobId = "";
    if (!jobId && jobs[0]) jobId = String(jobs[0].id || "");
    const job = jobs.find((j) => String(j.id || "") === jobId) || null;
    const stationId = String(job?.stationId || "");
    const station = stations.find((s) => String(s.id || "") === stationId) || null;
    return { state: st, jobs, stations, jobId, job, stationId, station };
  }

  function setGlobalJob(jobId) {
    const st = readAppState();
    if (!st || !Array.isArray(st.jobs)) return;
    const job = st.jobs.find((j) => String(j.id || "") === String(jobId || ""));
    if (!job) return;
    const prev = String(st.activeJobId || "");
    st.activeJobId = job.id;
    if (prev !== String(job.id || "")) {
      st.meta = st.meta || {};
      st.meta.updatedAt = new Date().toISOString();
      writeAppState(st);
    }
    localStorage.setItem(SHELL_JOB_KEY, String(job.id || ""));
  }

  function allowNativeContextMenu(target) {
    const el = target instanceof Element ? target : null;
    if (!el) return false;
    if (el.closest("#vmillRadialShell")) return false;
    const tag = String(el.tagName || "").toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function tt(key, fallback = "", vars) {
    return window.VMillLang?.t ? window.VMillLang.t(key, fallback, vars) : fallback;
  }

  const host = document.createElement("div");
  host.id = "vmillRadialShell";
  host.innerHTML = `
    <style>
      #vmillRadialShell {
        position: fixed;
        inset: 0;
        z-index: 100000;
        pointer-events: none;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      }
      #vmillRadialShell.open { pointer-events: auto; }
      #vmillRadialShell .backdrop {
        position: absolute;
        inset: 0;
        background: rgba(0,0,0,.14);
        opacity: 0;
        transition: opacity .14s ease;
      }
      #vmillRadialShell.open .backdrop { opacity: 1; }
      #vmillRadialShell .menu {
        position: absolute;
        width: 260px;
        transform: translate(-50%, -50%) scale(.96);
        opacity: 0;
        transition: transform .14s ease, opacity .14s ease;
        --shell-bg: rgba(var(--vm-theme-bg-rgb, 10,16,28), .88);
        --shell-border: rgba(var(--vm-theme-text-rgb, 220,238,254), .35);
        --shell-text: var(--vm-theme-text, #dceefe);
        --shell-muted: rgba(var(--vm-theme-text-rgb, 157,180,206), .72);
        --shell-accent: rgba(var(--vm-theme-accent-rgb, 87,180,255), .18);
        --shell-accent-border: rgba(var(--vm-theme-accent-rgb, 87,180,255), .48);
        --shell-active: rgba(var(--ok-rgb, 104,211,154), .22);
        --shell-active-border: rgba(var(--ok-rgb, 104,211,154), .82);
      }
      #vmillRadialShell.open .menu { transform: translate(-50%, -50%) scale(1); opacity: 1; }
      #vmillRadialShell .ring {
        width: 260px;
        height: 260px;
        border-radius: 999px;
        border: 1px solid var(--shell-border);
        background: radial-gradient(circle at center, rgba(255,255,255,.08) 0, var(--shell-bg) 62%);
        backdrop-filter: blur(8px);
        box-shadow: 0 12px 28px rgba(0,0,0,.36);
        position: relative;
      }
      #vmillRadialShell .center {
        position: absolute;
        left: 50%; top: 50%;
        transform: translate(-50%, -50%);
        width: 86px;
        height: 86px;
        border-radius: 999px;
        border: 1px solid var(--shell-accent-border);
        background: var(--shell-accent);
        color: var(--shell-text);
        font-size: 12px;
        font-weight: 800;
        letter-spacing: .06em;
        display: flex;
        align-items: center;
        justify-content: center;
        text-transform: uppercase;
      }
      #vmillRadialShell .item {
        position: absolute;
        width: 76px;
        height: 34px;
        margin-left: -38px;
        margin-top: -17px;
        text-decoration: none;
        border-radius: 999px;
        border: 1px solid var(--shell-accent-border);
        background: var(--shell-accent);
        color: var(--shell-text);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: 700;
      }
      #vmillRadialShell .item.active {
        border-color: var(--shell-active-border);
        background: var(--shell-active);
        color: var(--shell-text);
      }
      #vmillRadialShell .ctx {
        margin-top: 8px;
        border: 1px solid var(--shell-border);
        border-radius: 12px;
        background: var(--shell-bg);
        backdrop-filter: blur(8px);
        padding: 8px;
        display: grid;
        gap: 6px;
      }
      #vmillRadialShell .ctx select {
        width: 100%;
        border: 1px solid var(--shell-border);
        border-radius: 999px;
        background: rgba(255,255,255,.06);
        color: var(--shell-text);
        padding: 6px 8px;
        font-size: 11px;
      }
      #vmillRadialShell .closeHint {
        color: var(--shell-muted);
        font-size: 10px;
        text-align: center;
      }
      @media (max-width: 700px) {
        #vmillRadialShell .ring { width: 228px; height: 228px; }
        #vmillRadialShell .menu { width: 228px; }
        #vmillRadialShell .item { width: 68px; height: 32px; margin-left: -34px; margin-top: -16px; }
        #vmillRadialShell .center { width: 76px; height: 76px; font-size: 11px; }
      }
    </style>
    <div class="backdrop" id="vmillRadialBackdrop"></div>
    <div class="menu" id="vmillRadialMenu" style="left:50%;top:50%;">
      <div class="ring" id="vmillRadialRing">
        <button class="center" id="vmillRadialCenter" type="button">VM</button>
      </div>
      <div class="ctx">
        <select id="vmillRadialStation" title="Global station"></select>
        <select id="vmillRadialJob" title="Global job"></select>
        <div class="closeHint" id="vmillRadialHint">Right click opens. Esc or click outside closes.</div>
      </div>
    </div>
  `;
  document.body.appendChild(host);

  const menu = host.querySelector("#vmillRadialMenu");
  const ring = host.querySelector("#vmillRadialRing");
  const backdrop = host.querySelector("#vmillRadialBackdrop");
  const centerBtn = host.querySelector("#vmillRadialCenter");
  const stationSel = host.querySelector("#vmillRadialStation");
  const jobSel = host.querySelector("#vmillRadialJob");
  const hintEl = host.querySelector("#vmillRadialHint");
  let rightRail = null;
  let rightRailPanel = null;
  let rightRailToggle = null;
  let rightRailCollapsed = true;
  let scopeDock = null;
  let loggerOverlay = null;
  let scopeDockRenderTimer = 0;
  let scopeDockLastRenderAt = 0;
  const SCOPE_DOCK_RENDER_MIN_GAP_MS = 90;

  function applyTopDockPadding(enabled) {
    const isHub = currentModuleId() === "hub";
    const on = !!enabled && !isHub;
    document.body.classList.toggle("vmillShellHasTopDock", on);
    if (on) {
      document.body.style.setProperty("--vm-shell-top-offset", "52px");
    } else {
      document.body.style.removeProperty("--vm-shell-top-offset");
    }
  }

  function setScopeDockBodyClass(enabled) {
    document.body.classList.toggle("vmillHasScopeDock", !!enabled);
  }

  function shouldOwnScopeDock() {
    // When a module is rendered inside the Hub iframe, only the top window
    // should own the single global scope bar.
    if (IS_EMBEDDED_FRAME) return false;
    const id = currentModuleId();
    if (id === "chrono-camera" || id === "cnc-sim") return false;
    try {
      if (window.frameElement) return false;
    } catch {}
    return true;
  }

  function shouldOwnLoggerOverlay() {
    if (IS_EMBEDDED_FRAME) return false;
    if (currentModuleId() === "can-bus") return false;
    try {
      if (window.frameElement) return false;
    } catch {}
    return true;
  }

  function readLoggerUi() {
    const src = safeParse(localStorage.getItem(LOGGER_UI_KEY), {});
    const pos = String(src.position || "");
    return {
      position: ["top-left", "top-right", "bottom-left", "bottom-right"].includes(pos) ? pos : "bottom-right",
      maxRows: Math.max(50, Math.min(1200, Number(src.maxRows || 350))),
      active: src.active !== false,
      alertOnly: src.alertOnly === true,
    };
  }

  function writeLoggerUi(nextUi) {
    const ui = {
      ...readLoggerUi(),
      ...(nextUi && typeof nextUi === "object" ? nextUi : {}),
    };
    try { localStorage.setItem(LOGGER_UI_KEY, JSON.stringify(ui)); } catch {}
    return ui;
  }

  function readLoggerEntries() {
    const rows = safeParse(localStorage.getItem(LOGGER_LOG_KEY), []);
    return Array.isArray(rows) ? rows : [];
  }

  function loggerRoute() {
    return MODULES.find((m) => String(m.id || "") === "can-bus")?.route || ROUTES.logger || "/logger.html";
  }

  function ensureLoggerOverlay() {
    if (!shouldOwnLoggerOverlay()) {
      if (loggerOverlay) {
        loggerOverlay.remove();
        loggerOverlay = null;
      }
      return;
    }
    if (loggerOverlay) return;
    const node = document.createElement("div");
    node.id = "vmillLoggerOverlay";
    node.innerHTML = `
      <style>
        #vmillLoggerOverlay{
          position:fixed;
          z-index:99999;
          font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
          --logger-bg: color-mix(in srgb, var(--vm-theme-panel, #111a2a) 92%, transparent);
          --logger-border: var(--vm-theme-border, rgba(230,237,248,.24));
          --logger-text: var(--vm-theme-text, #e6edf8);
          --logger-muted: var(--vm-theme-muted, rgba(230,237,248,.66));
          --logger-accent: var(--vm-theme-accent, #57b4ff);
          --logger-ok: var(--ok, #68d39a);
          --logger-warn: var(--warn, #f5c96a);
          --logger-danger: var(--danger, #f47f96);
        }
        #vmillLoggerOverlay.hidden{ display:none; }
        #vmillLoggerOverlay[data-pos="top-left"]{ top:calc(var(--vm-shell-scope-top, 10px) + 42px); left:10px; }
        #vmillLoggerOverlay[data-pos="top-right"]{ top:calc(var(--vm-shell-scope-top, 10px) + 42px); right:10px; }
        #vmillLoggerOverlay[data-pos="bottom-left"]{ bottom:10px; left:10px; }
        #vmillLoggerOverlay[data-pos="bottom-right"]{ bottom:10px; right:10px; }
        #vmillLoggerOverlay .loggerBar{
          min-width:min(420px, calc(100vw - 20px));
          max-width:min(760px, calc(100vw - 20px));
          border:1px solid var(--logger-border);
          border-radius:10px;
          background:
            radial-gradient(220px 110px at 0% -30%, color-mix(in srgb, var(--logger-accent) 20%, transparent), transparent 62%),
            var(--logger-bg);
          box-shadow:0 10px 24px rgba(0,0,0,.34);
          backdrop-filter: blur(8px);
          padding:4px 7px;
          display:flex;
          align-items:center;
          gap:8px;
          cursor:pointer;
        }
        #vmillLoggerOverlay .loggerBar.issueOnly{
          min-width:auto;
          max-width:none;
          width:auto;
          padding:4px 6px;
          gap:6px;
        }
        #vmillLoggerOverlay .loggerBar.issueOnly .loggerText{ display:none; }
        #vmillLoggerOverlay .loggerDot{
          width:8px;height:8px;border-radius:999px;flex:0 0 auto;
          background:var(--logger-muted);
          box-shadow:0 0 0 2px color-mix(in srgb, var(--logger-border) 80%, transparent);
        }
        #vmillLoggerOverlay .loggerDot.online{ background:var(--logger-ok); }
        #vmillLoggerOverlay .loggerDot.offline{ background:var(--logger-warn); }
        #vmillLoggerOverlay .loggerText{
          min-width:0;flex:1 1 auto;
          color:var(--logger-text);
          font-size:11px;
          font-weight:700;
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis;
        }
        #vmillLoggerOverlay .loggerCounts{
          display:inline-flex;
          align-items:center;
          gap:5px;
          color:var(--logger-muted);
          font-size:10px;
          flex:0 0 auto;
        }
        #vmillLoggerOverlay .loggerCountErr{ color:var(--logger-danger); }
        #vmillLoggerOverlay .loggerBtn{
          border:1px solid var(--logger-border);
          background:rgba(255,255,255,.04);
          color:var(--logger-text);
          border-radius:999px;
          padding:2px 8px;
          font-size:10px;
          font-weight:700;
          cursor:pointer;
          text-decoration:none;
          flex:0 0 auto;
        }
        #vmillLoggerOverlay .loggerBtn.hideBtn{
          padding:2px 6px;
          min-width:24px;
          text-align:center;
        }
        #vmillLoggerOverlay .loggerBtn:hover{
          border-color:color-mix(in srgb, var(--logger-accent) 54%, var(--logger-border));
          background:color-mix(in srgb, var(--logger-accent) 14%, transparent);
        }
        @media (max-width:760px){
          #vmillLoggerOverlay[data-pos="top-left"],
          #vmillLoggerOverlay[data-pos="top-right"]{
            top:calc(var(--vm-shell-scope-top-mobile, var(--vm-shell-scope-top, 10px)) + 40px);
          }
          #vmillLoggerOverlay{
            left:6px !important;
            right:6px !important;
          }
          #vmillLoggerOverlay .loggerBar{
            min-width:0;
            max-width:none;
            width:calc(100vw - 12px);
            padding:4px 6px;
            gap:6px;
          }
          #vmillLoggerOverlay .loggerCounts{ display:none; }
        }
      </style>
      <div class="loggerBar" id="vmillLoggerBar">
        <span class="loggerDot" id="vmillLoggerDot"></span>
        <div class="loggerText" id="vmillLoggerText"></div>
        <div class="loggerCounts" id="vmillLoggerCounts"></div>
        <button class="loggerBtn hideBtn" id="vmillLoggerHide" type="button">×</button>
      </div>
    `;
    document.body.appendChild(node);
    loggerOverlay = node;
    const bar = node.querySelector("#vmillLoggerBar");
    const hideBtn = node.querySelector("#vmillLoggerHide");
    if (bar) {
      bar.setAttribute("role", "button");
      bar.setAttribute("tabindex", "0");
      bar.setAttribute("aria-label", tt("logger.openPanel", "Open logs panel"));
    }
    const openLoggerPanel = () => {
      writeLoggerUi({ active: true });
      const ctx = getCtxFromState();
      location.href = makeUrlWithCtx(loggerRoute(), { jobId: ctx.jobId, stationId: ctx.stationId });
    };
    bar?.addEventListener("click", () => {
      openLoggerPanel();
    });
    bar?.addEventListener("keydown", (e) => {
      if (!e || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      openLoggerPanel();
    });
    hideBtn?.addEventListener("click", (e) => {
      e?.stopPropagation?.();
      writeLoggerUi({ active: false });
      renderLoggerOverlay();
    });
  }

  function renderLoggerOverlay() {
    if (!shouldOwnLoggerOverlay()) {
      if (loggerOverlay) {
        loggerOverlay.remove();
        loggerOverlay = null;
      }
      return;
    }
    ensureLoggerOverlay();
    if (!loggerOverlay) return;
    const ui = readLoggerUi();
    const textEl = loggerOverlay.querySelector("#vmillLoggerText");
    const dotEl = loggerOverlay.querySelector("#vmillLoggerDot");
    const countsEl = loggerOverlay.querySelector("#vmillLoggerCounts");
    const barEl = loggerOverlay.querySelector("#vmillLoggerBar");
    const hideBtn = loggerOverlay.querySelector("#vmillLoggerHide");
    const all = readLoggerEntries().slice(-Math.max(1, Number(ui.maxRows || 350)));
    const infoCount = all.filter((r) => String(r?.level || "info") === "info").length;
    const warnCount = all.filter((r) => String(r?.level || "info") === "warn").length;
    const errCount = all.filter((r) => String(r?.level || "info") === "error").length;
    const hasIssues = warnCount > 0 || errCount > 0;
    const show = !!ui.active && (!ui.alertOnly || hasIssues);
    loggerOverlay.classList.toggle("hidden", !show);
    loggerOverlay.setAttribute("data-pos", String(ui.position || "bottom-right"));
    if (barEl) barEl.classList.toggle("issueOnly", !!ui.alertOnly);
    if (hideBtn) hideBtn.title = tt("common.hide", "Hide");
    if (!show) return;
    const latest = all.length ? all[all.length - 1] : null;
    const syncLatest = [...all].reverse().find((r) => String(r?.type || "") === "data:sync:status");
    const online = !!(syncLatest?.payload && typeof syncLatest.payload === "object" && syncLatest.payload.online);
    if (dotEl) {
      dotEl.classList.toggle("online", online);
      dotEl.classList.toggle("offline", !online);
    }
    if (countsEl) {
      countsEl.innerHTML = `
        <span>${infoCount}i</span>
        <span>${warnCount}w</span>
        <span class="loggerCountErr">${errCount}e</span>
      `;
    }
    if (textEl) {
      if (!latest) {
        textEl.textContent = tt("logger.empty", "No log entries yet.");
      } else {
        const ts = new Date(String(latest.ts || "")).toLocaleTimeString();
        const summary = String(latest.summary || latest.type || "event");
        textEl.textContent = `[${ts}] ${summary}`;
      }
    }
  }

  function applyI18n() {
    stationSel.title = tt("shell.ctx.stationTitle", "Global station");
    jobSel.title = tt("shell.ctx.jobTitle", "Global job");
    if (hintEl) hintEl.textContent = tt("shell.hint.close", "Right click opens. Esc or click outside closes.");
    if (rightRailToggle) rightRailToggle.title = tt("shell.rail.toggle", "Quick menu");
    if (rightRailPanel) {
      const title = rightRailPanel.querySelector("[data-rail-title]");
      if (title) title.textContent = tt("shell.rail.title", "Quick Menu");
    }
  }

  function clearItems() {
    ring.querySelectorAll("a.item").forEach((n) => n.remove());
  }

  function placeMenu(x, y) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pad = 18;
    const size = window.innerWidth <= 700 ? 228 : 260;
    const half = size / 2;
    const left = Math.max(pad + half, Math.min(w - pad - half, x));
    const top = Math.max(pad + half, Math.min(h - pad - half, y));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function renderMenuItems() {
    clearItems();
    const ctx = getCtxFromState();
    const prefs = readPrefs();
    const currentId = currentModuleId();
    const visibleModules = MODULES.filter((m) => {
      if (IS_EMBEDDED_FRAME && m.id === "hub") return false;
      const disabled = !m.fixed && prefs.disabled.includes(String(m.id || ""));
      return !(disabled && m.id !== currentId);
    });

    const activeJobId = String(jobSel.value || ctx.jobId || "");
    const activeJob = ctx.jobs.find((j) => String(j.id || "") === activeJobId) || null;
    const activeStationId = String(activeJob?.stationId || stationSel.value || "");
    const activeStation = ctx.stations.find((s) => String(s.id || "") === activeStationId) || null;

    const radius = window.innerWidth <= 700 ? 86 : 96;
    const cx = window.innerWidth <= 700 ? 114 : 130;
    const cy = cx;
    const n = visibleModules.length;
    if (!n) return;

    for (let i = 0; i < n; i++) {
      const m = visibleModules[i];
      const a = document.createElement("a");
      a.className = "item";
      a.textContent = tt(m.labelKey || "", m.fallback || m.id);
      const handoff = m.id === "spacial" ? buildSpacialHandoff(activeJob, activeStation) : "";
      a.href = makeUrlWithCtx(m.route, { jobId: activeJobId, stationId: activeStationId, handoff });
      if (m.id === currentId) a.classList.add("active");
      const angle = (-90 + (360 / n) * i) * (Math.PI / 180);
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      a.style.left = `${x}px`;
      a.style.top = `${y}px`;
      ring.appendChild(a);
    }
  }

  function renderContextSelectors() {
    const ctx = getCtxFromState();

    const prevStation = String(stationSel.value || "");
    stationSel.innerHTML = "";
    const stationOptions = new Map();
    for (const st of ctx.stations) stationOptions.set(String(st.id || ""), st);
    for (const st of ctx.stations) {
      const opt = document.createElement("option");
      opt.value = st.id;
      opt.textContent = `${st.code || "--"} ${st.name || tt("spacial.stationDefault", "Station")}`;
      stationSel.appendChild(opt);
    }
    if (prevStation && stationOptions.has(prevStation)) stationSel.value = prevStation;
    if (!stationSel.value && ctx.stationId) stationSel.value = ctx.stationId;

    const stationId = String(stationSel.value || ctx.stationId || "");
    const jobsForStation = stationId
      ? ctx.jobs.filter((j) => String(j.stationId || "") === stationId)
      : ctx.jobs.slice();

    const prevJob = String(jobSel.value || "");
    jobSel.innerHTML = "";
    for (const j of jobsForStation) {
      const opt = document.createElement("option");
      opt.value = j.id;
      opt.textContent = j.name || tt("hub.jobs.unnamed", "Unnamed job");
      jobSel.appendChild(opt);
    }

    if (prevJob && jobsForStation.some((j) => String(j.id || "") === prevJob)) jobSel.value = prevJob;
    if (!jobSel.value && ctx.jobId && jobsForStation.some((j) => String(j.id || "") === String(ctx.jobId))) {
      jobSel.value = ctx.jobId;
    }
    if (!jobSel.value && jobsForStation[0]) jobSel.value = String(jobsForStation[0].id || "");

    stationSel.disabled = !ctx.stations.length;
    jobSel.disabled = !jobsForStation.length;
  }

  function renderAll() {
    applyI18n();
    renderContextSelectors();
    renderMenuItems();
    renderRightRail();
    renderScopeDock();
    renderLoggerOverlay();
  }

  function readRightRailCollapsed() {
    const raw = String(localStorage.getItem(RIGHT_RAIL_COLLAPSED_KEY) || "1");
    return raw !== "0";
  }

  function writeRightRailCollapsed(next) {
    rightRailCollapsed = !!next;
    try {
      localStorage.setItem(RIGHT_RAIL_COLLAPSED_KEY, rightRailCollapsed ? "1" : "0");
    } catch {}
    if (!rightRail) return;
    rightRail.classList.toggle("collapsed", rightRailCollapsed);
    if (rightRailToggle) rightRailToggle.textContent = rightRailCollapsed ? "⚙" : "›";
  }

  function ensureRightRail() {
    if (!ENABLE_RIGHT_RAIL) return;
    if (currentModuleId() === "hub") return;
    if (rightRail) return;
    const rail = document.createElement("div");
    rail.id = "vmillRightRail";
    rail.innerHTML = `
      <style>
        #vmillRightRail{
          position:fixed;
          top:10px;
          right:10px;
          z-index:99998;
          display:flex;
          align-items:flex-start;
          gap:6px;
          font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
          --rail-bg: color-mix(in srgb, var(--vm-theme-panel, #111a2a) 90%, transparent);
          --rail-border: var(--vm-theme-border, rgba(230,237,248,.24));
          --rail-text: var(--vm-theme-text, #e6edf8);
          --rail-muted: var(--vm-theme-muted, rgba(230,237,248,.66));
          --rail-accent: var(--vm-theme-accent, #57b4ff);
          --rail-accent-rgb: var(--vm-theme-accent-rgb, 87,180,255);
        }
        #vmillRightRail .railToggle{
          width:34px;height:34px;border-radius:10px;
          border:1px solid var(--rail-border);
          background: linear-gradient(180deg, color-mix(in srgb,var(--rail-accent) 18%,transparent), color-mix(in srgb,var(--rail-accent) 8%,transparent));
          color:var(--rail-text);
          cursor:pointer;
          font-size:14px;
          font-weight:800;
          line-height:1;
          padding:0;
          box-shadow:0 10px 22px rgba(0,0,0,.32);
          backdrop-filter: blur(7px);
        }
        #vmillRightRail .railPanel{
          width:min(260px, 70vw);
          border:1px solid var(--rail-border);
          border-radius:12px;
          background:
            radial-gradient(240px 120px at 0% -40%, rgba(var(--rail-accent-rgb), .16), transparent 60%),
            var(--rail-bg);
          box-shadow:0 10px 24px rgba(0,0,0,.34);
          backdrop-filter: blur(8px);
          padding:8px;
          display:grid;
          gap:7px;
        }
        #vmillRightRail.collapsed .railPanel{ display:none; }
        #vmillRightRail .railTitle{
          font-size:10px;
          letter-spacing:.06em;
          text-transform:uppercase;
          color:var(--rail-muted);
          font-weight:700;
        }
        #vmillRightRail .railGrid{
          display:grid;
          grid-template-columns:1fr 1fr;
          gap:6px;
        }
        #vmillRightRail .railBtn{
          border:1px solid var(--rail-border);
          background:rgba(255,255,255,.03);
          color:var(--rail-text);
          border-radius:9px;
          padding:6px 8px;
          font-size:11px;
          font-weight:700;
          cursor:pointer;
          text-align:center;
          text-decoration:none;
        }
        #vmillRightRail .railBtn:hover{
          border-color:color-mix(in srgb, var(--rail-accent) 54%, var(--rail-border));
          background:color-mix(in srgb, var(--rail-accent) 14%, transparent);
        }
        #vmillRightRail .railSel{
          width:100%;
          border:1px solid var(--rail-border);
          border-radius:9px;
          background:rgba(255,255,255,.04);
          color:var(--rail-text);
          padding:6px 8px;
          font-size:11px;
        }
      </style>
      <button class="railToggle" id="vmillRailToggle" type="button" title="Quick menu">⚙</button>
      <div class="railPanel" id="vmillRailPanel">
        <div class="railTitle" data-rail-title>Quick Menu</div>
        <div class="railGrid" id="vmillRailLinks"></div>
        <select class="railSel" id="vmillRailStation"></select>
        <select class="railSel" id="vmillRailJob"></select>
      </div>
    `;
    document.body.appendChild(rail);
    rightRail = rail;
    rightRailPanel = rail.querySelector("#vmillRailPanel");
    rightRailToggle = rail.querySelector("#vmillRailToggle");
    const railStation = rail.querySelector("#vmillRailStation");
    const railJob = rail.querySelector("#vmillRailJob");
    const railLinks = rail.querySelector("#vmillRailLinks");

    rightRailCollapsed = readRightRailCollapsed();
    writeRightRailCollapsed(rightRailCollapsed);
    rightRailToggle?.addEventListener("click", () => writeRightRailCollapsed(!rightRailCollapsed));

    const buildRailLinks = () => {
      if (!railLinks) return;
      railLinks.innerHTML = "";
      const currentId = currentModuleId();
      const ctx = getCtxFromState();
      const activeJobId = String(railJob?.value || ctx.jobId || "");
      const activeJob = ctx.jobs.find((j) => String(j.id || "") === activeJobId) || null;
      const activeStationId = String(activeJob?.stationId || railStation?.value || ctx.stationId || "");
      const activeStation = ctx.stations.find((s) => String(s.id || "") === activeStationId) || null;
      const ids = ["hub", "chrono", "chrono-camera", "spacial", "can-bus", "translations", "theme"];
      for (const id of ids) {
        const mod = MODULES.find((m) => m.id === id);
        if (!mod) continue;
        if (IS_EMBEDDED_FRAME && id === "hub") continue;
        const handoff = mod.id === "spacial" ? buildSpacialHandoff(activeJob, activeStation) : "";
        const a = document.createElement("a");
        a.className = "railBtn";
        if (String(mod.id || "") === String(currentId)) a.style.borderColor = "color-mix(in srgb, var(--rail-accent) 66%, var(--rail-border))";
        a.href = makeUrlWithCtx(mod.route, { jobId: activeJobId, stationId: activeStationId, handoff });
        a.textContent = tt(mod.labelKey || "", mod.fallback || mod.id);
        railLinks.appendChild(a);
      }
    };

    const renderRailSelectors = () => {
      const ctx = getCtxFromState();
      const prevStation = String(railStation?.value || "");
      if (railStation) {
        railStation.innerHTML = "";
        for (const st of ctx.stations) {
          const o = document.createElement("option");
          o.value = String(st.id || "");
          o.textContent = `${st.code || "--"} ${st.name || tt("spacial.stationDefault", "Station")}`;
          railStation.appendChild(o);
        }
        if (prevStation && ctx.stations.some((s) => String(s.id || "") === prevStation)) railStation.value = prevStation;
        if (!railStation.value && ctx.stationId) railStation.value = String(ctx.stationId);
        railStation.disabled = !ctx.stations.length;
      }

      const stationId = String(railStation?.value || ctx.stationId || "");
      const jobs = stationId
        ? ctx.jobs.filter((j) => String(j.stationId || "") === stationId)
        : ctx.jobs.slice();
      const prevJob = String(railJob?.value || "");
      if (railJob) {
        railJob.innerHTML = "";
        for (const j of jobs) {
          const o = document.createElement("option");
          o.value = String(j.id || "");
          o.textContent = String(j.name || tt("hub.jobs.unnamed", "Unnamed job"));
          railJob.appendChild(o);
        }
        if (prevJob && jobs.some((j) => String(j.id || "") === prevJob)) railJob.value = prevJob;
        if (!railJob.value && ctx.jobId && jobs.some((j) => String(j.id || "") === String(ctx.jobId))) railJob.value = String(ctx.jobId);
        if (!railJob.value && jobs[0]) railJob.value = String(jobs[0].id || "");
        railJob.disabled = !jobs.length;
      }
      buildRailLinks();
    };

    railStation?.addEventListener("change", () => {
      const ctx = getCtxFromState();
      const stationId = String(railStation.value || "");
      const jobs = ctx.jobs.filter((j) => String(j.stationId || "") === stationId);
      if (jobs[0]) setGlobalJob(jobs[0].id);
      renderRailSelectors();
    });
    railJob?.addEventListener("change", () => {
      const jobId = String(railJob.value || "");
      if (jobId) setGlobalJob(jobId);
      renderRailSelectors();
    });

    rightRail.render = renderRailSelectors;
    renderRailSelectors();
  }

  function renderRightRail() {
    if (!ENABLE_RIGHT_RAIL) return;
    ensureRightRail();
    if (rightRail && typeof rightRail.render === "function") {
      rightRail.render();
    }
  }

  function ensureScopeDock() {
    if (!shouldOwnScopeDock()) {
      if (scopeDock) {
        scopeDock.remove();
        scopeDock = null;
      }
      setScopeDockBodyClass(false);
      applyTopDockPadding(false);
      return;
    }
    if (scopeDock) return;
    const node = document.createElement("div");
    node.id = "vmillScopeDock";
    node.className = "";
    node.innerHTML = `
      <style>
        #vmillScopeDock{
          position:fixed;
          left:50%;
          top:var(--vm-shell-scope-top, 4px);
          transform:translateX(-50%);
          z-index:var(--z-hub-scope, 100150);
          font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
          --scope-bg: color-mix(in srgb, var(--vm-theme-panel, #111a2a) 90%, transparent);
          --scope-border: var(--vm-theme-border, rgba(230,237,248,.24));
          --scope-text: var(--vm-theme-text, #e6edf8);
          --scope-muted: var(--vm-theme-muted, rgba(230,237,248,.66));
          --scope-accent: var(--vm-theme-accent, #57b4ff);
          --scope-accent-rgb: var(--vm-theme-accent-rgb, 87,180,255);
          --scope-fs-xs: 10px;
          --scope-fs-sm: 11px;
          --scope-fs-md: 12px;
        }
        body.hubHeaderMinimal #vmillScopeDock{
          opacity:1 !important;
          pointer-events:auto !important;
          transform:translateX(-50%) translateY(0) !important;
        }
        #vmillScopeDock .scopePanel{
          width:var(--vm-shell-scope-width, min(var(--vm-shell-scope-max-width, 1480px), calc(100vw - var(--vm-shell-scope-side-gap, 112px))));
          border:1px solid var(--scope-border);
          border-radius:9px;
          background:
            radial-gradient(240px 120px at 0% -40%, rgba(var(--scope-accent-rgb), .16), transparent 60%),
            var(--scope-bg);
          box-shadow:0 10px 24px rgba(0,0,0,.34);
          backdrop-filter: blur(8px);
          padding:4px 6px;
          display:grid;
          grid-template-columns:auto minmax(34px, 220px) 1fr;
          align-items:center;
          gap:4px;
          overflow:hidden;
        }
        #vmillScopeDock .scopeInfoBar{
          display:block;
          grid-column:1 / -1;
          min-width:0;
          border:1px solid var(--scope-border);
          border-radius:10px;
          background:rgba(255,255,255,.03);
          color:var(--scope-text);
          padding:3px 7px;
          font-size:var(--scope-fs-sm);
          font-weight:700;
          letter-spacing:.01em;
          text-align:left;
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis;
          cursor:pointer;
        }
        #vmillScopeDock .scopeSearchInline{
          grid-column:2;
          flex:0 0 32px;
          width:32px;
          min-width:32px;
          border-radius:10px;
          border:1px solid var(--scope-border);
          background: color-mix(in srgb, var(--vm-theme-panel-2, #0f1726) 90%, transparent);
          background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23a8b6cb' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cline x1='21' y1='21' x2='16.65' y2='16.65'/%3E%3C/svg%3E");
          background-repeat:no-repeat;
          background-position:center;
          background-size:12px 12px;
          color:transparent;
          caret-color:var(--scope-text);
          padding:6px 8px 6px 8px;
          font-size:var(--scope-fs-sm);
          line-height:1.2;
          transition:
            width .18s ease,
            min-width .18s ease,
            flex-basis .18s ease,
            color .16s ease,
            border-color .16s ease,
            box-shadow .16s ease;
        }
        #vmillScopeDock .scopeSearchInline::placeholder{
          color:transparent;
          transition: color .16s ease;
        }
        #vmillScopeDock .scopeSearchInline:focus,
        #vmillScopeDock .scopeSearchInline.hasText{
          flex:0 1 170px;
          width:clamp(110px, 18vw, var(--vm-shell-scope-search-max, 210px));
          min-width:120px;
          background-position:8px center;
          padding-left:24px;
          color:var(--scope-text);
          box-shadow:0 0 0 2px color-mix(in srgb, var(--scope-accent) 22%, transparent);
        }
        #vmillScopeDock .scopeSearchInline:focus::placeholder,
        #vmillScopeDock .scopeSearchInline.hasText::placeholder{
          color:var(--scope-muted);
        }
        #vmillScopeDock .scopeHead{
          display:flex;
          gap:4px;
          flex-wrap:wrap;
          align-items:center;
          flex:0 0 auto;
          grid-column:1;
        }
        #vmillScopeDock .scopeBtn{
          border:1px solid var(--scope-border);
          background:rgba(255,255,255,.03);
          color:var(--scope-text);
          border-radius:999px;
          padding:2px 6px;
          font-size:var(--scope-fs-sm);
          font-weight:700;
          cursor:pointer;
          text-decoration:none;
        }
        #vmillScopeDock.compact .scopePanel{
          width:min(260px, calc(100vw - 12px));
        }
        #vmillScopeDock.compact .scopeInfoBar{
          display:none !important;
        }
        #vmillScopeDock.compact .scopeHead,
        #vmillScopeDock.compact .scopeSearchInline,
        #vmillScopeDock.compact .scopeSummary,
        #vmillScopeDock.compact .scopeKpis{
          display:initial;
        }
        #vmillScopeDock .scopeBtn:hover{
          border-color:color-mix(in srgb, var(--scope-accent) 54%, var(--scope-border));
          background:color-mix(in srgb, var(--scope-accent) 14%, transparent);
        }
        #vmillScopeDock:not(.is-open):not(:hover):not(:focus-within) .scopeHead,
        #vmillScopeDock:not(.is-open):not(:hover):not(:focus-within) .scopeSearchInline,
        #vmillScopeDock:not(.is-open):not(:hover):not(:focus-within) .scopeKpis{
          display:none;
        }
        #vmillScopeDock .scopeKpis{
          grid-column:1 / -1;
          display:flex;
          flex-wrap:wrap;
          gap:3px 5px;
          margin-left:0;
          width:100%;
        }
        #vmillScopeDock .scopeSelWrap{
          display:grid;
          gap:1px;
          flex:0 0 var(--vm-shell-scope-select-width, 148px);
          max-width:var(--vm-shell-scope-select-width, 148px);
          min-width:118px;
        }
        #vmillScopeDock .scopeSelLabel{
          color:var(--scope-muted);
          font-size:var(--scope-fs-xs);
          font-weight:700;
          letter-spacing:.03em;
          text-transform:uppercase;
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis;
        }
        #vmillScopeDock .scopeSel{
          color-scheme: light dark;
          border:1px solid var(--scope-border);
          border-radius:8px;
          background:
            linear-gradient(180deg,
              color-mix(in srgb, var(--vm-theme-panel-2, #0f1726) 94%, transparent),
              color-mix(in srgb, var(--vm-theme-panel-2, #0f1726) 82%, transparent)
            );
          color:var(--scope-text);
          padding:2px 5px;
          font-size:var(--scope-fs-sm);
          min-width:0;
          width:100%;
        }
        #vmillScopeDock .scopeSel:focus{
          outline:none;
          border-color:color-mix(in srgb, var(--scope-accent) 64%, var(--scope-border));
          box-shadow:0 0 0 2px color-mix(in srgb, var(--scope-accent) 22%, transparent);
        }
        #vmillScopeDock .scopeSel option,
        #vmillScopeDock .scopeSel optgroup{
          background:color-mix(in srgb, var(--vm-theme-panel, #111a2a) 96%, transparent);
          color:var(--scope-text);
        }
        #vmillScopeDock .scopeSummary{
          display:none;
        }
        #vmillScopeDock .scopePicker{
          margin-top:6px;
          width:var(--vm-shell-scope-width, min(var(--vm-shell-scope-max-width, 1480px), calc(100vw - var(--vm-shell-scope-side-gap, 112px))));
          border:1px solid var(--scope-border);
          border-radius:12px;
          background:
            radial-gradient(240px 120px at 0% -40%, rgba(var(--scope-accent-rgb), .12), transparent 60%),
            var(--scope-bg);
          box-shadow:0 10px 24px rgba(0,0,0,.34);
          backdrop-filter: blur(8px);
          padding:6px;
          display:grid;
          gap:6px;
        }
        #vmillScopeDock .scopePicker.hidden{ display:none; }
        #vmillScopeDock .scopePickerHead{
          display:flex;
          align-items:center;
          gap:8px;
          flex-wrap:wrap;
        }
        #vmillScopeDock .scopePickerHead strong{
              font-size:var(--scope-fs-md);
        }
        #vmillScopeDock .scopeSearch{
          flex:1 1 180px;
          min-width:160px;
          border:1px solid var(--scope-border);
          border-radius:9px;
          background:rgba(255,255,255,.04);
          color:var(--scope-text);
          padding:5px 8px;
          font-size:var(--scope-fs-sm);
        }
        #vmillScopeDock .scopeList{
          max-height:min(45vh, 320px);
          overflow:auto;
          display:grid;
          gap:6px;
          padding-right:2px;
        }
        #vmillScopeDock .scopePick{
          border:1px solid var(--scope-border);
          background:rgba(255,255,255,.03);
          color:var(--scope-text);
          border-radius:9px;
          padding:6px 8px;
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:8px;
          cursor:pointer;
          font-size:var(--scope-fs-sm);
        }
        #vmillScopeDock .scopePick:hover{
          border-color:color-mix(in srgb, var(--scope-accent) 54%, var(--scope-border));
          background:color-mix(in srgb, var(--scope-accent) 12%, transparent);
        }
        #vmillScopeDock .scopePick.active{
          border-color:color-mix(in srgb, var(--scope-accent) 72%, var(--scope-border));
          background:color-mix(in srgb, var(--scope-accent) 18%, transparent);
        }
        #vmillScopeDock .scopePickMeta{
          color:var(--scope-muted);
          font-size:var(--scope-fs-xs);
          flex:0 0 auto;
        }
        @media (max-width:1200px){
          #vmillScopeDock .scopePanel{
            width:var(--vm-shell-scope-width, min(var(--vm-shell-scope-max-width, 1280px), calc(100vw - var(--vm-shell-scope-side-gap, 80px))));
          }
          #vmillScopeDock .scopePicker{
            width:var(--vm-shell-scope-width, min(var(--vm-shell-scope-max-width, 1280px), calc(100vw - var(--vm-shell-scope-side-gap, 80px))));
          }
        }
        @media (max-width:960px){
          #vmillScopeDock .scopePanel{
            width:var(--vm-shell-scope-width, min(var(--vm-shell-scope-max-width, 1000px), calc(100vw - var(--vm-shell-scope-side-gap, 40px))));
            gap:5px;
            grid-template-columns:auto minmax(34px, 180px) 1fr;
          }
          #vmillScopeDock .scopePicker{
            width:var(--vm-shell-scope-width, min(var(--vm-shell-scope-max-width, 1000px), calc(100vw - var(--vm-shell-scope-side-gap, 40px))));
          }
          #vmillScopeDock .scopeSummary{
            display:none;
            margin-left:0;
          }
          #vmillScopeDock .scopeKpis{
            gap:3px 4px;
          }
          #vmillScopeDock .scopeSelWrap{
            flex-basis:var(--vm-shell-scope-select-width-md, 134px);
            max-width:var(--vm-shell-scope-select-width-md, 134px);
            min-width:108px;
          }
        }
        @media (max-width:760px){
          #vmillScopeDock{
            top:var(--vm-shell-scope-top-mobile, var(--vm-shell-scope-top, 4px));
          }
        #vmillScopeDock .scopePanel{
          width:var(--vm-shell-scope-width-mobile, calc(100vw - 16px));
          gap:6px;
          padding:6px;
          grid-template-columns:1fr;
          align-items:stretch;
        }
          #vmillScopeDock .scopeHead{
            grid-column:1;
            order:initial;
          }
          #vmillScopeDock .scopeSearchInline{
            grid-column:1;
            order:initial;
            min-width:32px;
            padding:6px 8px;
            font-size:var(--scope-fs-sm);
            align-self:flex-start;
          }
          #vmillScopeDock .scopeSearchInline:focus,
          #vmillScopeDock .scopeSearchInline.hasText{
            width:100%;
            min-width:100%;
            flex:1 1 100%;
            align-self:stretch;
          }
          #vmillScopeDock .scopeKpis{
            grid-column:1;
            order:initial;
            display:flex;
            flex-wrap:wrap;
            width:100%;
          }
          #vmillScopeDock .scopeSelWrap{
            flex-basis:calc(50% - 3px);
            max-width:calc(50% - 3px);
            min-width:0;
          }
          #vmillScopeDock .scopePicker{ width:var(--vm-shell-scope-width-mobile, calc(100vw - 16px)); }
          #vmillScopeDock .scopeSummary{ display:none; }
        }
        @media (max-width:520px){
          #vmillScopeDock .scopeSelWrap{ flex-basis:100%; max-width:100%; }
        }
      </style>
      <div class="scopePanel" id="vmillScopePanel">
        <button class="scopeInfoBar" id="vmillScopeInfoBar" type="button"></button>
        <div class="scopeHead">
          <button class="scopeBtn" id="vmillScopeReset" type="button">Reset</button>
        </div>
        <input class="scopeSearchInline" id="vmillScopeFilterSearch" type="text" />
        <div class="scopeKpis" id="vmillScopeKpis"></div>
        <div class="scopeSummary" id="vmillScopeSummary"></div>
      </div>
      <div class="scopePicker hidden" id="vmillScopePicker">
        <div class="scopePickerHead">
          <strong id="vmillScopePickerTitle">Scope</strong>
          <input class="scopeSearch" id="vmillScopeSearch" type="text" />
          <button class="scopeBtn" id="vmillScopePickerClose" type="button">Close</button>
        </div>
        <div class="scopeList" id="vmillScopeList"></div>
      </div>
    `;
    document.body.appendChild(node);
    scopeDock = node;
    applyScopeDockStyle(node);
    setScopeDockBodyClass(true);
    applyTopDockPadding(true);

    const resetBtn = node.querySelector("#vmillScopeReset");
    const infoBarEl = node.querySelector("#vmillScopeInfoBar");
    const panelEl = node.querySelector("#vmillScopePanel");
    const kpisEl = node.querySelector("#vmillScopeKpis");
    const summaryEl = node.querySelector("#vmillScopeSummary");
    const filterSearchEl = node.querySelector("#vmillScopeFilterSearch");
    const pickerEl = node.querySelector("#vmillScopePicker");
    const pickerTitleEl = node.querySelector("#vmillScopePickerTitle");
    const pickerSearchEl = node.querySelector("#vmillScopeSearch");
    const pickerCloseEl = node.querySelector("#vmillScopePickerClose");
    const pickerListEl = node.querySelector("#vmillScopeList");

    const typeById = new Map();
    const itemsByType = new Map();
    let visibleTypeIds = [];
    let openTypeId = "";
    let pickerQuery = "";
    let scopeQueryInputTimer = 0;
    let scopeLeaveCloseTimer = 0;
    let lastScopeInsidePointerDownAt = 0;
    const SCOPE_LEAVE_CLOSE_DELAY_MS = 2000;
    const SCOPE_OUTSIDE_IGNORE_AFTER_INSIDE_MS = 360;
    let currentModel = { types: [], items: [], links: [], rules: [] };
    let lastModelLoadAt = 0;
    let cachedModelStoreRaw = "";
    let cachedModelStore = { types: [], items: [], links: [], rules: [] };
    const mobileScopeMq = window.matchMedia
      ? window.matchMedia("(max-width:760px), (hover:none) and (pointer:coarse)")
      : null;

    function isMobileScopeCompact() {
      if (mobileScopeMq) return !!mobileScopeMq.matches;
      return window.innerWidth <= 760;
    }

    function syncScopeDockCompactState() {
      const compactMode = isMobileScopeCompact();
      node.classList.toggle("mobile", compactMode);
      node.classList.remove("compact");
    }

    function setScopeCollapsed(_nextCollapsed, persist = true) {
      // Scope toolbar is always expanded now to keep selectors visible.
      if (persist) writeScopeDockUi({ collapsed: false });
      syncScopeDockCompactState();
    }
    function clearScopeLeaveCloseTimer() {
      if (!scopeLeaveCloseTimer) return;
      clearTimeout(scopeLeaveCloseTimer);
      scopeLeaveCloseTimer = 0;
    }
    function holdScopeOpen() {
      clearScopeLeaveCloseTimer();
      node.classList.add("is-open");
    }
    function scheduleScopeLeaveClose() {
      clearScopeLeaveCloseTimer();
      scopeLeaveCloseTimer = setTimeout(() => {
        if (!scopeDock || !node.isConnected) return;
        const hovered = node.matches(":hover");
        const active = document.activeElement;
        const focusWithin = !!(active instanceof Node && node.contains(active));
        if (hovered || focusWithin) {
          scheduleScopeLeaveClose();
          return;
        }
        closePicker();
        node.classList.remove("is-open");
        render();
      }, SCOPE_LEAVE_CLOSE_DELAY_MS);
    }

    function typeLabel(t) {
      const plural = String(t?.namePlural || "");
      const singular = String(t?.nameSingular || "");
      return plural || singular || String(t?.id || "Type");
    }
    function typeByIdSafe(typeId) {
      const wanted = String(typeId || "");
      if (!wanted) return null;
      const exact = typeById.get(wanted);
      if (exact) return exact;
      const lw = wanted.toLowerCase();
      for (const [id, row] of typeById.entries()) {
        if (String(id || "").toLowerCase() === lw) return row;
      }
      return null;
    }
    function itemLabel(it) {
      const code = String(it?.code || "").trim();
      const name = String(it?.name || it?.id || "");
      return code ? `${code} - ${name}` : name;
    }
    function roleTypeId(role) {
      const wanted = String(role || "").trim().toLowerCase();
      if (!wanted) return "";
      for (const t of typeById.values()) {
        const moduleRole = String(t?.moduleRole || "").trim().toLowerCase();
        if (moduleRole && moduleRole === wanted) return String(t?.id || "");
      }
      const byId = [...typeById.values()].find((t) => String(t?.id || "").trim().toLowerCase() === wanted);
      return byId ? String(byId.id || "") : "";
    }
    function emptyModel() {
      return { types: [], items: [], links: [], rules: [] };
    }
    function normalizeStructureModel(raw) {
      const src = raw && typeof raw === "object" ? raw : {};
      return {
        types: Array.isArray(src.types) ? src.types.slice() : [],
        items: Array.isArray(src.items) ? src.items.slice() : [],
        links: Array.isArray(src.links) ? src.links.slice() : [],
        rules: Array.isArray(src.rules) ? src.rules.slice() : [],
      };
    }
    function readStructureModelFromLocalStore() {
      const rawText = String(localStorage.getItem("vmill:module-data:v1") || "");
      if (rawText && rawText === cachedModelStoreRaw) {
        return cachedModelStore;
      }
      cachedModelStoreRaw = rawText;
      const rawModule = safeParse(rawText, null);
      const store = rawModule && typeof rawModule === "object"
        ? (rawModule.store && typeof rawModule.store === "object" ? rawModule.store : rawModule)
        : null;
      if (!store || typeof store !== "object") {
        cachedModelStore = emptyModel();
        return cachedModelStore;
      }
      cachedModelStore = {
        types: Array.isArray(store.global_entity_types) ? store.global_entity_types.slice() : [],
        items: Array.isArray(store.global_entity_items) ? store.global_entity_items.slice() : [],
        links: Array.isArray(store.global_entity_links) ? store.global_entity_links.slice() : [],
        rules: Array.isArray(store.global_structure_rules) ? store.global_structure_rules.slice() : [],
      };
      return cachedModelStore;
    }
    function readStructureModelFromEntityApi() {
      if (!window.VMillData?.listEntityTypes) return emptyModel();
      const typeRows = window.VMillData.listEntityTypes();
      const types = Array.isArray(typeRows) ? typeRows.slice() : [];
      if (!types.length) return emptyModel();
      const items = [];
      if (window.VMillData?.listEntities) {
        for (const t of types) {
          const tid = String(t?.id || "");
          if (!tid) continue;
          const rows = window.VMillData.listEntities(tid) || [];
          if (!Array.isArray(rows)) continue;
          for (const row of rows) {
            items.push({
              ...(row || {}),
              typeId: tid,
            });
          }
        }
      }
      return { types, items, links: [], rules: [] };
    }
    function synthesizeRoleModelFromAppState() {
      const app = readAppState() || {};
      const types = [
        { id: "product", nameSingular: "Product", namePlural: "Products", moduleRole: "product" },
        { id: "station", nameSingular: "Station", namePlural: "Stations", moduleRole: "station" },
        { id: "job", nameSingular: "Job", namePlural: "Jobs", moduleRole: "job" },
      ];
      const mapRows = (rows, typeId) =>
        (Array.isArray(rows) ? rows : [])
          .map((row) => {
            const id = String(row?.id || "");
            if (!id) return null;
            return {
              id,
              typeId,
              source: "app",
              sourceId: id,
              code: String(row?.code || ""),
              name: String(row?.name || id),
              meta: {},
            };
          })
          .filter(Boolean);
      const items = [
        ...mapRows(app?.products, "product"),
        ...mapRows(app?.stations, "station"),
        ...mapRows(app?.jobs, "job"),
      ];
      return { types, items, links: [], rules: [] };
    }
    function loadModel() {
      const nowTs = Date.now();
      if (currentModel.types.length && (nowTs - lastModelLoadAt) < 180) return;
      lastModelLoadAt = nowTs;
      typeById.clear();
      itemsByType.clear();
      // Fast path: local module snapshot (already normalized by module-data).
      let model = normalizeStructureModel(readStructureModelFromLocalStore());

      // Fallback to API abstraction only when local store is not ready.
      if (!model.types.length) {
        model = normalizeStructureModel(
          window.VMillData?.readStructureModel
            ? window.VMillData.readStructureModel({ persist: false })
            : emptyModel()
        );
      }

      // Early-shell fallback: module-shell can boot before module-data is ready.
      if (!model.types.length) model = normalizeStructureModel(readStructureModelFromLocalStore());

      // Secondary fallback: use entity APIs used by Hub settings.
      if (!model.types.length) model = normalizeStructureModel(readStructureModelFromEntityApi());

      // Last fallback: synthesize base role categories from app state.
      if (!model.types.length) model = normalizeStructureModel(synthesizeRoleModelFromAppState());

      const types = model.types.slice();
      const items = model.items.slice();
      const links = model.links.slice();
      const rules = model.rules.slice();

      currentModel = { types, items, links, rules };
      types.sort((a, b) => typeLabel(a).localeCompare(typeLabel(b)));
      for (const t of types) typeById.set(String(t?.id || ""), t);
      for (const it of items) {
        const tid = String(it?.typeId || "");
        if (!tid) continue;
        if (!itemsByType.has(tid)) itemsByType.set(tid, []);
        itemsByType.get(tid).push(it);
      }
      for (const [tid, rows] of itemsByType.entries()) {
        rows.sort((a, b) => itemLabel(a).localeCompare(itemLabel(b)));
        itemsByType.set(tid, rows);
      }

      // Determine root categories (types that are not children in rules),
      // then apply toolbar prefs from Hub settings.
      const hasType = (id) => typeById.has(String(id || ""));
      const childTypeIds = new Set(
        rules
          .filter((r) => {
            const parentId = String(r?.parentTypeId || "");
            const childId = String(r?.childTypeId || "");
            return !!parentId && !!childId && parentId !== childId && hasType(parentId) && hasType(childId);
          })
          .map((r) => String(r?.childTypeId || ""))
      );
      const rootTypeIds = types
        .map((t) => String(t?.id || ""))
        .filter((id) => id && !childTypeIds.has(id));
      const allTypeIds = types.map((t) => String(t?.id || "")).filter(Boolean);
      const prefs = readScopeToolbarPrefs();
      const baseTypeIds = prefs.mode === "all" ? allTypeIds : (rootTypeIds.length ? rootTypeIds : allTypeIds);
      const orderedBase = [];
      for (const id of (prefs.orderTypeIds || [])) {
        if (!baseTypeIds.includes(id) || orderedBase.includes(id)) continue;
        orderedBase.push(id);
      }
      for (const id of baseTypeIds) {
        if (!orderedBase.includes(id)) orderedBase.push(id);
      }
      const hidden = new Set(prefs.hiddenTypeIds || []);
      visibleTypeIds = orderedBase.filter((id) => !hidden.has(id));
      if (!visibleTypeIds.length) {
        // Fallback: never leave the scope bar empty because of stale/over-strict prefs.
        visibleTypeIds = (orderedBase.length ? orderedBase : allTypeIds).slice();
      }
      if (!visibleTypeIds.length && Array.isArray(prefs.orderTypeIds) && prefs.orderTypeIds.length) {
        // Last-resort fallback: preserve toolbar prefs visibility even if
        // model types are still loading.
        visibleTypeIds = [...new Set(prefs.orderTypeIds.map((x) => String(x || "").trim()).filter(Boolean))]
          .filter((id) => !hidden.has(id));
      }
    }
    function selectedScopeEntries(selectedMap, excludeTypeId = "") {
      const selected = selectedMap && typeof selectedMap === "object" ? selectedMap : {};
      const skip = String(excludeTypeId || "");
      return Object.entries(selected)
        .map(([typeId, itemId]) => [String(typeId || ""), String(itemId || "")])
        .filter(([typeId, itemId]) =>
          typeId
          && typeById.has(typeId)
          && itemId
          && itemId !== "all"
          && (!skip || typeId !== skip)
        );
    }
    function roleTypeIds() {
      return {
        productTypeId: roleTypeId("product"),
        stationTypeId: roleTypeId("station"),
        jobTypeId: roleTypeId("job"),
      };
    }
    function fastRoleScopedSet(ctx, targetTypeId, entries) {
      const targetTid = String(targetTypeId || "");
      const roleIds = ctx?.roleIds || roleTypeIds();
      const jobTid = String(roleIds.jobTypeId || "");
      const stationTid = String(roleIds.stationTypeId || "");
      const productTid = String(roleIds.productTypeId || "");
      if (!targetTid || !jobTid || !stationTid || !productTid) return null;
      if (!(targetTid === jobTid || targetTid === stationTid || targetTid === productTid)) return null;
      const jobs = Array.isArray(ctx?.appState?.jobs) ? ctx.appState.jobs : [];
      if (!jobs.length) return new Set();
      let active = null;
      let applied = 0;
      for (const [typeId, itemId] of entries) {
        const tid = String(typeId || "");
        const iid = String(itemId || "");
        if (!tid || !iid) continue;
        let next = null;
        if (targetTid === jobTid) {
          if (tid === jobTid) next = new Set([iid]);
          else if (tid === stationTid) next = new Set(jobs.filter((j) => String(j?.stationId || "") === iid).map((j) => String(j?.id || "")).filter(Boolean));
          else if (tid === productTid) next = new Set(jobs.filter((j) => String(j?.productId || "") === iid).map((j) => String(j?.id || "")).filter(Boolean));
        } else if (targetTid === stationTid) {
          if (tid === stationTid) next = new Set([iid]);
          else if (tid === jobTid) {
            const job = jobs.find((j) => String(j?.id || "") === iid);
            next = new Set(job && String(job?.stationId || "") ? [String(job.stationId || "")] : []);
          } else if (tid === productTid) {
            next = new Set(jobs.filter((j) => String(j?.productId || "") === iid).map((j) => String(j?.stationId || "")).filter(Boolean));
          }
        } else if (targetTid === productTid) {
          if (tid === productTid) next = new Set([iid]);
          else if (tid === jobTid) {
            const job = jobs.find((j) => String(j?.id || "") === iid);
            next = new Set(job && String(job?.productId || "") ? [String(job.productId || "")] : []);
          } else if (tid === stationTid) {
            next = new Set(jobs.filter((j) => String(j?.stationId || "") === iid).map((j) => String(j?.productId || "")).filter(Boolean));
          }
        }
        if (!(next instanceof Set)) continue;
        applied += 1;
        active = active == null ? next : new Set([...active].filter((id) => next.has(id)));
      }
      return applied > 0 ? (active || new Set()) : null;
    }
    function buildScopeGraph() {
      const items = Array.isArray(currentModel?.items) ? currentModel.items : [];
      const links = Array.isArray(currentModel?.links) ? currentModel.links : [];
      const itemByKey = new Map();
      const edgeForward = new Map();
      const keyOf = (typeId, itemId) => `${String(typeId || "")}::${String(itemId || "")}`;
      for (const item of items) {
        const k = keyOf(item?.typeId, item?.id);
        if (!k.startsWith("::") && !k.endsWith("::")) itemByKey.set(k, item);
      }
      for (const ln of links) {
        const fromKey = keyOf(ln?.fromTypeId, ln?.fromId);
        const toKey = keyOf(ln?.toTypeId, ln?.toId);
        if (!itemByKey.has(fromKey) || !itemByKey.has(toKey)) continue;
        // Keep directional graph to avoid over-expanding through shared nodes
        // (e.g. product -> job -> station -> other jobs).
        if (!edgeForward.has(fromKey)) edgeForward.set(fromKey, new Set());
        edgeForward.get(fromKey).add(toKey);
      }
      return { itemByKey, edgeForward, keyOf };
    }
    function reachableItemIdsFromNode(ctx, typeId, itemId, targetTypeId) {
      const tid = String(typeId || "");
      const iid = String(itemId || "");
      const targetTid = String(targetTypeId || "");
      if (!tid || !iid || !targetTid) return new Set();
      const reachCache = ctx?.reachableCache instanceof Map ? ctx.reachableCache : null;
      const reachKey = `${tid}|${iid}|${targetTid}`;
      if (reachCache && reachCache.has(reachKey)) return reachCache.get(reachKey);
      const roleIds = ctx?.roleIds || roleTypeIds();
      const graph = ctx?.graph || buildScopeGraph();
      const app = ctx?.appState || readAppState() || {};
      const startKey = graph.keyOf(tid, iid);
      const out = new Set();
      const jobs = Array.isArray(app?.jobs) ? app.jobs : [];
      const jobById = new Map(
        jobs
          .map((job) => [String(job?.id || ""), job])
          .filter(([id]) => !!id)
      );
      const addFromJobRecord = (job) => {
        if (!job || typeof job !== "object") return;
        if (targetTid === roleIds.jobTypeId) {
          const id = String(job?.id || "");
          if (id) out.add(id);
          return;
        }
        if (targetTid === roleIds.stationTypeId) {
          const id = String(job?.stationId || "");
          if (id) out.add(id);
          return;
        }
        if (targetTid === roleIds.productTypeId) {
          const id = String(job?.productId || "");
          if (id) out.add(id);
        }
      };
      const addFromSource = (sourceTid, sourceId) => {
        const sid = String(sourceId || "");
        if (!sid) return;
        if (sourceTid === roleIds.jobTypeId) {
          const job = jobById.get(sid);
          if (job) addFromJobRecord(job);
          return;
        }
        if (sourceTid === roleIds.stationTypeId) {
          for (const job of jobs) {
            if (String(job?.stationId || "") === sid) addFromJobRecord(job);
          }
          return;
        }
        if (sourceTid === roleIds.productTypeId) {
          for (const job of jobs) {
            if (String(job?.productId || "") === sid) addFromJobRecord(job);
          }
        }
      };
      const visited = new Set();
      const q = [startKey];
      while (q.length) {
        const key = q.shift();
        if (!key || visited.has(key)) continue;
        visited.add(key);
        const row = graph.itemByKey.get(key);
        if (row && String(row?.typeId || "") === targetTid) {
          const refId = String(row?.sourceId || row?.id || "");
          if (refId) out.add(refId);
        }
        if (row) addFromSource(String(row?.typeId || ""), String(row?.sourceId || row?.id || ""));
        for (const nextKey of (graph.edgeForward.get(key) || [])) {
          if (!visited.has(nextKey)) q.push(nextKey);
        }
      }
      if (!out.size) {
        if (tid === targetTid) out.add(iid);
        addFromSource(tid, iid);
      }
      if (reachCache) reachCache.set(reachKey, out);
      return out;
    }
    function computeScopeTypeSet(ctx, targetTypeId, excludeTypeId = "") {
      const targetTid = String(targetTypeId || "");
      if (!targetTid) return null;
      const entries = selectedScopeEntries(ctx?.scopeSelected || {}, excludeTypeId);
      if (!entries.length) return null;
      const setCache = ctx?.typeSetCache instanceof Map ? ctx.typeSetCache : null;
      const cacheKey = `${targetTid}|${String(excludeTypeId || "")}|${entries.map(([a, b]) => `${a}:${b}`).join(";")}`;
      if (setCache && setCache.has(cacheKey)) return setCache.get(cacheKey);
      const roleFast = fastRoleScopedSet(ctx, targetTid, entries);
      if (roleFast instanceof Set) {
        if (setCache) setCache.set(cacheKey, roleFast);
        return roleFast;
      }
      let active = null;
      for (const [typeId, itemId] of entries) {
        const nextSet = reachableItemIdsFromNode(ctx, typeId, itemId, targetTid);
        const normalizedSet = nextSet instanceof Set ? nextSet : new Set();
        active = active == null
          ? normalizedSet
          : new Set([...active].filter((id) => normalizedSet.has(id)));
      }
      const result = active || null;
      if (setCache) setCache.set(cacheKey, result);
      return result;
    }
    function rowIdMatchesScopedSet(row, scopedSet) {
      if (!scopedSet || !(scopedSet instanceof Set)) return true;
      const id = String(row?.id || "");
      const sourceId = String(row?.sourceId || "");
      return scopedSet.has(id) || (sourceId && scopedSet.has(sourceId));
    }
    function rowsForTypeWithScope(scope, targetTypeId, ctx, excludeTypeId = "") {
      const tid = String(targetTypeId || "");
      const rows = (itemsByType.get(tid) || []).slice();
      const scopedSet = computeScopeTypeSet(ctx, tid, excludeTypeId);
      if (!scopedSet) return rows;
      return rows.filter((row) => rowIdMatchesScopedSet(row, scopedSet));
    }
    function sanitizeScopeSelection(scope, ctx) {
      const src = normalizeHubScope(scope);
      const selected = { ...(src.selected || {}) };
      let changed = false;
      const keys = Object.keys(selected).filter((tid) => typeById.has(String(tid || "")));
      for (let pass = 0; pass < Math.max(1, keys.length * 2); pass++) {
        let mutated = false;
        for (const tid of keys) {
          const sel = String(selected[tid] || "all");
          if (!sel || sel === "all") continue;
          const rows = (itemsByType.get(tid) || []);
          const selectedRow = rows.find((row) => String(row?.id || "") === sel) || null;
          const scopedSet = computeScopeTypeSet({ ...ctx, scopeSelected: selected }, tid, tid);
          if (!scopedSet) continue;
          const valid = scopedSet.has(sel) || (selectedRow ? rowIdMatchesScopedSet(selectedRow, scopedSet) : false);
          if (!valid) {
            selected[tid] = "all";
            mutated = true;
            changed = true;
          }
        }
        if (!mutated) break;
      }
      return changed ? { ...src, selected } : src;
    }
    function buildScopeContext(scope) {
      return {
        scopeSelected: scope?.selected && typeof scope.selected === "object" ? scope.selected : {},
        appState: readAppState() || {},
        roleIds: roleTypeIds(),
        graph: buildScopeGraph(),
        reachableCache: new Map(),
        typeSetCache: new Map(),
      };
    }
    function applyScopeToAppContext(scope) {
      const st = readAppState();
      if (!isValidAppState(st)) return;
      const selected = scope && typeof scope.selected === "object" ? scope.selected : {};
      const jobType = roleTypeId("job");
      const stationType = roleTypeId("station");
      const productType = roleTypeId("product");
      let nextJobId = "";
      const selectedJob = jobType ? String(selected[jobType] || "all") : "all";
      if (selectedJob && selectedJob !== "all" && st.jobs.some((j) => String(j?.id || "") === selectedJob)) {
        nextJobId = selectedJob;
      }
      if (!nextJobId && stationType) {
        const sid = String(selected[stationType] || "all");
        if (sid && sid !== "all") {
          const match = st.jobs.find((j) => String(j?.stationId || "") === sid);
          if (match) nextJobId = String(match.id || "");
        }
      }
      if (!nextJobId && productType) {
        const pid = String(selected[productType] || "all");
        if (pid && pid !== "all") {
          const match = st.jobs.find((j) => String(j?.productId || "") === pid);
          if (match) nextJobId = String(match.id || "");
        }
      }
      if (!nextJobId) return;
      if (String(st.activeJobId || "") === nextJobId) return;
      st.activeJobId = nextJobId;
      st.meta = st.meta || {};
      st.meta.updatedAt = new Date().toISOString();
      writeAppState(st);
      try { localStorage.setItem(SHELL_JOB_KEY, nextJobId); } catch {}
    }
    function updateScope(nextScope) {
      const written = writeHubScope(nextScope);
      applyScopeToAppContext(written);
      return written;
    }
    function escHtml(v) {
      return String(v ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;");
    }
    function closePicker() {
      openTypeId = "";
      pickerQuery = "";
      pickerEl?.classList.add("hidden");
      if (pickerSearchEl) pickerSearchEl.value = "";
    }
    function syncSearchInlineState() {
      if (!filterSearchEl) return;
      const hasText = String(filterSearchEl.value || "").trim().length > 0;
      filterSearchEl.classList.toggle("hasText", hasText);
    }
    function renderKpis(scope) {
      if (!kpisEl) return;
      const ctx = buildScopeContext(scope);
      let types = visibleTypeIds
        .map((id) => typeByIdSafe(id))
        .filter(Boolean);
      if (!types.length && typeById.size) {
        // Settings/prefs may contain stale IDs (case or old ids). Fallback to all.
        types = Array.from(typeById.values());
      }
      if (!types.length) {
        kpisEl.innerHTML = `<span class="scopeSelLabel">${tt("hub.overview.none", "No categories")}</span>`;
        return;
      }
      kpisEl.innerHTML = types.map((t) => {
        const tid = String(t?.id || "");
        const rows = rowsForTypeWithScope(scope, tid, ctx, tid);
        const selectedId = String(scope.selected?.[tid] || "all");
        const opts = [
          `<option value="all">${tt("hub.common.all", "All")} (${rows.length})</option>`,
          ...rows.map((it) => {
            const id = String(it?.id || "");
            const selected = selectedId === id ? "selected" : "";
            return `<option value="${escHtml(id)}" ${selected}>${escHtml(itemLabel(it))}</option>`;
          }),
        ].join("");
        return `<label class="scopeSelWrap">
          <span class="scopeSelLabel">${escHtml(typeLabel(t))}</span>
          <select class="scopeSel" data-scope-select="${escHtml(tid)}">${opts}</select>
        </label>`;
      }).join("");
      kpisEl.querySelectorAll("[data-scope-select]").forEach((sel) => {
        sel.addEventListener("change", () => {
          holdScopeOpen();
          const tid = String(sel.getAttribute("data-scope-select") || "");
          if (!tid) return;
          const nextValue = String(sel.value || "all");
          const scopeNow = readHubScope();
          const next = {
            ...scopeNow,
            selected: {
              ...(scopeNow.selected || {}),
              [tid]: nextValue && nextValue !== "all" ? nextValue : "all",
            },
            openTypeId: "",
          };
          const nextCtx = buildScopeContext(next);
          updateScope(sanitizeScopeSelection(next, nextCtx));
          render();
        });
      });
    }
    function renderSummary(scope) {
      const rows = Object.entries(scope.selected || {})
        .map(([tid, iid]) => [String(tid || ""), String(iid || "")])
        .filter(([tid, iid]) => tid && iid && iid !== "all")
        .filter(([tid]) => visibleTypeIds.includes(tid));
      if (!rows.length) {
        summaryEl.innerHTML = "";
        return;
      }
      summaryEl.innerHTML = rows.map(([tid, iid]) => {
        const t = typeById.get(tid);
        const labelA = typeLabel(t);
        const item = (itemsByType.get(tid) || []).find((it) => String(it?.id || "") === iid);
        const labelB = itemLabel(item || { id: iid, name: iid });
        return `<span class="scopeChip">${labelA}: ${labelB}</span>`;
      }).join("");
    }
    function renderInfoBar(scope) {
      if (!infoBarEl) return;
      const selectedRows = Object.entries(scope.selected || {})
        .map(([tid, iid]) => [String(tid || ""), String(iid || "")])
        .filter(([tid, iid]) => tid && iid && iid !== "all")
        .filter(([tid]) => visibleTypeIds.includes(tid))
        .map(([tid, iid]) => {
          const t = typeById.get(tid);
          const item = (itemsByType.get(tid) || []).find((it) => String(it?.id || "") === iid);
          const labelA = typeLabel(t);
          const labelB = itemLabel(item || { id: iid, name: iid });
          return `${labelA}: ${labelB}`;
        });
      const txt = selectedRows.length
        ? selectedRows.join(" · ")
        : `${tt("hub.scope.allScope", "All scope")}`;
      infoBarEl.textContent = txt;
      infoBarEl.removeAttribute("title");
    }
    function renderPicker(scope) {
      if (!pickerEl || !pickerTitleEl || !pickerListEl || !openTypeId || !typeById.has(openTypeId)) {
        closePicker();
        return;
      }
      const ctx = buildScopeContext(scope);
      const rows = rowsForTypeWithScope(scope, openTypeId, ctx, openTypeId);
      const query = String(pickerQuery || "").trim().toLowerCase();
      const filtered = rows.filter((it) => {
        if (!query) return true;
        const txt = `${String(it?.code || "")} ${itemLabel(it)}`.toLowerCase();
        return txt.includes(query);
      });
      const selectedId = String(scope.selected?.[openTypeId] || "all");
      pickerEl.classList.remove("hidden");
      pickerTitleEl.textContent = typeLabel(typeById.get(openTypeId));
      pickerListEl.innerHTML = `
        <button class="scopePick ${selectedId === "all" ? "active" : ""}" type="button" data-scope-pick="all">
          <span>${tt("hub.common.all", "All")}</span>
          <span class="scopePickMeta">${tt("hub.overview.itemsCount", "{count} items", { count: rows.length })}</span>
        </button>
        ${filtered.map((it) => {
          const id = String(it?.id || "");
          return `<button class="scopePick ${selectedId === id ? "active" : ""}" type="button" data-scope-pick="${id}">
            <span>${itemLabel(it)}</span>
          </button>`;
        }).join("")}
      `;
      pickerListEl.querySelectorAll("[data-scope-pick]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const itemId = String(btn.getAttribute("data-scope-pick") || "all");
          const scopeNow = readHubScope();
          const next = {
            ...scopeNow,
            selected: {
              ...(scopeNow.selected || {}),
              [openTypeId]: itemId && itemId !== "all" ? itemId : "all",
            },
            openTypeId: "",
            query: "",
          };
          const nextCtx = buildScopeContext(next);
          updateScope(sanitizeScopeSelection(next, nextCtx));
          closePicker();
          render();
        });
      });
    }
    function render() {
      applyScopeDockStyle(node);
      const scopeRaw = readHubScope();
      loadModel();
      const scopeCtx = buildScopeContext(scopeRaw);
      const scope = sanitizeScopeSelection(scopeRaw, scopeCtx);
      if (JSON.stringify(scope.selected || {}) !== JSON.stringify(scopeRaw.selected || {})) {
        updateScope(scope);
      }
      renderKpis(scope);
      renderInfoBar(scope);
      if (resetBtn) resetBtn.textContent = tt("hub.overview.resetFilters", "Reset");
      if (filterSearchEl) {
        if (document.activeElement !== filterSearchEl) {
          const nextVal = String(scope.query || "");
          if (filterSearchEl.value !== nextVal) filterSearchEl.value = nextVal;
        }
        filterSearchEl.placeholder = tt("hub.jobs.searchPlaceholder", "Search station/job...");
        syncSearchInlineState();
      }
      if (pickerSearchEl) pickerSearchEl.placeholder = tt("hub.jobs.searchPlaceholder", "Search station/job...");
      if (pickerCloseEl) pickerCloseEl.textContent = tt("common.close", "Close");
      closePicker();
    }
    function clearSelection() {
      const scope = readHubScope();
      const nextSelected = { ...(scope.selected || {}) };
      for (const tid of visibleTypeIds) nextSelected[tid] = "all";
      updateScope({ ...scope, selected: nextSelected, openTypeId: "", query: "" });
    }
    function openScopePicker(typeId = "") {
      setScopeCollapsed(false);
      holdScopeOpen();
      closePicker();
      render();
      const wanted = String(typeId || "").trim();
      let targetSel = null;
      if (wanted) {
        const sels = kpisEl ? Array.from(kpisEl.querySelectorAll("[data-scope-select]")) : [];
        targetSel = sels.find((el) => String(el.getAttribute("data-scope-select") || "") === wanted) || null;
      } else {
        targetSel = kpisEl?.querySelector("[data-scope-select]") || null;
      }
      if (targetSel instanceof HTMLElement) targetSel.focus();
    }
    resetBtn?.addEventListener("click", () => {
      holdScopeOpen();
      clearSelection();
      closePicker();
      render();
    });
    infoBarEl?.addEventListener("click", () => {
      holdScopeOpen();
      setScopeCollapsed(false);
      render();
      const firstSel = kpisEl?.querySelector("[data-scope-select]");
      if (firstSel instanceof HTMLElement) firstSel.focus();
    });
    panelEl?.addEventListener("pointerdown", (e) => {
      lastScopeInsidePointerDownAt = Date.now();
      holdScopeOpen();
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".scopeInfoBar")) return;
    });
    panelEl?.addEventListener("focusin", () => {
      holdScopeOpen();
    });
    node.addEventListener("pointerenter", () => {
      holdScopeOpen();
    });
    node.addEventListener("pointerleave", () => {
      scheduleScopeLeaveClose();
    });
    pickerCloseEl?.addEventListener("click", () => {
      holdScopeOpen();
      closePicker();
      render();
    });
    pickerSearchEl?.addEventListener("input", () => {
      holdScopeOpen();
      pickerQuery = String(pickerSearchEl.value || "");
      renderPicker(readHubScope());
    });
    filterSearchEl?.addEventListener("input", () => {
      holdScopeOpen();
      syncSearchInlineState();
      if (scopeQueryInputTimer) clearTimeout(scopeQueryInputTimer);
      scopeQueryInputTimer = setTimeout(() => {
        const nextQuery = String(filterSearchEl.value || "");
        const scopeNow = readHubScope();
        if (String(scopeNow.query || "") === nextQuery) return;
        updateScope({
          ...scopeNow,
          query: nextQuery,
        });
        render();
      }, 140);
    });
    filterSearchEl?.addEventListener("blur", () => {
      syncSearchInlineState();
    });
    document.addEventListener("pointerdown", (e) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (!scopeDock) return;
      if (scopeDock.contains(target)) return;
      if ((Date.now() - lastScopeInsidePointerDownAt) < SCOPE_OUTSIDE_IGNORE_AFTER_INSIDE_MS) return;
      clearScopeLeaveCloseTimer();
      let changed = false;
      if (pickerEl && !pickerEl.classList.contains("hidden")) {
        closePicker();
        changed = true;
      }
      node.classList.remove("is-open");
      if (changed) render();
    });

    if (mobileScopeMq) {
      const onMobileScopeChange = () => {
        // Keep collapsed/expanded state stable across viewport changes.
        syncScopeDockCompactState();
        render();
      };
      if (typeof mobileScopeMq.addEventListener === "function") {
        mobileScopeMq.addEventListener("change", onMobileScopeChange);
      } else if (typeof mobileScopeMq.addListener === "function") {
        mobileScopeMq.addListener(onMobileScopeChange);
      }
    }

    scopeDock.openScopePicker = openScopePicker;
    scopeDock.render = render;
    syncScopeDockCompactState();
    render();
  }

  function renderScopeDockNow() {
    if (!shouldOwnScopeDock()) {
      if (scopeDock) {
        scopeDock.remove();
        scopeDock = null;
      }
      setScopeDockBodyClass(false);
      applyTopDockPadding(false);
      return;
    }
    ensureScopeDock();
    setScopeDockBodyClass(true);
    if (scopeDock && typeof scopeDock.render === "function") {
      scopeDock.render();
    }
  }

  function renderScopeDock(force = false) {
    if (force) {
      if (scopeDockRenderTimer) {
        clearTimeout(scopeDockRenderTimer);
        scopeDockRenderTimer = 0;
      }
      scopeDockLastRenderAt = Date.now();
      renderScopeDockNow();
      return;
    }
    if (scopeDockRenderTimer) return;
    const elapsed = Date.now() - scopeDockLastRenderAt;
    const wait = Math.max(0, SCOPE_DOCK_RENDER_MIN_GAP_MS - elapsed);
    scopeDockRenderTimer = window.setTimeout(() => {
      scopeDockRenderTimer = 0;
      scopeDockLastRenderAt = Date.now();
      renderScopeDockNow();
    }, wait);
  }

  function openAt(x, y) {
    renderAll();
    placeMenu(x, y);
    host.classList.add("open");
  }

  function closeMenu() {
    host.classList.remove("open");
  }

  stationSel.addEventListener("change", () => {
    const ctx = getCtxFromState();
    const stationId = String(stationSel.value || "");
    const jobsForStation = ctx.jobs.filter((j) => String(j.stationId || "") === stationId);
    if (jobsForStation[0]) setGlobalJob(jobsForStation[0].id);
    renderAll();
  });

  jobSel.addEventListener("change", () => {
    const jobId = String(jobSel.value || "");
    if (jobId) setGlobalJob(jobId);
    renderAll();
  });

  backdrop.addEventListener("click", closeMenu);
  centerBtn.addEventListener("click", closeMenu);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });

  document.addEventListener("contextmenu", (e) => {
    if (allowNativeContextMenu(e.target)) return;
    e.preventDefault();
    openAt(e.clientX, e.clientY);
  });

  window.addEventListener("storage", (e) => {
    if ([...APP_KEYS, PREF_KEY, SHELL_JOB_KEY].includes(String(e.key || "")) && host.classList.contains("open")) {
      renderAll();
    }
    if (String(e.key || "") === RIGHT_RAIL_COLLAPSED_KEY) {
      writeRightRailCollapsed(readRightRailCollapsed());
    }
    if ([...APP_KEYS, PREF_KEY, SHELL_JOB_KEY].includes(String(e.key || ""))) {
      renderRightRail();
    }
    if (String(e.key || "") === HUB_SCOPE_KEY) {
      renderScopeDock();
    }
    if (String(e.key || "") === HUB_SCOPE_TOOLBAR_KEY) {
      renderScopeDock();
    }
    if (String(e.key || "") === SCOPE_DOCK_STYLE_KEY) {
      renderScopeDock();
    }
    if (String(e.key || "") === SCOPE_DOCK_UI_KEY) {
      renderScopeDock();
    }
    if (String(e.key || "") === LOGGER_UI_KEY || String(e.key || "") === LOGGER_LOG_KEY) {
      renderLoggerOverlay();
    }
  });

  window.addEventListener("vmill:module-prefs-changed", () => {
    if (host.classList.contains("open")) renderAll();
  });
  window.CANBus?.onMessage?.((msg) => {
    const type = String(msg?.type || "");
    if (!type) return;
    if (type === "data:sync:status") return;
    if (type.startsWith("data:") || type === "shop:tree:changed" || type === "vmill:hub-scope:changed") {
      renderScopeDock();
    }
  });
  window.addEventListener("vmill:lang:changed", () => {
    if (host.classList.contains("open")) renderAll();
    else {
      applyI18n();
      renderScopeDock();
      renderLoggerOverlay();
    }
  });
  window.addEventListener("vmill:lang:catalog:changed", () => {
    if (host.classList.contains("open")) renderAll();
    else {
      applyI18n();
      renderScopeDock();
      renderLoggerOverlay();
    }
  });
  window.addEventListener("vmill:hub-scope:changed", () => {
    renderScopeDock();
  });
  window.addEventListener("vmill:scope-toolbar-prefs:changed", () => {
    renderScopeDock();
  });
  window.addEventListener("vmill:scope-dock-style:changed", () => {
    renderScopeDock();
  });
  window.addEventListener("vmill:scope:open", (e) => {
    if (!shouldOwnScopeDock()) return;
    ensureScopeDock();
    const typeId = String(e?.detail?.typeId || "");
    if (scopeDock && typeof scopeDock.openScopePicker === "function") {
      scopeDock.openScopePicker(typeId);
      return;
    }
    renderScopeDock(true);
  });
  window.addEventListener("vmill:logger:new", () => {
    renderLoggerOverlay();
  });
  window.addEventListener("vmill:logger:cleared", () => {
    renderLoggerOverlay();
  });
  window.addEventListener("load", () => {
    applyModuleViewportFix();
    if (host.classList.contains("open")) renderAll();
    else applyI18n();
    renderRightRail();
    renderScopeDock(true);
    renderLoggerOverlay();
  });
  applyModuleViewportFix();
  applyI18n();
  renderRightRail();
  renderScopeDock(true);
  renderLoggerOverlay();
})();
