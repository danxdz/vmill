(() => {
  const APP_KEY = "chrono_drawer_timeline_v5";
  const MODULE_KEY = "vmill:module-data:v1";

  function safeParse(raw, fallback) {
    try {
      const v = JSON.parse(raw);
      return v ?? fallback;
    } catch {
      return fallback;
    }
  }

  function readAppState() {
    const raw = localStorage.getItem(APP_KEY);
    if (!raw) return null;
    return safeParse(raw, null);
  }

  function writeAppState(next) {
    localStorage.setItem(APP_KEY, JSON.stringify(next));
    window.CANBus?.emit("data:app:updated", { key: APP_KEY }, "module-data");
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
    const raw = localStorage.getItem(MODULE_KEY);
    return ensureModuleState(safeParse(raw, {}));
  }

  function writeModuleState(next) {
    const st = ensureModuleState(next);
    localStorage.setItem(MODULE_KEY, JSON.stringify(st));
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
      "stationCode,stationName,jobName,cycleId,cycleAtIso,tag,totalMs,lapIndex,elementName,elementType,lapMs",
    ];
    const stations = new Map((app?.stations || []).map((s) => [s.id, s]));
    for (const job of (app?.jobs || [])) {
      const st = stations.get(job.stationId) || {};
      for (const cyc of (job.cycles || [])) {
        const laps = Array.isArray(cyc.laps) ? cyc.laps : [];
        for (let i = 0; i < laps.length; i++) {
          const l = laps[i] || {};
          const cols = [
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
    const stations = Array.isArray(app?.stations) ? app.stations : [];
    const jobs = Array.isArray(app?.jobs) ? app.jobs : [];
    const lines = [];
    lines.push("VMill Offline Backup Report");
    lines.push(`ExportedAt: ${new Date().toISOString()}`);
    lines.push(`Stations: ${stations.length}`);
    lines.push(`Jobs: ${jobs.length}`);
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
    keys: { APP_KEY, MODULE_KEY },
    readAppState,
    writeAppState,
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
