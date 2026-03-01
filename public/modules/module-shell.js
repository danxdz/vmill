(() => {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (document.getElementById("vmillRadialShell")) return;

  const APP_KEY = "chrono_drawer_timeline_v5";
  const PREF_KEY = "vmill:module-manager:v1";
  const SHELL_JOB_KEY = "vmill:shell:job-id";

  function safeParse(raw, fallback) {
    try {
      const parsed = JSON.parse(String(raw || ""));
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }

  function readAppState() {
    return safeParse(localStorage.getItem(APP_KEY), null);
  }

  function writeAppState(next) {
    if (!next || typeof next !== "object") return;
    localStorage.setItem(APP_KEY, JSON.stringify(next));
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
        };
      }
      if (inPublicRoot) {
        return {
          hub: "./vmill_hub.html",
          cnc: "../index.html",
          chrono: "./chrono/chrono.html",
          camera: "./chrono/chrono_camera.html",
          spacial: "./SPaCial.html",
        };
      }
      return {
        hub: "./public/vmill_hub.html",
        cnc: "./index.html",
        chrono: "./public/chrono/chrono.html",
        camera: "./public/chrono/chrono_camera.html",
        spacial: "./public/SPaCial.html",
      };
    }
    if (kind === "chrono") {
      return {
        hub: "../vmill_hub.html",
        cnc: "/",
        chrono: "./chrono.html",
        camera: "./chrono_camera.html",
        spacial: "../SPaCial.html",
      };
    }
    return {
      hub: "/vmill_hub.html",
      cnc: "/",
      chrono: "/chrono/chrono.html",
      camera: "/chrono/chrono_camera.html",
      spacial: "/SPaCial.html",
    };
  }

  const ROUTES = routes();
  const MODULES = [
    { id: "hub", label: "Hub", route: ROUTES.hub, fixed: true },
    { id: "cnc-sim", label: "CNC", route: ROUTES.cnc },
    { id: "chrono", label: "Chrono", route: ROUTES.chrono },
    { id: "chrono-camera", label: "Camera", route: ROUTES.camera },
    { id: "spacial", label: "SPaCial", route: ROUTES.spacial },
  ];

  function currentModuleId() {
    const p = String(location.pathname || "");
    if (p.includes("/vmill_hub.html")) return "hub";
    if (p.includes("/chrono/chrono_camera.html")) return "chrono-camera";
    if (p.includes("/chrono/chrono.html")) return "chrono";
    if (p.includes("/SPaCial.html")) return "spacial";
    if (p === "/" || p.endsWith("/index.html") || p.includes("/cnc_sim.html")) return "cnc-sim";
    return "hub";
  }

  function makeUrlWithCtx(baseHref, ctx) {
    if (!baseHref) return "#";
    if (!ctx?.jobId && !ctx?.stationId) return baseHref;
    try {
      const u = new URL(baseHref, location.href);
      if (ctx.stationId) u.searchParams.set("station", String(ctx.stationId));
      if (ctx.jobId) u.searchParams.set("job", String(ctx.jobId));
      return u.href;
    } catch {
      return baseHref;
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
      }
      #vmillRadialShell.open .menu { transform: translate(-50%, -50%) scale(1); opacity: 1; }
      #vmillRadialShell .ring {
        width: 260px;
        height: 260px;
        border-radius: 999px;
        border: 1px solid rgba(120,145,175,.45);
        background: radial-gradient(circle at center, rgba(255,255,255,.08) 0, rgba(10,16,28,.86) 62%);
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
        border: 1px solid rgba(120,145,175,.55);
        background: rgba(87,180,255,.16);
        color: #d9eeff;
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
        border: 1px solid rgba(120,145,175,.55);
        background: rgba(87,180,255,.18);
        color: #dceefe;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: 700;
      }
      #vmillRadialShell .item.active {
        border-color: rgba(104,211,154,.85);
        background: rgba(104,211,154,.22);
        color: #c9f7df;
      }
      #vmillRadialShell .ctx {
        margin-top: 8px;
        border: 1px solid rgba(120,145,175,.45);
        border-radius: 12px;
        background: rgba(10,16,28,.86);
        backdrop-filter: blur(8px);
        padding: 8px;
        display: grid;
        gap: 6px;
      }
      #vmillRadialShell .ctx select {
        width: 100%;
        border: 1px solid rgba(120,145,175,.45);
        border-radius: 999px;
        background: rgba(255,255,255,.06);
        color: #dceefe;
        padding: 6px 8px;
        font-size: 11px;
      }
      #vmillRadialShell .closeHint {
        color: #9db4ce;
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
        <button class="center" id="vmillRadialCenter" type="button">VMILL</button>
      </div>
      <div class="ctx">
        <select id="vmillRadialStation" title="Global station"></select>
        <select id="vmillRadialJob" title="Global job"></select>
        <div class="closeHint">Right click opens. Esc or click outside closes.</div>
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
      const disabled = !m.fixed && prefs.disabled.includes(String(m.id || ""));
      return !(disabled && m.id !== currentId);
    });

    const activeJobId = String(jobSel.value || ctx.jobId || "");
    const activeJob = ctx.jobs.find((j) => String(j.id || "") === activeJobId) || null;
    const activeStationId = String(activeJob?.stationId || stationSel.value || "");

    const radius = window.innerWidth <= 700 ? 86 : 96;
    const cx = window.innerWidth <= 700 ? 114 : 130;
    const cy = cx;
    const n = visibleModules.length;
    if (!n) return;

    for (let i = 0; i < n; i++) {
      const m = visibleModules[i];
      const a = document.createElement("a");
      a.className = "item";
      a.textContent = m.label;
      a.href = makeUrlWithCtx(m.route, { jobId: activeJobId, stationId: activeStationId });
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
      opt.textContent = `${st.code || "--"} ${st.name || "Station"}`;
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
      opt.textContent = j.name || "Unnamed job";
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
    renderContextSelectors();
    renderMenuItems();
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
    if ([APP_KEY, PREF_KEY, SHELL_JOB_KEY].includes(String(e.key || "")) && host.classList.contains("open")) {
      renderAll();
    }
  });

  window.addEventListener("vmill:module-prefs-changed", () => {
    if (host.classList.contains("open")) renderAll();
  });
})();
