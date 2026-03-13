import {
  $,
  tt,
  state,
  markDirty,
  setStatus,
  confirmDiscardDirty,
  readModel,
  typeRows,
  ruleRows,
  nextTypeCode,
  idFromCode,
  syncParentRuleForType,
  WATCH_KEYS,
} from "./core.js";
import { render } from "./render.js";

export function addCategory() {
  const singular = String($("typeSingularIn").value || "").trim();
  const plural = String($("typePluralIn").value || "").trim();
  const desc = String($("typeDescIn").value || "").trim();
  const parentId = String($("typeParentSel").value || "");
  const rel = String($("typeRelIn").value || "").trim() || tt("structure.relation.default", "contains");
  if (!singular) return setStatus(tt("structure.error.singularRequired", "Singular name is required."), true);

  const model = readModel();
  const types = typeRows(model);
  const code = nextTypeCode(types);
  const existingIds = new Set(types.map((t) => String(t?.id || "")).filter(Boolean));
  const id = idFromCode(code, existingIds);

  const out = window.VMillData?.upsertEntityType
    ? window.VMillData.upsertEntityType({ id, code, nameSingular: singular, namePlural: plural || `${singular}s`, description: desc })
    : null;
  if (!out) return setStatus(tt("structure.error.addFailed", "Failed to add category."), true);

  state.ui.typeId = String(out.id || id);
  syncParentRuleForType(state.ui.typeId, parentId, rel);
  state.formDirty = false;
  state.externalPending = false;
  render();
  setStatus(tt("structure.status.added", "Category added ({code}).", { code: out.code || code }));
}

export function saveCategory() {
  if (!state.ui.typeId) return;
  const singular = String($("typeSingularIn").value || "").trim();
  const plural = String($("typePluralIn").value || "").trim();
  const desc = String($("typeDescIn").value || "").trim();
  const parentId = String($("typeParentSel").value || "");
  const rel = String($("typeRelIn").value || "").trim() || tt("structure.relation.default", "contains");
  if (!singular) return setStatus(tt("structure.error.singularRequired", "Singular name is required."), true);

  const out = window.VMillData?.upsertEntityType
    ? window.VMillData.upsertEntityType({ id: state.ui.typeId, nameSingular: singular, namePlural: plural || `${singular}s`, description: desc })
    : null;
  if (!out) return setStatus(tt("structure.error.saveFailed", "Failed to save category."), true);

  syncParentRuleForType(state.ui.typeId, parentId, rel);
  state.formDirty = false;
  state.externalPending = false;
  render();
  setStatus(tt("structure.status.saved", "Category saved."));
}

export function deleteCategory() {
  if (!state.ui.typeId) return;
  if (!confirm(tt("structure.confirm.delete", "Delete selected category?"))) return;
  const ok = window.VMillData?.deleteEntityType ? window.VMillData.deleteEntityType(state.ui.typeId) : false;
  if (!ok) return setStatus(tt("structure.error.deleteFailed", "Delete failed (base or linked category)."), true);
  state.ui.typeId = "";
  state.formDirty = false;
  state.externalPending = false;
  render();
  setStatus(tt("structure.status.deleted", "Category deleted."));
}

export function newCategory() {
  state.ui.typeId = "";
  $("typeSel").value = "";
  $("typeCodeIn").value = "";
  $("typeKeyIn").value = "";
  $("typeSingularIn").value = "";
  $("typePluralIn").value = "";
  $("typeDescIn").value = "";
  $("typeParentSel").value = "";
  $("typeRelIn").value = tt("structure.relation.default", "contains");
  state.formDirty = false;
  state.externalPending = false;
  render({ force: true });
}

export function wire() {
  $("refreshBtn").addEventListener("click", () => {
    if (!confirmDiscardDirty()) return;
    state.formDirty = false;
    state.externalPending = false;
    render({ force: true });
    setStatus(tt("common.status.refreshed", "Refreshed."));
  });
  $("openHubBtn").addEventListener("click", () => {
    window.location.href = "./vmill_hub.html#structure";
  });
  $("typeSel").addEventListener("change", () => {
    if (!confirmDiscardDirty()) {
      $("typeSel").value = String(state.ui.typeId || "");
      return;
    }
    state.ui.typeId = String($("typeSel").value || "");
    state.formDirty = false;
    state.externalPending = false;
    render({ force: true });
  });
  $("newBtn").addEventListener("click", () => {
    if (!confirmDiscardDirty()) return;
    newCategory();
  });
  $("addBtn").addEventListener("click", addCategory);
  $("saveBtn").addEventListener("click", saveCategory);
  $("deleteBtn").addEventListener("click", deleteCategory);
  ["typeSingularIn", "typePluralIn", "typeDescIn", "typeRelIn"].forEach((id) => {
    $(id).addEventListener("input", markDirty);
  });
  $("typeParentSel").addEventListener("change", markDirty);
}

export function watch() {
  const onExternal = () => {
    if (state.formDirty) {
      state.externalPending = true;
      setStatus(tt("structure.status.externalPending", "External data changed. Save or Refresh to reload."), false);
      return;
    }
    render();
  };
  window.CANBus?.onMessage((msg) => {
    if (!msg?.type) return;
    if (String(msg.type).startsWith("data:")) onExternal();
  });
  window.addEventListener("storage", (e) => {
    const key = String(e?.key || "");
    if (WATCH_KEYS.has(key)) onExternal();
  });
  setInterval(() => {
    const model = readModel();
    const sig = JSON.stringify({
      x: String(window.VMillData?.readModuleState?.()?.meta?.updatedAt || ""),
      t: typeRows(model).length,
      r: ruleRows(model).length,
    });
    if (sig !== state.lastSig) onExternal();
  }, 1500);
}
