(() => {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.VMillTheme) return;

  const THEME_KEY = "vmill:global-theme:v1";
  const THEME_NS = "global_theme";
  const THEME_ID = "global";

  function toHex(v, fallback) {
    const s = String(v || "").trim();
    return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : fallback;
  }

  function clamp01(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 1;
    return Math.max(0, Math.min(1, n));
  }

  function hexToRgb(hex) {
    const h = toHex(hex, "#000000");
    return {
      r: parseInt(h.slice(1, 3), 16),
      g: parseInt(h.slice(3, 5), 16),
      b: parseInt(h.slice(5, 7), 16),
    };
  }

  function rgba(hex, alpha) {
    const c = hexToRgb(hex);
    return `rgba(${c.r}, ${c.g}, ${c.b}, ${clamp01(alpha)})`;
  }

  function mix(hexA, hexB, t) {
    const a = hexToRgb(hexA);
    const b = hexToRgb(hexB);
    const k = clamp01(t);
    const r = Math.round(a.r + (b.r - a.r) * k);
    const g = Math.round(a.g + (b.g - a.g) * k);
    const b2 = Math.round(a.b + (b.b - a.b) * k);
    return `#${[r, g, b2].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
  }

  function darken(hex, amount) {
    return mix(hex, "#000000", amount);
  }

  function lighten(hex, amount) {
    return mix(hex, "#ffffff", amount);
  }

  function luminance(hex) {
    const c = hexToRgb(hex);
    return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
  }

  function defaultTheme() {
    return {
      id: THEME_ID,
      name: "Midnight",
      bg: "#0a0f17",
      text: "#e6edf8",
      accent: "#57b4ff",
      headerBg: "#101521",
      headerText: "#e8e8e8",
      updatedAt: new Date().toISOString(),
    };
  }

  function normalizeTheme(raw) {
    const d = defaultTheme();
    const src = raw && typeof raw === "object" ? raw : {};
    return {
      id: THEME_ID,
      name: String(src.name || d.name || "Theme"),
      bg: toHex(src.bg, d.bg),
      text: toHex(src.text, d.text),
      accent: toHex(src.accent, d.accent),
      headerBg: toHex(src.headerBg, d.headerBg),
      headerText: toHex(src.headerText, d.headerText),
      updatedAt: new Date().toISOString(),
    };
  }

  function readFromModuleData() {
    try {
      if (!window.VMillData?.listRecords) return null;
      const rows = window.VMillData.listRecords(THEME_NS);
      const row = rows.find((x) => String(x?.id || "") === THEME_ID) || rows[0] || null;
      return row ? normalizeTheme(row) : null;
    } catch {
      return null;
    }
  }

  function writeToModuleData(theme) {
    try {
      if (!window.VMillData?.upsertRecord) return;
      window.VMillData.upsertRecord(THEME_NS, { ...theme, id: THEME_ID });
    } catch {}
  }

  function readTheme() {
    const fromModule = readFromModuleData();
    if (fromModule) return fromModule;
    try {
      const raw = localStorage.getItem(THEME_KEY);
      if (!raw) return defaultTheme();
      return normalizeTheme(JSON.parse(raw));
    } catch {
      return defaultTheme();
    }
  }

  function writeTheme(next, source = "module-theme") {
    const theme = normalizeTheme(next);
    try { localStorage.setItem(THEME_KEY, JSON.stringify(theme)); } catch {}
    writeToModuleData(theme);
    try {
      window.dispatchEvent(new CustomEvent("vmill:theme:changed", { detail: { theme, source } }));
    } catch {}
    window.CANBus?.emit("theme:changed", { theme }, source);
    return theme;
  }

  function detectMode() {
    const p = String(location.pathname || "").toLowerCase();
    if (p.includes("/vmill_hub.html")) return "hub";
    if (p.includes("/spacial.html")) return "spacial";
    if (p.includes("/chrono/chrono_camera.html")) return "camera";
    if (p.includes("/chrono/chrono.html")) return "chrono";
    if (p.includes("/theme_studio.html")) return "theme";
    return "generic";
  }

  function setVar(root, name, value) {
    root.style.setProperty(name, String(value));
  }

  function applyTheme(doc = document, mode = "") {
    const theme = readTheme();
    const root = doc.documentElement;
    const body = doc.body;
    const m = String(mode || detectMode());
    const light = luminance(theme.bg) > 0.5;

    if (body) body.classList.toggle("vm-theme-light", light);

    setVar(root, "--vm-theme-bg", theme.bg);
    setVar(root, "--vm-theme-text", theme.text);
    setVar(root, "--vm-theme-accent", theme.accent);
    setVar(root, "--vm-theme-header-bg", theme.headerBg);
    setVar(root, "--vm-theme-header-text", theme.headerText);

    if (m === "hub" || m === "theme") {
      setVar(root, "--bg", theme.bg);
      if (light) {
        setVar(root, "--bg2", darken(theme.bg, 0.08));
        setVar(root, "--panel", darken(theme.bg, 0.03));
        setVar(root, "--panel2", darken(theme.bg, 0.05));
        setVar(root, "--panel3", darken(theme.bg, 0.08));
      } else {
        setVar(root, "--bg2", darken(theme.bg, 0.2));
        setVar(root, "--panel", lighten(theme.bg, 0.06));
        setVar(root, "--panel2", lighten(theme.bg, 0.03));
        setVar(root, "--panel3", darken(theme.bg, 0.12));
      }
      setVar(root, "--text", theme.text);
      setVar(root, "--muted", rgba(theme.text, light ? 0.62 : 0.66));
      setVar(root, "--border", rgba(theme.text, light ? 0.22 : 0.18));
      setVar(root, "--accent", theme.accent);
    } else if (m === "chrono") {
      if (body) body.classList.toggle("themeLight", light);
      setVar(root, "--bg", theme.bg);
      setVar(root, "--text", theme.text);
      setVar(root, "--accent", theme.accent);
      setVar(root, "--accent-10", rgba(theme.accent, 0.1));
      setVar(root, "--accent-18", rgba(theme.accent, 0.18));
      setVar(root, "--accent-35", rgba(theme.accent, 0.35));
      setVar(root, "--accent-55", rgba(theme.accent, 0.55));
      setVar(root, "--accent-65", rgba(theme.accent, 0.65));
      setVar(root, "--accent-75", rgba(theme.accent, 0.75));
      setVar(root, "--accent-85", rgba(theme.accent, 0.85));
      setVar(root, "--header-bg", rgba(theme.headerBg, 0.94));
      setVar(root, "--header-text", theme.headerText);
      setVar(root, "--header-border", rgba(theme.headerText, light ? 0.2 : 0.16));
      if (light) {
        setVar(root, "--panel", darken(theme.bg, 0.04));
        setVar(root, "--panel2", darken(theme.bg, 0.08));
        setVar(root, "--border", "rgba(0,0,0,.13)");
        setVar(root, "--muted", "rgba(0,0,0,.55)");
        setVar(root, "--muted2", "rgba(0,0,0,.38)");
      } else {
        setVar(root, "--panel", lighten(theme.bg, 0.08));
        setVar(root, "--panel2", lighten(theme.bg, 0.04));
        setVar(root, "--border", lighten(theme.bg, 0.12));
        setVar(root, "--muted", rgba(theme.text, 0.75));
        setVar(root, "--muted2", rgba(theme.text, 0.55));
      }
    } else if (m === "spacial") {
      setVar(root, "--bg", theme.bg);
      if (light) {
        setVar(root, "--panel", darken(theme.bg, 0.03));
        setVar(root, "--panel2", darken(theme.bg, 0.05));
      } else {
        setVar(root, "--panel", lighten(theme.bg, 0.08));
        setVar(root, "--panel2", lighten(theme.bg, 0.04));
      }
      setVar(root, "--text", theme.text);
      setVar(root, "--muted", rgba(theme.text, light ? 0.58 : 0.62));
      setVar(root, "--border", rgba(theme.text, light ? 0.22 : 0.18));
      setVar(root, "--accent", theme.accent);
    } else if (m === "camera") {
      setVar(root, "--acc", theme.accent);
      setVar(root, "--acc-dim", rgba(theme.accent, 0.14));
      setVar(root, "--acc-b", rgba(theme.accent, 0.4));
      setVar(root, "--text", theme.text);
      setVar(root, "--muted", rgba(theme.text, 0.55));
      setVar(root, "--border", rgba(theme.text, 0.14));
    }
    return theme;
  }

  window.addEventListener("storage", (e) => {
    if (e.key !== THEME_KEY) return;
    try {
      const theme = normalizeTheme(JSON.parse(String(e.newValue || "{}")));
      window.dispatchEvent(new CustomEvent("vmill:theme:changed", { detail: { theme, source: "storage" } }));
    } catch {}
  });

  window.VMillTheme = {
    key: THEME_KEY,
    namespace: THEME_NS,
    id: THEME_ID,
    defaultTheme,
    normalizeTheme,
    readTheme,
    writeTheme,
    applyTheme,
  };
})();
