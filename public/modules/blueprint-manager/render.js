import { $, state, tt, str, getProductById, docsApi, setStatus } from './core.js';

function sendAgentDebugLog(payload) {
  void payload;
}

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function numText(value) {
  return value == null || value === '' || !Number.isFinite(Number(value)) ? '' : String(value);
}

function numValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function numView(value) {
  const n = numValue(value);
  if (n == null) return '';
  if (Math.abs(n) < 1e-12) return '0';
  return String(Number(n.toFixed(6)));
}

function calcDerivedLimits(row) {
  const nominal = numValue(row?.nominal);
  const lowerDev = numValue(row?.lowerDeviation);
  const upperDev = numValue(row?.upperDeviation);
  const lsl = numValue(row?.lsl);
  const usl = numValue(row?.usl);
  const min = nominal != null && lowerDev != null
    ? nominal + lowerDev
    : lsl;
  const max = nominal != null && upperDev != null
    ? nominal + upperDev
    : usl;
  const median = min != null && max != null
    ? (min + max) / 2
    : nominal;
  return { min, median, max };
}

function themeVar(name, fallback) {
  try {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  } catch {
    return fallback;
  }
}

function wrapDisplayRotation(angle) {
  const v = Number(angle);
  if (!Number.isFinite(v)) return 0;
  let norm = ((v % 360) + 360) % 360;
  if (norm > 180) norm -= 360;
  return norm;
}

function autoThumbCorrection(row) {
  const ocrRotation = Number(row?.ocrRotation ?? 0);
  if (!Number.isFinite(ocrRotation)) return 0;
  return wrapDisplayRotation((360 - ocrRotation) % 360);
}

function manualThumbRotation(row) {
  return wrapDisplayRotation(Number(row?.thumbnailRotation ?? 0) || 0);
}

function rotationOptionsHtml(selectedValue) {
  const selectedNum = wrapDisplayRotation(Number(selectedValue ?? 0) || 0);
  const selected = String(selectedNum);
  const options = [-180, -135, -90, -45, 0, 45, 90, 135, 180];
  const rows = options.map((angle) => {
    const label = angle > 0 ? `+${angle}°` : `${angle}°`;
    return `<option value="${angle}"${selected === String(angle) ? ' selected' : ''}>${label}</option>`;
  });
  if (!options.includes(selectedNum)) {
    const label = selectedNum > 0 ? `+${selectedNum}°` : `${selectedNum}°`;
    rows.unshift(`<option value="${selected}" selected>${label}</option>`);
  }
  return rows.join('');
}

function readThumbDisplaySettings() {
  const toInt = (id, fallback, min, max) => {
    const n = Number($(id)?.value);
    if (!Number.isFinite(n)) return fallback;
    return clamp(Math.round(n), min, max);
  };
  const listMax = toInt('bubbleDisplayThumbListMaxIn', 50, 24, 96);
  const listMin = Math.min(toInt('bubbleDisplayThumbListMinIn', 24, 16, 64), listMax);
  const detailMax = toInt('bubbleDisplayThumbDetailMaxIn', 176, 96, 320);
  const detailMin = Math.min(toInt('bubbleDisplayThumbDetailMinIn', 72, 48, 180), detailMax);
  return { listMax, listMin, detailMax, detailMin };
}

function thumbFrameSize(row, maxSize, minSize, angle = 0) {
  const box = row?.thumbnailBBox || row?.bbox || null;
  let x1 = Number(box?.x1);
  let y1 = Number(box?.y1);
  let x2 = Number(box?.x2);
  let y2 = Number(box?.y2);
  const looksNormalized = [x1, y1, x2, y2].every((v) => Number.isFinite(v) && v >= -0.02 && v <= 1.02);
  if (looksNormalized) {
    const doc = row?.documentId
      ? docsApi.productDocumentById(row.documentId, state.selectedProductId)
      : null;
    const srcW = Math.max(0, Number(doc?.imageWidth || 0));
    const srcH = Math.max(0, Number(doc?.imageHeight || 0));
    if (srcW > 0 && srcH > 0) {
      x1 *= srcW;
      y1 *= srcH;
      x2 *= srcW;
      y2 *= srcH;
    }
  }
  const width = Math.max(1, Math.abs((Number.isFinite(x2) ? x2 : 0) - (Number.isFinite(x1) ? x1 : 0)));
  const height = Math.max(1, Math.abs((Number.isFinite(y2) ? y2 : 0) - (Number.isFinite(y1) ? y1 : 0)));
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return { width: maxSize, height: maxSize };
  }
  const radians = (Number(angle || 0) * Math.PI) / 180;
  const cosV = Math.abs(Math.cos(radians));
  const sinV = Math.abs(Math.sin(radians));
  const rotatedWidth = (width * cosV) + (height * sinV);
  const rotatedHeight = (width * sinV) + (height * cosV);
  const longestSide = Math.max(rotatedWidth, rotatedHeight, 1);
  const fitScale = maxSize / longestSide;
  let frameWidth = Math.max(1, Math.round(rotatedWidth * fitScale));
  let frameHeight = Math.max(1, Math.round(rotatedHeight * fitScale));

  // Keep the exact bbox aspect ratio while allowing tiny thumbs
  // to scale up uniformly instead of fattening one side only.
  const shortestSide = Math.min(frameWidth, frameHeight);
  if (shortestSide < minSize && shortestSide > 0) {
    const uniformScale = minSize / shortestSide;
    frameWidth = Math.max(1, Math.round(frameWidth * uniformScale));
    frameHeight = Math.max(1, Math.round(frameHeight * uniformScale));
  }

  return {
    width: frameWidth,
    height: frameHeight,
  };
}

function currentDocuments() {
  return docsApi.listProductDocuments(state.selectedProductId);
}

function currentDocument() {
  return docsApi.productDocumentById(state.selectedDocId, state.selectedProductId) || currentDocuments()[0] || null;
}

function currentSelectedAnnotation() {
  return docsApi.productAnnotationById(state.selectedAnnId, state.selectedProductId) || null;
}

function currentAnnotations() {
  const docId = state.annScope === 'document' ? state.selectedDocId : '';
  if (state.annScope === 'document' && !str(docId)) return [];
  const search = str(state.annSearch).toLowerCase();
  return docsApi.listProductAnnotations(state.selectedProductId, docId).filter((row) => {
    if (!search) return true;
    const hay = [row.id, row.sourceBubbleId, row.name, row.characteristicId, row.instrument, row.method].join(' ').toLowerCase();
    return hay.includes(search);
  });
}

function currentPreviewAnnotations() {
  const doc = currentDocument();
  const docId = str(doc?.id || '');
  if (!docId) return [];
  return docsApi.listProductAnnotations(state.selectedProductId, docId);
}

const ANN_POPOVER_MIN_STORAGE_KEY = 'vmill-bm-ann-popover-minimized';

function loadStoredAnnPopoverMinimized() {
  try {
    return window.localStorage?.getItem(ANN_POPOVER_MIN_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function persistAnnPopoverMinimized(minimized) {
  try {
    window.localStorage?.setItem(ANN_POPOVER_MIN_STORAGE_KEY, minimized ? '1' : '0');
  } catch {}
}

const previewRuntime = {
  bound: false,
  zoom: 1,
  panX: 0,
  panY: 0,
  mode: 'idle',
  pointerId: null,
  startClientX: 0,
  startClientY: 0,
  startPanX: 0,
  startPanY: 0,
  activeAnnId: '',
  activeHandle: '',
  startBox: null,
  draftBox: null,
  lastDocKey: '',
  hoveredAnnId: '',
  popoverHideTimeout: null,
  popoverPointerInside: false,
  popoverFocusInside: false,
  createBoxStart: null,
  annPopoverMinimized: loadStoredAnnPopoverMinimized(),
  popoverAnchorAnnId: '',
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeEditableBbox(raw) {
  const x1 = Number(raw?.x1);
  const y1 = Number(raw?.y1);
  const x2 = Number(raw?.x2);
  const y2 = Number(raw?.y2);
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  const nx1 = Math.min(x1, x2);
  const ny1 = Math.min(y1, y2);
  const nx2 = Math.max(x1, x2);
  const ny2 = Math.max(y1, y2);
  if (Math.abs(nx2 - nx1) < 1e-6 || Math.abs(ny2 - ny1) < 1e-6) return null;
  return { x1: nx1, y1: ny1, x2: nx2, y2: ny2 };
}

function clampEditableBboxToSource(raw, srcW, srcH) {
  const box = normalizeEditableBbox(raw);
  if (!box) return null;
  const width = Math.max(1, Number(srcW || 1));
  const height = Math.max(1, Number(srcH || 1));
  let x1 = clamp(box.x1, 0, width);
  let y1 = clamp(box.y1, 0, height);
  let x2 = clamp(box.x2, 0, width);
  let y2 = clamp(box.y2, 0, height);
  if (x2 - x1 < 1) x2 = Math.min(width, x1 + 1);
  if (y2 - y1 < 1) y2 = Math.min(height, y1 + 1);
  return normalizeEditableBbox({ x1, y1, x2, y2 });
}

/** Annotation coords are stored vs doc.imageWidth/Height; trust decoded bitmap when metadata disagrees (e.g. after server downscale). */
function previewSourceDimensions(img, doc) {
  const imageW = Math.max(1, Number(img.naturalWidth || img.width || 1));
  const imageH = Math.max(1, Number(img.naturalHeight || img.height || 1));
  let srcW = Math.max(1, Number(doc?.imageWidth || 0) || imageW);
  let srcH = Math.max(1, Number(doc?.imageHeight || 0) || imageH);
  const relW = Math.abs(srcW - imageW) / Math.max(imageW, 1);
  const relH = Math.abs(srcH - imageH) / Math.max(imageH, 1);
  if (relW > 0.03 || relH > 0.03) {
    srcW = imageW;
    srcH = imageH;
  }
  return { imageW, imageH, srcW, srcH };
}

function previewMetrics() {
  const wrap = $('docPreviewWrap');
  const canvas = $('docOverlayCanvas');
  const img = $('docImagePreview');
  const doc = currentDocument();
  if (!wrap || !canvas || !img || !doc || img.hidden || !str(img.src)) return null;
  const canvasW = Math.max(1, Math.round(wrap.clientWidth || 0));
  const canvasH = Math.max(1, Math.round(wrap.clientHeight || 0));
  const { imageW, imageH, srcW, srcH } = previewSourceDimensions(img, doc);
  const baseScale = Math.min(canvasW / imageW, canvasH / imageH);
  const zoom = clamp(Number(previewRuntime.zoom || 1), 0.25, 6);
  const scale = baseScale * zoom;
  const drawW = imageW * scale;
  const drawH = imageH * scale;
  const maxPanX = Math.max(0, (drawW - canvasW) / 2);
  const maxPanY = Math.max(0, (drawH - canvasH) / 2);
  if (maxPanX <= 0) previewRuntime.panX = 0;
  if (maxPanY <= 0) previewRuntime.panY = 0;
  previewRuntime.panX = clamp(Number(previewRuntime.panX || 0), -maxPanX, maxPanX);
  previewRuntime.panY = clamp(Number(previewRuntime.panY || 0), -maxPanY, maxPanY);
  const offsetX = ((canvasW - drawW) / 2) + previewRuntime.panX;
  const offsetY = ((canvasH - drawH) / 2) + previewRuntime.panY;
  return {
    wrap,
    canvas,
    img,
    doc,
    canvasW,
    canvasH,
    imageW,
    imageH,
    srcW,
    srcH,
    baseScale,
    zoom,
    scale,
    drawW,
    drawH,
    offsetX,
    offsetY,
  };
}

function sourceToCanvasPoint(x, y, metrics) {
  const m = metrics || previewMetrics();
  if (!m) return null;
  return {
    x: m.offsetX + (Number(x || 0) / m.srcW) * m.drawW,
    y: m.offsetY + (Number(y || 0) / m.srcH) * m.drawH,
  };
}

function canvasToSourcePoint(x, y, metrics) {
  const m = metrics || previewMetrics();
  if (!m) return null;
  return {
    x: ((Number(x || 0) - m.offsetX) / Math.max(1e-6, m.drawW)) * m.srcW,
    y: ((Number(y || 0) - m.offsetY) / Math.max(1e-6, m.drawH)) * m.srcH,
  };
}

function canvasEventPoint(event, canvas) {
  const target = canvas || $('docOverlayCanvas');
  if (!target) return { x: 0, y: 0 };
  const rect = target.getBoundingClientRect();
  const sx = target.width / Math.max(1, rect.width);
  const sy = target.height / Math.max(1, rect.height);
  return {
    x: (event.clientX - rect.left) * sx,
    y: (event.clientY - rect.top) * sy,
  };
}

function selectedOverlayBox(metrics) {
  const rows = currentPreviewAnnotations();
  const selected = rows.find((row) => String(row?.id || '') === String(state.selectedAnnId || ''));
  if (!selected) return null;
  const box = previewRowBoxInSource(selected, metrics);
  if (!box) return null;
  return { row: selected, box };
}

function previewHandleRadius() {
  const cfg = readDisplaySettingsFromUi();
  const size = Number(cfg?.handleSize);
  return Number.isFinite(size) ? clamp(size, 2, 8) + 1.5 : 5;
}

function overlayResizeHandles(box, metrics) {
  const p1 = sourceToCanvasPoint(box.x1, box.y1, metrics);
  const p2 = sourceToCanvasPoint(box.x2, box.y2, metrics);
  if (!p1 || !p2) return [];
  const cx = (p1.x + p2.x) / 2;
  const cy = (p1.y + p2.y) / 2;
  const r = previewHandleRadius();
  return [
    { name: 'nw', x: p1.x, y: p1.y, r },
    { name: 'n', x: cx, y: p1.y, r },
    { name: 'ne', x: p2.x, y: p1.y, r },
    { name: 'e', x: p2.x, y: cy, r },
    { name: 'se', x: p2.x, y: p2.y, r },
    { name: 's', x: cx, y: p2.y, r },
    { name: 'sw', x: p1.x, y: p2.y, r },
    { name: 'w', x: p1.x, y: cy, r },
  ];
}

function previewRowBoxInSource(row, metrics) {
  if (!row) return null;
  return normalizeOverlayBbox(row?.bbox, metrics?.srcW || 0, metrics?.srcH || 0, metrics?.doc);
}

function bubbleCenterAndRadius(row, box, metrics) {
  if (!box || !metrics) return null;
  const p1 = sourceToCanvasPoint(box.x1, box.y1, metrics);
  const p2 = sourceToCanvasPoint(box.x2, box.y2, metrics);
  if (!p1 || !p2) return null;
  const x = Math.min(p1.x, p2.x);
  const y = Math.min(p1.y, p2.y);
  const w = Math.abs(p2.x - p1.x);
  const h = Math.abs(p2.y - p1.y);
  const cfg = readDisplaySettingsFromUi();
  const radius = Number(cfg?.bubbleSize ?? 14);
  const defaultOff = { x: -((w / 2) + (radius * 1.2)), y: 0 };
  const rawOff = row?.bubbleOffset && typeof row.bubbleOffset === 'object'
    ? { x: Number(row.bubbleOffset.x || 0), y: Number(row.bubbleOffset.y || 0) }
    : defaultOff;
  return {
    lx: x + w / 2 + rawOff.x,
    ly: y + h / 2 + rawOff.y,
    radius: Math.max(radius, 10),
  };
}

function hitPreviewBox(point, metrics) {
  const rows = currentPreviewAnnotations();
  if (!rows.length) return { row: null, handle: '', onBubble: false };
  const selected = selectedOverlayBox(metrics);
  if (selected) {
    const handles = overlayResizeHandles(selected.box, metrics);
    const hitHandle = handles.find((h) => Math.hypot(point.x - h.x, point.y - h.y) <= h.r + 3);
    if (hitHandle) return { row: selected.row, handle: hitHandle.name, onBubble: false };
    const bubble = bubbleCenterAndRadius(selected.row, selected.box, metrics);
    if (bubble && Math.hypot(point.x - bubble.lx, point.y - bubble.ly) <= bubble.radius + 2) {
      return { row: selected.row, handle: '', onBubble: true };
    }
  }
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    const box = previewRowBoxInSource(row, metrics);
    if (!box) continue;
    const bubble = bubbleCenterAndRadius(row, box, metrics);
    if (bubble && Math.hypot(point.x - bubble.lx, point.y - bubble.ly) <= bubble.radius + 2) {
      return { row, handle: '', onBubble: true };
    }
  }
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    const box = previewRowBoxInSource(row, metrics);
    if (!box) continue;
    const p1 = sourceToCanvasPoint(box.x1, box.y1, metrics);
    const p2 = sourceToCanvasPoint(box.x2, box.y2, metrics);
    if (!p1 || !p2) continue;
    const x1 = Math.min(p1.x, p2.x);
    const y1 = Math.min(p1.y, p2.y);
    const x2 = Math.max(p1.x, p2.x);
    const y2 = Math.max(p1.y, p2.y);
    if (point.x >= x1 && point.x <= x2 && point.y >= y1 && point.y <= y2) {
      return { row, handle: '', onBubble: false };
    }
  }
  return { row: null, handle: '', onBubble: false };
}

function resizeSourceBoxFromHandle(startBox, handle, point, metrics) {
  const srcPoint = canvasToSourcePoint(point.x, point.y, metrics);
  if (!srcPoint) return startBox;
  const next = { ...startBox };
  const h = String(handle || '');
  if (h.includes('w')) next.x1 = srcPoint.x;
  if (h.includes('e')) next.x2 = srcPoint.x;
  if (h.includes('n')) next.y1 = srcPoint.y;
  if (h.includes('s')) next.y2 = srcPoint.y;
  if (h === 'n' || h === 's') {
    next.x1 = startBox.x1;
    next.x2 = startBox.x2;
  }
  if (h === 'e' || h === 'w') {
    next.y1 = startBox.y1;
    next.y2 = startBox.y2;
  }
  return clampEditableBboxToSource(next, metrics?.srcW || 1, metrics?.srcH || 1) || startBox;
}

function readDisplaySettingsFromUi() {
  const toNum = (id, fallback) => {
    const v = Number($(id)?.value);
    return Number.isFinite(v) ? v : fallback;
  };
  return {
    boxColor: $('bubbleDisplayBoxColorIn')?.value || '#ff6b6b',
    bubbleColor: $('bubbleDisplayColorIn')?.value || '#4dafff',
    selectedColor: $('bubbleDisplaySelectedColorIn')?.value || '#00ff8f',
    bubbleTextColor: $('bubbleDisplayTextColorIn')?.value || '#0f1724',
    bubbleSize: clamp(toNum('bubbleDisplaySizeIn', 14), 6, 44),
    bubbleFontSize: clamp(toNum('bubbleDisplayFontSizeIn', 12), 6, 36),
    boxVisible: !!$('bubbleDisplayShowBoxChk')?.checked,
    bubbleVisible: !!$('bubbleDisplayShowBubbleChk')?.checked,
    textVisible: !!$('bubbleDisplayShowTextChk')?.checked,
    bubbleFill: !!$('bubbleDisplayBubbleFillChk')?.checked,
  };
}

function normalizeOverlayBbox(raw, srcW, srcH, doc = null) {
  const x1 = Number(raw?.x1 ?? raw?.x ?? raw?.left);
  const y1 = Number(raw?.y1 ?? raw?.y ?? raw?.top);
  const x2Direct = Number(raw?.x2 ?? raw?.right);
  const y2Direct = Number(raw?.y2 ?? raw?.bottom);
  const width = Number(raw?.width);
  const height = Number(raw?.height);
  const x2 = Number.isFinite(x2Direct) ? x2Direct : (Number.isFinite(x1) && Number.isFinite(width) ? x1 + width : NaN);
  const y2 = Number.isFinite(y2Direct) ? y2Direct : (Number.isFinite(y1) && Number.isFinite(height) ? y1 + height : NaN);
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  let nx1 = Math.min(x1, x2);
  let ny1 = Math.min(y1, y2);
  let nx2 = Math.max(x1, x2);
  let ny2 = Math.max(y1, y2);
  const looksNormalized = [nx1, ny1, nx2, ny2].every((v) => v >= -0.02 && v <= 1.02);
  if (looksNormalized && srcW > 0 && srcH > 0) {
    nx1 *= srcW;
    ny1 *= srcH;
    nx2 *= srcW;
    ny2 *= srcH;
  } else if (!looksNormalized && doc) {
    const metaW = Math.max(0, Number(doc?.imageWidth || 0));
    const metaH = Math.max(0, Number(doc?.imageHeight || 0));
    if (metaW > 0 && metaH > 0 && srcW > 0 && srcH > 0) {
      const rw = Math.abs(srcW - metaW) / Math.max(metaW, 1);
      const rh = Math.abs(srcH - metaH) / Math.max(metaH, 1);
      if (rw > 0.03 || rh > 0.03) {
        const sx = srcW / metaW;
        const sy = srcH / metaH;
        nx1 *= sx;
        ny1 *= sy;
        nx2 *= sx;
        ny2 *= sy;
      }
    }
  }
  if (Math.abs(nx2 - nx1) < 1e-6 || Math.abs(ny2 - ny1) < 1e-6) return null;
  return { x1: nx1, y1: ny1, x2: nx2, y2: ny2 };
}

export function renderPreviewOverlay() {
  const m = previewMetrics();
  const canvas = $('docOverlayCanvas');
  const img = $('docImagePreview');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const width = Math.max(1, Math.round(m?.canvasW || canvas.width || 1));
  const height = Math.max(1, Math.round(m?.canvasH || canvas.height || 1));
  canvas.width = width;
  canvas.height = height;
  ctx.clearRect(0, 0, width, height);
  if (!m) {
    if (img) {
      img.style.position = '';
      img.style.left = '';
      img.style.top = '';
      img.style.width = '';
      img.style.height = '';
      img.style.maxWidth = '';
      img.style.maxHeight = '';
      img.style.objectFit = '';
      img.style.pointerEvents = '';
    }
    canvas.hidden = true;
    renderSettingsLivePreview();
    return;
  }
  canvas.hidden = false;

  const drawW = m.drawW;
  const drawH = m.drawH;
  const offsetX = m.offsetX;
  const offsetY = m.offsetY;
  const srcW = m.srcW;
  const srcH = m.srcH;
  if (img && !img.hidden) {
    img.style.position = 'absolute';
    img.style.left = `${offsetX}px`;
    img.style.top = `${offsetY}px`;
    img.style.width = `${drawW}px`;
    img.style.height = `${drawH}px`;
    img.style.maxWidth = 'none';
    img.style.maxHeight = 'none';
    img.style.objectFit = 'fill';
    img.style.pointerEvents = 'none';
  }
  const cfg = readDisplaySettingsFromUi();
  const handleMode = ['hover', 'always', 'never'].includes(String(cfg?.handleMode || ''))
    ? String(cfg.handleMode)
    : 'hover';
  const selectedId = String(state.selectedAnnId || '');
  const activeId = String(previewRuntime.activeAnnId || '');
  const docZoomResetBtn = $('docZoomResetBtn');
  if (docZoomResetBtn) docZoomResetBtn.textContent = `${Math.round((Number(previewRuntime.zoom || 1)) * 100)}%`;
  const info = $('docCanvasInfo');
  if (info) {
    info.textContent = tt(
      'blueprint.preview.controls',
      `Drawings mode (${state.previewPickerMode === 'box' ? 'box pick' : 'point pick'}): drag the number circle (bubble) to move it; drag the red box to move the zone; drag corner pins to resize; wheel to zoom; right-click to switch picker.`,
    );
  }
  const hoveredId = String(previewRuntime.hoveredAnnId || '');
  const rows = currentPreviewAnnotations();
  rows.forEach((row, idx) => {
    const draftMatch = String(row?.id || '') === activeId && previewRuntime.draftBox;
    const box = draftMatch ? normalizeEditableBbox(previewRuntime.draftBox) : normalizeOverlayBbox(row?.bbox, srcW, srcH);
    if (!box) return;
    const isSel = String(row?.id || '') === selectedId;
    const isHovered = String(row?.id || '') === hoveredId;
    const stroke = isSel ? cfg.selectedColor : cfg.boxColor;
    const bubbleColor = isSel ? cfg.selectedColor : cfg.bubbleColor;

    const x = offsetX + (box.x1 / srcW) * drawW;
    const y = offsetY + (box.y1 / srcH) * drawH;
    const w = ((box.x2 - box.x1) / srcW) * drawW;
    const h = ((box.y2 - box.y1) / srcH) * drawH;
    if (cfg.boxVisible || isSel) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = isSel ? 2.6 : 1.8;
      ctx.strokeRect(x, y, w, h);
    }

    const showHandles = isSel && handleMode !== 'never';
    if (showHandles) {
      const handles = overlayResizeHandles(box, m);
      for (const handle of handles) {
        ctx.fillStyle = themeVar('--vm-theme-panel-2', '#0f1724');
        ctx.beginPath();
        ctx.arc(handle.x, handle.y, handle.r + 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = cfg.selectedColor || '#00ff8f';
        ctx.beginPath();
        ctx.arc(handle.x, handle.y, handle.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const label = String(row?.sourceBubbleId || row?.id || idx + 1);
    const radius = cfg.bubbleSize;
    const defaultOff = { x: -((w / 2) + (radius * 1.2)), y: 0 };
    const isActiveBubbleDrag = String(row?.id || '') === String(previewRuntime.activeAnnId || '') && previewRuntime.draftBubbleOffset;
    const rawOff = isActiveBubbleDrag
      ? { x: Number(previewRuntime.draftBubbleOffset.x || 0), y: Number(previewRuntime.draftBubbleOffset.y || 0) }
      : (row?.bubbleOffset && typeof row.bubbleOffset === 'object'
          ? { x: Number(row.bubbleOffset.x || 0), y: Number(row.bubbleOffset.y || 0) }
          : defaultOff);
    let lx = x + (w / 2) + rawOff.x;
    let ly = y + (h / 2) + rawOff.y;
    lx = clamp(lx, offsetX + radius, offsetX + drawW - radius);
    ly = clamp(ly, offsetY + radius, offsetY + drawH - radius);

    if (cfg.bubbleVisible) {
      if (cfg.bubbleFill) {
        ctx.fillStyle = `${bubbleColor}cc`;
        ctx.beginPath();
        ctx.arc(lx, ly, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = bubbleColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(lx, ly, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (cfg.textVisible) {
      ctx.font = `700 ${cfg.bubbleFontSize}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (!cfg.bubbleVisible) {
        ctx.lineWidth = Math.max(2, Math.round(cfg.bubbleFontSize / 4));
        ctx.strokeStyle = themeVar('--vm-theme-text', '#ffffff');
        ctx.strokeText(label, lx, ly);
      }
      ctx.fillStyle = cfg.bubbleTextColor;
      ctx.fillText(label, lx, ly);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
  });
  const hid = String(previewRuntime.hoveredAnnId || '');
  const sid = String(state.selectedAnnId || '');
  if ((hid || sid) && m) {
    const popRow = sid
      ? rows.find((r) => String(r?.id || '') === sid)
      : (hid ? rows.find((r) => String(r?.id || '') === hid) : null);
    if (popRow) {
      updateAnnPopover(popRow, m);
      cancelPopoverHide();
    }
  }
  if (previewRuntime.mode === 'createBox' && previewRuntime.draftBox) {
    const box = normalizeEditableBbox(previewRuntime.draftBox);
    if (box) {
      const x = offsetX + (box.x1 / srcW) * drawW;
      const y = offsetY + (box.y1 / srcH) * drawH;
      const w = ((box.x2 - box.x1) / srcW) * drawW;
      const h = ((box.y2 - box.y1) / srcH) * drawH;
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = cfg.selectedColor || '#00ff8f';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
      ctx.fillStyle = `${cfg.selectedColor || '#00ff8f'}22`;
      ctx.fillRect(x, y, w, h);
    }
  }
  renderSettingsLivePreview();
}

export function renderSettingsLivePreview() {
  const modal = $('drawingSettingsModal');
  const wrap = $('drawingSettingsPreviewWrap');
  const canvas = $('drawingSettingsPreviewCanvas');
  const empty = $('drawingSettingsPreviewEmpty');
  const img = $('docImagePreview');
  const doc = currentDocument();
  if (!modal || modal.hidden || !wrap || !canvas || !empty || !img) return;
  const hasImage = !img.hidden && !!str(img.src);
  if (!doc || !hasImage) {
    empty.hidden = false;
    canvas.hidden = true;
    return;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const width = Math.max(1, Math.round(wrap.clientWidth || 0));
  const height = Math.max(1, Math.round(wrap.clientHeight || 0));
  canvas.width = width;
  canvas.height = height;
  canvas.hidden = false;
  empty.hidden = true;

  const { imageW, imageH, srcW, srcH } = previewSourceDimensions(img, doc);
  const scale = Math.min(width / imageW, height / imageH);
  const drawW = imageW * scale;
  const drawH = imageH * scale;
  const offsetX = (width - drawW) / 2;
  const offsetY = (height - drawH) / 2;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = themeVar('--vm-theme-surface', '#ffffff');
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
  const cfg = readDisplaySettingsFromUi();
  const rows = currentPreviewAnnotations();
  const selectedId = String(state.selectedAnnId || '');
  rows.forEach((row, idx) => {
    const box = normalizeOverlayBbox(row?.bbox, srcW, srcH, doc);
    if (!box) return;
    const isSel = String(row?.id || '') === selectedId;
    const stroke = isSel ? cfg.selectedColor : cfg.boxColor;
    const bubbleColor = isSel ? cfg.selectedColor : cfg.bubbleColor;

    const x = offsetX + (box.x1 / srcW) * drawW;
    const y = offsetY + (box.y1 / srcH) * drawH;
    const w = ((box.x2 - box.x1) / srcW) * drawW;
    const h = ((box.y2 - box.y1) / srcH) * drawH;
    if (cfg.boxVisible || isSel) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = isSel ? 2.6 : 1.8;
      ctx.strokeRect(x, y, w, h);
    }

    const label = String(row?.sourceBubbleId || row?.id || idx + 1);
    const radius = cfg.bubbleSize;
    const defaultOff = h > w * 1.15
      ? { x: -((w / 2) + (radius * 1.15)), y: 0 }
      : { x: (Math.min(w * 0.2, radius * 1.1)) - (w / 2), y: -((h / 2) + (radius * 0.45)) };
    const rawOff = row?.bubbleOffset && typeof row.bubbleOffset === 'object'
      ? { x: Number(row.bubbleOffset.x || 0), y: Number(row.bubbleOffset.y || 0) }
      : defaultOff;
    let lx = x + (w / 2) + rawOff.x;
    let ly = y + (h / 2) + rawOff.y;
    lx = clamp(lx, offsetX + radius, offsetX + drawW - radius);
    ly = clamp(ly, offsetY + radius, offsetY + drawH - radius);

    if (cfg.bubbleVisible) {
      if (cfg.bubbleFill) {
        ctx.fillStyle = `${bubbleColor}cc`;
        ctx.beginPath();
        ctx.arc(lx, ly, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = bubbleColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(lx, ly, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (cfg.textVisible) {
      ctx.font = `700 ${cfg.bubbleFontSize}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (!cfg.bubbleVisible) {
        ctx.lineWidth = Math.max(2, Math.round(cfg.bubbleFontSize / 4));
        ctx.strokeStyle = themeVar('--vm-theme-text', '#ffffff');
        ctx.strokeText(label, lx, ly);
      }
      ctx.fillStyle = cfg.bubbleTextColor;
      ctx.fillText(label, lx, ly);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
  });
}

export function syncSelection() {
  const docs = currentDocuments();
  if (!docs.some((row) => String(row.id || '') === String(state.selectedDocId || ''))) {
    state.selectedDocId = docs[0]?.id || '';
  }
}

export function writeDocumentToInputs(doc = null) {
  const current = doc || currentDocument();
  $('docNameIn').value = current?.name || '';
  $('docRevisionIn').value = current?.revision || '';
  $('docNotesIn').value = current?.notes || '';
}

export function renderProducts(products) {
  const sel = $('productSel');
  if (!sel) return;
  const current = String(state.selectedProductId || '');
  sel.innerHTML = '';
  if (!products.length) {
    sel.innerHTML = `<option value="">${tt('blueprint.noProducts', 'No products')}</option>`;
    return;
  }
  for (const product of products) {
    const opt = document.createElement('option');
    opt.value = String(product.id || '');
    opt.textContent = `${product.code || '--'} - ${product.name || 'Product'}`;
    if (opt.value === current) opt.selected = true;
    sel.appendChild(opt);
  }
}

export function renderDocuments() {
  syncSelection();
  const docs = currentDocuments();
  const docLinkCounts = new Map();
  for (const link of docsApi.listOperationAnnotationLinks({ productId: state.selectedProductId })) {
    const key = String(link.productDocumentId || '');
    if (!key) continue;
    docLinkCounts.set(key, Number(docLinkCounts.get(key) || 0) + 1);
  }
  const sel = $('docSel');
  if (sel) {
    sel.innerHTML = docs.length
      ? docs.map((doc) => `<option value="${esc(doc.id)}" ${String(doc.id) === String(state.selectedDocId) ? 'selected' : ''}>${esc(doc.name || 'Document')}</option>`).join('')
      : `<option value="">${esc(tt('blueprint.noDocs', 'No documents yet'))}</option>`;
  }
  const list = $('docList');
  if (list) {
    list.innerHTML = docs.length ? docs.map((doc) => {
      const annCount = docsApi.listProductAnnotations(state.selectedProductId, doc.id).length;
      const linkCount = Number(docLinkCounts.get(String(doc.id || '')) || 0);
      return `
        <article class="docCard ${String(doc.id) === String(state.selectedDocId) ? 'sel' : ''}" data-doc-card="${esc(doc.id)}">
          <div class="docHead">
            <strong>${esc(doc.name || 'Document')}</strong>
            <span class="chip">${esc(doc.mime?.includes('pdf') ? 'PDF' : 'Image')}</span>
          </div>
          <div class="docMeta">${esc(doc.revision ? `Rev ${doc.revision} | ` : '')}${esc(`${annCount} annotation(s) | ${linkCount} link(s)`)}</div>
          <div class="docMeta mono">${esc(doc.id)}</div>
        </article>
      `;
    }).join('') : `<div class="empty">${esc(tt('blueprint.noDocsHint', 'Upload one or more blueprint documents for this product.'))}</div>`;
  }
  writeDocumentToInputs();
  renderPreview();
}

export function renderPreview() {
  const doc = currentDocument();
  const img = $('docImagePreview');
  const frame = $('docPdfPreview');
  const empty = $('docPreviewEmpty');
  const canvas = $('docOverlayCanvas');
  const typeChip = $('docTypeChip');
  const statsChip = $('docStatsChip');
  if (!img || !frame || !empty || !typeChip || !statsChip) return;
  const annCount = doc ? docsApi.listProductAnnotations(state.selectedProductId, doc.id).length : 0;
  const previewState = doc
    ? (doc.previewDataUrl
      ? tt('blueprint.previewReady', 'preview ready')
      : (doc.mime?.includes('pdf') ? tt('blueprint.previewNeeded', 'preview needed') : tt('blueprint.imageReady', 'image ready')))
    : tt('blueprint.noPreview', 'no preview');
  statsChip.textContent = `${annCount} ${tt(annCount === 1 ? 'blueprint.annotationSingular' : 'blueprint.annotationPlural', annCount === 1 ? 'annotation' : 'annotations')} | ${previewState}`;
  const imageUrl = doc?.previewDataUrl || doc?.dataUrl || '';
  if (!doc || (!doc.dataUrl && !imageUrl)) {
    previewRuntime.mode = 'idle';
    previewRuntime.draftBox = null;
    previewRuntime.activeAnnId = '';
    previewRuntime.activeHandle = '';
    previewRuntime.lastDocKey = '';
    previewRuntime.panX = 0;
    previewRuntime.panY = 0;
    previewRuntime.zoom = 1;
    clearAnnPopover(true);
    img.hidden = true;
    frame.hidden = true;
    if (canvas) canvas.hidden = true;
    empty.hidden = false;
    typeChip.textContent = tt('blueprint.noDocument', 'No document');
    return;
  }
  typeChip.textContent = doc.mime?.includes('pdf')
    ? (doc.previewDataUrl ? tt('blueprint.pdfPreviewReady', 'PDF document | OCR preview ready') : tt('blueprint.pdfDocument', 'PDF document'))
    : tt('blueprint.imageDocument', 'Image document');
  const docKey = `${String(doc?.id || '')}|${String(imageUrl || '')}`;
  if (docKey !== previewRuntime.lastDocKey) {
    previewRuntime.lastDocKey = docKey;
    previewRuntime.panX = 0;
    previewRuntime.panY = 0;
    previewRuntime.zoom = 1;
    previewRuntime.mode = 'idle';
    previewRuntime.draftBox = null;
    previewRuntime.activeAnnId = '';
    previewRuntime.activeHandle = '';
    clearAnnPopover(true);
  }
  if (doc.mime?.includes('pdf') && !doc.previewDataUrl) {
    frame.src = doc.dataUrl;
    frame.hidden = false;
    img.hidden = true;
    if (canvas) canvas.hidden = true;
  } else {
    img.onload = () => renderPreviewOverlay();
    img.src = imageUrl;
    img.hidden = false;
    frame.hidden = true;
    if (canvas) canvas.hidden = false;
  }
  empty.hidden = true;
  setTimeout(() => renderPreviewOverlay(), 0);
}

function setPreviewZoom(nextZoom, anchorEvent = null) {
  const m = previewMetrics();
  if (!m) return;
  const prev = clamp(Number(previewRuntime.zoom || 1), 0.25, 6);
  const next = clamp(Number(nextZoom || 1), 0.25, 6);
  if (Math.abs(next - prev) < 1e-4) return;
  let relX = 0.5;
  let relY = 0.5;
  if (anchorEvent && typeof anchorEvent.clientX === 'number' && typeof anchorEvent.clientY === 'number') {
    const rect = m.canvas.getBoundingClientRect();
    relX = clamp((anchorEvent.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    relY = clamp((anchorEvent.clientY - rect.top) / Math.max(1, rect.height), 0, 1);
  }
  const worldX = (relX * m.canvasW - m.offsetX) / Math.max(1e-6, m.drawW);
  const worldY = (relY * m.canvasH - m.offsetY) / Math.max(1e-6, m.drawH);
  previewRuntime.zoom = next;
  const n = previewMetrics();
  if (n) {
    const targetX = worldX * n.drawW + n.offsetX;
    const targetY = worldY * n.drawH + n.offsetY;
    previewRuntime.panX += (relX * n.canvasW) - targetX;
    previewRuntime.panY += (relY * n.canvasH) - targetY;
  }
  renderPreviewOverlay();
}

function fitPreviewInView() {
  previewRuntime.zoom = 1;
  previewRuntime.panX = 0;
  previewRuntime.panY = 0;
  renderPreviewOverlay();
}

function saveOverlayDraft() {
  const annId = String(previewRuntime.activeAnnId || '');
  const box = normalizeEditableBbox(previewRuntime.draftBox);
  if (!annId || !box) return false;
  const current = docsApi.productAnnotationById(annId, state.selectedProductId);
  if (!current) return false;
  const m = previewMetrics();
  const srcW = Math.max(0, Number(m?.srcW || 0));
  const srcH = Math.max(0, Number(m?.srcH || 0));
  const normalizedBox = srcW > 0 && srcH > 0
    ? normalizeEditableBbox({
        x1: box.x1 / srcW,
        y1: box.y1 / srcH,
        x2: box.x2 / srcW,
        y2: box.y2 / srcH,
      })
    : box;
  docsApi.upsertProductAnnotation({
    ...current,
    bbox: normalizedBox || box,
    coordSpace: 'normalized',
  });
  try {
    window.dispatchEvent(new CustomEvent('vmill:refresh-annotation-thumbnail', { detail: { id: annId, delayMs: 1000 } }));
  } catch {}
  setStatus(tt('blueprint.annotationUpdated', `Updated annotation ${annId}.`));
  return true;
}

function saveOverlayBubbleOffset() {
  const annId = String(previewRuntime.activeAnnId || '');
  const off = previewRuntime.draftBubbleOffset;
  if (!annId || !off) return false;
  const current = docsApi.productAnnotationById(annId, state.selectedProductId);
  if (!current) return false;
  docsApi.upsertProductAnnotation({
    ...current,
    bubbleOffset: { x: Number(off.x || 0), y: Number(off.y || 0) },
    bubbleOffsetSpace: 'canvas',
  });
  setStatus(tt('blueprint.bubbleMoved', `Moved bubble for ${annId}.`));
  return true;
}

export function updateAnnPopover(row, metrics) {
  const pop = $('annOverlayPopover');
  const headEl = pop?.querySelector('.annOverlayPopoverHead');
  const bodyEl = pop?.querySelector('.annOverlayPopoverBody');
  if (!pop || !headEl || !bodyEl) return;
  if (!row || !metrics) {
    pop.hidden = true;
    return;
  }
  const box = normalizeOverlayBbox(row?.bbox, metrics.srcW, metrics.srcH, metrics.doc);
  if (!box) {
    pop.hidden = true;
    return;
  }
  const canvas = $('docOverlayCanvas');
  const wrap = $('docPreviewWrap');
  if (!canvas || !wrap) return;
  const x = metrics.offsetX + (box.x1 / metrics.srcW) * metrics.drawW;
  const y = metrics.offsetY + (box.y1 / metrics.srcH) * metrics.drawH;
  const w = ((box.x2 - box.x1) / metrics.srcW) * metrics.drawW;
  const h = ((box.y2 - box.y1) / metrics.srcH) * metrics.drawH;
  const scaleX = canvas.clientWidth / Math.max(1, canvas.width);
  const scaleY = canvas.clientHeight / Math.max(1, canvas.height);
  const wrapRect = wrap.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  previewRuntime.popoverAnchorAnnId = String(row?.id || '');

  const loN = numValue(row?.lowerDeviation);
  const hiN = numValue(row?.upperDeviation);
  const lslN = numValue(row?.lsl);
  const uslN = numValue(row?.usl);
  const tolInverted = loN != null && hiN != null && hiN < loN;
  const limitsInverted = lslN != null && uslN != null && uslN < lslN;
  const tolAlertText = esc(tt(
    'blueprint.tolInvertedHint',
    'Max tolerance is smaller than min (limits may be invalid).',
  ));
  const derivedPop = calcDerivedLimits(row);
  const medianStr = numView(derivedPop.median);
  const medianRow = medianStr
    ? `<div class="annPopoverMedianRow" title="${esc(tt('blueprint.medianHint', 'Mid-point of LSL–USL (same as nominal after tolerance sync).'))}">
        <span class="annPopoverMedianLab">${esc(tt('blueprint.medianShort', 'Median'))}</span>
        <span class="annPopoverMedianVal">${esc(medianStr)}</span>
      </div>`
    : '';

  const minimized = !!previewRuntime.annPopoverMinimized;

  const annId = esc(String(row?.id || ''));
  const rawName = String(row?.name ?? '');
  const name = esc(rawName);
  const nominal = esc(String(row?.nominal ?? ''));
  const lowerDevStr = esc(numText(row?.lowerDeviation));
  const upperDevStr = esc(numText(row?.upperDeviation));
  const nomRead = esc(numView(row?.nominal) || '—');
  const maybeRadius = (rawName === '61' || rawName === '62')
    ? ` <span class="annPopoverHint">(${tt('blueprint.radiusHint', rawName === '61' ? 'R1?' : 'R2?')})</span>`
    : '';
  const titleText = esc(`#${row?.sourceBubbleId ?? row?.id ?? ''}`);
  const delTitle = esc(tt('blueprint.deleteAnnotation', 'Delete this annotation'));
  const minTitle = esc(tt('blueprint.popoverMinimize', 'Minimize'));
  const expTitle = esc(tt('blueprint.popoverExpand', 'Expand'));
  const rotateOptionsHtml = `
        <option value="-180">-180°</option>
        <option value="-135">-135°</option>
        <option value="-90">-90°</option>
        <option value="-45">-45°</option>
        <option value="0">0°</option>
        <option value="45">+45°</option>
        <option value="90">+90°</option>
        <option value="135">+135°</option>
        <option value="180">+180°</option>`;

  pop.classList.toggle('annOverlayPopover--min', minimized);

  if (minimized) {
    headEl.innerHTML = `
    <span class="annOverlayPopoverTitle annPopoverMiniId">${titleText}</span>
    <span class="annPopoverMiniNom" data-ann-popover-expand role="button" tabindex="0" title="${expTitle}" aria-label="${expTitle}">${nomRead}</span>
    <div class="annOverlayPopoverHeadActions annPopoverMiniActions">
      <button type="button" class="annPopoverIconBtn annPopoverIconBtnSm" data-ann-popover-expand title="${expTitle}" aria-label="${expTitle}">+</button>
      <button type="button" class="annPopoverIconBtn annPopoverIconBtnSm annPopoverIconBtnDanger" data-ann-delete="${annId}" title="${delTitle}" aria-label="${delTitle}">×</button>
    </div>
  `;
    bodyEl.innerHTML = '';
  } else {
    headEl.innerHTML = `
    <span class="annOverlayPopoverTitle">${titleText}</span>
    <div class="annPopoverHeadMain">
      <div class="annPopoverField annPopoverFieldName">
        <label class="annPopoverLab">${tt('common.name', 'Name')}${maybeRadius}</label>
        <input type="text" data-ann-id="${annId}" data-ann-field="name" value="${name}" placeholder="${esc(tt('common.name', 'Name'))}" class="annPopoverIn" />
      </div>
      <div class="annPopoverField annPopoverFieldRotHead">
        <label class="annPopoverLab">${tt('blueprint.rotate', 'Rot')}</label>
        <select data-ann-id="${annId}" data-ann-field="thumbnailRotation" class="annPopoverIn annPopoverRotateSel">${rotateOptionsHtml}</select>
      </div>
    </div>
    <div class="annOverlayPopoverHeadActions">
      <button type="button" class="annPopoverIconBtn annPopoverIconBtnSm" data-ann-popover-minimize title="${minTitle}" aria-label="${minTitle}">−</button>
      <button type="button" class="annPopoverIconBtn annPopoverIconBtnSm annPopoverIconBtnDanger" data-ann-delete="${annId}" title="${delTitle}" aria-label="${delTitle}">×</button>
    </div>
  `;
    const alertBlock = (tolInverted || limitsInverted)
      ? `<div class="annPopoverTolAlert" role="status">${tolAlertText}</div>`
      : '';
    bodyEl.innerHTML = `
    <div class="annPopoverForm annPopoverFormCompact">
    <div class="annPopoverGrid3">
      <div class="annPopoverField annPopoverFieldNom">
        <label class="annPopoverLab">${tt('blueprint.nomShort', 'Nom')}</label>
        <input type="text" data-ann-id="${annId}" data-ann-field="nominal" value="${nominal}" placeholder="—" class="annPopoverIn annPopoverInNum" inputmode="decimal" autocomplete="off" />
      </div>
      <div class="annPopoverField annPopoverFieldTol">
        <label class="annPopoverLab">${tt('blueprint.minTolShort', 'Min tol')}</label>
        <input type="text" data-ann-id="${annId}" data-ann-field="lowerDeviation" value="${lowerDevStr}" placeholder="${esc(tt('blueprint.tolMinus', 'Tol -'))}" class="annPopoverIn annPopoverInTol" inputmode="decimal" autocomplete="off" />
      </div>
      <div class="annPopoverField annPopoverFieldTol">
        <label class="annPopoverLab">${tt('blueprint.maxTolShort', 'Max tol')}</label>
        <input type="text" data-ann-id="${annId}" data-ann-field="upperDeviation" value="${upperDevStr}" placeholder="${esc(tt('blueprint.tolPlus', 'Tol +'))}" class="annPopoverIn annPopoverInTol" inputmode="decimal" autocomplete="off" />
      </div>
    </div>
    ${medianRow}
    ${alertBlock}
    </div>
  `;
  }
  if (!minimized) {
    const rotateSel = pop.querySelector('.annPopoverRotateSel');
    if (rotateSel) {
      rotateSel.value = String(wrapDisplayRotation(autoThumbCorrection(row) + manualThumbRotation(row)));
    }
  }
  // #region agent log
  sendAgentDebugLog({sessionId:'6d6734',runId:'initial',hypothesisId:'H2',location:'render.js:updateAnnPopover:824',message:'popover content rendered',data:{annId:String(row?.id || ''),nameLength:String(row?.name || '').length,nominalLength:String(row?.nominal ?? '').length,unitLength:String(row?.unit ?? '').length,toleranceLength:String(row?.toleranceSpec ?? '').length,box:{x1:box.x1,y1:box.y1,x2:box.x2,y2:box.y2}},timestamp:Date.now()});
  // #endregion
  cancelPopoverHide();
  pop.hidden = false;
  let popW;
  if (minimized) {
    pop.style.width = 'auto';
    pop.style.minWidth = '0';
    popW = Math.min(320, Math.max(48, Math.ceil(pop.getBoundingClientRect().width || pop.offsetWidth || 48)));
    pop.style.width = `${popW}px`;
  } else {
    pop.style.minWidth = '';
    popW = Math.max(260, Math.min(400, pop.offsetWidth || 300));
    pop.style.width = `${popW}px`;
  }
  const popH = pop.offsetHeight || 170;
  const gap = 6;
  const boxLeftInWrap = (canvasRect.left - wrapRect.left) + x * scaleX;
  const boxRightInWrap = boxLeftInWrap + w * scaleX;
  const boxTopInWrap = (canvasRect.top - wrapRect.top) + y * scaleY;
  const boxCenterYInWrap = boxTopInWrap + (h * scaleY) / 2;
  const wrapW = wrapRect.width;
  const wrapH = wrapRect.height;
  const spaceRight = wrapW - (boxRightInWrap + gap);
  const spaceLeft = boxLeftInWrap - gap;
  const preferRight = spaceRight >= popW;
  const preferLeft = spaceLeft >= popW;
  let leftInWrap;
  if (preferRight) {
    leftInWrap = Math.min(wrapW - popW - 4, boxRightInWrap + gap);
  } else if (preferLeft) {
    leftInWrap = Math.max(4, boxLeftInWrap - popW - gap);
  } else {
    leftInWrap = spaceRight >= spaceLeft
      ? Math.min(wrapW - popW - 4, boxRightInWrap + gap)
      : Math.max(4, boxLeftInWrap - popW - gap);
  }
  const topInWrap = Math.max(4, Math.min(wrapH - popH - 4, boxCenterYInWrap - popH / 2));
  pop.style.width = `${popW}px`;
  pop.style.left = `${leftInWrap}px`;
  pop.style.top = `${topInWrap}px`;
  const boxBottomInWrap = boxTopInWrap + h * scaleY;
  const popRightInWrap = leftInWrap + popW;
  const popBottomInWrap = topInWrap + popH;
  const overlapX = boxLeftInWrap < popRightInWrap && boxRightInWrap > leftInWrap;
  const overlapY = boxTopInWrap < popBottomInWrap && boxBottomInWrap > topInWrap;
  const side = leftInWrap >= boxRightInWrap ? 'right' : (popRightInWrap <= boxLeftInWrap ? 'left' : 'overlap');
  // #region agent log
  sendAgentDebugLog({sessionId:'6d6734',runId:'initial',hypothesisId:'H1',location:'render.js:updateAnnPopover:861',message:'popover positioned',data:{annId:String(row?.id || ''),wrap:{width:wrapW,height:wrapH},box:{left:boxLeftInWrap,right:boxRightInWrap,top:boxTopInWrap,bottom:boxBottomInWrap},popover:{left:leftInWrap,right:popRightInWrap,top:topInWrap,bottom:popBottomInWrap,width:popW,height:popH},space:{left:spaceLeft,right:spaceRight},side,overlap:overlapX && overlapY},timestamp:Date.now()});
  // #endregion
}

const POPOVER_HIDE_DELAY_MS = 500;

function isPopoverSticky() {
  return previewRuntime.popoverPointerInside || previewRuntime.popoverFocusInside;
}

function isPopoverPinned() {
  const sid = String(state.selectedAnnId || '');
  const aid = String(previewRuntime.popoverAnchorAnnId || '');
  return Boolean(sid && aid && sid === aid);
}

export function clearAnnPopover(force = false) {
  if (previewRuntime.popoverHideTimeout) {
    clearTimeout(previewRuntime.popoverHideTimeout);
    previewRuntime.popoverHideTimeout = null;
  }
  if (!force && isPopoverSticky()) return;
  if (!force && isPopoverPinned()) return;
  if (force) {
    previewRuntime.popoverPointerInside = false;
    previewRuntime.popoverFocusInside = false;
  }
  const pop = $('annOverlayPopover');
  if (pop) pop.hidden = true;
  previewRuntime.hoveredAnnId = '';
  previewRuntime.popoverAnchorAnnId = '';
}

function schedulePopoverHide() {
  if (isPopoverPinned()) return;
  if (previewRuntime.popoverHideTimeout) clearTimeout(previewRuntime.popoverHideTimeout);
  previewRuntime.popoverHideTimeout = setTimeout(() => {
    previewRuntime.popoverHideTimeout = null;
    if (isPopoverSticky()) return;
    clearAnnPopover();
    renderPreviewOverlay();
  }, POPOVER_HIDE_DELAY_MS);
}

function cancelPopoverHide() {
  if (previewRuntime.popoverHideTimeout) {
    clearTimeout(previewRuntime.popoverHideTimeout);
    previewRuntime.popoverHideTimeout = null;
  }
}

function hidePreviewPickerMenu() {
  const menu = $('previewPickerMenu');
  if (menu) menu.hidden = true;
}

function updatePreviewPickerMenuButtons() {
  $('previewPickerPointBtn')?.classList.toggle('active', state.previewPickerMode !== 'box');
  $('previewPickerBoxBtn')?.classList.toggle('active', state.previewPickerMode === 'box');
}

function showPreviewPickerMenu(clientX, clientY) {
  const menu = $('previewPickerMenu');
  const wrap = $('docPreviewWrap');
  if (!menu || !wrap) return;
  updatePreviewPickerMenuButtons();
  const rect = wrap.getBoundingClientRect();
  menu.hidden = false;
  const menuW = Math.max(148, menu.offsetWidth || 148);
  const menuH = Math.max(76, menu.offsetHeight || 76);
  const left = clamp(clientX - rect.left, 6, Math.max(6, rect.width - menuW - 6));
  const top = clamp(clientY - rect.top, 6, Math.max(6, rect.height - menuH - 6));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

export function bindPreviewInteractions() {
  const canvas = $('docOverlayCanvas');
  const wrap = $('docPreviewWrap');
  if (!canvas || !wrap || previewRuntime.bound) return;
  previewRuntime.bound = true;
  // #region agent log
  sendAgentDebugLog({sessionId:'6d6734',runId:'initial',hypothesisId:'H6',location:'render.js:bindPreviewInteractions:902',message:'render instrumentation active',data:{canvasId:canvas.id,wrapId:wrap.id},timestamp:Date.now()});
  // #endregion
  canvas.style.pointerEvents = 'auto';
  canvas.style.touchAction = 'none';

  const onPointerMove = (event) => {
    if (previewRuntime.pointerId == null || previewRuntime.pointerId !== event.pointerId) return;
    const m = previewMetrics();
    if (!m) return;
    if (previewRuntime.mode === 'createBox' && previewRuntime.createBoxStart) {
      const p = canvasEventPoint(event, m.canvas);
      const currentPoint = canvasToSourcePoint(p.x, p.y, m);
      if (!currentPoint) return;
      previewRuntime.draftBox = clampEditableBboxToSource({
        x1: previewRuntime.createBoxStart.x,
        y1: previewRuntime.createBoxStart.y,
        x2: currentPoint.x,
        y2: currentPoint.y,
      }, m.srcW, m.srcH);
      renderPreviewOverlay();
      return;
    }
    if (previewRuntime.mode === 'pan') {
      const dx = event.clientX - previewRuntime.startClientX;
      const dy = event.clientY - previewRuntime.startClientY;
      previewRuntime.panX = previewRuntime.startPanX + dx;
      previewRuntime.panY = previewRuntime.startPanY + dy;
      renderPreviewOverlay();
      return;
    }
    const active = docsApi.productAnnotationById(previewRuntime.activeAnnId, state.selectedProductId);
    const startBox = normalizeEditableBbox(previewRuntime.startBox);
    if (!active || !startBox) return;
    const p = canvasEventPoint(event, m.canvas);
    if (previewRuntime.mode === 'move') {
      const startPoint = canvasToSourcePoint(canvasEventPoint({
        clientX: previewRuntime.startClientX,
        clientY: previewRuntime.startClientY,
      }, m.canvas).x, canvasEventPoint({
        clientX: previewRuntime.startClientX,
        clientY: previewRuntime.startClientY,
      }, m.canvas).y, m);
      const currentPoint = canvasToSourcePoint(p.x, p.y, m);
      if (!startPoint || !currentPoint) return;
      const dx = currentPoint.x - startPoint.x;
      const dy = currentPoint.y - startPoint.y;
      previewRuntime.draftBox = clampEditableBboxToSource({
        x1: startBox.x1 + dx,
        y1: startBox.y1 + dy,
        x2: startBox.x2 + dx,
        y2: startBox.y2 + dy,
      }, m.srcW, m.srcH);
      renderPreviewOverlay();
      return;
    }
    if (previewRuntime.mode === 'resize') {
      previewRuntime.draftBox = resizeSourceBoxFromHandle(startBox, previewRuntime.activeHandle, p, m);
      renderPreviewOverlay();
      return;
    }
    if (previewRuntime.mode === 'dragBubble' && previewRuntime.startBubbleOffset) {
      const dx = event.clientX - previewRuntime.startClientX;
      const dy = event.clientY - previewRuntime.startClientY;
      previewRuntime.draftBubbleOffset = {
        x: Number(previewRuntime.startBubbleOffset.x || 0) + dx,
        y: Number(previewRuntime.startBubbleOffset.y || 0) + dy,
      };
      renderPreviewOverlay();
    }
  };

  const onPointerUp = (event) => {
    if (previewRuntime.pointerId == null || previewRuntime.pointerId !== event.pointerId) return;
    const boxChanged = (previewRuntime.mode === 'move' || previewRuntime.mode === 'resize') && !!previewRuntime.draftBox;
    const bubbleChanged = previewRuntime.mode === 'dragBubble' && !!previewRuntime.draftBubbleOffset;
    const createBoxChanged = previewRuntime.mode === 'createBox' && !!previewRuntime.draftBox;
    if (canvas.hasPointerCapture(event.pointerId)) {
      try { canvas.releasePointerCapture(event.pointerId); } catch {}
    }
    previewRuntime.pointerId = null;
    const prevMode = previewRuntime.mode;
    previewRuntime.mode = 'idle';
    previewRuntime.startBox = null;
    previewRuntime.activeHandle = '';
    previewRuntime.startBubbleOffset = null;
    previewRuntime.createBoxStart = null;
    if (boxChanged && saveOverlayDraft()) {
      previewRuntime.draftBox = null;
      renderAnnotations();
    } else if (createBoxChanged) {
      const createdBox = normalizeEditableBbox(previewRuntime.draftBox);
      previewRuntime.draftBox = null;
      renderPreviewOverlay();
      if (createdBox && (createdBox.x2 - createdBox.x1) >= 4 && (createdBox.y2 - createdBox.y1) >= 4) {
        try {
          window.dispatchEvent(new CustomEvent('vmill:create-annotation-box', { detail: { sourceBox: createdBox } }));
        } catch {}
      }
    } else if (bubbleChanged && saveOverlayBubbleOffset()) {
      previewRuntime.draftBubbleOffset = null;
      renderAnnotations();
    } else {
      previewRuntime.draftBox = null;
      previewRuntime.draftBubbleOffset = null;
      if (prevMode === 'dragBubble' || prevMode === 'move' || prevMode === 'resize') renderPreviewOverlay();
    }
  };

  document.addEventListener('pointerdown', (event) => {
    const menu = $('previewPickerMenu');
    if (!menu || menu.hidden) return;
    if (menu.contains(event.target)) return;
    hidePreviewPickerMenu();
  });
  $('previewPickerPointBtn')?.addEventListener('click', () => {
    state.previewPickerMode = 'point';
    updatePreviewPickerMenuButtons();
    hidePreviewPickerMenu();
    setStatus(tt('blueprint.pointPickMode', 'Picker tool: point pick.'));
    renderPreviewOverlay();
  });
  $('previewPickerBoxBtn')?.addEventListener('click', () => {
    state.previewPickerMode = 'box';
    updatePreviewPickerMenuButtons();
    hidePreviewPickerMenu();
    setStatus(tt('blueprint.boxPickMode', 'Picker tool: box pick.'));
    renderPreviewOverlay();
  });
  canvas.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    showPreviewPickerMenu(event.clientX, event.clientY);
  });
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 && event.button !== 1) return;
    hidePreviewPickerMenu();
    const m = previewMetrics();
    if (!m) return;
    const point = canvasEventPoint(event, m.canvas);
    const hit = hitPreviewBox(point, m);
    if (hit.row) {
      const id = String(hit.row.id || '');
      if (id && id !== String(state.selectedAnnId || '')) {
        state.selectedAnnId = id;
        renderAnnotations();
      }
    } else if (event.button === 0 && !event.shiftKey && state.previewPickerMode !== 'box') {
      state.selectedAnnId = '';
      renderAnnotations();
      clearAnnPopover(true);
    }
    previewRuntime.pointerId = event.pointerId;
    previewRuntime.startClientX = event.clientX;
    previewRuntime.startClientY = event.clientY;
    previewRuntime.startPanX = Number(previewRuntime.panX || 0);
    previewRuntime.startPanY = Number(previewRuntime.panY || 0);
    previewRuntime.activeAnnId = String(hit.row?.id || '');
    previewRuntime.activeHandle = String(hit.handle || '');
    previewRuntime.startBox = hit.row ? previewRowBoxInSource(hit.row, m) : null;
    previewRuntime.draftBox = null;
    previewRuntime.draftBubbleOffset = null;
    previewRuntime.startBubbleOffset = null;
    previewRuntime.createBoxStart = null;
    if (event.button === 0 && !hit.row && state.previewPickerMode === 'box') {
      const sourcePoint = canvasToSourcePoint(point.x, point.y, m);
      if (!sourcePoint) return;
      previewRuntime.mode = 'createBox';
      previewRuntime.createBoxStart = sourcePoint;
      previewRuntime.draftBox = clampEditableBboxToSource({
        x1: sourcePoint.x,
        y1: sourcePoint.y,
        x2: sourcePoint.x + 1,
        y2: sourcePoint.y + 1,
      }, m.srcW, m.srcH);
    } else if (event.button === 1 || event.shiftKey || !hit.row) {
      previewRuntime.mode = 'pan';
    } else if (hit.onBubble) {
      const raw = hit.row?.bubbleOffset && typeof hit.row.bubbleOffset === 'object'
        ? { x: Number(hit.row.bubbleOffset.x || 0), y: Number(hit.row.bubbleOffset.y || 0) }
        : { x: -24, y: -24 };
      previewRuntime.mode = 'dragBubble';
      previewRuntime.startBubbleOffset = { x: raw.x, y: raw.y };
      previewRuntime.draftBubbleOffset = { x: raw.x, y: raw.y };
    } else {
      previewRuntime.mode = hit.handle ? 'resize' : 'move';
    }
    try { canvas.setPointerCapture(event.pointerId); } catch {}
    event.preventDefault();
  });

  canvas.addEventListener('pointermove', (event) => {
    if (previewRuntime.pointerId != null) return;
    const m = previewMetrics();
    if (!m) return;
    const point = canvasEventPoint(event, m.canvas);
    const hit = hitPreviewBox(point, m);
    const prevHoverId = String(previewRuntime.hoveredAnnId || '');
    const nextHoverId = hit?.row?.id != null ? String(hit.row.id) : '';
    const pinSid = String(state.selectedAnnId || '');
    const hoverPopoverAllowed = !pinSid || nextHoverId === pinSid;

    if (hit?.row) {
      if (hoverPopoverAllowed) {
        // Hovering over a box: show/update popover for this row (or same as selection).
        if (nextHoverId !== prevHoverId) {
          previewRuntime.hoveredAnnId = nextHoverId;
        }
        updateAnnPopover(hit.row, m);
        cancelPopoverHide();
      } else {
        // Another annotation is selected: do not activate hover/popover on other boxes.
        previewRuntime.hoveredAnnId = '';
        const selRow = currentPreviewAnnotations().find((r) => String(r?.id || '') === pinSid);
        if (selRow) {
          updateAnnPopover(selRow, m);
          cancelPopoverHide();
        }
      }
      renderPreviewOverlay();
    } else {
      previewRuntime.hoveredAnnId = '';
      if (pinSid) {
        const selRow = currentPreviewAnnotations().find((r) => String(r?.id || '') === pinSid);
        if (selRow) {
          updateAnnPopover(selRow, m);
          cancelPopoverHide();
        } else {
          schedulePopoverHide();
        }
      } else if (prevHoverId) {
        schedulePopoverHide();
      }
      if (prevHoverId) renderPreviewOverlay();
    }
    if (hit?.handle) canvas.style.cursor = 'nwse-resize';
    else if (hit?.onBubble) canvas.style.cursor = 'move';
    else if (hit?.row) canvas.style.cursor = 'move';
    else canvas.style.cursor = state.previewPickerMode === 'box' ? 'crosshair' : 'grab';
  });

  canvas.addEventListener('pointerleave', (event) => {
    const pop = $('annOverlayPopover');
    if (event.relatedTarget && pop?.contains(event.relatedTarget)) return;
    if (previewRuntime.hoveredAnnId) schedulePopoverHide();
  });
  $('annOverlayPopover')?.addEventListener('pointerenter', () => {
    previewRuntime.popoverPointerInside = true;
    cancelPopoverHide();
  });
  $('annOverlayPopover')?.addEventListener('pointerleave', (event) => {
    previewRuntime.popoverPointerInside = false;
    const canvasEl = $('docOverlayCanvas');
    if (event.relatedTarget && canvasEl?.contains(event.relatedTarget)) return;
    if (previewRuntime.hoveredAnnId) schedulePopoverHide();
  });
  $('annOverlayPopover')?.addEventListener('focusin', () => {
    previewRuntime.popoverFocusInside = true;
    cancelPopoverHide();
  });
  $('annOverlayPopover')?.addEventListener('focusout', (event) => {
    const pop = $('annOverlayPopover');
    if (event.relatedTarget && pop?.contains(event.relatedTarget)) return;
    previewRuntime.popoverFocusInside = false;
    if (previewRuntime.hoveredAnnId) schedulePopoverHide();
  });

  $('annOverlayPopover')?.addEventListener('click', (event) => {
    if (event.target.closest('[data-ann-popover-minimize]')) {
      previewRuntime.annPopoverMinimized = true;
      persistAnnPopoverMinimized(true);
      event.preventDefault();
      const m = previewMetrics();
      const id = String(previewRuntime.hoveredAnnId || previewRuntime.popoverAnchorAnnId || '');
      const row = docsApi.productAnnotationById(id, state.selectedProductId);
      if (m && row) updateAnnPopover(row, m);
      renderPreviewOverlay();
      return;
    }
    if (event.target.closest('[data-ann-popover-expand]')) {
      previewRuntime.annPopoverMinimized = false;
      persistAnnPopoverMinimized(false);
      event.preventDefault();
      const m = previewMetrics();
      const id = String(previewRuntime.hoveredAnnId || previewRuntime.popoverAnchorAnnId || '');
      const row = docsApi.productAnnotationById(id, state.selectedProductId);
      if (m && row) updateAnnPopover(row, m);
      renderPreviewOverlay();
      return;
    }
  });

  canvas.addEventListener('dblclick', (event) => {
    if (state.previewPickerMode === 'box') return;
    const m = previewMetrics();
    if (!m) return;
    const point = canvasEventPoint(event, m.canvas);
    const hit = hitPreviewBox(point, m);
    const annId = String(hit?.row?.id || '');
    const sourcePoint = canvasToSourcePoint(point.x, point.y, m);
    const insideImage = !!sourcePoint
      && sourcePoint.x >= 0 && sourcePoint.y >= 0
      && sourcePoint.x <= m.srcW && sourcePoint.y <= m.srcH;
    if (!annId && !insideImage) return;
    try {
      window.dispatchEvent(new CustomEvent('vmill:reocr-annotation', { detail: annId ? { id: annId } : { sourcePoint } }));
    } catch {}
  });

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  wrap.addEventListener('wheel', (event) => {
    const m = previewMetrics();
    if (!m) return;
    event.preventDefault();
    const dir = event.deltaY > 0 ? -0.1 : 0.1;
    setPreviewZoom(Number(previewRuntime.zoom || 1) + dir, event);
  }, { passive: false });

  $('docZoomOutBtn')?.addEventListener('click', () => setPreviewZoom(Number(previewRuntime.zoom || 1) - 0.1));
  $('docZoomInBtn')?.addEventListener('click', () => setPreviewZoom(Number(previewRuntime.zoom || 1) + 0.1));
  $('docZoomResetBtn')?.addEventListener('click', () => setPreviewZoom(1));
  $('docZoomFitBtn')?.addEventListener('click', fitPreviewInView);
  const fullscreenBtn = $('docFullscreenBtn');
  function updateFullscreenButton() {
    const isFs = !!document.fullscreenElement;
    if (wrap) wrap.classList.toggle('fullscreen', isFs);
    if (fullscreenBtn) fullscreenBtn.textContent = isFs ? 'Exit fullscreen' : 'Fullscreen';
  }
  fullscreenBtn?.addEventListener('click', () => {
    if (!wrap) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().then(updateFullscreenButton).catch(() => {});
    } else {
      wrap.requestFullscreen().then(updateFullscreenButton).catch(() => {});
    }
  });
  document.addEventListener('fullscreenchange', updateFullscreenButton);
}

export function renderAnnotations() {
  const host = $('annList');
  if (!host) return;
  const rows = currentAnnotations();
  const thumbDisplay = readThumbDisplaySettings();
  const annLinkCounts = new Map();
  for (const link of docsApi.listOperationAnnotationLinks({ productId: state.selectedProductId })) {
    const key = String(link.masterAnnotationId || '');
    if (!key) continue;
    annLinkCounts.set(key, Number(annLinkCounts.get(key) || 0) + 1);
  }
  host.innerHTML = rows.length ? rows.map((row) => {
    const isSelected = String(row.id) === String(state.selectedAnnId);
    const primaryLabel = String(row.sourceBubbleId || '').trim() || String(row.id || '--');
    const autoRotation = autoThumbCorrection(row);
    const manualRotation = manualThumbRotation(row);
    const rotation = wrapDisplayRotation(autoRotation + manualRotation);
    const thumbStyle = `transform: rotate(${rotation}deg);`;
    const thumbFrame = thumbFrameSize(row, thumbDisplay.listMax, thumbDisplay.listMin, rotation);
    const thumbWrapStyle = `--ann-thumb-w:${thumbFrame.width}px; --ann-thumb-h:${thumbFrame.height}px;`;
    const linkCount = Number(annLinkCounts.get(String(row.id || '')) || 0);
    const nominalStr = numText(row.nominal);
    const lowerDevStr = numText(row.lowerDeviation);
    const upperDevStr = numText(row.upperDeviation);
    const derived = calcDerivedLimits(row);
    const minStr = numView(derived.min);
    const medianStr = numView(derived.median);
    const maxStr = numView(derived.max);
    const nameLabel = String(row.name || row.characteristicId || `#${primaryLabel}`);
    const toleranceLabel = String(row.toleranceSpec || '').trim();
    const instrumentLabel = String(row.instrument || '').trim();
    const editRotation = String(rotation);
    const confPct = row.ocrConfidence != null && Number.isFinite(Number(row.ocrConfidence))
      ? Math.round(Number(row.ocrConfidence) * 100)
      : null;
    const isLocked = row.validated === true;
    const pendingDelete = String(state.pendingDeleteAnnId || '') === String(row.id || '');
    const disabledAttr = isLocked ? ' disabled' : '';
    const summaryParts = [];
    if (nominalStr) summaryParts.push(`${tt('blueprint.nomShort', 'Nom')} ${nominalStr}`);
    if (lowerDevStr || upperDevStr) summaryParts.push(`${lowerDevStr || '0'} / ${upperDevStr || '0'}`);
    if (minStr || medianStr || maxStr) summaryParts.push(`${tt('common.min', 'Min')} ${minStr || '-'} | ${tt('common.median', 'Median')} ${medianStr || '-'} | ${tt('common.max', 'Max')} ${maxStr || '-'}`);
    if (row.unit) summaryParts.push(String(row.unit));
    const summaryText = summaryParts.join(' | ') || tt('blueprint.noParsedValues', 'No parsed values');
    const metaChips = [
      confPct != null ? `<span class="annMetaChip warn" title="${esc(tt('blueprint.ocrConfidence', 'OCR confidence'))}">${esc(`${confPct}% sure`)}</span>` : '',
      isLocked ? `<span class="annMetaChip ok" title="${esc(tt('blueprint.validatedLocked', 'Validated and locked'))}">${esc(tt('blueprint.locked', 'Locked'))}</span>` : '',
      toleranceLabel ? `<span class="annMetaChip" title="${esc(toleranceLabel)}">${esc(toleranceLabel)}</span>` : '',
      instrumentLabel ? `<span class="annMetaChip" title="${esc(instrumentLabel)}">${esc(instrumentLabel)}</span>` : '',
      linkCount > 0 ? `<span class="annLinksChip">${linkCount === 1 ? '1 link' : `${linkCount} links`}</span>` : '',
    ].filter(Boolean).join('');
    const primaryContent = isSelected
      ? `<input class="annInlineInput annPrimaryInput" type="text" data-ann-id="${esc(row.id)}" data-ann-field="name" value="${esc(nameLabel)}" title="${esc(tt('common.name', 'Name'))}" placeholder="${esc(tt('common.name', 'Name'))}"${disabledAttr} />`
      : `<div class="annPrimaryValue" title="${esc(nameLabel)}">${esc(nameLabel)}</div>`;
    const editorRow = isSelected
      ? `<div class="annEditorRow">
          <input class="annInlineInput annNumInline" type="text" data-ann-id="${esc(row.id)}" data-ann-field="nominal" value="${esc(nominalStr)}" title="${esc(tt('blueprint.nominal', 'Nom'))}" placeholder="${esc(tt('blueprint.nominal', 'Nom'))}"${disabledAttr} />
          <input class="annInlineInput annNumInline" type="text" data-ann-id="${esc(row.id)}" data-ann-field="lowerDeviation" value="${esc(lowerDevStr)}" title="${esc(tt('blueprint.tolMinus', 'Tol -'))}" placeholder="${esc(tt('blueprint.tolMinus', 'Tol -'))}"${disabledAttr} />
          <input class="annInlineInput annNumInline" type="text" data-ann-id="${esc(row.id)}" data-ann-field="upperDeviation" value="${esc(upperDevStr)}" title="${esc(tt('blueprint.tolPlus', 'Tol +'))}" placeholder="${esc(tt('blueprint.tolPlus', 'Tol +'))}"${disabledAttr} />
          <input class="annInlineInput annUnitInline" type="text" data-ann-id="${esc(row.id)}" data-ann-field="unit" value="${esc(row.unit || '')}" title="${esc(tt('common.unit', 'Unit'))}" placeholder="mm" list="annUnitDatalist"${disabledAttr} />
          <input class="annInlineInput" type="text" data-ann-id="${esc(row.id)}" data-ann-field="instrument" value="${esc(row.instrument || '')}" title="${esc(tt('common.instrument', 'Instrument'))}" placeholder="${esc(tt('blueprint.noTol', 'no tol'))}" list="annInstrumentDatalist"${disabledAttr} />
        </div>`
      : '';
    return `
    <article class="annCard annCardCompact ${isSelected ? 'sel' : ''}" data-ann-card="${esc(row.id)}">
      <div class="annCardRow">
        <div class="annThumbWrap" data-ann-reocr="${esc(row.id)}" title="Double-click to re-OCR" style="${thumbWrapStyle}">
          ${row.thumbnailDataUrl ? `<img class="thumb" src="${esc(row.thumbnailDataUrl)}" alt="" style="${thumbStyle}" />` : `<div class="thumbPlaceholder">—</div>`}
          <span class="annThumbHint">2× re-OCR</span>
        </div>
        <div class="annMain">
          <div class="annTopRow">
            <span class="annBadge">#${esc(primaryLabel)}</span>
            ${primaryContent}
          </div>
          <div class="annSummaryRow">${esc(summaryText)}</div>
          ${editorRow}
          <div class="annMetaRow">${metaChips}</div>
        </div>
        <div class="annQuickActions">
          <button class="btn annQuickBtn" type="button" data-ann-lock="${esc(row.id)}" data-ann-lock-next="${isLocked ? '0' : '1'}">${isLocked ? tt('common.unlock', 'Unlock') : tt('blueprint.validate', 'Validate')}</button>
          <button class="btn annQuickBtn" type="button" data-ann-reocr-btn="${esc(row.id)}"${disabledAttr}>${tt('blueprint.reocr', 'Re-OCR')}</button>
          <select class="annRotateSel" data-ann-id="${esc(row.id)}" data-ann-field="thumbnailRotation" title="${esc(tt('blueprint.rotate', 'Rotate'))}"${disabledAttr}>
            ${rotationOptionsHtml(editRotation)}
          </select>
        </div>
        ${pendingDelete
          ? `<button class="btn annConfirmBtn ok" type="button" data-ann-delete-confirm="${esc(row.id)}" title="${esc(tt('common.confirm', 'Confirm'))}">V</button>
             <button class="btn bad annConfirmBtn" type="button" data-ann-delete-cancel="${esc(row.id)}" title="${esc(tt('common.cancel', 'Cancel'))}">X</button>`
          : `<button class="btn bad annDelBtn" type="button" data-ann-delete-request="${esc(row.id)}" title="${esc(tt('blueprint.deleteAnnotation', 'Delete'))}">✕</button>`}
      </div>
    </article>
  `; }).join('') : `<div class="empty">${esc(tt('blueprint.noAnnotations', 'No master annotations for this scope yet. Prepare them here, then link them from Router.'))}</div>`;
  renderAnnotationDetails();
  renderPreviewOverlay();
}

export function renderAnnotationDetails() {
  const empty = $('annDetailEmpty');
  const wrap = $('annDetailWrap');
  const thumbHost = $('annDetailThumbHost');
  const idChip = $('annDetailIdChip');
  const usageChip = $('annDetailUsageChip');
  const list = $('annDetailList');
  const rotateSel = $('annDetailRotateSel');
  const reocrBtn = $('annDetailReocrBtn');
  if (!empty || !wrap || !thumbHost || !idChip || !usageChip || !list || !rotateSel || !reocrBtn) return;
  const row = currentSelectedAnnotation();
  if (!row) {
    empty.hidden = false;
    wrap.hidden = true;
    rotateSel.value = '0';
    rotateSel.dataset.annId = '';
    rotateSel.dataset.annField = 'thumbnailRotation';
    rotateSel.disabled = true;
    reocrBtn.dataset.annReocrBtn = '';
    reocrBtn.disabled = true;
    return;
  }
  const usageCount = docsApi.listOperationAnnotationLinks({ productId: state.selectedProductId })
    .filter((link) => String(link.masterAnnotationId || '') === String(row.id || '')).length;
  empty.hidden = true;
  wrap.hidden = false;
  idChip.textContent = row.id || '--';
  usageChip.textContent = `${usageCount} ${tt(usageCount === 1 ? 'blueprint.operationLinkSingular' : 'blueprint.operationLinkPlural', usageCount === 1 ? 'operation link' : 'operation links')}`;
  const autoRotation = autoThumbCorrection(row);
  const manualRotation = manualThumbRotation(row);
  const rotation = wrapDisplayRotation(autoRotation + manualRotation);
  const editRotation = String(rotation);
  const thumbDisplay = readThumbDisplaySettings();
  const detailThumbFrame = thumbFrameSize(row, thumbDisplay.detailMax, thumbDisplay.detailMin, rotation);
  const detailThumbStyle = `--detail-thumb-w:${detailThumbFrame.width}px; --detail-thumb-h:${detailThumbFrame.height}px; transform: rotate(${rotation}deg);`;
  const detailPlaceholderStyle = `--detail-thumb-w:${detailThumbFrame.width}px; --detail-thumb-h:${detailThumbFrame.height}px;`;
  const derived = calcDerivedLimits(row);
  thumbHost.innerHTML = row.thumbnailDataUrl
    ? `<img class="thumbLarge" src="${esc(row.thumbnailDataUrl)}" alt="${esc(tt('blueprint.annotationThumbAlt', 'annotation thumb'))}" style="${detailThumbStyle}" />`
    : `<div class="thumbLargePlaceholder" style="${detailPlaceholderStyle}">${esc(tt('blueprint.noThumb', 'No thumb'))}</div>`;
  rotateSel.innerHTML = rotationOptionsHtml(editRotation);
  rotateSel.value = editRotation;
  rotateSel.dataset.annId = String(row.id || '');
  rotateSel.dataset.annField = 'thumbnailRotation';
  rotateSel.disabled = false;
  reocrBtn.dataset.annReocrBtn = String(row.id || '');
  reocrBtn.disabled = false;
  list.innerHTML = [
    `<div><strong>${esc(tt('common.name', 'Name'))}:</strong> ${esc(row.name || '--')}</div>`,
    `<div><strong>${esc(tt('common.document', 'Document'))}:</strong> <span class="mono">${esc(row.documentId || '--')}</span></div>`,
    `<div><strong>${esc(tt('blueprint.characteristic', 'Characteristic'))}:</strong> ${esc(row.characteristicId || tt('blueprint.noLinkedCharacteristic', 'No linked characteristic'))}</div>`,
    `<div><strong>${esc(tt('blueprint.nominalLimits', 'Nominal / Limits'))}:</strong> ${esc(`${numText(row.nominal) || '-'} | ${numText(row.lsl) || '-'} -> ${numText(row.usl) || '-'}`)}</div>`,
    `<div><strong>${esc(tt('blueprint.deviationsSpec', 'Deviations / Spec'))}:</strong> ${esc(`${numText(row.lowerDeviation) || '-'} / ${numText(row.upperDeviation) || '-'} | ${row.toleranceSpec || '-'}`)}</div>`,
    `<div><strong>${esc(tt('blueprint.derivedLimits', 'Derived Min / Median / Max'))}:</strong> ${esc(`${numView(derived.min) || '-'} / ${numView(derived.median) || '-'} / ${numView(derived.max) || '-'}`)}</div>`,
    `<div><strong>${esc(tt('blueprint.methodInstrument', 'Method / Instrument'))}:</strong> ${esc(`${row.method || '-'} | ${row.instrument || '-'}`)}</div>`,
  ].join('');
}

export function renderAll(products) {
  renderProducts(products);
  renderDocuments();
  renderAnnotations();
  const product = getProductById(state.selectedProductId);
  const hint = $('docHint');
  if (hint) {
    hint.textContent = product
      ? tt('blueprint.manageProductDrawings', 'Managing drawings for the selected product. Build previews and marks here, then link them into Router.')
      : tt('blueprint.pickProductManageDrawings', 'Pick a product to manage its drawings and annotations.');
  }
}
