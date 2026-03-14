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

    function setRoutingDisabled(disabled) {
      const ids = [
        "routeNameIn","routeRevisionIn","routeProductRefIn","routeSaveBtn","routeResetBtn",
        "routeExportJsonBtn","routeExportCsvBtn","routeExportPdfBtn",
        "routeOpSel","opAddBtn","opDeleteBtn","opUpBtn","opDownBtn","opSeqIn","opNameIn",
        "opStationIn","opWorkstationIn","opEstTimeIn","opSampleSizeIn","opFrequencyIn","opControlMethodIn",
        "opNotesIn","opCriticalChk","opSaveBtn",
        "opOpenChronoBtn","opProductDocSel","opLinkProductDocBtn","opUnlinkDrawingBtn","opOpenDrawingMgrBtn","opAnnSelectAllBtn","opAnnClearBtn",
        "bubbleIdIn","bubbleCharSel","bubbleNameIn","bubbleNomIn","bubbleTolSpecIn","bubbleDevMinusIn","bubbleDevPlusIn",
        "bubbleDevMinusSignIn","bubbleDevPlusSignIn","bubbleTolApplyBtn","bubbleLslIn",
        "bubbleUslIn","bubbleUnitIn","bubbleMethodIn","bubbleInstrumentIn","bubbleReactionIn",
        "opFileSel","opExportFileJpgBtn","opExportAutocontrolBtn","opExportPdfBtn",
        "bubbleSaveBtn","bubbleClearBtn","bubbleImportBtn",
        "bubbleOpenBlueprintMgrBtn","bubbleShowBoxesChk",
        "bubbleDisplayColorIn","bubbleDisplaySelectedColorIn","bubbleDisplayTextColorIn","bubbleDisplaySizeIn","bubbleDisplayFontSizeIn","bubbleDisplayHandleSizeIn","bubbleDisplayHandleModeSel","bubbleDisplayResetBtn",
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
      const files = ensureOperationFiles(op);
      for (const f of files) {
        const o = document.createElement("option");
        o.value = String(f.id || "");
        const bubbleCount = Array.isArray(f.bubbles) ? f.bubbles.length : 0;
        o.textContent = `${f.name || tt("spacial.file.default", "File")} (${bubbleCount})`;
        sel.appendChild(o);
      }
      const current = strOrEmpty(getSelectedOpFileId());
      if (!files.some((f) => String(f.id || "") === current)) {
        setSelectedOpFileId(String(op.activeFileId || files[0]?.id || ""));
      }
      sel.value = strOrEmpty(getSelectedOpFileId());
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
          bubbles: [],
        }, files.length);
        files.push(opFile);
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
      const docs = currentProductDocs();
      const doc = docs.find((row) => String(row.id || "") === docId) || null;
      if (doc) ensureOperationFileForProductDocument(doc, { create: false, select: false });
      const masterRows = listProductAnnotations(productId, docId);
      const byMaster = new Map(masterRows.map((row) => [String(row.id || ""), row]));
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
        nextBubbles.push(normalizeBubble(productAnnotationToBubble(master, nextBubbles.length), nextBubbles.length));
      }
      opFile.bubbles = nextBubbles;
      setSelectedOpFileId(String(opFile.id || ""));
      op.activeFileId = strOrEmpty(getSelectedOpFileId());
      syncOperationCharacteristicIdsFromBubbles(op);
      setSelectedCanvasBubbleId(nextBubbles[0]?.id || "");
      writeRoutePlan(getRoutePlan());
      renderRoutingPanel();
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
      sel.innerHTML = "";
      if (!op) {
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
        sel.innerHTML = `<option value="">${tt("spacial.docs.noProductDocs", "No product-level blueprint documents exist for this product yet.")}</option>`;
        info.textContent = tt("spacial.docs.useDrawingManager", "No product drawings yet. Open Drawing Manager to add files and OCR annotations.");
        host.innerHTML = `<div class="mini">${tt("spacial.docs.useDrawingManager", "No product drawings yet. Open Drawing Manager to add files and OCR annotations.")}</div>`;
        if (linkBtn) linkBtn.disabled = true;
        if (unlinkBtn) unlinkBtn.disabled = true;
        if (selectAllBtn) selectAllBtn.disabled = true;
        if (clearBtn) clearBtn.disabled = true;
        return;
      }
      const currentFile = selectedOperationFile(op);
      const linkedDocId = strOrEmpty(currentFile?.productDocumentId || "");
      const currentUiDocId = strOrEmpty(getSelectedProductDocUiValue() || linkedDocId || docs[0]?.id || "");
      docs.forEach((doc) => {
        const option = document.createElement("option");
        option.value = String(doc.id || "");
        const masterCount = listProductAnnotations(currentRouteProductId(), doc.id).length;
        option.textContent = `${doc.name || tt("spacial.file.default", "File")} (${masterCount})`;
        if (String(doc.id || "") === currentUiDocId) option.selected = true;
        sel.appendChild(option);
      });
      const doc = docs.find((row) => String(row.id || "") === String(sel.value || currentUiDocId || "")) || docs[0] || null;
      if (!doc) {
        info.textContent = tt("spacial.docs.useDrawingManager", "No product drawings yet. Open Drawing Manager to add files and OCR annotations.");
        host.innerHTML = `<div class="mini">${tt("spacial.docs.useDrawingManager", "No product drawings yet. Open Drawing Manager to add files and OCR annotations.")}</div>`;
        return;
      }
      const linkedFile = ensureOperationFileForProductDocument(doc, { create: false, select: false });
      const hasLinkedFile = !!linkedFile;
      const selectedMasterIds = new Set((linkedFile?.bubbles || []).map((bubble) => strOrEmpty(bubble?.masterAnnotationId || "")).filter(Boolean));
      const masters = listProductAnnotations(currentRouteProductId(), doc.id);
      if (linkBtn) linkBtn.disabled = false;
      if (unlinkBtn) unlinkBtn.disabled = !hasLinkedFile;
      if (selectAllBtn) selectAllBtn.disabled = !masters.length;
      if (clearBtn) clearBtn.disabled = !hasLinkedFile || !selectedMasterIds.size;
      info.textContent = hasLinkedFile
        ? tt("spacial.docs.linkedInfo", "Linked drawing: {name} | {count} operation annotation(s) selected.", { name: doc.name || tt("spacial.file.default", "File"), count: selectedMasterIds.size })
        : tt("spacial.docs.availableInfo", "Available drawing: {name} | {count} master annotation(s). Link it to use in this operation.", { name: doc.name || tt("spacial.file.default", "File"), count: masters.length });
      if (!masters.length) {
        host.innerHTML = `<div class="mini">${tt("spacial.none.annotations", "No annotations yet for this operation.")}</div>`;
        return;
      }
      host.innerHTML = masters.map((row) => {
        const checked = selectedMasterIds.has(String(row.id || "")) ? "checked" : "";
        const label = row.characteristicId
          ? `${row.id || "--"} - ${characteristicNameById(row.characteristicId, currentRouteProductId()) || row.name || ""}`
          : `${row.id || "--"} - ${row.name || ""}`;
        return `
          <label class="importTreeRow" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid color-mix(in srgb,var(--text) 8%, transparent);">
            <input type="checkbox" data-op-ann-link="${String(row.id || "").replace(/"/g, "&quot;")}" ${checked} />
            <span>${String(label || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</span>
          </label>
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
        sampleSize: null,
        frequency: "",
        controlMethod: "",
        critical: false,
        notes: "",
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
      syncSelectedMasterAnnotationsToCurrentFile,
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
