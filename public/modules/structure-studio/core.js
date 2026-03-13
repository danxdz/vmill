export const APP_KEYS = Array.isArray(window.VMillData?.keys?.ALL_APP_KEYS)
  ? window.VMillData.keys.ALL_APP_KEYS.slice()
  : ["vmill:app-state:v1"];
export const MODULE_KEY = String(window.VMillData?.keys?.MODULE_KEY || "vmill:module-data:v1");
export const WATCH_KEYS = new Set([...APP_KEYS, MODULE_KEY]);

export const state = {
  ui: { typeId: "" },
  lastSig: "",
  formDirty: false,
  suppressDirtyMark: false,
  externalPending: false,
};

export const $ = (id) => document.getElementById(id);

export function tt(key, fallback = "", vars) {
  return window.VMillLang?.t ? window.VMillLang.t(key, fallback, vars) : fallback;
}

export function esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function applyGlobalTheme(event) {
  if (!window.VMillTheme?.applyTheme) return;
  window.VMillTheme.applyTheme(document, "structure", event?.detail?.theme || null);
}

export function setStatus(msg, bad = false) {
  const el = $("status");
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = bad ? "var(--bad)" : "var(--muted)";
}

export function markDirty() {
  if (state.suppressDirtyMark) return;
  state.formDirty = true;
  setStatus(tt("structure.status.unsaved", "Unsaved changes. Save or Refresh."));
}

export function confirmDiscardDirty() {
  if (!state.formDirty) return true;
  return confirm(tt("structure.confirm.discard", "Discard unsaved changes?"));
}

export function normalizeCode(raw) {
  const s = String(raw || "").trim().toUpperCase();
  const m = s.match(/^CAT(\d+)$/);
  if (!m) return "";
  return `CAT${String(Number(m[1] || "0")).padStart(3, "0")}`;
}

export function nextTypeCode(types) {
  let max = 0;
  for (const t of (types || [])) {
    const m = normalizeCode(t?.code).match(/^CAT(\d+)$/);
    if (!m) continue;
    max = Math.max(max, Number(m[1] || "0"));
  }
  return `CAT${String(max + 1).padStart(3, "0")}`;
}

export function idFromCode(code, existingIds) {
  const m = normalizeCode(code).match(/^CAT(\d+)$/);
  const base = m ? `cat${String(Number(m[1] || "0")).padStart(3, "0")}` : "cat";
  let out = base;
  let i = 2;
  while (existingIds.has(out)) {
    out = `${base}-${i}`;
    i += 1;
  }
  return out;
}

export function readModel() {
  return window.VMillData?.readStructureModel
    ? window.VMillData.readStructureModel({ persist: false })
    : { types: [], rules: [] };
}

export function typeRows(model) {
  const rows = Array.isArray(model?.types) ? model.types.slice() : [];
  rows.sort((a, b) => {
    return String(a?.code || "").localeCompare(String(b?.code || ""))
      || String(a?.namePlural || a?.id || "").localeCompare(String(b?.namePlural || b?.id || ""));
  });
  return rows;
}

export function ruleRows(model) {
  const rows = (
    window.VMillData?.listStructureRules
      ? window.VMillData.listStructureRules()
      : (Array.isArray(model?.rules) ? model.rules : [])
  ).slice();
  rows.sort((a, b) => {
    const ak = `${String(a?.childTypeId || "")}|${String(a?.parentTypeId || "")}|${String(a?.relation || "")}`;
    const bk = `${String(b?.childTypeId || "")}|${String(b?.parentTypeId || "")}|${String(b?.relation || "")}`;
    return ak.localeCompare(bk);
  });
  return rows;
}

export function typeLabel(t) {
  const code = String(t?.code || "").trim();
  const name = String(t?.namePlural || t?.id || "");
  return code ? `${code} - ${name}` : name;
}

export function setOptions(sel, rows, labelFn, selected = "", includeEmpty = false, emptyLabel = "-") {
  if (!sel) return "";
  sel.innerHTML = "";
  if (includeEmpty) {
    const o = document.createElement("option");
    o.value = "";
    o.textContent = emptyLabel;
    sel.appendChild(o);
  }
  for (const r of rows || []) {
    const o = document.createElement("option");
    o.value = String(r?.id || "");
    o.textContent = labelFn(r);
    sel.appendChild(o);
  }
  const want = String(selected || "");
  if (want && [...sel.options].some((o) => o.value === want)) sel.value = want;
  else if (includeEmpty) sel.value = "";
  else if (sel.options.length) sel.value = sel.options[0].value;
  else sel.value = "";
  return String(sel.value || "");
}

export function incomingRuleFor(childTypeId, rules) {
  const id = String(childTypeId || "");
  if (!id) return null;
  return (rules || []).find((r) => String(r?.childTypeId || "") === id) || null;
}

export function childRulesFor(parentTypeId, rules) {
  const id = String(parentTypeId || "");
  if (!id) return [];
  return (rules || []).filter((r) => String(r?.parentTypeId || "") === id);
}

export function syncParentRuleForType(typeId, parentTypeId, relation) {
  const childId = String(typeId || "");
  const parentId = String(parentTypeId || "");
  const rel = String(relation || tt("structure.relation.default", "contains")).trim()
    || tt("structure.relation.default", "contains");
  const rows = window.VMillData?.listStructureRules
    ? window.VMillData.listStructureRules({ childTypeId: childId })
    : [];

  if (!parentId || parentId === childId) {
    for (const row of rows) window.VMillData?.deleteStructureRule?.(row.id);
    return;
  }

  let keep = false;
  for (const row of rows) {
    const same = String(row?.parentTypeId || "") === parentId && String(row?.relation || "") === rel;
    if (same) {
      keep = true;
      continue;
    }
    window.VMillData?.deleteStructureRule?.(row.id);
  }

  if (!keep) {
    window.VMillData?.upsertStructureRule?.({
      parentTypeId: parentId,
      childTypeId: childId,
      relation: rel,
      label: `${parentId} ${rel} ${childId}`,
    });
  }
}
