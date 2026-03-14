(() => {
  function createRuntime(deps = {}) {
    const $ = deps.$ || ((id) => document.getElementById(id));
    const strOrEmpty = deps.strOrEmpty || ((value) => String(value == null ? "" : value).trim());
    const normalizeBubble = deps.normalizeBubble || ((value) => value);
    const normalizeBbox = deps.normalizeBbox || (() => null);
    const getSelectedOperation = deps.getSelectedOperation || (() => null);
    const selectedFileBubbles = deps.selectedFileBubbles || (() => []);
    const selectedOperationFile = deps.selectedOperationFile || (() => null);
    const clampBboxToCanvas = deps.clampBboxToCanvas || ((value) => value);
    const clampBubblesToCanvas = deps.clampBubblesToCanvas || (() => false);
    const pointFromCanvasEvent = deps.pointFromCanvasEvent || (() => ({ x: 0, y: 0 }));
    const findBubbleAtPoint = deps.findBubbleAtPoint || (() => ({ bubble: null, onLabel: false, onDelete: false, onResize: null }));
    const setBubbleCanvasCursor = deps.setBubbleCanvasCursor || (() => {});
    const bubbleCanvasCursorForHit = deps.bubbleCanvasCursorForHit || (() => "grab");
    const resizeBubbleRectFromHandle = deps.resizeBubbleRectFromHandle || ((box) => box);
    const setCanvasZoom = deps.setCanvasZoom || (() => {});
    const drawBubbleCanvas = deps.drawBubbleCanvas || (() => {});
    const renderBubbleTable = deps.renderBubbleTable || (() => {});
    const renderBubbleCharacteristicSelect = deps.renderBubbleCharacteristicSelect || (() => {});
    const clearBubbleForm = deps.clearBubbleForm || (() => {});
    const writeSignedDeviation = deps.writeSignedDeviation || (() => {});
    const readSignedDeviation = deps.readSignedDeviation || (() => null);
    const defaultBubbleOffset = deps.defaultBubbleOffset || (() => ({ x: -24, y: -24 }));
    const writeRoutePlan = deps.writeRoutePlan || (() => {});
    const renderRoutingPanel = deps.renderRoutingPanel || (() => {});
    const syncOperationCharacteristicIdsFromBubbles = deps.syncOperationCharacteristicIdsFromBubbles || (() => {});
    const numOrNull = deps.numOrNull || ((value) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    });
    const state = deps.state && typeof deps.state === "object" ? deps.state : {};
    const getRoutePlan = deps.getRoutePlan || (() => null);
    const getSelectedCanvasBubbleId = deps.getSelectedCanvasBubbleId || (() => "");
    const setSelectedCanvasBubbleId = deps.setSelectedCanvasBubbleId || (() => {});
    const getEditingBubbleId = deps.getEditingBubbleId || (() => "");
    const setEditingBubbleId = deps.setEditingBubbleId || (() => {});

    function startDrawAt(x, y) {
      state.mode = "draw";
      state.start = { x, y };
      state.rect = { x1: x, y1: y, x2: x, y2: y };
    }

    function canvasPickBubble(bubble) {
      setSelectedCanvasBubbleId(String(bubble?.id || ""));
      setEditingBubbleId(getSelectedCanvasBubbleId());
      if (bubble) {
        $("bubbleIdIn").value = bubble.id || "";
        renderBubbleCharacteristicSelect(bubble.characteristicId || "");
        if ($("bubbleCharSel")) $("bubbleCharSel").value = bubble.characteristicId || "";
        $("bubbleNameIn").value = bubble.name || "";
        $("bubbleNomIn").value = bubble.nominal == null ? "" : String(bubble.nominal);
        $("bubbleTolSpecIn").value = bubble.toleranceSpec || "";
        $("bubbleLslIn").value = bubble.lsl == null ? "" : String(bubble.lsl);
        $("bubbleUslIn").value = bubble.usl == null ? "" : String(bubble.usl);
        writeSignedDeviation("bubbleDevMinusIn", "bubbleDevMinusSignIn", bubble?.lowerDeviation, "-");
        writeSignedDeviation("bubbleDevPlusIn", "bubbleDevPlusSignIn", bubble?.upperDeviation, "+");
        $("bubbleUnitIn").value = bubble.unit || "";
        $("bubbleMethodIn").value = bubble.method || "";
        $("bubbleInstrumentIn").value = bubble.instrument || "";
        $("bubbleReactionIn").value = bubble.reactionPlan || "";
      }
      renderBubbleTable();
      drawBubbleCanvas();
    }

    function upsertCanvasBubbleWithRect(rect) {
      const routePlan = getRoutePlan();
      const op = getSelectedOperation();
      if (!routePlan || !op) return;
      const r = clampBboxToCanvas(rect);
      if (!r) return;
      const bubbles = selectedFileBubbles(op);
      let id = strOrEmpty(getSelectedCanvasBubbleId() || getEditingBubbleId() || $("bubbleIdIn").value);
      if (!id) id = `B${String(bubbles.length + 1).padStart(3, "0")}`;
      let bubble = bubbles.find((x) => String(x.id || "") === id);
      if (!bubble) {
        bubble = normalizeBubble({
          id,
          name: $("bubbleNameIn").value || `Annotation ${bubbles.length + 1}`,
          nominal: $("bubbleNomIn").value,
          toleranceSpec: $("bubbleTolSpecIn").value,
          lsl: $("bubbleLslIn").value,
          usl: $("bubbleUslIn").value,
          lowerDeviation: readSignedDeviation("bubbleDevMinusIn", "bubbleDevMinusSignIn"),
          upperDeviation: readSignedDeviation("bubbleDevPlusIn", "bubbleDevPlusSignIn"),
          unit: $("bubbleUnitIn").value || "mm",
          method: $("bubbleMethodIn").value,
          instrument: $("bubbleInstrumentIn").value,
          reactionPlan: $("bubbleReactionIn").value,
        }, bubbles.length);
        bubbles.push(bubble);
      }
      bubble.id = id;
      if (!$("bubbleNameIn").value && !bubble.name) bubble.name = `Annotation ${bubbles.length}`;
      if ($("bubbleNameIn").value) bubble.name = $("bubbleNameIn").value;
      bubble.nominal = numOrNull($("bubbleNomIn").value);
      bubble.toleranceSpec = strOrEmpty($("bubbleTolSpecIn").value);
      bubble.lsl = numOrNull($("bubbleLslIn").value);
      bubble.usl = numOrNull($("bubbleUslIn").value);
      bubble.lowerDeviation = readSignedDeviation("bubbleDevMinusIn", "bubbleDevMinusSignIn");
      bubble.upperDeviation = readSignedDeviation("bubbleDevPlusIn", "bubbleDevPlusSignIn");
      bubble.unit = strOrEmpty($("bubbleUnitIn").value || "mm");
      bubble.method = strOrEmpty($("bubbleMethodIn").value);
      bubble.instrument = strOrEmpty($("bubbleInstrumentIn").value);
      bubble.reactionPlan = strOrEmpty($("bubbleReactionIn").value);
      bubble.bbox = r;
      bubble.thumbnailDataUrl = "";
      bubble.thumbnailBBox = null;
      if (bubble.thumbnailRotation == null) bubble.thumbnailRotation = 0;
      if (bubble.ocrRotation == null) bubble.ocrRotation = 0;
      if (!bubble.bubbleOffset) bubble.bubbleOffset = defaultBubbleOffset();
      setSelectedCanvasBubbleId(bubble.id);
      setEditingBubbleId("");
      writeRoutePlan(routePlan);
      renderRoutingPanel();
    }

    function saveCanvasInteractions() {
      const routePlan = getRoutePlan();
      if (!routePlan) return;
      writeRoutePlan(routePlan);
      renderRoutingPanel();
    }

    function bindBubbleCanvas() {
      const cv = $("bubbleCanvas");
      const wrap = $("bubbleCanvasWrap");
      if (!cv || cv.dataset.bound === "1") return;
      cv.dataset.bound = "1";
      const beginPan = (e) => {
        if (!wrap) return;
        state.mode = "pan";
        state.resize = null;
        state.pan = {
          x: e.clientX,
          y: e.clientY,
          scrollLeft: wrap.scrollLeft,
          scrollTop: wrap.scrollTop,
        };
        cv.style.cursor = "grabbing";
        e.preventDefault();
      };
      cv.addEventListener("mousedown", (e) => {
        const op = getSelectedOperation();
        if (!op) return;
        if (e.button !== 0 && e.button !== 1) return;
        const p = pointFromCanvasEvent(e);
        if ((e.button === 1 || e.shiftKey) && wrap) {
          beginPan(e);
          return;
        }
        const hit = findBubbleAtPoint(p.x, p.y);
        if (hit.onDelete && hit.bubble) {
          const opFile = selectedOperationFile(op);
          if (opFile) {
            opFile.bubbles = (opFile.bubbles || []).filter((x) => String(x.id || "") !== String(hit.bubble.id || ""));
            syncOperationCharacteristicIdsFromBubbles(op);
            setSelectedCanvasBubbleId(opFile.bubbles[0]?.id || "");
            writeRoutePlan(getRoutePlan());
            renderRoutingPanel();
          }
          e.preventDefault();
          return;
        }
        if (hit.bubble) {
          canvasPickBubble(hit.bubble);
          state.mode = hit.onResize ? "resizeBox" : (hit.onLabel ? "dragLabel" : "dragBox");
          state.last = p;
          state.resize = hit.onResize
            ? { handle: hit.onResize.name, startBox: normalizeBbox(hit.bubble?.bbox) }
            : null;
          setBubbleCanvasCursor(hit.onResize ? hit.onResize.cursor : "move");
          e.preventDefault();
          return;
        }
        if (!e.altKey && wrap) {
          beginPan(e);
          return;
        }
        clearBubbleForm();
        startDrawAt(p.x, p.y);
        state.last = p;
        state.resize = null;
        renderBubbleTable();
        drawBubbleCanvas();
        e.preventDefault();
      });
      cv.addEventListener("mousemove", (e) => {
        const op = getSelectedOperation();
        if (!op) return;
        const p = pointFromCanvasEvent(e);
        if (!state.mode || state.mode === "idle") {
          const hit = findBubbleAtPoint(p.x, p.y);
          const nextHoverId = String(hit?.bubble?.id || "");
          const nextHoverResize = !!hit?.onResize;
          const hoverChanged = nextHoverId !== String(state.hoverBubbleId || "") || nextHoverResize !== !!state.hoverOnResize;
          state.hoverBubbleId = nextHoverId;
          state.hoverOnResize = nextHoverResize;
          setBubbleCanvasCursor(bubbleCanvasCursorForHit(hit, e.altKey));
          if (hoverChanged) drawBubbleCanvas();
          return;
        }
        if (state.mode === "pan" && wrap && state.pan) {
          const dx = e.clientX - state.pan.x;
          const dy = e.clientY - state.pan.y;
          wrap.scrollLeft = state.pan.scrollLeft - dx;
          wrap.scrollTop = state.pan.scrollTop - dy;
          e.preventDefault();
          return;
        }
        const bubbles = selectedFileBubbles(op);
        if (state.mode === "draw" && state.start) {
          state.rect = clampBboxToCanvas({ x1: state.start.x, y1: state.start.y, x2: p.x, y2: p.y });
          drawBubbleCanvas();
          return;
        }
        const sel = bubbles.find((x) => String(x.id || "") === String(getSelectedCanvasBubbleId() || ""));
        if (!sel) return;
        const prev = state.last || p;
        const dx = p.x - prev.x;
        const dy = p.y - prev.y;
        if (state.mode === "dragLabel") {
          const cur = sel.bubbleOffset || defaultBubbleOffset();
          sel.bubbleOffset = { x: Number(cur.x || 0) + dx, y: Number(cur.y || 0) + dy };
        } else if (state.mode === "resizeBox" && state.resize?.handle && state.resize?.startBox) {
          sel.bbox = resizeBubbleRectFromHandle(state.resize.startBox, state.resize.handle, p);
        } else if (state.mode === "dragBox") {
          const b = normalizeBbox(sel.bbox);
          if (b) sel.bbox = clampBboxToCanvas({ x1: b.x1 + dx, y1: b.y1 + dy, x2: b.x2 + dx, y2: b.y2 + dy }) || b;
        }
        state.last = p;
        drawBubbleCanvas();
      });
      const onUp = () => {
        const mode = state.mode;
        const rect = state.rect;
        state.mode = "idle";
        state.start = null;
        state.rect = null;
        state.last = null;
        state.pan = null;
        state.resize = null;
        state.hoverBubbleId = "";
        state.hoverOnResize = false;
        setBubbleCanvasCursor("grab");
        if (mode === "draw" && rect) {
          upsertCanvasBubbleWithRect(rect);
          return;
        }
        if (mode === "dragLabel" || mode === "dragBox" || mode === "resizeBox") {
          clampBubblesToCanvas();
          saveCanvasInteractions();
          return;
        }
        drawBubbleCanvas();
      };
      cv.addEventListener("mouseup", onUp);
      cv.addEventListener("mouseleave", onUp);
      window.addEventListener("mouseup", onUp);
      if (wrap) {
        wrap.addEventListener("wheel", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const dir = e.deltaY > 0 ? -0.1 : 0.1;
          setCanvasZoom(Number(state.zoom || 1) + dir, e);
        }, { passive: false });
      }
    }

    return {
      startDrawAt,
      canvasPickBubble,
      upsertCanvasBubbleWithRect,
      saveCanvasInteractions,
      bindBubbleCanvas,
    };
  }

  window.VMillSpacialCanvasEditor = { createRuntime };
})();
