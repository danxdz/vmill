(() => {
  function createRuntime(deps = {}) {
    const $ = deps.$ || ((id) => document.getElementById(id));
    const tt = deps.tt || ((_key, fallback = "") => fallback);
    const strOrEmpty = deps.strOrEmpty || ((value) => String(value == null ? "" : value).trim());
    const escHtml = deps.escHtml || ((value) => String(value == null ? "" : value));
    const normalizeCharacteristic = deps.normalizeCharacteristic || ((value) => value);
    const currentRouteProductId = deps.currentRouteProductId || (() => "");
    const listAllCharacteristics = deps.listAllCharacteristics || (() => []);
    const listProductCharacteristics = deps.listProductCharacteristics || (() => []);
    const characteristicById = deps.characteristicById || (() => null);
    const readSignedDeviation = deps.readSignedDeviation || (() => null);
    const writeSignedDeviation = deps.writeSignedDeviation || (() => {});
    const sanitizeStructuredMarker = deps.sanitizeStructuredMarker || ((value) => String(value || ""));
    const renderOperationCharacteristicList = deps.renderOperationCharacteristicList || (() => {});
    const renderBubbleCharacteristicSelect = deps.renderBubbleCharacteristicSelect || (() => {});
    const renderBubbleTable = deps.renderBubbleTable || (() => {});
    const renderRoutingPanel = deps.renderRoutingPanel || (() => {});
    const readState = deps.readState || (() => ({}));
    const getJob = deps.getJob || (() => null);
    const getStation = deps.getStation || (() => null);
    const getProduct = deps.getProduct || (() => null);
    const normalizeRoutePlan = deps.normalizeRoutePlan || ((value) => value);
    const ensureOpCharacteristicRefs = deps.ensureOpCharacteristicRefs || (() => []);
    const ensureOperationFiles = deps.ensureOperationFiles || (() => []);
    const uid = deps.uid || ((prefix = "id") => `${prefix}_${Date.now()}`);
    const NS_CHAR = deps.NS_CHAR || "spacial_characteristics";
    const NS_ROUTE = deps.NS_ROUTE || "spacial_routes";
    const getSelectedCharId = deps.getSelectedCharId || (() => "");
    const setSelectedCharId = deps.setSelectedCharId || (() => {});

    function nextCharacteristicId(rows) {
      const used = new Set(
        [
          ...((rows || []).map((x) => String(x?.id || ""))),
          ...(listAllCharacteristics().map((x) => String(x?.id || ""))),
        ].filter(Boolean)
      );
      let i = 1;
      while (i < 100000) {
        const id = `C${String(i).padStart(3, "0")}`;
        if (!used.has(id)) return id;
        i += 1;
      }
      return uid("char");
    }

    function setCharacteristicEditorDisabled(disabled) {
      const ids = [
        "charGridAddBtn",
        "charSel", "charNewBtn", "charDeleteBtn", "charIdIn", "charNameIn", "charNomIn", "charLslIn", "charUslIn",
        "charUnitIn", "charMethodIn", "charInstrumentIn", "charReactionIn", "charTolSpecIn", "charDevMinusIn", "charDevPlusIn",
        "charDevMinusSignIn", "charDevPlusSignIn", "charTolApplyBtn", "charSaveBtn", "charClearBtn",
      ];
      for (const id of ids) {
        const el = $(id);
        if (el) el.disabled = !!disabled;
      }
    }

    function writeCharacteristicToInputs(ch) {
      $("charIdIn").value = ch?.id || "";
      $("charNameIn").value = ch?.name || "";
      $("charNomIn").value = ch?.nominal == null ? "" : String(ch.nominal);
      $("charLslIn").value = ch?.lsl == null ? "" : String(ch.lsl);
      $("charUslIn").value = ch?.usl == null ? "" : String(ch.usl);
      $("charTolSpecIn").value = ch?.toleranceSpec || "";
      writeSignedDeviation("charDevMinusIn", "charDevMinusSignIn", ch?.lowerDeviation, "-");
      writeSignedDeviation("charDevPlusIn", "charDevPlusSignIn", ch?.upperDeviation, "+");
      $("charUnitIn").value = ch?.unit || "mm";
      $("charMethodIn").value = ch?.method || "";
      $("charInstrumentIn").value = ch?.instrument || "";
      $("charReactionIn").value = ch?.reactionPlan || "";
    }

    function clearCharacteristicForm() {
      setSelectedCharId("");
      if ($("charSel")) $("charSel").value = "";
      writeCharacteristicToInputs(null);
    }

    function readCharacteristicForm() {
      const productId = currentRouteProductId();
      return normalizeCharacteristic({
        id: $("charIdIn").value,
        productId,
        name: $("charNameIn").value,
        nominal: $("charNomIn").value,
        lsl: $("charLslIn").value,
        usl: $("charUslIn").value,
        lowerDeviation: readSignedDeviation("charDevMinusIn", "charDevMinusSignIn"),
        upperDeviation: readSignedDeviation("charDevPlusIn", "charDevPlusSignIn"),
        toleranceSpec: $("charTolSpecIn").value,
        unit: $("charUnitIn").value,
        method: $("charMethodIn").value,
        instrument: $("charInstrumentIn").value,
        reactionPlan: $("charReactionIn").value,
      }, 0, productId);
    }

    function readCharacteristicRowFromInputs(row, productId, idOverride = "") {
      const read = (field) => {
        const el = row?.querySelector?.(`[data-char-grid-field="${field}"]`);
        return el ? String(el.value || "") : "";
      };
      return normalizeCharacteristic({
        id: idOverride || read("id"),
        productId,
        name: read("name"),
        nominal: read("nominal"),
        lsl: read("lsl"),
        usl: read("usl"),
        unit: read("unit"),
        method: sanitizeStructuredMarker(read("method")),
        instrument: read("instrument"),
        reactionPlan: read("reaction"),
      }, 0, productId);
    }

    function upsertCharacteristicRecord(rec, productId, options = {}) {
      if (!window.VMillData?.upsertRecord) return { ok: false, error: "not_available" };
      if (!productId) return { ok: false, error: tt("spacial.characteristics.pickProduct", "Select one product first.") };
      const rows = listProductCharacteristics(productId);
      const allRows = listAllCharacteristics().map((x, i) => normalizeCharacteristic(x, i, ""));
      const originalId = strOrEmpty(options?.originalId || "");
      if (!strOrEmpty(rec.name)) {
        return { ok: false, error: tt("spacial.characteristics.nameRequired", "Spec name is required.") };
      }
      if (!strOrEmpty(rec.id)) rec.id = nextCharacteristicId(rows);
      if (originalId && originalId !== String(rec.id || "")) {
        return { ok: false, error: tt("spacial.characteristics.idLocked", "ID cannot be changed in inline edit.") };
      }
      const externalDup = allRows.find((x) =>
        String(x.id || "") === String(rec.id || "")
        && String(x.productId || "") !== String(productId || "")
      );
      if (externalDup) {
        return { ok: false, error: tt("spacial.characteristics.idInUse", "This spec ID is already used by another product.") };
      }
      const dup = rows.find((x) => String(x.id || "") === String(originalId || rec.id || ""));
      if (dup) rec.createdAt = dup.createdAt || rec.createdAt;
      rec.updatedAt = new Date().toISOString();
      window.VMillData.upsertRecord(NS_CHAR, rec);
      setSelectedCharId(String(rec.id || ""));
      return { ok: true, id: String(rec.id || "") };
    }

    function refreshCharacteristicViews() {
      renderCharacteristicSelect();
      renderCharacteristicGrid();
      renderOperationCharacteristicList();
      renderBubbleCharacteristicSelect();
      renderBubbleTable();
    }

    function characteristicGridRowHtml(ch, options = {}) {
      const isNew = !!options.newRow;
      const rowId = String(ch?.id || "");
      const actionLabel = tt("spacial.add", "Add");
      const actionAttr = 'data-char-grid-add="1"';
      const delBtn = isNew
        ? ""
        : `<button class="cellAction danger" type="button" data-char-grid-del="${escHtml(rowId)}">${escHtml(tt("spacial.delete", "Delete"))}</button>`;
      const idReadonly = isNew ? "" : "readonly";
      return `
        <tr ${isNew ? 'data-char-grid-new="1"' : `data-char-grid-id="${escHtml(rowId)}"`}>
          <td><input class="cellInput mono" data-char-grid-field="id" type="text" value="${escHtml(ch?.id || "")}" ${idReadonly} /></td>
          <td><input class="cellInput" data-char-grid-field="name" type="text" value="${escHtml(ch?.name || "")}" /></td>
          <td><input class="cellInput" data-char-grid-field="nominal" type="number" step="0.001" value="${ch?.nominal == null ? "" : escHtml(ch.nominal)}" /></td>
          <td><input class="cellInput" data-char-grid-field="lsl" type="number" step="0.001" value="${ch?.lsl == null ? "" : escHtml(ch.lsl)}" /></td>
          <td><input class="cellInput" data-char-grid-field="usl" type="number" step="0.001" value="${ch?.usl == null ? "" : escHtml(ch.usl)}" /></td>
          <td><input class="cellInput" data-char-grid-field="unit" type="text" value="${escHtml(ch?.unit || "")}" /></td>
          <td><input class="cellInput" data-char-grid-field="method" type="text" value="${escHtml(ch?.method || "")}" /></td>
          <td><input class="cellInput" data-char-grid-field="instrument" type="text" value="${escHtml(ch?.instrument || "")}" /></td>
          <td><input class="cellInput" data-char-grid-field="reaction" type="text" value="${escHtml(ch?.reactionPlan || "")}" /></td>
          <td>
            <div class="cellActions">
              ${isNew ? `<button class="cellAction primary" type="button" ${actionAttr}>${escHtml(actionLabel)}</button>` : `<span class="cellMeta">${escHtml(tt("spacial.autoSave", "Auto-save"))}</span>`}
              ${delBtn}
            </div>
          </td>
        </tr>
      `;
    }

    function renderCharacteristicGrid() {
      const body = $("charGridBody");
      const info = $("charGridInfo");
      if (!body) return;
      const productId = currentRouteProductId();
      if (!productId) {
        body.innerHTML = `<tr><td colspan="10" class="mini">${tt("spacial.characteristics.pickProduct", "Select one product first.")}</td></tr>`;
        if (info) info.textContent = "";
        return;
      }
      const rows = listProductCharacteristics(productId);
      const visibleRows = rows.map((ch) => characteristicGridRowHtml(ch)).join("");
      const newRow = characteristicGridRowHtml({
        id: nextCharacteristicId(rows),
        productId,
        name: "",
        nominal: null,
        lsl: null,
        usl: null,
        unit: "mm",
        method: "",
        instrument: "",
        reactionPlan: "",
      }, { newRow: true });
      body.innerHTML = `${visibleRows}${newRow}`;
      if (info) info.textContent = tt("spacial.characteristics.gridInfo", "{count} specs", { count: rows.length });
    }

    function saveCharacteristicFromGridRow(row, options = {}) {
      const productId = currentRouteProductId();
      if (!productId) {
        if (!options?.silent) alert(tt("spacial.characteristics.pickProduct", "Select one product first."));
        return false;
      }
      const rec = readCharacteristicRowFromInputs(row, productId, options?.idOverride || "");
      const result = upsertCharacteristicRecord(rec, productId, { originalId: options?.originalId || options?.idOverride || "" });
      if (!result.ok) {
        if (!options?.silent) alert(result.error || tt("spacial.saveFailed", "Save failed."));
        return false;
      }
      refreshCharacteristicViews();
      return true;
    }

    function removeCharacteristicRefsInRoutes(charId) {
      const cid = strOrEmpty(charId);
      if (!cid || !window.VMillData?.listRecords || !window.VMillData?.upsertRecord) return;
      const rows = window.VMillData.listRecords(NS_ROUTE) || [];
      const state = readState();
      for (const row of rows) {
        const rowJob = getJob(state, row?.jobId) || null;
        const rowStation = getStation(state, row?.stationId || rowJob?.stationId) || null;
        const rowProduct = getProduct(state, row?.productId || rowJob?.productId) || null;
        const route = normalizeRoutePlan(row, rowJob, rowStation, rowProduct, { fallback: false });
        if (!route) continue;
        let changed = false;
        for (const op of (route.operations || [])) {
          const before = ensureOpCharacteristicRefs(op);
          const nextIds = before.filter((x) => String(x || "") !== cid);
          if (nextIds.length !== before.length) {
            op.characteristicIds = nextIds;
            changed = true;
          }
          const manualBefore = Array.isArray(op.manualCharacteristicIds) ? op.manualCharacteristicIds : [];
          const manualNext = manualBefore.filter((x) => String(x || "") !== cid);
          if (manualNext.length !== manualBefore.length) {
            op.manualCharacteristicIds = manualNext;
            changed = true;
          }
          const files = ensureOperationFiles(op);
          for (const f of files) {
            for (const b of (f.bubbles || [])) {
              if (String(b?.characteristicId || "") !== cid) continue;
              b.characteristicId = "";
              changed = true;
            }
          }
        }
        if (changed) window.VMillData.upsertRecord(NS_ROUTE, route);
      }
    }

    function renderCharacteristicSelect() {
      const sel = $("charSel");
      if (!sel) return;
      const productId = currentRouteProductId();
      const rows = listProductCharacteristics(productId);
      if (!productId) {
        setCharacteristicEditorDisabled(true);
        sel.innerHTML = `<option value="">${tt("spacial.characteristics.pickProduct", "Select one product first.")}</option>`;
        writeCharacteristicToInputs(null);
        return;
      }
      setCharacteristicEditorDisabled(false);
      sel.innerHTML = "";
      if (!rows.length) {
        sel.innerHTML = `<option value="">${tt("spacial.characteristics.none", "No specs yet.")}</option>`;
        setSelectedCharId("");
        writeCharacteristicToInputs(null);
        return;
      }
      for (const ch of rows) {
        const o = document.createElement("option");
        o.value = String(ch.id || "");
        o.textContent = `${ch.id || "--"} - ${ch.name || ""}`;
        sel.appendChild(o);
      }
      let selectedCharId = getSelectedCharId();
      if (!rows.some((x) => String(x.id || "") === String(selectedCharId || ""))) {
        selectedCharId = String(rows[0]?.id || "");
        setSelectedCharId(selectedCharId);
      }
      sel.value = selectedCharId;
      writeCharacteristicToInputs(rows.find((x) => String(x.id || "") === String(selectedCharId || "")) || rows[0] || null);
    }

    function saveSelectedCharacteristic() {
      const productId = currentRouteProductId();
      const rec = readCharacteristicForm();
      const result = upsertCharacteristicRecord(rec, productId, { originalId: strOrEmpty(getSelectedCharId() || rec.id || "") });
      if (!result.ok) {
        alert(result.error || tt("spacial.saveFailed", "Save failed."));
        return;
      }
      refreshCharacteristicViews();
    }

    function deleteCharacteristicById(id, options = {}) {
      const cleanId = strOrEmpty(id);
      if (!cleanId || !window.VMillData?.deleteRecord) return false;
      if (options.confirm !== false && !confirm(tt("spacial.characteristics.confirmDelete", "Delete this spec?"))) return false;
      window.VMillData.deleteRecord(NS_CHAR, cleanId);
      removeCharacteristicRefsInRoutes(cleanId);
      if (String($("bubbleCharSel")?.value || "") === cleanId) $("bubbleCharSel").value = "";
      if (String(getSelectedCharId() || "") === cleanId) setSelectedCharId("");
      if (options.fullRefresh) renderRoutingPanel();
      else refreshCharacteristicViews();
      return true;
    }

    function deleteSelectedCharacteristic() {
      const id = strOrEmpty(getSelectedCharId() || $("charSel")?.value || $("charIdIn")?.value);
      if (!id) return;
      deleteCharacteristicById(id, { confirm: true, fullRefresh: true });
    }

    function prepareNewCharacteristicRow() {
      const rows = listProductCharacteristics(currentRouteProductId());
      const newRow = $("charGridBody")?.querySelector?.('tr[data-char-grid-new="1"]');
      if (!newRow) return;
      const idInput = newRow.querySelector('[data-char-grid-field="id"]');
      const nameInput = newRow.querySelector('[data-char-grid-field="name"]');
      if (idInput) idInput.value = nextCharacteristicId(rows);
      if (nameInput) nameInput.focus();
    }

    function loadCharacteristicIntoForm(charId) {
      const cleanId = strOrEmpty(charId);
      setSelectedCharId(cleanId);
      const row = characteristicById(cleanId, currentRouteProductId());
      writeCharacteristicToInputs(row);
    }

    function startNewCharacteristic() {
      clearCharacteristicForm();
      const rows = listProductCharacteristics(currentRouteProductId());
      $("charIdIn").value = nextCharacteristicId(rows);
    }

    return {
      nextCharacteristicId,
      setCharacteristicEditorDisabled,
      writeCharacteristicToInputs,
      clearCharacteristicForm,
      readCharacteristicForm,
      upsertCharacteristicRecord,
      refreshCharacteristicViews,
      renderCharacteristicGrid,
      saveCharacteristicFromGridRow,
      removeCharacteristicRefsInRoutes,
      renderCharacteristicSelect,
      saveSelectedCharacteristic,
      deleteSelectedCharacteristic,
      deleteCharacteristicById,
      prepareNewCharacteristicRow,
      loadCharacteristicIntoForm,
      startNewCharacteristic,
    };
  }

  window.VMillSpacialCharacteristics = { createRuntime };
})();
