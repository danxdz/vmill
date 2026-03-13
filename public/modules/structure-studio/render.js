import {
  $,
  tt,
  esc,
  state,
  readModel,
  typeRows,
  ruleRows,
  typeLabel,
  setOptions,
  incomingRuleFor,
  childRulesFor,
} from "./core.js";

export function applyTexts() {
  $("pageTitle").textContent = tt("structure.title", "Structure Studio");
  $("pageSub").textContent = tt("structure.subtitle", "One form only. Internal codes are auto CAT###; users manage names and parent/child tree.");
  $("refreshBtn").textContent = tt("common.refresh", "Refresh");
  $("openHubBtn").textContent = tt("structure.openHub", "Open Hub");
  $("formTitle").textContent = tt("structure.form.title", "Category Form");
  $("lblTypeSel").textContent = tt("structure.form.category", "Category");
  $("lblTypeCodeIn").textContent = tt("structure.form.code", "Internal Code");
  $("lblTypeKeyIn").textContent = tt("structure.form.key", "Internal Key");
  $("lblTypeSingularIn").textContent = tt("structure.form.singular", "Singular Name");
  $("lblTypePluralIn").textContent = tt("structure.form.plural", "Plural Name");
  $("lblTypeDescIn").textContent = tt("structure.form.description", "Description");
  $("lblTypeParentSel").textContent = tt("structure.form.parent", "Parent Category");
  $("lblTypeRelIn").textContent = tt("structure.form.relation", "Parent Relation");
  $("newBtn").textContent = tt("common.new", "New");
  $("addBtn").textContent = tt("common.add", "+ Add");
  $("saveBtn").textContent = tt("common.save", "Save");
  $("deleteBtn").textContent = tt("common.delete", "Delete");
  $("childrenTitle").textContent = tt("structure.children.title", "Selected Category Children");
  $("typeCodeIn").placeholder = tt("structure.placeholder.code", "CAT###");
  $("typeKeyIn").placeholder = tt("structure.placeholder.key", "cat###");
  $("typeSingularIn").placeholder = tt("structure.placeholder.singular", "Atelier");
  $("typePluralIn").placeholder = tt("structure.placeholder.plural", "Ateliers");
  $("typeDescIn").placeholder = tt("common.optional", "Optional");
  $("typeRelIn").placeholder = tt("structure.placeholder.relation", "contains");
}

export function render(options = {}) {
  const force = options?.force === true;
  if (state.formDirty && !force) return;
  const model = readModel();
  const types = typeRows(model);
  const rules = ruleRows(model);

  state.ui.typeId = setOptions($("typeSel"), types, (t) => typeLabel(t), state.ui.typeId, true, tt("structure.option.new", "(new category)"));
  const selected = types.find((t) => String(t?.id || "") === String(state.ui.typeId || "")) || null;

  const parentRows = selected ? types.filter((t) => String(t?.id || "") !== String(selected.id || "")) : types;
  const parentRule = selected ? incomingRuleFor(selected.id, rules) : null;
  setOptions($("typeParentSel"), parentRows, (t) => typeLabel(t), parentRule?.parentTypeId || "", true, tt("structure.option.noParent", "(no parent)"));

  state.suppressDirtyMark = true;
  if (selected) {
    $("typeCodeIn").value = String(selected.code || "");
    $("typeKeyIn").value = String(selected.id || "");
    $("typeSingularIn").value = String(selected.nameSingular || "");
    $("typePluralIn").value = String(selected.namePlural || "");
    $("typeDescIn").value = String(selected.description || "");
    $("typeRelIn").value = String(parentRule?.relation || tt("structure.relation.default", "contains"));
  } else {
    $("typeCodeIn").value = "";
    $("typeKeyIn").value = "";
    $("typeSingularIn").value = "";
    $("typePluralIn").value = "";
    $("typeDescIn").value = "";
    if (!$("typeRelIn").value.trim()) $("typeRelIn").value = tt("structure.relation.default", "contains");
  }
  state.suppressDirtyMark = false;

  const children = selected ? childRulesFor(selected.id, rules) : [];
  if (!selected) {
    $("childrenList").innerHTML = tt("structure.children.noneSelected", "No category selected.");
  } else if (!children.length) {
    $("childrenList").innerHTML = tt("structure.children.none", "No child category.");
  } else {
    $("childrenList").innerHTML = children.map((rule) => {
      const child = types.find((t) => String(t.id || "") === String(rule.childTypeId || ""));
      const childLabel = child
        ? `${child.code || child.id} - ${child.namePlural || child.nameSingular || child.id}`
        : String(rule.childTypeId || "");
      return `<div class="line"><span class="mono">${esc(childLabel)}</span> <span class="tag">${esc(rule.relation || tt("structure.relation.default", "contains"))}</span></div>`;
    }).join("");
  }

  $("saveBtn").disabled = !selected;
  $("deleteBtn").disabled = !selected || !!selected.locked;

  $("treeList").innerHTML = types.map((t) => {
    const parent = incomingRuleFor(t.id, rules);
    const parentType = parent ? types.find((x) => String(x.id || "") === String(parent.parentTypeId || "")) : null;
    const parentTxt = parentType
      ? `${parentType.code || parentType.id} (${parent.relation || tt("structure.relation.default", "contains")})`
      : tt("structure.parent.root", "root");
    const codeTxt = String(t.code || "---");
    const nameTxt = `${String(t.nameSingular || t.id)} / ${String(t.namePlural || `${t.nameSingular || t.id}s`)}`;
    return `<div class="line"><span class="mono">${esc(codeTxt)}</span> ${esc(nameTxt)} <span class="tag">${esc(tt("common.id", "id"))}: ${esc(t.id || "")}</span> <span class="tag">${esc(tt("structure.parent.tag", "parent"))}: ${esc(parentTxt)}</span> <span class="tag">${t.locked ? esc(tt("common.base", "base")) : esc(tt("common.custom", "custom"))}</span></div>`;
  }).join("") || `<div class="line">${esc(tt("structure.none", "No categories"))}</div>`;

  const updated = String(window.VMillData?.readModuleState?.()?.meta?.updatedAt || "");
  state.lastSig = JSON.stringify({ m: updated, t: types.length, r: rules.length });
}
