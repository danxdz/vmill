(() => {
  function createRuntime(deps = {}) {
    const $ = deps.$ || ((id) => document.getElementById(id));
    const tt = deps.tt || ((_key, fallback = "") => fallback);
    const strOrEmpty = deps.strOrEmpty || ((value) => String(value == null ? "" : value).trim());
    const escHtml = deps.escHtml || ((value) => String(value == null ? "" : value));
    const normalizeBubble = deps.normalizeBubble || ((value) => value);
    const currentRouteProductId = deps.currentRouteProductId || (() => "");
    const operationById = deps.operationById || (() => null);
    const selectedOperationFile = deps.selectedOperationFile || (() => null);
    const selectedFileBubbles = deps.selectedFileBubbles || (() => []);
    const listProductCharacteristics = deps.listProductCharacteristics || (() => []);
    const characteristicById = deps.characteristicById || (() => null);
    const renderRoutingPanel = deps.renderRoutingPanel || (() => {});
    const syncOperationCharacteristicIdsFromBubbles = deps.syncOperationCharacteristicIdsFromBubbles || (() => {});
    const upsertCharacteristicFromAnnotation = deps.upsertCharacteristicFromAnnotation || (() => "");
    const normalizeBbox = deps.normalizeBbox || (() => null);
    const bubbleLinkState = deps.bubbleLinkState || (() => ({ master: null, overriddenFields: new Set(), hasOverrides: false }));
    const bubbleFieldStateClass = deps.bubbleFieldStateClass || (() => "");
    const normalizeCardinalRotation = deps.normalizeCardinalRotation || ((value) => Number(value || 0) || 0);
    const formatDeviationInputValue = deps.formatDeviationInputValue || ((value) => {
      const n = Number(value);
      return Number.isFinite(n) ? String(Math.abs(n)) : "";
    });
    const roundToleranceValue = deps.roundToleranceValue || ((value) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    });
    const readSignedDeviation = deps.readSignedDeviation || (() => null);
    const writeSignedDeviation = deps.writeSignedDeviation || (() => {});
    const applyToleranceValuesToFields = deps.applyToleranceValuesToFields || (() => null);
    const resolveToleranceSpec = deps.resolveToleranceSpec || (() => null);
    const inferDeviationsFromBounds = deps.inferDeviationsFromBounds || (() => ({ lowerDeviation: null, upperDeviation: null }));
    const sanitizeStructuredMarker = deps.sanitizeStructuredMarker || ((value) => String(value || ""));
    const writeRoutePlan = deps.writeRoutePlan || (() => {});
    const getRoutePlan = deps.getRoutePlan || (() => null);
    const getSelectedOpId = deps.getSelectedOpId || (() => "");
    const getSelectedCanvasBubbleId = deps.getSelectedCanvasBubbleId || (() => "");
    const setSelectedCanvasBubbleId = deps.setSelectedCanvasBubbleId || (() => {});
    const getEditingBubbleId = deps.getEditingBubbleId || (() => "");
    const setEditingBubbleId = deps.setEditingBubbleId || (() => {});
    const numOrNull = deps.numOrNull || ((value) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    });

    function renderBubbleCharacteristicSelect(preferredId = "") {
      const sel = $("bubbleCharSel");
      if (!sel) return;
      const op = operationById(getSelectedOpId());
      sel.innerHTML = "";
      if (!op) {
        sel.innerHTML = `<option value="">${tt("spacial.none.operation", "Select or create an operation first.")}</option>`;
        sel.disabled = true;
        return;
      }
      const productId = currentRouteProductId();
      const rows = listProductCharacteristics(productId);
      const first = document.createElement("option");
      first.value = "";
      first.textContent = tt("spacial.annotation.noCharacteristic", "No linked characteristic");
      sel.appendChild(first);
      for (const ch of rows) {
        const o = document.createElement("option");
        o.value = String(ch.id || "");
        o.textContent = `${ch.id || "--"} - ${ch.name || ""}`;
        sel.appendChild(o);
      }
      let wanted = strOrEmpty(preferredId || sel.value);
      if (wanted && !rows.some((x) => String(x.id || "") === wanted)) {
        const fallback = rows.find((x) => String(x.id || "") === wanted);
        if (fallback) {
          const o = document.createElement("option");
          o.value = String(fallback.id || "");
          o.textContent = `${fallback.id || "--"} - ${fallback.name || ""} (${tt("spacial.annotation.legacy", "legacy")})`;
          sel.appendChild(o);
        } else {
          wanted = "";
        }
      }
      const hasLinkedOptions = rows.length > 0 || (wanted && Array.from(sel.options).some((o) => String(o.value || "") === wanted));
      sel.disabled = !hasLinkedOptions;
      sel.value = wanted || "";
    }

    function applyCharacteristicToBubbleForm(charId, force = false) {
      const cid = strOrEmpty(charId);
      if (!cid) return;
      const ch = characteristicById(cid, currentRouteProductId());
      if (!ch) return;
      if (force || !strOrEmpty($("bubbleNameIn")?.value)) $("bubbleNameIn").value = ch.name || $("bubbleNameIn").value;
      if (force || !strOrEmpty($("bubbleNomIn")?.value)) $("bubbleNomIn").value = ch.nominal == null ? "" : String(ch.nominal);
      if (force || !strOrEmpty($("bubbleTolSpecIn")?.value)) $("bubbleTolSpecIn").value = ch.toleranceSpec || "";
      if (force || !strOrEmpty($("bubbleLslIn")?.value)) $("bubbleLslIn").value = ch.lsl == null ? "" : String(ch.lsl);
      if (force || !strOrEmpty($("bubbleUslIn")?.value)) $("bubbleUslIn").value = ch.usl == null ? "" : String(ch.usl);
      if (force || !strOrEmpty($("bubbleDevMinusIn")?.value)) writeSignedDeviation("bubbleDevMinusIn", "bubbleDevMinusSignIn", ch?.lowerDeviation, "-");
      if (force || !strOrEmpty($("bubbleDevPlusIn")?.value)) writeSignedDeviation("bubbleDevPlusIn", "bubbleDevPlusSignIn", ch?.upperDeviation, "+");
      if (force || !strOrEmpty($("bubbleUnitIn")?.value)) $("bubbleUnitIn").value = ch.unit || "mm";
      if (force || !strOrEmpty($("bubbleMethodIn")?.value)) $("bubbleMethodIn").value = ch.method || "";
      if (force || !strOrEmpty($("bubbleInstrumentIn")?.value)) $("bubbleInstrumentIn").value = ch.instrument || "";
      if (force || !strOrEmpty($("bubbleReactionIn")?.value)) $("bubbleReactionIn").value = ch.reactionPlan || "";
    }

    function clearBubbleForm() {
      setEditingBubbleId("");
      setSelectedCanvasBubbleId("");
      $("bubbleIdIn").value = "";
      if ($("bubbleCharSel")) $("bubbleCharSel").value = "";
      $("bubbleNameIn").value = "";
      $("bubbleNomIn").value = "";
      $("bubbleTolSpecIn").value = "";
      $("bubbleLslIn").value = "";
      $("bubbleUslIn").value = "";
      writeSignedDeviation("bubbleDevMinusIn", "bubbleDevMinusSignIn", null, "-");
      writeSignedDeviation("bubbleDevPlusIn", "bubbleDevPlusSignIn", null, "+");
      $("bubbleUnitIn").value = "mm";
      $("bubbleMethodIn").value = "";
      $("bubbleInstrumentIn").value = "";
      $("bubbleReactionIn").value = "";
    }

    function readBubbleForm() {
      return normalizeBubble({
        id: $("bubbleIdIn").value,
        characteristicId: $("bubbleCharSel")?.value || "",
        name: $("bubbleNameIn").value,
        nominal: $("bubbleNomIn").value,
        lsl: $("bubbleLslIn").value,
        usl: $("bubbleUslIn").value,
        lowerDeviation: readSignedDeviation("bubbleDevMinusIn", "bubbleDevMinusSignIn"),
        upperDeviation: readSignedDeviation("bubbleDevPlusIn", "bubbleDevPlusSignIn"),
        toleranceSpec: $("bubbleTolSpecIn").value,
        unit: $("bubbleUnitIn").value,
        method: $("bubbleMethodIn").value,
        instrument: $("bubbleInstrumentIn").value,
        reactionPlan: $("bubbleReactionIn").value,
      }, 0);
    }

    function applyBubbleToleranceForm() {
      return applyToleranceValuesToFields({
        nominalEl: $("bubbleNomIn"),
        specEl: $("bubbleTolSpecIn"),
        lslEl: $("bubbleLslIn"),
        uslEl: $("bubbleUslIn"),
        lowerDeviation: readSignedDeviation("bubbleDevMinusIn", "bubbleDevMinusSignIn"),
        upperDeviation: readSignedDeviation("bubbleDevPlusIn", "bubbleDevPlusSignIn"),
        lowerInputId: "bubbleDevMinusIn",
        lowerSignId: "bubbleDevMinusSignIn",
        upperInputId: "bubbleDevPlusIn",
        upperSignId: "bubbleDevPlusSignIn",
      });
    }

    function setBubbleRowSignedDeviation(row, field, value, fallbackSign = "+") {
      if (!row) return;
      const input = row.querySelector(`[data-bubble-grid-field="${field}Abs"]`);
      const btn = row.querySelector(`[data-bubble-grid-sign="${field}"]`);
      const num = Number(value);
      if (btn) btn.textContent = Number.isFinite(num) && num < 0 ? "-" : fallbackSign;
      if (input) input.value = Number.isFinite(num) ? formatDeviationInputValue(num) : "";
    }

    function readBubbleRowSignedDeviation(row, field) {
      if (!row) return null;
      const input = row.querySelector(`[data-bubble-grid-field="${field}Abs"]`);
      const btn = row.querySelector(`[data-bubble-grid-sign="${field}"]`);
      const raw = strOrEmpty(input?.value || "");
      if (!raw) return null;
      const mag = Number(raw.replace(",", "."));
      if (!Number.isFinite(mag)) return null;
      const sign = String(btn?.textContent || "+").trim() === "-" ? -1 : 1;
      return roundToleranceValue(Math.abs(mag) * sign);
    }

    function applyBubbleRowTolerance(row, fallback = null) {
      if (!row) return null;
      const nominalEl = row.querySelector('[data-bubble-grid-field="nominal"]');
      const specEl = row.querySelector('[data-bubble-grid-field="toleranceSpec"]');
      const lslEl = row.querySelector('[data-bubble-grid-field="lsl"]');
      const uslEl = row.querySelector('[data-bubble-grid-field="usl"]');
      const raw = resolveToleranceSpec(specEl?.value || fallback?.toleranceSpec || "", nominalEl?.value || fallback?.nominal || "");
      let lowerDeviation = raw?.lowerDeviation ?? readBubbleRowSignedDeviation(row, "lowerDeviation") ?? fallback?.lowerDeviation ?? null;
      let upperDeviation = raw?.upperDeviation ?? readBubbleRowSignedDeviation(row, "upperDeviation") ?? fallback?.upperDeviation ?? null;
      if ((lowerDeviation == null || upperDeviation == null) && fallback?.nominal != null) {
        const inferred = inferDeviationsFromBounds(fallback.nominal, fallback.lsl, fallback.usl);
        if (lowerDeviation == null) lowerDeviation = inferred.lowerDeviation;
        if (upperDeviation == null) upperDeviation = inferred.upperDeviation;
      }
      const result = applyToleranceValuesToFields({
        nominalEl,
        specEl,
        lslEl,
        uslEl,
        lowerDeviation,
        upperDeviation,
      });
      setBubbleRowSignedDeviation(row, "lowerDeviation", result?.lowerDeviation, "-");
      setBubbleRowSignedDeviation(row, "upperDeviation", result?.upperDeviation, "+");
      return result;
    }

    function bubbleCharacteristicOptionsHtml(selectedId, productId) {
      const selected = strOrEmpty(selectedId);
      const rows = listProductCharacteristics(productId);
      const hasSelected = selected && rows.some((x) => String(x.id || "") === selected);
      const out = [
        `<option value="">${escHtml(tt("spacial.annotation.noCharacteristic", "No linked characteristic"))}</option>`,
      ];
      if (selected && !hasSelected) {
        out.push(`<option value="${escHtml(selected)}" selected>${escHtml(`${selected} (${tt("spacial.annotation.legacy", "legacy")})`)}</option>`);
      }
      for (const ch of rows) {
        const cid = String(ch.id || "");
        const sel = cid === selected ? " selected" : "";
        out.push(`<option value="${escHtml(cid)}"${sel}>${escHtml(`${cid} - ${ch.name || ""}`)}</option>`);
      }
      return out.join("");
    }

    function readBubbleRowFromInputs(row, fallback = null) {
      const read = (field) => {
        const el = row?.querySelector?.(`[data-bubble-grid-field="${field}"]`);
        return el ? String(el.value || "") : "";
      };
      const src = fallback || {};
      const characteristicInput = row?.querySelector?.('[data-bubble-grid-field="characteristicId"]');
      return normalizeBubble({
        ...src,
        id: read("id") || src.id,
        characteristicId: characteristicInput ? read("characteristicId") : strOrEmpty(src.characteristicId || ""),
        name: read("name"),
        nominal: read("nominal"),
        lowerDeviation: readBubbleRowSignedDeviation(row, "lowerDeviation"),
        upperDeviation: readBubbleRowSignedDeviation(row, "upperDeviation"),
        toleranceSpec: read("toleranceSpec"),
        lsl: read("lsl"),
        usl: read("usl"),
        unit: read("unit"),
        method: sanitizeStructuredMarker(read("method")),
        instrument: read("instrument"),
        reactionPlan: read("reaction"),
      }, 0);
    }

    function saveBubbleFromGridRow(row, options = {}) {
      const routePlan = getRoutePlan();
      if (!routePlan) return false;
      const op = operationById(getSelectedOpId());
      if (!op) return false;
      const opFile = selectedOperationFile(op);
      if (!opFile) return false;
      const bubbles = Array.isArray(opFile.bubbles) ? opFile.bubbles : [];
      const idx = Number(row?.getAttribute?.("data-bubble-row-index"));
      if (!Number.isFinite(idx) || idx < 0 || idx >= bubbles.length) return false;
      const prev = normalizeBubble(bubbles[idx], idx);
      applyBubbleRowTolerance(row, prev);
      const next = readBubbleRowFromInputs(row, prev);
      next.id = strOrEmpty(prev.id) || strOrEmpty(next.id) || `B${String(idx + 1).padStart(3, "0")}`;
      const productId = currentRouteProductId();
      if (!strOrEmpty(next.name) && next.characteristicId) {
        const ch = characteristicById(next.characteristicId, productId);
        if (ch?.name) next.name = ch.name;
      }
      if (next.characteristicId) {
        const ch = characteristicById(next.characteristicId, productId);
        if (ch) {
          if (!strOrEmpty(next.name)) next.name = ch.name || next.name;
          if (next.nominal == null) next.nominal = ch.nominal;
          if (next.lsl == null) next.lsl = ch.lsl;
          if (next.usl == null) next.usl = ch.usl;
          if (next.lowerDeviation == null) next.lowerDeviation = ch.lowerDeviation;
          if (next.upperDeviation == null) next.upperDeviation = ch.upperDeviation;
          if (!strOrEmpty(next.toleranceSpec)) next.toleranceSpec = ch.toleranceSpec || "";
          if (!strOrEmpty(next.unit)) next.unit = ch.unit || "mm";
          if (!strOrEmpty(next.method)) next.method = ch.method || "";
          if (!strOrEmpty(next.instrument)) next.instrument = ch.instrument || "";
          if (!strOrEmpty(next.reactionPlan)) next.reactionPlan = ch.reactionPlan || "";
        }
      }
      if (!strOrEmpty(next.name)) {
        if (!options?.silent) alert(tt("spacial.alert.annotationNameRequired", "Annotation name is required."));
        return false;
      }
      const linkedCharId = upsertCharacteristicFromAnnotation(next, productId);
      if (linkedCharId) next.characteristicId = linkedCharId;
      if (prev?.bbox && !next?.bbox) next.bbox = prev.bbox;
      if (prev?.bubbleOffset && !next?.bubbleOffset) next.bubbleOffset = prev.bubbleOffset;
      if (prev?.thumbnailDataUrl && !next?.thumbnailDataUrl) next.thumbnailDataUrl = prev.thumbnailDataUrl;
      if (prev?.thumbnailBBox && !next?.thumbnailBBox) next.thumbnailBBox = prev.thumbnailBBox;
      if (next?.thumbnailRotation == null) next.thumbnailRotation = prev?.thumbnailRotation ?? 0;
      if (next?.ocrRotation == null) next.ocrRotation = prev?.ocrRotation ?? 0;
      opFile.bubbles[idx] = next;
      syncOperationCharacteristicIdsFromBubbles(op);
      if (String(getSelectedCanvasBubbleId() || "") === String(prev.id || "")) {
        setSelectedCanvasBubbleId(next.id);
      }
      writeRoutePlan(routePlan);
      renderRoutingPanel();
      return true;
    }

    function renderBubbleTable() {
      const body = $("bubbleTableBody");
      if (!body) return;
      const op = operationById(getSelectedOpId());
      if (!op) {
        body.innerHTML = `<div class="mini">${tt("spacial.none.operation", "Select or create an operation first.")}</div>`;
        return;
      }
      renderBubbleCharacteristicSelect();
      const productId = currentRouteProductId();
      const bubbles = selectedFileBubbles(op);
      if (!bubbles.length) {
        body.innerHTML = `<div class="mini">${tt("spacial.none.annotations", "No annotations yet for this operation.")}</div>`;
        return;
      }
      body.innerHTML = bubbles.map((b, idx) => {
        const box = normalizeBbox(b?.bbox);
        const linkState = bubbleLinkState(b, productId);
        const hasMaster = !!linkState.master;
        const linkedChar = characteristicById(b.characteristicId, productId);
        const linkedLabel = linkedChar
          ? `${linkedChar.id || "--"} - ${linkedChar.name || ""}`
          : tt("spacial.annotation.noCharacteristic", "No linked characteristic");
        const lowerDevText = b.lowerDeviation == null ? "" : String(b.lowerDeviation);
        const upperDevText = b.upperDeviation == null ? "" : String(b.upperDeviation);
        const moreId = `bubble_more_${idx}_${String(b.id || "").replace(/[^a-zA-Z0-9_-]/g, "_")}`;
        const statusChip = hasMaster
          ? `<span class="bubbleChip master" title="${escHtml(tt("spacial.tip.masterLinked", "This drawing characteristic is linked to a product-level master annotation."))}">${escHtml(tt("spacial.annotation.masterLinked", "Product master"))}</span>`
          : "";
        const overrideChip = linkState.hasOverrides
          ? `<span class="bubbleChip override" title="${escHtml(tt("spacial.tip.opOverride", "Some fields are overridden only for this operation."))}">${escHtml(tt("spacial.annotation.operationOverride", "Operation override"))}</span>`
          : "";
        return `
          <article class="bubbleCard ${String(getSelectedCanvasBubbleId() || "") === String(b.id || "") ? "sel" : ""}" data-bubble-row-index="${idx}" data-bubble-row-id="${escHtml(String(b.id || ""))}">
            <div class="bubbleCardRow">
              ${strOrEmpty(b.thumbnailDataUrl)
                ? `<img class="annThumb" src="${escHtml(b.thumbnailDataUrl)}" alt="thumb" />`
                : `<div class="annThumbPlaceholder">${escHtml(tt("spacial.annotation.thumbEmpty", "none"))}</div>`}
              <div class="bubbleCardMain">
                <div class="bubbleCardTitleRow">
                  <input class="cellInput mono" data-bubble-grid-field="id" type="text" value="${escHtml(b.id || "")}" readonly title="${escHtml(tt("spacial.tip.id", "Unique ID for this drawing characteristic."))}" />
                  <input class="cellInput ${bubbleFieldStateClass(linkState, "name")}" data-bubble-grid-field="name" type="text" value="${escHtml(b.name || "")}" placeholder="${escHtml(tt("spacial.annotation.name", "Annotation name"))}" title="${escHtml(tt("spacial.tip.name", "Name or label for this drawing characteristic."))}" />
                </div>
                <div class="bubbleCardMetrics">
                  <input class="cellInput ${bubbleFieldStateClass(linkState, "nominal")}" data-bubble-grid-field="nominal" type="number" step="0.001" value="${b.nominal == null ? "" : escHtml(b.nominal)}" placeholder="${escHtml(tt("spacial.annotation.nominal", "Nominal"))}" title="${escHtml(tt("spacial.tip.nominal", "Target nominal value."))}" />
                  <div class="bubbleSignField">
                    <button class="bubbleSignBtn" data-bubble-grid-sign="lowerDeviation" type="button" title="${escHtml(tt("spacial.tip.tolMinSign", "Change the sign of tolerance min."))}">${escHtml((b.lowerDeviation ?? 0) < 0 ? "-" : "+")}</button>
                    <input class="cellInput ${bubbleFieldStateClass(linkState, "lowerDeviation")}" data-bubble-grid-field="lowerDeviationAbs" type="number" step="0.001" min="0" value="${escHtml(formatDeviationInputValue(b.lowerDeviation))}" placeholder="Tol min" title="${escHtml(tt("spacial.tip.tolMin", "Tolerance min amount. Usually negative, but sign can be changed."))}" />
                  </div>
                  <div class="bubbleSignField">
                    <button class="bubbleSignBtn" data-bubble-grid-sign="upperDeviation" type="button" title="${escHtml(tt("spacial.tip.tolMaxSign", "Change the sign of tolerance max."))}">${escHtml((b.upperDeviation ?? 0) < 0 ? "-" : "+")}</button>
                    <input class="cellInput ${bubbleFieldStateClass(linkState, "upperDeviation")}" data-bubble-grid-field="upperDeviationAbs" type="number" step="0.001" min="0" value="${escHtml(formatDeviationInputValue(b.upperDeviation))}" placeholder="Tol max" title="${escHtml(tt("spacial.tip.tolMax", "Tolerance max amount. Usually positive, but sign can be changed."))}" />
                  </div>
                  <input class="cellInput ${bubbleFieldStateClass(linkState, "lsl")}" data-bubble-grid-field="lsl" type="number" step="0.001" value="${b.lsl == null ? "" : escHtml(b.lsl)}" placeholder="Min" readonly title="${escHtml(tt("spacial.tip.min", "Calculated minimum allowed value."))}" />
                  <input class="cellInput ${bubbleFieldStateClass(linkState, "usl")}" data-bubble-grid-field="usl" type="number" step="0.001" value="${b.usl == null ? "" : escHtml(b.usl)}" placeholder="Max" readonly title="${escHtml(tt("spacial.tip.max", "Calculated maximum allowed value."))}" />
                  <input class="cellInput ${bubbleFieldStateClass(linkState, "unit")}" data-bubble-grid-field="unit" type="text" value="${escHtml(b.unit || "")}" placeholder="${escHtml(tt("spacial.annotation.unit", "Unit"))}" title="${escHtml(tt("spacial.tip.unit", "Measurement unit, for example mm or deg."))}" />
                </div>
              </div>
              <div class="bubbleCardActions">
                <button data-bubble-pick-btn="${idx}" type="button" title="${escHtml(tt("spacial.tip.pick", "Load this row into the editor and select it on the blueprint."))}">${tt("spacial.pick", "Pick")}</button>
                <button data-bubble-more-btn="${idx}" type="button" aria-controls="${escHtml(moreId)}" title="${escHtml(tt("spacial.tip.more", "Show linked characteristic, fit code, method, instrument, and reaction fields."))}">${tt("spacial.annotation.more", "More")}</button>
                ${hasMaster ? `<button data-bubble-reset-master="${idx}" class="bubbleActionSoft" type="button" title="${escHtml(tt("spacial.tip.resetToMaster", "Restore inherited values from the product-level master annotation."))}">${tt("spacial.annotation.resetToMaster", "Reset")}</button>` : ""}
                <button data-bubble-del="${idx}" type="button" class="danger" title="${escHtml(tt("spacial.tip.delete", "Delete this drawing characteristic."))}">${tt("spacial.delete", "Delete")}</button>
              </div>
            </div>
            <details class="bubbleCardMore" id="${escHtml(moreId)}">
              <summary>${escHtml(tt("spacial.annotation.more", "More fields"))}</summary>
              <div class="bubbleCardMetaRow">
                ${statusChip}
                ${overrideChip}
                <span class="bubbleChip">${escHtml(linkedLabel)}</span>
                <span class="tolPreview">${escHtml((lowerDevText || upperDevText) ? `${lowerDevText || "0"} / ${upperDevText || "0"}` : tt("spacial.annotation.noTolerance", "No tolerance yet"))}</span>
                <span class="tolPreview">${escHtml(tt("spacial.thumb.rotation", "Thumb {deg}°", { deg: normalizeCardinalRotation(b?.thumbnailRotation ?? 0, 0) }))}</span>
                <span title="${escHtml(box ? `${Math.round(box.x1)},${Math.round(box.y1)} -> ${Math.round(box.x2)},${Math.round(box.y2)}` : tt("spacial.annotation.noBox", "No box yet"))}">${escHtml(box ? `${Math.round(box.x1)},${Math.round(box.y1)} -> ${Math.round(box.x2)},${Math.round(box.y2)}` : tt("spacial.annotation.noBox", "No box yet"))}</span>
              </div>
              <div class="bubbleCardMoreGrid">
                <select class="cellInput ${bubbleFieldStateClass(linkState, "characteristicId")}" data-bubble-grid-field="characteristicId" title="${escHtml(tt("spacial.tip.linkedChar", "Linked product characteristic from the catalog."))}">${bubbleCharacteristicOptionsHtml(b.characteristicId, productId)}</select>
                <input class="cellInput ${bubbleFieldStateClass(linkState, "toleranceSpec")}" data-bubble-grid-field="toleranceSpec" type="text" list="fitCodeList" value="${escHtml(b.toleranceSpec || "")}" placeholder="${escHtml(tt("spacial.annotation.toleranceSpec", "Fit / tolerance spec"))}" title="${escHtml(tt("spacial.tip.fitSpec", "Optional fit or tolerance notation like H7, h6, +0,1/0."))}" />
                <input class="cellInput ${bubbleFieldStateClass(linkState, "method")}" data-bubble-grid-field="method" type="text" value="${escHtml(b.method || "")}" placeholder="${escHtml(tt("spacial.annotation.method", "Method"))}" title="${escHtml(tt("spacial.tip.method", "Inspection or measurement method."))}" />
                <input class="cellInput ${bubbleFieldStateClass(linkState, "instrument")}" data-bubble-grid-field="instrument" type="text" value="${escHtml(b.instrument || "")}" placeholder="${escHtml(tt("spacial.annotation.instrument", "Instrument"))}" title="${escHtml(tt("spacial.tip.instrument", "Instrument or gage used for this check."))}" />
                <input class="cellInput ${bubbleFieldStateClass(linkState, "reactionPlan")}" data-bubble-grid-field="reaction" type="text" value="${escHtml(b.reactionPlan || "")}" placeholder="${escHtml(tt("spacial.annotation.reaction", "Reaction plan"))}" title="${escHtml(tt("spacial.tip.reaction", "Reaction plan if the result is out of tolerance."))}" />
              </div>
            </details>
          </article>
        `;
      }).join("");
    }

    function saveBubbleFromInputs() {
      const routePlan = getRoutePlan();
      if (!routePlan) return;
      const op = operationById(getSelectedOpId());
      if (!op) return;
      applyBubbleToleranceForm();
      const bubbles = selectedFileBubbles(op);
      const b = readBubbleForm();
      if (!strOrEmpty(b.name) && b.characteristicId) {
        const ch = characteristicById(b.characteristicId, currentRouteProductId());
        if (ch?.name) b.name = ch.name;
        if (!strOrEmpty(b.toleranceSpec)) b.toleranceSpec = ch?.toleranceSpec || "";
        if (b.lowerDeviation == null) b.lowerDeviation = ch?.lowerDeviation ?? null;
        if (b.upperDeviation == null) b.upperDeviation = ch?.upperDeviation ?? null;
      }
      if (!strOrEmpty(b.id)) b.id = `B${String(bubbles.length + 1).padStart(3, "0")}`;
      if (!strOrEmpty(b.name)) {
        alert(tt("spacial.alert.annotationNameRequired", "Annotation name is required."));
        return;
      }
      const linkedCharId = upsertCharacteristicFromAnnotation(b, currentRouteProductId());
      if (linkedCharId) b.characteristicId = linkedCharId;
      const editIdx = bubbles.findIndex((x) => String(x.id || "") === String(getEditingBubbleId() || ""));
      const idIdx = bubbles.findIndex((x) => String(x.id || "") === String(b.id || ""));
      const prev = editIdx >= 0 ? bubbles[editIdx] : (idIdx >= 0 ? bubbles[idIdx] : null);
      if (prev?.linkId && !b?.linkId) b.linkId = prev.linkId;
      if (prev?.masterAnnotationId && !b?.masterAnnotationId) b.masterAnnotationId = prev.masterAnnotationId;
      if (prev?.bbox && !b?.bbox) b.bbox = prev.bbox;
      if (prev?.bubbleOffset && !b?.bubbleOffset) b.bubbleOffset = prev.bubbleOffset;
      if (prev?.thumbnailDataUrl && !b?.thumbnailDataUrl) b.thumbnailDataUrl = prev.thumbnailDataUrl;
      if (prev?.thumbnailBBox && !b?.thumbnailBBox) b.thumbnailBBox = prev.thumbnailBBox;
      if (b?.thumbnailRotation == null) b.thumbnailRotation = prev?.thumbnailRotation ?? 0;
      if (b?.ocrRotation == null) b.ocrRotation = prev?.ocrRotation ?? 0;
      if (editIdx >= 0) bubbles[editIdx] = b;
      else if (idIdx >= 0) bubbles[idIdx] = b;
      else bubbles.push(b);
      syncOperationCharacteristicIdsFromBubbles(op);
      setSelectedCanvasBubbleId(b.id);
      clearBubbleForm();
      setSelectedCanvasBubbleId(b.id);
      setEditingBubbleId("");
      writeRoutePlan(routePlan);
      renderRoutingPanel();
      const opFile = selectedOperationFile(op);
    }

    function splitCsvLine(line, sep) {
      const out = [];
      let cur = "";
      let inQuote = false;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        const next = line[i + 1];
        if (ch === "\"") {
          if (inQuote && next === "\"") {
            cur += "\"";
            i += 1;
            continue;
          }
          inQuote = !inQuote;
          continue;
        }
        if (ch === sep && !inQuote) {
          out.push(cur);
          cur = "";
          continue;
        }
        cur += ch;
      }
      out.push(cur);
      return out.map((x) => x.trim());
    }

    function parseCsvRows(text) {
      const lines = String(text || "").replace(/\r/g, "\n").split("\n").map((x) => x.trim()).filter(Boolean);
      if (!lines.length) return [];
      const seps = [",", ";", "\t"];
      let bestSep = ",";
      let bestScore = -1;
      for (const sep of seps) {
        const score = splitCsvLine(lines[0], sep).length;
        if (score > bestScore) {
          bestScore = score;
          bestSep = sep;
        }
      }
      const header = splitCsvLine(lines[0], bestSep).map((h) => String(h || "").toLowerCase().replace(/[^a-z0-9]+/g, ""));
      const rows = [];
      for (let i = 1; i < lines.length; i += 1) {
        const cells = splitCsvLine(lines[i], bestSep);
        if (!cells.some((x) => String(x || "").trim())) continue;
        const obj = {};
        for (let c = 0; c < header.length; c += 1) obj[header[c]] = cells[c] ?? "";
        rows.push(obj);
      }
      return rows;
    }

    function fromAlias(row, aliases) {
      for (const key of aliases) {
        const k = String(key || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
        const val = row[k];
        if (val != null && String(val).trim() !== "") return String(val).trim();
      }
      return "";
    }

    function numFromAlias(row, aliases) {
      const raw = fromAlias(row, aliases);
      if (!raw) return null;
      const n = Number(String(raw).replace(",", "."));
      return Number.isFinite(n) ? n : null;
    }

    function importBubblesCsv(file) {
      if (!file) return;
      const op = operationById(getSelectedOpId());
      if (!op) {
        alert(tt("spacial.none.operation", "Select or create an operation first."));
        return;
      }
      const bubbles = selectedFileBubbles(op);
      const fr = new FileReader();
      fr.onload = () => {
        try {
          const rows = parseCsvRows(String(fr.result || ""));
          if (!rows.length) throw new Error(tt("spacial.import.noRows", "No rows found."));
          const productChars = listProductCharacteristics(currentRouteProductId());
          const imported = [];
          for (const row of rows) {
            const id = fromAlias(row, ["bubble", "bubbleid", "id", "num", "number", "char"]);
            const name = fromAlias(row, ["name", "dimension", "feature", "characteristic"]);
            let characteristicId = fromAlias(row, ["characteristicid", "charid", "controlid", "featureid", "characteristic"]);
            if (characteristicId) {
              const byId = productChars.find((x) => String(x.id || "") === characteristicId);
              if (!byId) {
                const byName = productChars.find((x) => String(x.name || "").toLowerCase() === String(characteristicId || "").toLowerCase());
                if (byName) characteristicId = String(byName.id || "");
                else characteristicId = "";
              }
            }
            const nominal = fromAlias(row, ["nominal", "target", "nom"]);
            const lsl = fromAlias(row, ["lsl", "min", "lower", "specmin"]);
            const usl = fromAlias(row, ["usl", "max", "upper", "specmax"]);
            const unit = fromAlias(row, ["unit", "uom"]);
            const method = fromAlias(row, ["method", "controlmethod", "inspectionmethod"]);
            const instrument = fromAlias(row, ["instrument", "gauge", "gage", "tool"]);
            const reaction = fromAlias(row, ["reaction", "reactionplan", "plan", "action"]);
            const x1 = numFromAlias(row, ["x1", "left", "xmin", "bboxx1"]);
            const y1 = numFromAlias(row, ["y1", "top", "ymin", "bboxy1"]);
            const x2Raw = numFromAlias(row, ["x2", "right", "xmax", "bboxx2"]);
            const y2Raw = numFromAlias(row, ["y2", "bottom", "ymax", "bboxy2"]);
            const width = numFromAlias(row, ["width", "w", "bboxwidth"]);
            const height = numFromAlias(row, ["height", "h", "bboxheight"]);
            const x2 = x2Raw != null ? x2Raw : (x1 != null && width != null ? x1 + width : null);
            const y2 = y2Raw != null ? y2Raw : (y1 != null && height != null ? y1 + height : null);
            const labelX = numFromAlias(row, ["bubbleoffsetx", "offsetx", "labelx", "bubblex"]);
            const labelY = numFromAlias(row, ["bubbleoffsety", "offsety", "labely", "bubbley"]);
            if (!id && !name) continue;
            imported.push(normalizeBubble({
              id: id || "",
              characteristicId,
              name: name || "",
              nominal,
              lsl,
              usl,
              unit,
              method,
              instrument,
              reactionPlan: reaction,
              bbox: (x1 != null && y1 != null && x2 != null && y2 != null) ? { x1, y1, x2, y2 } : null,
              bubbleOffset: (labelX != null && labelY != null) ? { x: labelX, y: labelY } : null,
            }, bubbles.length + imported.length));
          }
          if (!imported.length) throw new Error(tt("spacial.import.noValid.annotations", "No valid annotations found."));
          for (const b of imported) {
            const linkedCharId = upsertCharacteristicFromAnnotation(b, currentRouteProductId());
            if (linkedCharId) b.characteristicId = linkedCharId;
            const idx = bubbles.findIndex((x) => String(x.id || "") === String(b.id || ""));
            if (idx >= 0) bubbles[idx] = b;
            else bubbles.push(b);
          }
          syncOperationCharacteristicIdsFromBubbles(op);
          writeRoutePlan(getRoutePlan());
          renderRoutingPanel();
          alert(tt("spacial.import.done.annotations", "Imported {count} annotation(s).", { count: imported.length }));
        } catch (err) {
          alert(tt("spacial.import.failed", "CSV import failed: {err}", { err: err?.message || "invalid file" }));
        }
      };
      fr.readAsText(file);
    }

    return {
      renderBubbleCharacteristicSelect,
      applyCharacteristicToBubbleForm,
      clearBubbleForm,
      readBubbleForm,
      applyBubbleToleranceForm,
      setBubbleRowSignedDeviation,
      readBubbleRowSignedDeviation,
      applyBubbleRowTolerance,
      bubbleCharacteristicOptionsHtml,
      readBubbleRowFromInputs,
      saveBubbleFromGridRow,
      renderBubbleTable,
      saveBubbleFromInputs,
      importBubblesCsv,
    };
  }

  window.VMillSpacialAnnotations = { createRuntime };
})();
