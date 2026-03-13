(() => {
  function createRuntime(config = {}) {
    const $ = typeof config.$ === 'function' ? config.$ : (id) => document.getElementById(id);
    const tt = typeof config.tt === 'function' ? config.tt : (_key, fallback = '', vars) => fallback;
    const cssThemeHex = typeof config.cssThemeHex === 'function' ? config.cssThemeHex : (_name, fallback) => fallback || '#000000';
    const hexToRgba = typeof config.hexToRgba === 'function' ? config.hexToRgba : (hex, _alpha) => hex;
    const normalizeBbox = typeof config.normalizeBbox === 'function' ? config.normalizeBbox : () => null;
    const bubbleLabelPosition = typeof config.bubbleLabelPosition === 'function' ? config.bubbleLabelPosition : () => null;
    const getSelectedOperation = typeof config.getSelectedOperation === 'function' ? config.getSelectedOperation : () => null;
    const selectedFileBubbles = typeof config.selectedFileBubbles === 'function' ? config.selectedFileBubbles : () => [];
    const selectedOperationFile = typeof config.selectedOperationFile === 'function' ? config.selectedOperationFile : () => null;
    const renderBubbleTable = typeof config.renderBubbleTable === 'function' ? config.renderBubbleTable : () => {};
    const writeRoutePlan = typeof config.writeRoutePlan === 'function' ? config.writeRoutePlan : () => {};
    const state = config.state && typeof config.state === 'object' ? config.state : {};
    const getDisplaySettings = typeof config.getDisplaySettings === 'function'
      ? config.getDisplaySettings
      : () => (state.displaySettings || {
        bubbleColor: '#4dafff',
        selectedColor: '#00ff8f',
        bubbleTextColor: '#0f1724',
        bubbleSize: 14,
        bubbleFontSize: 12,
        handleSize: 4,
        handleMode: 'hover',
      });

    function ensureCanvasReady() {
      const cv = $('bubbleCanvas');
      if (!cv) return null;
      const ctx = cv.getContext('2d');
      if (!ctx) return null;
      return { cv, ctx };
    }

    function canvasImageBounds() {
      const cv = $('bubbleCanvas');
      if (!cv) return { width: 0, height: 0 };
      return { width: Math.max(0, Number(cv.width || 0)), height: Math.max(0, Number(cv.height || 0)) };
    }

    function clampBboxToCanvas(bbox) {
      const r = normalizeBbox(bbox);
      if (!r) return null;
      const bounds = canvasImageBounds();
      if (!bounds.width || !bounds.height) return r;
      let x1 = Math.max(0, Math.min(bounds.width, r.x1));
      let y1 = Math.max(0, Math.min(bounds.height, r.y1));
      let x2 = Math.max(0, Math.min(bounds.width, r.x2));
      let y2 = Math.max(0, Math.min(bounds.height, r.y2));
      if (x2 - x1 < 2) {
        if (x1 <= 0) x2 = Math.min(bounds.width, x1 + 2);
        else x1 = Math.max(0, x2 - 2);
      }
      if (y2 - y1 < 2) {
        if (y1 <= 0) y2 = Math.min(bounds.height, y1 + 2);
        else y1 = Math.max(0, y2 - 2);
      }
      return normalizeBbox({ x1, y1, x2, y2 });
    }

    function clampBubblesToCanvas(op = null) {
      const target = op || getSelectedOperation();
      if (!target) return false;
      const bubbles = selectedFileBubbles(target);
      let changed = false;
      for (const b of bubbles) {
        const prev = normalizeBbox(b?.bbox);
        if (!prev) continue;
        const next = clampBboxToCanvas(prev);
        if (!next) continue;
        if (next.x1 !== prev.x1 || next.y1 !== prev.y1 || next.x2 !== prev.x2 || next.y2 !== prev.y2) {
          b.bbox = next;
          changed = true;
        }
      }
      return changed;
    }

    function bubbleDeleteControlRect(boxB) {
      const box = normalizeBbox(boxB);
      if (!box) return null;
      const size = 18;
      const pad = 6;
      const bounds = canvasImageBounds();
      let x1 = box.x2 + pad;
      let y1 = box.y1 - size - pad;
      if (Number.isFinite(bounds.width) && x1 + size > bounds.width) {
        x1 = Math.max(0, box.x1 - size - pad);
      }
      if (y1 < 0) {
        y1 = Math.min(Math.max(0, bounds.height - size), box.y1 + pad);
      }
      return { x1, y1, x2: x1 + size, y2: y1 + size };
    }

    function updateCanvasViewport() {
      const cv = $('bubbleCanvas');
      if (!cv) return;
      const z = Math.max(0.25, Math.min(6, Number(state.zoom || 1)));
      state.zoom = z;
      cv.style.width = `${Math.max(12, Math.round(cv.width * z))}px`;
      cv.style.height = `${Math.max(12, Math.round(cv.height * z))}px`;
      const zr = $('bubbleZoomResetBtn');
      if (zr) zr.textContent = `${Math.round(z * 100)}%`;
    }

    function setCanvasZoom(nextZoom, anchorEvent = null) {
      const wrap = $('bubbleCanvasWrap');
      const cv = $('bubbleCanvas');
      if (!wrap || !cv) return;
      const prevZoom = Math.max(0.25, Math.min(6, Number(state.zoom || 1)));
      const z = Math.max(0.25, Math.min(6, Number(nextZoom || 1)));
      if (Math.abs(z - prevZoom) < 0.0001) return;
      let relX = 0.5;
      let relY = 0.5;
      if (anchorEvent && typeof anchorEvent.clientX === 'number' && typeof anchorEvent.clientY === 'number') {
        const rect = wrap.getBoundingClientRect();
        relX = (anchorEvent.clientX - rect.left) / Math.max(1, rect.width);
        relY = (anchorEvent.clientY - rect.top) / Math.max(1, rect.height);
      }
      const oldW = cv.width * prevZoom;
      const oldH = cv.height * prevZoom;
      const worldX = (wrap.scrollLeft + relX * wrap.clientWidth) / Math.max(1, oldW);
      const worldY = (wrap.scrollTop + relY * wrap.clientHeight) / Math.max(1, oldH);
      state.zoom = z;
      updateCanvasViewport();
      const newW = cv.width * z;
      const newH = cv.height * z;
      wrap.scrollLeft = Math.max(0, worldX * newW - relX * wrap.clientWidth);
      wrap.scrollTop = Math.max(0, worldY * newH - relY * wrap.clientHeight);
    }

    function fitCanvasInView() {
      const wrap = $('bubbleCanvasWrap');
      const cv = $('bubbleCanvas');
      if (!wrap || !cv || !cv.width || !cv.height) return;
      const zx = wrap.clientWidth / cv.width;
      const zy = wrap.clientHeight / cv.height;
      setCanvasZoom(Math.max(0.25, Math.min(6, Math.min(zx, zy))));
      wrap.scrollLeft = 0;
      wrap.scrollTop = 0;
    }

    async function toggleCanvasFullscreen() {
      const wrap = $('bubbleCanvasWrap');
      if (!wrap || !document.fullscreenEnabled) return;
      try {
        if (document.fullscreenElement === wrap) await document.exitFullscreen();
        else await wrap.requestFullscreen();
      } catch {}
    }

    function pointFromCanvasEvent(e) {
      const cv = $('bubbleCanvas');
      if (!cv) return { x: 0, y: 0 };
      const rect = cv.getBoundingClientRect();
      const scaleX = cv.width / Math.max(1, rect.width);
      const scaleY = cv.height / Math.max(1, rect.height);
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    }

    function bubbleResizeHandleRadius() {
      const cfg = getDisplaySettings() || {};
      const size = Number(cfg.handleSize);
      return Number.isFinite(size) ? Math.max(2, Math.min(8, size)) : 4;
    }

    function bubbleResizeCursor(handle) {
      switch (String(handle || '')) {
        case 'n':
        case 's':
          return 'ns-resize';
        case 'e':
        case 'w':
          return 'ew-resize';
        case 'ne':
        case 'sw':
          return 'nesw-resize';
        case 'nw':
        case 'se':
          return 'nwse-resize';
        default:
          return 'grab';
      }
    }

    function bubbleResizeHandles(boxB) {
      const box = normalizeBbox(boxB);
      if (!box) return [];
      const cx = (box.x1 + box.x2) / 2;
      const cy = (box.y1 + box.y2) / 2;
      const r = bubbleResizeHandleRadius();
      return [
        { name: 'nw', x: box.x1, y: box.y1, r, cursor: bubbleResizeCursor('nw') },
        { name: 'n', x: cx, y: box.y1, r, cursor: bubbleResizeCursor('n') },
        { name: 'ne', x: box.x2, y: box.y1, r, cursor: bubbleResizeCursor('ne') },
        { name: 'e', x: box.x2, y: cy, r, cursor: bubbleResizeCursor('e') },
        { name: 'se', x: box.x2, y: box.y2, r, cursor: bubbleResizeCursor('se') },
        { name: 's', x: cx, y: box.y2, r, cursor: bubbleResizeCursor('s') },
        { name: 'sw', x: box.x1, y: box.y2, r, cursor: bubbleResizeCursor('sw') },
        { name: 'w', x: box.x1, y: cy, r, cursor: bubbleResizeCursor('w') },
      ];
    }

    function bubbleResizeHandleAtPoint(boxB, x, y) {
      for (const handle of bubbleResizeHandles(boxB)) {
        if (Math.hypot(x - handle.x, y - handle.y) <= handle.r + 3) return handle;
      }
      return null;
    }

    function resizeBubbleRectFromHandle(startBoxB, handleName, point) {
      const startBox = normalizeBbox(startBoxB);
      if (!startBox) return null;
      const p = point || { x: startBox.x2, y: startBox.y2 };
      const next = { x1: startBox.x1, y1: startBox.y1, x2: startBox.x2, y2: startBox.y2 };
      if (String(handleName || '').includes('w')) next.x1 = p.x;
      if (String(handleName || '').includes('e')) next.x2 = p.x;
      if (String(handleName || '').includes('n')) next.y1 = p.y;
      if (String(handleName || '').includes('s')) next.y2 = p.y;
      if (handleName === 'n' || handleName === 's') {
        next.x1 = startBox.x1;
        next.x2 = startBox.x2;
      }
      if (handleName === 'e' || handleName === 'w') {
        next.y1 = startBox.y1;
        next.y2 = startBox.y2;
      }
      return clampBboxToCanvas(next) || startBox;
    }

    function bubbleCanvasCursorForHit(hit, altKey = false) {
      if (hit?.onDelete) return 'pointer';
      if (hit?.onResize?.cursor) return hit.onResize.cursor;
      if (hit?.onLabel || hit?.bubble) return 'move';
      return altKey ? 'crosshair' : 'grab';
    }

    function setBubbleCanvasCursor(nextCursor) {
      const cv = $('bubbleCanvas');
      if (cv) cv.style.cursor = nextCursor || 'grab';
    }

    function findBubbleAtPoint(x, y) {
      const op = getSelectedOperation();
      const bubbles = selectedFileBubbles(op);
      if (!op) return { bubble: null, onLabel: false, onDelete: false, onResize: null };
      const selected = bubbles.find((b) => String(b?.id || '') === String(state.selectedCanvasBubbleId || ''));
      if (selected) {
        const sbox = normalizeBbox(selected?.bbox);
        const delRect = bubbleDeleteControlRect(sbox);
        if (delRect && x >= delRect.x1 && x <= delRect.x2 && y >= delRect.y1 && y <= delRect.y2) {
          return { bubble: selected, onLabel: false, onDelete: true, onResize: null };
        }
        const handle = bubbleResizeHandleAtPoint(sbox, x, y);
        if (handle) return { bubble: selected, onLabel: false, onDelete: false, onResize: handle };
      }
      for (let i = bubbles.length - 1; i >= 0; i -= 1) {
        const b = bubbles[i];
        const label = bubbleLabelPosition(b);
        if (label) {
          const d = Math.hypot(x - label.x, y - label.y);
          if (d <= label.r) return { bubble: b, onLabel: true, onDelete: false, onResize: null };
        }
      }
      for (let i = bubbles.length - 1; i >= 0; i -= 1) {
        const b = bubbles[i];
        const box = normalizeBbox(b?.bbox);
        if (!box) continue;
        if (x >= box.x1 && x <= box.x2 && y >= box.y1 && y <= box.y2) {
          return { bubble: b, onLabel: false, onDelete: false, onResize: null };
        }
      }
      return { bubble: null, onLabel: false, onDelete: false, onResize: null };
    }

    function drawBubbleCanvas() {
      const box = ensureCanvasReady();
      if (!box) return;
      const { cv, ctx } = box;
      const info = $('bubbleCanvasInfo');
      const display = getDisplaySettings() || {};
      const bgHex = cssThemeHex('--bg', '#0b1320');
      const textHex = cssThemeHex('--text', '#d2dceb');
      const accentHex = String(display.bubbleColor || cssThemeHex('--accent', '#4dafff'));
      const boxHex = String(display.boxColor || accentHex);
      const okHex = String(display.selectedColor || cssThemeHex('--ok', accentHex));
      const bubbleTextHex = String(display.bubbleTextColor || bgHex);
      const warnHex = cssThemeHex('--warn', '#ffd37a');
      const boxVisible = display.boxVisible !== false;
      const bubbleVisible = display.bubbleVisible !== false;
      const textVisible = display.textVisible !== false;
      const bubbleFill = display.bubbleFill !== false;
      const handleMode = ['hover', 'always', 'never'].includes(String(display.handleMode || ''))
        ? String(display.handleMode)
        : 'hover';
      const fontSize = Math.max(6, Math.min(36, Number(display.bubbleFontSize || 12)));
      ctx.clearRect(0, 0, cv.width, cv.height);
      if (state.image) ctx.drawImage(state.image, 0, 0, cv.width, cv.height);
      else {
        ctx.fillStyle = bgHex;
        ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.fillStyle = hexToRgba(textHex, 0.8);
        ctx.font = '14px sans-serif';
        ctx.fillText(tt('spacial.canvas.uploadHint.annotations', 'Upload drawing image to place annotations'), 14, 26);
      }
      const op = getSelectedOperation();
      const opFile = selectedOperationFile(op);
      const bubbles = selectedFileBubbles(op);
      const showBoxes = boxVisible;
      if (info) {
        const opName = op?.name || tt('spacial.canvas.noOp', 'No operation');
        const fileName = opFile?.name ? ` | ${tt('spacial.file.label', 'File')}: ${opFile.name}` : '';
        const sel = state.selectedCanvasBubbleId ? ` | ${tt('spacial.canvas.selected', 'Selected: {id}', { id: state.selectedCanvasBubbleId })}` : '';
        info.textContent = `${tt('spacial.canvas.instructions.annotations', 'Operation: {op}{selected}. Left-drag to pan, drag box or dots to resize, Alt+drag to draw, wheel to zoom, double-click OCR.', { op: opName, selected: sel })}${fileName}`;
      }
      if (op && Array.isArray(bubbles)) {
        bubbles.forEach((b, idx) => {
          const boxB = normalizeBbox(b?.bbox);
          if (!boxB) return;
          const isSel = String(b.id || '') === String(state.selectedCanvasBubbleId || '');
          if (showBoxes || isSel) {
            ctx.strokeStyle = isSel ? okHex : boxHex;
            ctx.lineWidth = isSel ? 3 : 2;
            ctx.strokeRect(boxB.x1, boxB.y1, boxB.x2 - boxB.x1, boxB.y2 - boxB.y1);
            if (boxVisible || isSel) {
              ctx.fillStyle = isSel ? hexToRgba(okHex, 0.08) : hexToRgba(boxHex, 0.06);
              ctx.fillRect(boxB.x1, boxB.y1, boxB.x2 - boxB.x1, boxB.y2 - boxB.y1);
            }
            const showHandles = isSel && handleMode !== 'never' && (
              handleMode === 'always'
              || String(state.hoverBubbleId || '') === String(b.id || '')
              || state.hoverOnResize
              || state.mode === 'resizeBox'
            );
            if (showHandles) {
              const delRect = bubbleDeleteControlRect(boxB);
              if (delRect) {
                ctx.fillStyle = hexToRgba(cssThemeHex('--danger', '#ff6a7f'), 0.92);
                ctx.fillRect(delRect.x1, delRect.y1, delRect.x2 - delRect.x1, delRect.y2 - delRect.y1);
                ctx.strokeStyle = hexToRgba(textHex, 0.92);
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.moveTo(delRect.x1 + 4, delRect.y1 + 4);
                ctx.lineTo(delRect.x2 - 4, delRect.y2 - 4);
                ctx.moveTo(delRect.x2 - 4, delRect.y1 + 4);
                ctx.lineTo(delRect.x1 + 4, delRect.y2 - 4);
                ctx.stroke();
              }
              for (const handle of bubbleResizeHandles(boxB)) {
                ctx.fillStyle = bgHex;
                ctx.beginPath();
                ctx.arc(handle.x, handle.y, handle.r + 1.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = okHex;
                ctx.beginPath();
                ctx.arc(handle.x, handle.y, handle.r, 0, Math.PI * 2);
                ctx.fill();
              }
            }
          }
          const label = bubbleLabelPosition(b);
          if (label && (bubbleVisible || textVisible)) {
            ctx.font = `bold ${fontSize}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            if (bubbleVisible) {
              if (bubbleFill) {
                ctx.fillStyle = isSel ? hexToRgba(okHex, 0.92) : hexToRgba(accentHex, 0.86);
                ctx.beginPath();
                ctx.arc(label.x, label.y, label.r, 0, Math.PI * 2);
                ctx.fill();
              }
              ctx.strokeStyle = isSel ? okHex : accentHex;
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.arc(label.x, label.y, label.r, 0, Math.PI * 2);
              ctx.stroke();
            }
            if (textVisible) {
              if (!bubbleVisible) {
                ctx.lineWidth = Math.max(2, Math.round(fontSize / 5));
                ctx.strokeStyle = hexToRgba('#ffffff', 0.96);
                ctx.strokeText(String(idx + 1), label.x, label.y);
              }
              ctx.fillStyle = bubbleTextHex;
              ctx.fillText(String(idx + 1), label.x, label.y);
            }
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
          }
        });
      }
      if (state.mode === 'draw' && state.rect) {
        const r = normalizeBbox(state.rect);
        if (r) {
          ctx.strokeStyle = warnHex;
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 4]);
          ctx.strokeRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
          ctx.setLineDash([]);
        }
      }
    }

    function setCanvasImageFromDataUrl(src) {
      state.imageSrc = String(src || '');
      state.image = null;
      if (!state.imageSrc) {
        drawBubbleCanvas();
        return;
      }
      const img = new Image();
      img.onload = () => {
        state.image = img;
        const cv = $('bubbleCanvas');
        if (cv) {
          cv.width = img.width;
          cv.height = img.height;
        }
        state.zoom = 1;
        updateCanvasViewport();
        setTimeout(() => fitCanvasInView(), 0);
        const op = getSelectedOperation();
        if (op && clampBubblesToCanvas(op)) {
          writeRoutePlan(state.routePlan);
          renderBubbleTable();
        }
        drawBubbleCanvas();
      };
      img.onerror = () => {
        state.image = null;
        state.zoom = 1;
        updateCanvasViewport();
        drawBubbleCanvas();
      };
      img.src = state.imageSrc;
    }

    function syncCanvasFromRoute() {
      const opFile = selectedOperationFile();
      const src = String(opFile?.dataUrl || '');
      if (src !== state.imageSrc) setCanvasImageFromDataUrl(src);
      else drawBubbleCanvas();
    }

    return {
      ensureCanvasReady,
      canvasImageBounds,
      clampBboxToCanvas,
      clampBubblesToCanvas,
      bubbleDeleteControlRect,
      updateCanvasViewport,
      setCanvasZoom,
      fitCanvasInView,
      toggleCanvasFullscreen,
      pointFromCanvasEvent,
      bubbleResizeHandleRadius,
      bubbleResizeCursor,
      bubbleResizeHandles,
      bubbleResizeHandleAtPoint,
      resizeBubbleRectFromHandle,
      bubbleCanvasCursorForHit,
      setBubbleCanvasCursor,
      findBubbleAtPoint,
      drawBubbleCanvas,
      setCanvasImageFromDataUrl,
      syncCanvasFromRoute,
    };
  }

  window.VMillSpacialCanvas = { createRuntime };
})();
