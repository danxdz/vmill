(() => {
  function createRuntime(deps = {}) {
    const $ = deps.$ || ((id) => document.getElementById(id));
    const tt = deps.tt || ((_key, fallback = "") => fallback);
    const strOrEmpty = deps.strOrEmpty || ((value) => String(value == null ? "" : value).trim());
    const getRoutePlan = deps.getRoutePlan || (() => null);
    const currentRouteProductId = deps.currentRouteProductId || (() => "");
    const operationById = deps.operationById || (() => null);
    const ensureOperationFiles = deps.ensureOperationFiles || (() => []);
    const selectedOperationFile = deps.selectedOperationFile || (() => null);
    const normalizeOperationFile = deps.normalizeOperationFile || ((value) => value);
    const normalizeBubble = deps.normalizeBubble || ((value) => value);
    const listProductDocuments = deps.listProductDocuments || (() => []);
    const listProductAnnotations = deps.listProductAnnotations || (() => []);
    const productAnnotationToBubble = deps.productAnnotationToBubble || ((value) => value);
    const syncOperationCharacteristicIdsFromBubbles = deps.syncOperationCharacteristicIdsFromBubbles || (() => []);
    const writeRoutePlan = deps.writeRoutePlan || (() => {});
    const renderRoutingPanel = deps.renderRoutingPanel || (() => {});
    const characteristicNameById = deps.characteristicNameById || (() => "");
    const getSelectedOpId = deps.getSelectedOpId || (() => "");
    const setSelectedOpId = deps.setSelectedOpId || (() => {});
    const getSelectedOpFileId = deps.getSelectedOpFileId || (() => "");
    const setSelectedOpFileId = deps.setSelectedOpFileId || (() => {});
    const setSelectedCanvasBubbleId = deps.setSelectedCanvasBubbleId || (() => {});
    const getSelectedCanvasBubbleId = deps.getSelectedCanvasBubbleId || (() => "");
    const getSelectedProductDocUiValue = deps.getSelectedProductDocUiValue || (() => "");
    const createRouteFromScope = deps.createRouteFromScope || (() => null);
    const readState = deps.readState || (() => ({}));
    const routesInFilters = deps.routesInFilters || (() => []);
    const currentScope = deps.currentScope || (() => ({}));
    const normalizeOperation = deps.normalizeOperation || ((value) => value);
    const sortOpsBySeq = deps.sortOpsBySeq || ((rows) => rows || []);
    const writeOperationToInputs = deps.writeOperationToInputs || (() => {});
    const renderOperationQuickList = deps.renderOperationQuickList || (() => {});
    const renderOperationCharacteristicList = deps.renderOperationCharacteristicList || (() => {});
    const renderBubbleCharacteristicSelect = deps.renderBubbleCharacteristicSelect || (() => {});
    const clearBubbleForm = deps.clearBubbleForm || (() => {});
    const renderBubbleTable = deps.renderBubbleTable || (() => {});
    const syncCanvasFromRoute = deps.syncCanvasFromRoute || (() => {});
    const refresh = deps.refresh || (() => {});
    const numOrNull = deps.numOrNull || ((value) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    });
    const sanitizeRouteName = deps.sanitizeRouteName || ((value) => String(value || ""));
    const normalizeRouteRevision = deps.normalizeRouteRevision || ((value) => String(value || ""));
    const sanitizeStructuredMarker = deps.sanitizeStructuredMarker || ((value) => String(value || ""));
    let annotationFilterQuery = "";

    function setAnnotationFilterQuery(value) {
      annotationFilterQuery = strOrEmpty(value).toLowerCase();
    }

    function getAnnotationFilterQuery() {
      return annotationFilterQuery;
    }

    function escHtml(value) {
      return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function fmtNumber(value) {
      const n = Number(value);
      if (!Number.isFinite(n)) return "";
      const rounded = Math.round(n * 1000) / 1000;
      return String(rounded);
    }
    const isPlaceholderFile = (file) => {
      const f = file && typeof file === "object" ? file : null;
      if (!f) return false;
      const hasDocLink = !!strOrEmpty(f.productDocumentId || "");
      const hasImage = !!strOrEmpty(f.dataUrl || f.sourceDataUrl || "");
      const bubbleCount = Array.isArray(f.bubbles) ? f.bubbles.length : 0;
      return !hasDocLink && !hasImage && bubbleCount === 0;
    };

    function setRoutingDisabled(disabled) {
      const ids = [
        "routeNameIn","routeRevisionIn","routeProductRefIn","routeSaveBtn","routeResetBtn",
        "routeExportJsonBtn","routeExportCsvBtn","routeExportPdfBtn",
        "routeOpSel","opAddBtn","opDeleteBtn","opUpBtn","opDownBtn","opSeqIn","opNameIn",
        "opStationIn","opWorkstationIn","opEstTimeIn","opEstQtyBaseIn","opSampleSizeIn","opFrequencyIn","opControlMethodIn",
        "opNotesIn","opCriticalChk","opSaveBtn",
        "opOpenChronoBtn","opTaskAddBtn","opProductDocSel","opLinkProductDocBtn","opUnlinkDrawingBtn","opOpenDrawingMgrBtn","opAnnSelectAllBtn","opAnnClearBtn",
        "bubbleIdIn","bubbleCharSel","bubbleNameIn","bubbleNomIn","bubbleTolSpecIn","bubbleDevMinusIn","bubbleDevPlusIn",
        "bubbleDevMinusSignIn","bubbleDevPlusSignIn","bubbleTolApplyBtn","bubbleLslIn",
        "bubbleUslIn","bubbleUnitIn","bubbleMethodIn","bubbleInstrumentIn","bubbleReactionIn",
        "opFileSel","opExportFileJpgBtn","opExportAutocontrolBtn","opExportPdfBtn",
        "bubbleSaveBtn","bubbleClearBtn","bubbleImportBtn",
        "bubbleOpenBlueprintMgrBtn",
        "bubbleZoomOutBtn","bubbleZoomResetBtn","bubbleZoomFitBtn","bubbleZoomInBtn","bubbleFullscreenBtn",
      ];
      for (const id of ids) {
        const el = $(id);
        if (!el) continue;
        el.disabled = !!disabled;
      }
    }

    function renderOperationSelect() {
      const sel = $("routeOpSel");
      if (!sel) return;
      const routePlan = getRoutePlan();
      sel.innerHTML = "";
      const ops = Array.isArray(routePlan?.operations) ? routePlan.operations : [];
      if (!ops.length) {
        sel.innerHTML = `<option value="">${tt("spacial.none.operations", "No operations")}</option>`;
        setSelectedOpId("");
        return;
      }
      for (const op of ops) {
        const o = document.createElement("option");
        o.value = op.id;
        o.textContent = `${op.seq} - ${op.name}`;
        sel.appendChild(o);
      }
      const current = strOrEmpty(getSelectedOpId());
      if (!ops.some((x) => String(x.id) === current)) setSelectedOpId(ops[0].id);
      sel.value = strOrEmpty(getSelectedOpId());
    }

    function renderOperationFileSelect() {
      const sel = $("opFileSel");
      if (!sel) return;
      const op = operationById(getSelectedOpId());
      sel.innerHTML = "";
      if (!op) {
        sel.innerHTML = `<option value="">${tt("spacial.none.file", "No files")}</option>`;
        setSelectedOpFileId("");
        return;
      }
      const allFiles = ensureOperationFiles(op);
      const visibleFiles = allFiles.filter((f) => !isPlaceholderFile(f));
      const files = visibleFiles.length ? visibleFiles : allFiles;
      for (const f of files) {
        const o = document.createElement("option");
        o.value = String(f.id || "");
        const bubbleCount = Array.isArray(f.bubbles) ? f.bubbles.length : 0;
        o.textContent = `${f.name || tt("spacial.file.default", "Drawing")} (${bubbleCount})`;
        sel.appendChild(o);
      }
      const current = strOrEmpty(getSelectedOpFileId() || op.activeFileId || "");
      if (!files.some((f) => String(f.id || "") === current)) {
        setSelectedOpFileId(String(files[0]?.id || ""));
      } else {
        setSelectedOpFileId(current);
      }
      op.activeFileId = strOrEmpty(getSelectedOpFileId());
      sel.value = op.activeFileId;
    }

    function currentProductDocs() {
      return listProductDocuments(currentRouteProductId());
    }

    function selectedProductDocumentForUi() {
      const explicit = strOrEmpty(getSelectedProductDocUiValue());
      const docs = currentProductDocs();
      if (explicit) return docs.find((row) => String(row.id || "") === explicit) || null;
      const op = operationById(getSelectedOpId());
      const opFile = selectedOperationFile(op);
      const linked = strOrEmpty(opFile?.productDocumentId || "");
      if (linked) return docs.find((row) => String(row.id || "") === linked) || null;
      return docs[0] || null;
    }

    function ensureOperationFileForProductDocument(doc, options = {}) {
      const productDoc = doc && typeof doc === "object" ? doc : null;
      const op = operationById(getSelectedOpId());
      if (!productDoc || !op) return null;
      const files = ensureOperationFiles(op);
      let opFile = files.find((row) => String(row?.productDocumentId || "") === String(productDoc.id || "")) || null;
      if (!opFile && options.create !== false) {
        const placeholder = files.find((row) => isPlaceholderFile(row)) || null;
        if (placeholder) {
          opFile = placeholder;
        } else {
          opFile = normalizeOperationFile({
            name: productDoc.name || `${tt("spacial.file.default", "File")} ${files.length + 1}`,
            mime: productDoc.previewMime || productDoc.mime || "",
            dataUrl: productDoc.previewDataUrl || productDoc.dataUrl || "",
            productDocumentId: productDoc.id,
            productDocumentName: productDoc.name || "",
            sourceDataUrl: productDoc.dataUrl || "",
            sourceMime: productDoc.mime || "",
            sourceName: productDoc.sourceName || productDoc.name || "",
            sourcePage: Number(productDoc.sourcePage || 0) || 0,
            imageWidth: Math.max(0, Number(productDoc.imageWidth || 0) || 0),
            imageHeight: Math.max(0, Number(productDoc.imageHeight || 0) || 0),
            sourceDpi: Math.max(0, Number(productDoc.sourceDpi || 0) || 0),
            sourcePageWidthPt: Math.max(0, Number(productDoc.sourcePageWidthPt || 0) || 0),
            sourcePageHeightPt: Math.max(0, Number(productDoc.sourcePageHeightPt || 0) || 0),
            bubbles: [],
          }, files.length);
          files.push(opFile);
        }
      }
      if (!opFile) return null;
      opFile.name = productDoc.name || opFile.name;
      opFile.mime = productDoc.previewMime || productDoc.mime || opFile.mime;
      opFile.dataUrl = productDoc.previewDataUrl || productDoc.dataUrl || opFile.dataUrl;
      opFile.productDocumentId = productDoc.id;
      opFile.productDocumentName = productDoc.name || "";
      opFile.sourceDataUrl = productDoc.dataUrl || opFile.sourceDataUrl;
      opFile.sourceMime = productDoc.mime || opFile.sourceMime;
      opFile.sourceName = productDoc.sourceName || productDoc.name || opFile.sourceName;
      opFile.imageWidth = Math.max(0, Number(productDoc.imageWidth || opFile.imageWidth || 0) || 0);
      opFile.imageHeight = Math.max(0, Number(productDoc.imageHeight || opFile.imageHeight || 0) || 0);
      opFile.sourceDpi = Math.max(0, Number(productDoc.sourceDpi || opFile.sourceDpi || 0) || 0);
      opFile.sourcePageWidthPt = Math.max(0, Number(productDoc.sourcePageWidthPt || opFile.sourcePageWidthPt || 0) || 0);
      opFile.sourcePageHeightPt = Math.max(0, Number(productDoc.sourcePageHeightPt || opFile.sourcePageHeightPt || 0) || 0);
      if (Array.isArray(op.files) && op.files.length > 1) {
        op.files = op.files.filter((row) => String(row?.id || "") === String(opFile.id || "") || !isPlaceholderFile(row));
      }
      if (options.select !== false) {
        setSelectedOpFileId(String(opFile.id || ""));
        op.activeFileId = strOrEmpty(getSelectedOpFileId());
      }
      return opFile;
    }

    function operationFileForProductDocument(op, docId = "") {
      const targetOp = op && typeof op === "object" ? op : operationById(getSelectedOpId());
      const wanted = strOrEmpty(docId);
      if (!targetOp || !wanted) return null;
      return ensureOperationFiles(targetOp).find((row) => String(row?.productDocumentId || "") === wanted) || null;
    }

    function syncSelectedMasterAnnotationsToCurrentFile(selectedMasterIds = [], options = {}) {
      const op = operationById(getSelectedOpId());
      const productId = currentRouteProductId();
      const uiDoc = selectedProductDocumentForUi();
      const docId = strOrEmpty(options?.docId || uiDoc?.id || selectedOperationFile(op)?.productDocumentId || "");
      let opFile = operationFileForProductDocument(op, docId);
      const wantedIds = new Set((selectedMasterIds || []).map((x) => strOrEmpty(x)).filter(Boolean));
      if (!op || !docId) return false;
      if (!opFile && options?.ensureFile !== false && uiDoc && String(uiDoc.id || "") === docId) {
        opFile = ensureOperationFileForProductDocument(uiDoc, { create: true });
      }
      if (!opFile) return false;
      if (strOrEmpty(getSelectedOpFileId()) !== strOrEmpty(opFile.id || "")) {
        setSelectedOpFileId(String(opFile.id || ""));
        op.activeFileId = strOrEmpty(getSelectedOpFileId());
      }
      const materialized = selectedOperationFile(op);
      if (materialized && String(materialized.id || "") === String(opFile.id || "")) {
        opFile = materialized;
      }
      const docs = currentProductDocs();
      const doc = docs.find((row) => String(row.id || "") === docId) || null;
      if (doc) ensureOperationFileForProductDocument(doc, { create: false, select: false });
      const masterRows = listProductAnnotations(productId, docId);
      const byMaster = new Map(masterRows.map((row) => [String(row.id || ""), row]));
      const selectedBubbleId = strOrEmpty(getSelectedCanvasBubbleId());
      const previousMasterOrder = (opFile.bubbles || [])
        .map((bubble) => strOrEmpty(bubble?.masterAnnotationId || ""))
        .filter(Boolean);
      const existingByMaster = new Map((opFile.bubbles || []).map((bubble) => [strOrEmpty(bubble?.masterAnnotationId || ""), bubble]).filter(([id]) => !!id));
      const nextBubbles = [];
      for (const masterId of wantedIds) {
        const existing = existingByMaster.get(masterId);
        if (existing) {
          nextBubbles.push(normalizeBubble(existing, nextBubbles.length));
          continue;
        }
        const master = byMaster.get(masterId);
        if (!master) continue;
        const bubble = normalizeBubble(productAnnotationToBubble(master, nextBubbles.length), nextBubbles.length);
        if (!strOrEmpty(bubble?.coordSpace || "")) bubble.coordSpace = "source";
        if (!strOrEmpty(bubble?.bubbleOffsetSpace || "")) bubble.bubbleOffsetSpace = "source";
        nextBubbles.push(bubble);
      }
      const nextMasterOrder = nextBubbles
        .map((bubble) => strOrEmpty(bubble?.masterAnnotationId || ""))
        .filter(Boolean);
      const unchanged = previousMasterOrder.length === nextMasterOrder.length
        && previousMasterOrder.every((id, idx) => id === nextMasterOrder[idx]);
      if (unchanged && !options?.forceWrite) return false;
      opFile.bubbles = nextBubbles;
      setSelectedOpFileId(String(opFile.id || ""));
      op.activeFileId = strOrEmpty(getSelectedOpFileId());
      syncOperationCharacteristicIdsFromBubbles(op);
      const keepSelected = selectedBubbleId
        ? nextBubbles.find((bubble) => String(bubble?.id || "") === selectedBubbleId)
        : null;
      setSelectedCanvasBubbleId(keepSelected?.id || nextBubbles[0]?.id || "");
      if (options?.persist !== false) {
        writeRoutePlan(getRoutePlan(), {
          linkScope: "current",
          operationId: op.id,
          fileId: opFile.id,
        });
      }
      if (options?.render !== false) renderRoutingPanel();
      return true;
    }

    function reorderSelectedMasterForCurrentFile(masterId, direction = 0, options = {}) {
      const targetMasterId = strOrEmpty(masterId);
      const dir = Number(direction);
      if (!targetMasterId || !Number.isFinite(dir) || !dir) return false;
      const op = operationById(getSelectedOpId());
      const uiDoc = selectedProductDocumentForUi();
      const docId = strOrEmpty(options?.docId || uiDoc?.id || selectedOperationFile(op)?.productDocumentId || "");
      if (!op || !docId) return false;
      const opFile = operationFileForProductDocument(op, docId);
      if (!opFile || !Array.isArray(opFile.bubbles) || opFile.bubbles.length < 2) return false;
      const from = opFile.bubbles.findIndex((bubble) => strOrEmpty(bubble?.masterAnnotationId || "") === targetMasterId);
      if (from < 0) return false;
      const to = from + (dir > 0 ? 1 : -1);
      if (to < 0 || to >= opFile.bubbles.length) return false;
      const next = opFile.bubbles.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      opFile.bubbles = next.map((bubble, idx) => normalizeBubble(bubble, idx));
      syncOperationCharacteristicIdsFromBubbles(op);
      setSelectedCanvasBubbleId(strOrEmpty(opFile.bubbles[to]?.id || opFile.bubbles[0]?.id || ""));
      if (options?.persist !== false) {
        writeRoutePlan(getRoutePlan(), {
          linkScope: "current",
          operationId: op.id,
          fileId: opFile.id,
        });
      }
      if (options?.render !== false) renderRoutingPanel();
      return true;
    }

    function renderOperationDrawingLinks() {
      const sel = $("opProductDocSel");
      const info = $("opLinkedDocInfo");
      const host = $("opAnnLinkList");
      const linkBtn = $("opLinkProductDocBtn");
      const unlinkBtn = $("opUnlinkDrawingBtn");
      const selectAllBtn = $("opAnnSelectAllBtn");
      const clearBtn = $("opAnnClearBtn");
      if (!sel || !info || !host) return;
      const op = operationById(getSelectedOpId());
      const docs = currentProductDocs();
      const productId = currentRouteProductId();
      const allMasters = listProductAnnotations(productId, "");
      const mastersByDoc = new Map();
      for (const row of allMasters) {
        const docId = strOrEmpty(row?.documentId || "");
        if (!docId) continue;
        if (!mastersByDoc.has(docId)) mastersByDoc.set(docId, []);
        mastersByDoc.get(docId).push(row);
      }
      const selectedUiDocId = strOrEmpty(sel.value || getSelectedProductDocUiValue());
      sel.innerHTML = "";
      if (!op) {
        host.dataset.total = "0";
        host.dataset.visible = "0";
        host.dataset.selected = "0";
        sel.innerHTML = `<option value="">${tt("spacial.none.operation", "Select or create an operation first.")}</option>`;
        info.textContent = tt("spacial.none.operation", "Select or create an operation first.");
        host.innerHTML = `<div class="mini">${tt("spacial.none.operation", "Select or create an operation first.")}</div>`;
        if (linkBtn) linkBtn.disabled = true;
        if (unlinkBtn) unlinkBtn.disabled = true;
        if (selectAllBtn) selectAllBtn.disabled = true;
        if (clearBtn) clearBtn.disabled = true;
        return;
      }
      if (!docs.length) {
        host.dataset.total = "0";
        host.dataset.visible = "0";
        host.dataset.selected = "0";
        sel.innerHTML = `<option value="">${tt("spacial.docs.noProductDocs", "No product-level blueprint documents exist for this product yet.")}</option>`;
        info.textContent = tt("spacial.docs.useDrawingManager", "No product drawings yet. Open Drawing Manager to add drawings and master marks.");
        host.innerHTML = `<div class="mini">${tt("spacial.docs.useDrawingManager", "No product drawings yet. Open Drawing Manager to add drawings and master marks.")}</div>`;
        if (linkBtn) linkBtn.disabled = true;
        if (unlinkBtn) unlinkBtn.disabled = true;
        if (selectAllBtn) selectAllBtn.disabled = true;
        if (clearBtn) clearBtn.disabled = true;
        return;
      }
      const currentFile = selectedOperationFile(op);
      const linkedDocId = strOrEmpty(currentFile?.productDocumentId || "");
      const currentUiDocId = strOrEmpty(selectedUiDocId || linkedDocId || docs[0]?.id || "");
      docs.forEach((doc) => {
        const option = document.createElement("option");
        option.value = String(doc.id || "");
        const masterCount = (mastersByDoc.get(String(doc.id || "")) || []).length;
        option.textContent = `${doc.name || tt("spacial.file.default", "File")} (${masterCount})`;
        if (String(doc.id || "") === currentUiDocId) option.selected = true;
        sel.appendChild(option);
      });
      const doc = docs.find((row) => String(row.id || "") === String(sel.value || currentUiDocId || "")) || docs[0] || null;
      if (!doc) {
        host.dataset.total = "0";
        host.dataset.visible = "0";
        host.dataset.selected = "0";
        host.dataset.docId = "";
        host.dataset.fileId = "";
        info.textContent = tt("spacial.docs.useDrawingManager", "No product drawings yet. Open Drawing Manager to add drawings and master marks.");
        host.innerHTML = `<div class="mini">${tt("spacial.docs.useDrawingManager", "No product drawings yet. Open Drawing Manager to add drawings and master marks.")}</div>`;
        return;
      }
      const linkedFile = ensureOperationFileForProductDocument(doc, { create: false, select: false });
      const hasLinkedFile = !!linkedFile;
      const linkedFileId = strOrEmpty(linkedFile?.id || "");
      host.dataset.docId = String(doc.id || "");
      host.dataset.fileId = linkedFileId;
      if (linkedFileId && strOrEmpty(getSelectedOpFileId()) !== linkedFileId) {
        setSelectedOpFileId(linkedFileId);
        op.activeFileId = linkedFileId;
      }
      let linkedFileLive = linkedFile;
      if (linkedFileId) {
        const activeFile = selectedOperationFile(op);
        if (activeFile && String(activeFile.id || "") === linkedFileId) linkedFileLive = activeFile;
      }
      const selectedMasterOrder = (linkedFileLive?.bubbles || []).map((bubble) => strOrEmpty(bubble?.masterAnnotationId || "")).filter(Boolean);
      const selectedMasterIds = new Set(selectedMasterOrder);
      const selectedOrderByMaster = new Map(selectedMasterOrder.map((id, idx) => [id, idx]));
      const masters = mastersByDoc.get(String(doc.id || "")) || [];
      const filter = String(annotationFilterQuery || "").toLowerCase();
      const masterRows = masters.map((row) => {
        const charName = row.characteristicId ? (characteristicNameById(row.characteristicId, currentRouteProductId()) || "") : "";
        const label = row.characteristicId
          ? `${row.id || "--"} - ${charName || row.name || ""}`
          : `${row.id || "--"} - ${row.name || ""}`;
        return {
          row,
          label,
          haystack: `${row.id || ""} ${row.name || ""} ${row.characteristicId || ""} ${charName}`.toLowerCase(),
        };
      });
      const visibleRows = !filter
        ? masterRows
        : masterRows.filter((item) => item.haystack.includes(filter));
      if (linkBtn) linkBtn.disabled = false;
      if (unlinkBtn) unlinkBtn.disabled = !hasLinkedFile;
      if (selectAllBtn) selectAllBtn.disabled = !masters.length;
      if (clearBtn) clearBtn.disabled = !hasLinkedFile || !selectedMasterIds.size;
      info.textContent = hasLinkedFile
        ? tt("spacial.docs.linkedInfo", "Linked drawing: {name} | {count} operation annotation(s) selected.", { name: doc.name || tt("spacial.file.default", "File"), count: selectedMasterIds.size })
        : tt("spacial.docs.availableInfo", "Available drawing: {name} | {count} master annotation(s). Link it to use in this operation.", { name: doc.name || tt("spacial.file.default", "File"), count: masters.length });
      if (!masters.length) {
        host.dataset.total = "0";
        host.dataset.visible = "0";
        host.dataset.selected = "0";
        host.innerHTML = `<div class="mini">${tt("spacial.none.annotations", "No annotations yet for this operation.")}</div>`;
        return;
      }
      host.dataset.total = String(masters.length);
      host.dataset.visible = String(visibleRows.length);
      host.dataset.selected = String(selectedMasterIds.size);
      if (!visibleRows.length) {
        host.innerHTML = `<div class="mini">${tt("spacial.filter.noMatch", "No annotations match your filter.")}</div>`;
        return;
      }
      host.innerHTML = visibleRows.map((item) => {
        const row = item.row;
        const rowId = strOrEmpty(row.id || "");
        const checked = selectedMasterIds.has(rowId) ? "checked" : "";
        const order = selectedOrderByMaster.has(rowId) ? Number(selectedOrderByMaster.get(rowId)) : -1;
        const canMoveUp = order > 0;
        const canMoveDown = order >= 0 && order < (selectedMasterOrder.length - 1);
        const nominal = fmtNumber(row.nominal);
        const lsl = fmtNumber(row.lsl);
        const usl = fmtNumber(row.usl);
        const unit = strOrEmpty(row.unit || "mm");
        const safeId = escHtml(String(row.id || ""));
        return `
          <div class="importTreeRow" data-op-ann-row="${safeId}" style="display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border-bottom:1px solid color-mix(in srgb,var(--text) 8%, transparent);cursor:pointer;">
            <input type="checkbox" data-op-ann-link="${safeId}" ${checked} />
            <div style="flex:1 1 auto;min-width:0;">
              <div style="display:flex;align-items:center;gap:8px;min-width:0;">
                <span style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(item.label || "")}</span>
                ${order >= 0 ? `<span class="mini mono" style="padding:1px 6px;border:1px solid var(--border);border-radius:999px;">#${order + 1}</span>` : ""}
              </div>
              <div class="mini mono" style="margin-top:2px;opacity:.85;">${escHtml(`N:${nominal || "-"}  LSL:${lsl || "-"}  USL:${usl || "-"}  ${unit || ""}`)}</div>
            </div>
            <div style="display:flex;gap:4px;flex:0 0 auto;">
              <button type="button" data-op-ann-move="${safeId}" data-op-ann-dir="-1" ${(!checked || !canMoveUp) ? "disabled" : ""} title="${escHtml(tt("spacial.moveUp", "Move Up"))}">↑</button>
              <button type="button" data-op-ann-move="${safeId}" data-op-ann-dir="1" ${(!checked || !canMoveDown) ? "disabled" : ""} title="${escHtml(tt("spacial.moveDown", "Move Down"))}">↓</button>
            </div>
          </div>
        `;
      }).join("");
    }

    function createNewRoute() {
      const state = readState();
      const scope = currentScope(state);
      if (!scope.product) {
        alert(tt("spacial.alert.routeNeedScope", "Select one product first."));
        return;
      }
      const base = createRouteFromScope(state);
      const existing = routesInFilters(state);
      const nextIdx = existing.length + 1;
      base.routeName = sanitizeRouteName(`${base.routeName || tt("spacial.section.route", "Route")} ${nextIdx}`);
      base.revision = "A";
      writeRoutePlan(base);
      setSelectedOpId("");
      refresh();
    }

    function addOperation() {
      const routePlan = getRoutePlan();
      if (!routePlan) return;
      const ops = Array.isArray(routePlan.operations) ? routePlan.operations : [];
      const maxSeq = ops.reduce((acc, op) => Math.max(acc, Number(op?.seq || 0)), 0);
      const op = normalizeOperation({
        id: deps.uid ? deps.uid("op") : `op_${Date.now()}`,
        seq: maxSeq + 10,
        name: `${tt("spacial.section.operations", "Operations")} ${ops.length + 1}`,
        stationCode: "",
        workstation: "",
        estimatedTimeMin: null,
        estimatedQtyBase: 1,
        sampleSize: null,
        frequency: "",
        controlMethod: "",
        critical: false,
        notes: "",
        tasks: [{
          seq: 10,
          name: tt("spacial.task.default", "Task 1"),
          type: "HUMAN",
          notes: "",
        }],
        characteristicIds: [],
        files: [{ name: `${tt("spacial.file.default", "File")} 1`, bubbles: [] }],
      }, ops.length);
      routePlan.operations.push(op);
      routePlan.operations = sortOpsBySeq(routePlan.operations);
      setSelectedOpId(op.id);
      setSelectedOpFileId(op.activeFileId || op.files?.[0]?.id || "");
      writeRoutePlan(routePlan);
      renderRoutingPanel();
    }

    function saveSelectedOperation() {
      const routePlan = getRoutePlan();
      if (!routePlan) return;
      const op = operationById(getSelectedOpId());
      if (!op) return;
      const seq = Number($("opSeqIn").value);
      op.seq = Number.isFinite(seq) ? seq : op.seq;
      op.name = strOrEmpty($("opNameIn").value) || op.name;
      op.stationCode = strOrEmpty($("opStationIn").value);
      op.workstation = strOrEmpty($("opWorkstationIn").value);
      op.estimatedTimeMin = numOrNull($("opEstTimeIn").value);
      {
        const qtyBase = Number($("opEstQtyBaseIn").value || 1);
        op.estimatedQtyBase = Number.isFinite(qtyBase) && qtyBase > 0 ? Math.max(1, Math.round(qtyBase)) : 1;
      }
      op.sampleSize = numOrNull($("opSampleSizeIn").value);
      op.frequency = strOrEmpty($("opFrequencyIn").value);
      op.controlMethod = sanitizeStructuredMarker($("opControlMethodIn").value);
      op.notes = strOrEmpty($("opNotesIn").value);
      op.critical = !!$("opCriticalChk").checked;
      syncOperationCharacteristicIdsFromBubbles(op);
      routePlan.operations = sortOpsBySeq(routePlan.operations);
      writeRoutePlan(routePlan);
      renderRoutingPanel();
    }

    function deleteSelectedOperation() {
      const routePlan = getRoutePlan();
      const currentId = strOrEmpty(getSelectedOpId());
      if (!routePlan || !currentId) return;
      if (!confirm(tt("spacial.confirm.deleteOperation", "Delete selected operation and all its annotations?"))) return;
      routePlan.operations = (routePlan.operations || []).filter((op) => String(op?.id || "") !== currentId);
      const nextOp = routePlan.operations[0] || null;
      setSelectedOpId(nextOp?.id || "");
      setSelectedOpFileId(nextOp?.activeFileId || nextOp?.files?.[0]?.id || "");
      setSelectedCanvasBubbleId("");
      clearBubbleForm();
      writeRoutePlan(routePlan);
      renderRoutingPanel();
    }

    return {
      setRoutingDisabled,
      renderOperationSelect,
      renderOperationFileSelect,
      currentProductDocs,
      selectedProductDocumentForUi,
      ensureOperationFileForProductDocument,
      operationFileForProductDocument,
      setAnnotationFilterQuery,
      getAnnotationFilterQuery,
      syncSelectedMasterAnnotationsToCurrentFile,
      reorderSelectedMasterForCurrentFile,
      renderOperationDrawingLinks,
      createNewRoute,
      addOperation,
      saveSelectedOperation,
      deleteSelectedOperation,
    };
  }

  window.VMillSpacialOperations = {
    createRuntime,
  };
})();
