(() => {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (document.getElementById("vmillDataExplorer")) return;

  const APP_KEY = "vmill:app-state:v1";
  const LEGACY_APP_KEYS = ["chrono_drawer_timeline_v5", "chrono_drawer_timeline_v4", "chrono_drawer_timeline_v3"];
  const APP_KEYS = [APP_KEY, ...LEGACY_APP_KEYS];

  function safeParse(raw, fallback) {
    try {
      const parsed = JSON.parse(String(raw || ""));
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }

  function isValidAppState(v) {
    return !!(v && typeof v === "object" && Array.isArray(v.stations) && Array.isArray(v.jobs));
  }

  function readState() {
    const fromApi = window.VMillData?.readAppState ? window.VMillData.readAppState({ seedIfMissing: false }) : null;
    if (isValidAppState(fromApi)) return fromApi;
    for (const key of APP_KEYS) {
      const parsed = safeParse(localStorage.getItem(key), null);
      if (isValidAppState(parsed)) return parsed;
    }
    return null;
  }

  function normalizeImportPayload(payload) {
    if (window.VMillData?.normalizeImportedAppState) return window.VMillData.normalizeImportedAppState(payload);
    const src = payload?.app && typeof payload.app === "object" ? payload.app : payload;
    if (!isValidAppState(src)) return null;
    return src;
  }

  function writeState(next) {
    if (!next || typeof next !== "object") return;
    if (window.VMillData?.writeAppState) {
      window.VMillData.writeAppState(next);
      return;
    }
    const raw = JSON.stringify(next);
    for (const key of APP_KEYS) {
      try { localStorage.setItem(key, raw); } catch {}
    }
    window.CANBus?.emit("data:app:updated", { key: APP_KEY, mirrors: LEGACY_APP_KEYS.slice() }, "data-explorer");
  }

  function downloadText(filename, text, mime = "text/plain") {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const host = document.createElement("div");
  host.id = "vmillDataExplorer";
  host.innerHTML = `
    <style>
      #vmillDataExplorer {
        position: fixed;
        right: 14px;
        bottom: 14px;
        z-index: 100001;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      }
      #vmillDataExplorer .fab {
        width: 44px;
        height: 44px;
        border-radius: 999px;
        border: 1px solid rgba(77,105,148,.85);
        background: radial-gradient(circle at 30% 20%, rgba(115,181,255,.26), rgba(14,21,34,.94));
        color: #cfe7ff;
        font-size: 17px;
        font-weight: 800;
        cursor: pointer;
        box-shadow: 0 14px 28px rgba(0,0,0,.35);
      }
      #vmillDataExplorer .panel {
        position: absolute;
        right: 0;
        bottom: 54px;
        width: min(460px, calc(100vw - 20px));
        max-height: min(80vh, 720px);
        border-radius: 14px;
        border: 1px solid #2a3a57;
        background: linear-gradient(180deg, rgba(13,21,34,.98), rgba(9,15,25,.98));
        color: #e6edf8;
        box-shadow: 0 20px 38px rgba(0,0,0,.44);
        overflow: hidden;
        display: none;
      }
      #vmillDataExplorer.open .panel { display: flex; flex-direction: column; }
      #vmillDataExplorer .hdr {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 10px 12px;
        border-bottom: 1px solid rgba(255,255,255,.08);
        background: rgba(255,255,255,.04);
        cursor: move;
        user-select: none;
      }
      #vmillDataExplorer .ttl { font-size: 13px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
      #vmillDataExplorer .row { display: flex; gap: 6px; flex-wrap: wrap; padding: 8px 10px; }
      #vmillDataExplorer .row button {
        border: 1px solid #314a71;
        border-radius: 9px;
        padding: 6px 9px;
        background: rgba(88,168,255,.14);
        color: #cbe6ff;
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
      }
      #vmillDataExplorer .row button.alt {
        border-color: #3e6652;
        background: rgba(104,211,154,.14);
        color: #c8f7dc;
      }
      #vmillDataExplorer .row button.warn {
        border-color: #785430;
        background: rgba(255,193,102,.16);
        color: #ffe0aa;
      }
      #vmillDataExplorer .status {
        padding: 0 10px 8px;
        color: #9ab0cb;
        font-size: 11px;
      }
      #vmillDataExplorer .body {
        padding: 0 10px 10px;
        overflow: auto;
      }
      #vmillDataExplorer .block {
        border: 1px solid rgba(255,255,255,.1);
        border-radius: 10px;
        background: rgba(255,255,255,.03);
        padding: 8px;
        margin-bottom: 8px;
      }
      #vmillDataExplorer .stTitle { font-size: 12px; font-weight: 800; }
      #vmillDataExplorer .meta { font-size: 11px; color: #9ab0cb; margin-top: 3px; }
      #vmillDataExplorer .job { margin-top: 7px; padding-top: 7px; border-top: 1px dashed rgba(255,255,255,.12); }
      #vmillDataExplorer .job:first-of-type { border-top: 0; padding-top: 0; margin-top: 6px; }
      #vmillDataExplorer .jobName { font-size: 12px; }
      #vmillDataExplorer .empty {
        border: 1px dashed rgba(255,255,255,.18);
        border-radius: 10px;
        padding: 10px;
        color: #9ab0cb;
        font-size: 12px;
        text-align: center;
      }
    </style>
    <button class="fab" type="button" title="Global Data Explorer">DB</button>
    <div class="panel">
      <div class="hdr">
        <div class="ttl">Global Data Explorer</div>
        <button type="button" class="closeBtn" style="width:auto;padding:4px 8px;border-radius:8px;border:1px solid #344d73;background:rgba(88,168,255,.14);color:#d5e9ff;cursor:pointer;">✕</button>
      </div>
      <div class="row">
        <button type="button" data-act="refresh">Refresh</button>
        <button type="button" data-act="seed" class="alt">Seed Demo</button>
        <button type="button" data-act="demo-small">Demo S</button>
        <button type="button" data-act="demo-medium">Demo M</button>
        <button type="button" data-act="demo-large">Demo L</button>
      </div>
      <div class="row" style="padding-top:0;">
        <button type="button" data-act="export">Export JSON</button>
        <button type="button" data-act="import">Import JSON</button>
        <input type="file" id="vmillDataExplorerImport" accept=".json,application/json" style="display:none;" />
        <button type="button" data-act="remove-demo" class="warn">Remove Demo</button>
      </div>
      <div class="status" id="vmillDataExplorerStatus"></div>
      <div class="body" id="vmillDataExplorerBody"></div>
    </div>
  `;
  document.body.appendChild(host);

  const fab = host.querySelector(".fab");
  const panel = host.querySelector(".panel");
  const closeBtn = host.querySelector(".closeBtn");
  const body = host.querySelector("#vmillDataExplorerBody");
  const status = host.querySelector("#vmillDataExplorerStatus");
  const importInput = host.querySelector("#vmillDataExplorerImport");
  const header = host.querySelector(".hdr");
  let drag = null;

  function setStatus(msg) {
    status.textContent = String(msg || "");
  }

  function stationsAndJobsHtml(st) {
    const stations = Array.isArray(st?.stations) ? st.stations : [];
    const jobs = Array.isArray(st?.jobs) ? st.jobs : [];
    if (!stations.length && !jobs.length) return `<div class="empty">No global data available.</div>`;
    const byStation = new Map();
    for (const s of stations) byStation.set(String(s.id || ""), []);
    const unassigned = [];
    for (const j of jobs) {
      const sid = String(j.stationId || "");
      if (byStation.has(sid)) byStation.get(sid).push(j);
      else unassigned.push(j);
    }
    const parts = [];
    for (const s of stations) {
      const sid = String(s.id || "");
      const sj = byStation.get(sid) || [];
      const jobsHtml = sj.length
        ? sj.map((j) => {
            const cycles = Array.isArray(j?.cycles) ? j.cycles.length : 0;
            const els = Array.isArray(j?.elements) ? j.elements.length : 0;
            const active = String(st?.activeJobId || "") === String(j?.id || "") ? " (active)" : "";
            return `<div class="job"><div class="jobName">${j?.name || "Job"}${active}</div><div class="meta">elements: ${els} | cycles: ${cycles}</div></div>`;
          }).join("")
        : `<div class="meta">No jobs</div>`;
      parts.push(`<div class="block"><div class="stTitle">${s?.code || "--"} - ${s?.name || "Station"}</div><div class="meta">stationId: ${s?.id || ""}</div>${jobsHtml}</div>`);
    }
    if (unassigned.length) {
      const uj = unassigned.map((j) => {
        const cycles = Array.isArray(j?.cycles) ? j.cycles.length : 0;
        const els = Array.isArray(j?.elements) ? j.elements.length : 0;
        return `<div class="job"><div class="jobName">${j?.name || "Job"}</div><div class="meta">stationId: ${j?.stationId || "-"} | elements: ${els} | cycles: ${cycles}</div></div>`;
      }).join("");
      parts.push(`<div class="block"><div class="stTitle">Unassigned Jobs</div>${uj}</div>`);
    }
    return parts.join("");
  }

  function render() {
    const st = readState();
    if (!st) {
      setStatus("No shared app state found.");
      body.innerHTML = `<div class="empty">Open Hub or Chrono and create/import data.</div>`;
      return;
    }
    const stations = Array.isArray(st.stations) ? st.stations.length : 0;
    const jobs = Array.isArray(st.jobs) ? st.jobs.length : 0;
    let cycles = 0;
    for (const j of (st.jobs || [])) cycles += Array.isArray(j?.cycles) ? j.cycles.length : 0;
    const srcUpdated = String(st?.meta?.updatedAt || st?.meta?.createdAt || "n/a");
    setStatus(`Stations: ${stations} | Jobs: ${jobs} | Cycles: ${cycles} | Updated: ${srcUpdated}`);
    body.innerHTML = stationsAndJobsHtml(st);
  }

  async function loadDemo(preset) {
    if (!window.VMillData?.loadDemoAppState) {
      setStatus("Demo loader unavailable (module-data missing).");
      return;
    }
    setStatus(`Loading demo "${preset}"...`);
    try {
      const out = await window.VMillData.loadDemoAppState(preset);
      setStatus(`Demo loaded from ${out?.source || preset}`);
      render();
    } catch (err) {
      setStatus(err?.message || "Demo load failed.");
    }
  }

  function exportSnapshot() {
    const payload = window.VMillData?.exportAllSnapshot
      ? window.VMillData.exportAllSnapshot()
      : { exportedAt: new Date().toISOString(), app: readState() };
    downloadText(
      `VMill_global_${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(payload, null, 2),
      "application/json"
    );
    setStatus("Exported snapshot JSON.");
  }

  function importSnapshotFile(file) {
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const parsed = safeParse(fr.result, null);
        const normalized = normalizeImportPayload(parsed);
        if (!normalized) throw new Error("Invalid JSON app/snapshot format.");
        writeState(normalized);
        setStatus("Imported global app state.");
        render();
      } catch (err) {
        setStatus(`Import failed: ${err?.message || "invalid file"}`);
      }
    };
    fr.readAsText(file);
  }

  fab.addEventListener("click", () => {
    host.classList.toggle("open");
    if (host.classList.contains("open")) render();
  });
  closeBtn.addEventListener("click", () => host.classList.remove("open"));
  host.querySelectorAll("[data-act]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const act = String(btn.getAttribute("data-act") || "");
      if (act === "refresh") { render(); return; }
      if (act === "seed") {
        if (!window.VMillData?.createDefaultAppState) {
          setStatus("Default seed unavailable.");
          return;
        }
        const seeded = window.VMillData.createDefaultAppState();
        writeState(seeded);
        setStatus("Seeded demo global state.");
        render();
        return;
      }
      if (act === "demo-small") { await loadDemo("small"); return; }
      if (act === "demo-medium") { await loadDemo("medium"); return; }
      if (act === "demo-large") { await loadDemo("large"); return; }
      if (act === "export") { exportSnapshot(); return; }
      if (act === "import") { importInput.click(); return; }
      if (act === "remove-demo") {
        if (!confirm("Remove demo data and keep global state empty?")) return;
        if (window.VMillData?.clearAppStateToEmpty) {
          window.VMillData.clearAppStateToEmpty();
          setStatus("Demo data removed (empty global state).");
          render();
        } else {
          setStatus("Remove demo unavailable.");
        }
      }
    });
  });
  importInput.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) importSnapshotFile(f);
    e.target.value = "";
  });

  header.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (e.target?.closest?.("button")) return;
    const r = panel.getBoundingClientRect();
    drag = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.left = `${r.left}px`;
    panel.style.top = `${r.top}px`;
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    panel.style.left = `${Math.max(8, drag.left + dx)}px`;
    panel.style.top = `${Math.max(8, drag.top + dy)}px`;
  });
  window.addEventListener("mouseup", () => { drag = null; });

  window.CANBus?.onMessage((msg) => {
    if (!msg?.type) return;
    if (msg.type.startsWith("data:") || msg.type === "chrono:state:saved") render();
  });
  window.addEventListener("storage", (e) => {
    if (APP_KEYS.includes(String(e.key || ""))) render();
  });

  render();
})();
