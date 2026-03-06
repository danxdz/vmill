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
          top:var(--vm-shell-scope-top, 12px);
          transform:translateX(-50%);
          z-index:99997;
          font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
          --scope-bg: color-mix(in srgb, var(--vm-theme-panel, #111a2a) 90%, transparent);
          --scope-border: var(--vm-theme-border, rgba(230,237,248,.24));
          --scope-text: var(--vm-theme-text, #e6edf8);
          --scope-muted: var(--vm-theme-muted, rgba(230,237,248,.66));
          --scope-accent: var(--vm-theme-accent, #57b4ff);
          --scope-accent-rgb: var(--vm-theme-accent-rgb, 87,180,255);
        }
        #vmillScopeDock .scopePanel{
          width:var(--vm-shell-scope-width, min(320px, calc(100vw - 118px)));
          border:1px solid var(--scope-border);
          border-radius:9px;
          background:
            radial-gradient(240px 120px at 0% -40%, rgba(var(--scope-accent-rgb), .16), transparent 60%),
            var(--scope-bg);
          box-shadow:0 10px 24px rgba(0,0,0,.34);
          backdrop-filter: blur(8px);
          padding:2px 4px;
          display:flex;
          align-items:center;
          gap:3px;
          flex-wrap:nowrap;
          overflow:hidden;
        }
        #vmillScopeDock .scopeSearchInline{
          flex:1 1 140px;
          min-width:120px;
          border-radius:10px;
          border:1px solid var(--scope-border);
          background: color-mix(in srgb, var(--vm-theme-panel-2, #0f1726) 90%, transparent);
          color:var(--scope-text);
          padding:7px 9px;
          font-size:12px;
          line-height:1.2;
        }
        #vmillScopeDock .scopeSearchInline::placeholder{
          color:var(--scope-muted);
        }
        #vmillScopeDock .scopeHead{
          display:flex;
          gap:6px;
          flex-wrap:wrap;
          align-items:center;
        }
        #vmillScopeDock .scopeBtn{
          border:1px solid var(--scope-border);
          background:rgba(255,255,255,.03);
          color:var(--scope-text);
          border-radius:999px;
          padding:2px 6px;
          font-size:9px;
          font-weight:700;
          cursor:pointer;
          text-decoration:none;
        }
        #vmillScopeDock .scopeBtn:hover{
          border-color:color-mix(in srgb, var(--scope-accent) 54%, var(--scope-border));
          background:color-mix(in srgb, var(--scope-accent) 14%, transparent);
        }
        #vmillScopeDock .scopeKpis{
          display:flex;
          flex-wrap:nowrap;
          gap:3px;
          margin-left:2px;
          max-width:100%;
          overflow-x:auto;
          overflow-y:hidden;
          scrollbar-width:thin;
          padding-bottom:1px;
        }
        #vmillScopeDock .scopeChip{
          border:1px solid var(--scope-border);
          border-radius:999px;
          padding:1px 5px;
          font-size:7px;
          color:var(--scope-muted);
          background:rgba(255,255,255,.03);
          max-width:100%;
          overflow:hidden;
          text-overflow:ellipsis;
          white-space:nowrap;
        }
        #vmillScopeDock .scopeKpi{
          border:1px solid var(--scope-border);
          background:rgba(255,255,255,.03);
          color:var(--scope-text);
          border-radius:999px;
          padding:2px 6px;
          display:inline-flex;
          align-items:center;
          gap:4px;
          cursor:pointer;
          font-size:9px;
          max-width:88px;
          min-width:0;
          flex:0 0 auto;
        }
        #vmillScopeDock .scopeKpi:hover{
          border-color:color-mix(in srgb, var(--scope-accent) 54%, var(--scope-border));
          background:color-mix(in srgb, var(--scope-accent) 14%, transparent);
        }
        #vmillScopeDock .scopeKpi.active{
          border-color:color-mix(in srgb, var(--scope-accent) 72%, var(--scope-border));
          background:color-mix(in srgb, var(--scope-accent) 20%, transparent);
        }
        #vmillScopeDock .scopeKpiCount{
          border:1px solid color-mix(in srgb, var(--scope-accent) 45%, var(--scope-border));
          background:color-mix(in srgb, var(--scope-accent) 20%, transparent);
          color:var(--scope-text);
          border-radius:999px;
          padding:0 4px;
          font-size:8px;
          font-weight:700;
          flex:0 0 auto;
        }
        #vmillScopeDock .scopeKpiLabel{
          overflow:hidden;
          text-overflow:ellipsis;
          white-space:nowrap;
          font-weight:700;
          flex:1 1 auto;
          min-width:0;
        }
        #vmillScopeDock .scopeSummary{
          display:none;
        }
        #vmillScopeDock .scopePicker{
          margin-top:6px;
          width:var(--vm-shell-scope-width, min(320px, calc(100vw - 118px)));
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
              font-size:11px;
        }
        #vmillScopeDock .scopeSearch{
          flex:1 1 180px;
          min-width:160px;
          border:1px solid var(--scope-border);
          border-radius:9px;
          background:rgba(255,255,255,.04);
          color:var(--scope-text);
          padding:5px 8px;
          font-size:11px;
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
          font-size:11px;
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
          font-size:9px;
          flex:0 0 auto;
        }
        @media (max-width:1200px){
          #vmillScopeDock .scopePanel{
            width:var(--vm-shell-scope-width, min(304px, calc(100vw - 104px)));
          }
          #vmillScopeDock .scopePicker{
            width:var(--vm-shell-scope-width, min(304px, calc(100vw - 104px)));
          }
          #vmillScopeDock .scopeKpi{
            max-width:84px;
          }
        }
        @media (max-width:960px){
          #vmillScopeDock .scopePanel{
            width:var(--vm-shell-scope-width, min(288px, calc(100vw - 86px)));
          }
          #vmillScopeDock .scopePicker{
            width:var(--vm-shell-scope-width, min(288px, calc(100vw - 86px)));
          }
          #vmillScopeDock .scopeSummary{
            display:none;
            margin-left:0;
          }
          #vmillScopeDock .scopeKpi{
            max-width:78px;
          }
        }
        @media (max-width:760px){
          #vmillScopeDock{
            top:var(--vm-shell-scope-top-mobile, var(--vm-shell-scope-top, 10px));
          }
        #vmillScopeDock .scopePanel{
          width:var(--vm-shell-scope-width-mobile, calc(100vw - 10px));
          gap:4px;
          padding:4px 5px;
        }
          #vmillScopeDock .scopeSearchInline{
            min-width:96px;
            padding:6px 8px;
            font-size:11px;
          }
          #vmillScopeDock .scopeKpi{ max-width:none; }
          #vmillScopeDock .scopePicker{ width:var(--vm-shell-scope-width-mobile, calc(100vw - 10px)); }
          #vmillScopeDock .scopeSummary{ display:none; }
        }
      </style>
      <div class="scopePanel" id="vmillScopePanel">
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
    applyTopDockPadding(true);

    const resetBtn = node.querySelector("#vmillScopeReset");
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
    let currentModel = { types: [], items: [], links: [], rules: [] };

    function typeLabel(t) {
      const plural = String(t?.namePlural || "");
      const singular = String(t?.nameSingular || "");
      return plural || singular || String(t?.id || "Type");
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
    function loadModel() {
      typeById.clear();
      itemsByType.clear();
      const model = window.VMillData?.readStructureModel
        ? window.VMillData.readStructureModel({ persist: false })
        : { types: [], items: [], links: [], rules: [] };
      const types = Array.isArray(model?.types) ? model.types.slice() : [];
      const items = Array.isArray(model?.items) ? model.items.slice() : [];
      const links = Array.isArray(model?.links) ? model.links.slice() : [];
      const rules = Array.isArray(model?.rules) ? model.rules.slice() : [];
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
      return out;
    }
    function computeScopeTypeSet(ctx, targetTypeId, excludeTypeId = "") {
      const targetTid = String(targetTypeId || "");
      if (!targetTid) return null;
      const entries = selectedScopeEntries(ctx?.scopeSelected || {}, excludeTypeId);
      if (!entries.length) return null;
      let active = null;
      for (const [typeId, itemId] of entries) {
        const nextSet = reachableItemIdsFromNode(ctx, typeId, itemId, targetTid);
        active = active == null
          ? nextSet
          : new Set([...active].filter((id) => nextSet.has(id)));
      }
      return active || null;
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
    function closePicker() {
      openTypeId = "";
      pickerQuery = "";
      pickerEl?.classList.add("hidden");
      if (pickerSearchEl) pickerSearchEl.value = "";
    }
    function renderKpis(scope) {
      if (!kpisEl) return;
      const ctx = buildScopeContext(scope);
      const types = visibleTypeIds
        .map((id) => typeById.get(id))
        .filter(Boolean);
      if (!types.length) {
        kpisEl.innerHTML = `<span class="scopeChip">${tt("hub.overview.none", "No categories")}</span>`;
        return;
      }
      kpisEl.innerHTML = types.map((t) => {
        const tid = String(t?.id || "");
        const rows = rowsForTypeWithScope(scope, tid, ctx, tid);
        const selectedId = String(scope.selected?.[tid] || "all");
        const selectedItem = (itemsByType.get(tid) || []).find((it) => String(it?.id || "") === selectedId) || null;
        const label = selectedItem ? itemLabel(selectedItem) : tt("hub.common.all", "All");
        const active = String(openTypeId || "") === tid ? "active" : "";
        return `<button class="scopeKpi ${active}" type="button" data-scope-type="${tid}">
          <span class="scopeKpiCount">${rows.length}</span>
          <span class="scopeKpiLabel">${typeLabel(t)}: ${label}</span>
        </button>`;
      }).join("");
      kpisEl.querySelectorAll("[data-scope-type]").forEach((btn) => {
        const supportsHover = !!(window.matchMedia && window.matchMedia("(hover:hover) and (pointer:fine)").matches);
        btn.addEventListener("click", () => {
          const tid = String(btn.getAttribute("data-scope-type") || "");
          if (!tid) return;
          openTypeId = openTypeId === tid ? "" : tid;
          pickerQuery = "";
          render();
          if (!openTypeId) closePicker();
        });
        if (supportsHover) {
          btn.addEventListener("mouseenter", () => {
            const tid = String(btn.getAttribute("data-scope-type") || "");
            if (!tid || openTypeId === tid) return;
            openTypeId = tid;
            pickerQuery = "";
            render();
          });
        }
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
      const scopeRaw = readHubScope();
      loadModel();
      const scopeCtx = buildScopeContext(scopeRaw);
      const scope = sanitizeScopeSelection(scopeRaw, scopeCtx);
      if (JSON.stringify(scope.selected || {}) !== JSON.stringify(scopeRaw.selected || {})) {
        updateScope(scope);
      }
      renderKpis(scope);
      if (resetBtn) resetBtn.textContent = tt("hub.overview.resetFilters", "Reset");
      if (filterSearchEl) {
        if (document.activeElement !== filterSearchEl) {
          const nextVal = String(scope.query || "");
          if (filterSearchEl.value !== nextVal) filterSearchEl.value = nextVal;
        }
        filterSearchEl.placeholder = tt("hub.jobs.searchPlaceholder", "Search station/job...");
      }
      if (pickerSearchEl) pickerSearchEl.placeholder = tt("hub.jobs.searchPlaceholder", "Search station/job...");
      if (pickerCloseEl) pickerCloseEl.textContent = tt("common.close", "Close");
      renderPicker(scope);
    }
    function clearSelection() {
      const scope = readHubScope();
      const nextSelected = { ...(scope.selected || {}) };
      for (const tid of visibleTypeIds) nextSelected[tid] = "all";
      updateScope({ ...scope, selected: nextSelected, openTypeId: "", query: "" });
    }
    function openScopePicker(typeId = "") {
      loadModel();
      const wanted = String(typeId || "").trim();
      openTypeId = wanted && visibleTypeIds.includes(wanted)
        ? wanted
        : String(visibleTypeIds[0] || "");
      pickerQuery = "";
      if (pickerSearchEl) pickerSearchEl.value = "";
      render();
    }
    resetBtn?.addEventListener("click", () => {
      clearSelection();
      closePicker();
      render();
    });
    pickerCloseEl?.addEventListener("click", () => {
      closePicker();
      render();
    });
    pickerSearchEl?.addEventListener("input", () => {
      pickerQuery = String(pickerSearchEl.value || "");
      renderPicker(readHubScope());
    });
    filterSearchEl?.addEventListener("input", () => {
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
    document.addEventListener("pointerdown", (e) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (!scopeDock || !pickerEl || pickerEl.classList.contains("hidden")) return;
      if (scopeDock.contains(target)) return;
      closePicker();
      render();
    });

    scopeDock.openScopePicker = openScopePicker;
    scopeDock.render = render;
    render();
  }

  function renderScopeDock() {
    if (!shouldOwnScopeDock()) {
      if (scopeDock) {
        scopeDock.remove();
        scopeDock = null;
      }
      applyTopDockPadding(false);
      return;
    }
    ensureScopeDock();
    if (scopeDock && typeof scopeDock.render === "function") {
      scopeDock.render();
    }
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
    }
  });
  window.addEventListener("vmill:lang:catalog:changed", () => {
    if (host.classList.contains("open")) renderAll();
    else {
      applyI18n();
      renderScopeDock();
    }
  });
  window.addEventListener("vmill:hub-scope:changed", () => {
    renderScopeDock();
  });
  window.addEventListener("vmill:scope-toolbar-prefs:changed", () => {
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
    renderScopeDock();
  });
  window.addEventListener("load", () => {
    applyModuleViewportFix();
    if (host.classList.contains("open")) renderAll();
    else applyI18n();
    renderRightRail();
    renderScopeDock();
  });
  applyModuleViewportFix();
  applyI18n();
  renderRightRail();
  renderScopeDock();
})();
