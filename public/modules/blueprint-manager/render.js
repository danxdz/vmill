import { $, state, tt, str, getProductById, docsApi, setStatus } from './core.js';

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

function previewMetrics() {
  const wrap = $('docPreviewWrap');
  const canvas = $('docOverlayCanvas');
  const img = $('docImagePreview');
  const doc = currentDocument();
  if (!wrap || !canvas || !img || !doc || img.hidden || !str(img.src)) return null;
  const canvasW = Math.max(1, Math.round(wrap.clientWidth || 0));
  const canvasH = Math.max(1, Math.round(wrap.clientHeight || 0));
  const imageW = Math.max(1, Number(img.naturalWidth || img.width || 1));
  const imageH = Math.max(1, Number(img.naturalHeight || img.height || 1));
  const srcW = Math.max(1, Number(doc.imageWidth || imageW || 1));
  const srcH = Math.max(1, Number(doc.imageHeight || imageH || 1));
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
  return normalizeOverlayBbox(row?.bbox, metrics?.srcW || 0, metrics?.srcH || 0);
}

function hitPreviewBox(point, metrics) {
  const rows = currentPreviewAnnotations();
  if (!rows.length) return { row: null, handle: '' };
  const selected = selectedOverlayBox(metrics);
  if (selected) {
    const handles = overlayResizeHandles(selected.box, metrics);
    const hitHandle = handles.find((h) => Math.hypot(point.x - h.x, point.y - h.y) <= h.r + 3);
    if (hitHandle) return { row: selected.row, handle: hitHandle.name };
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
      return { row, handle: '' };
    }
  }
  return { row: null, handle: '' };
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

function normalizeOverlayBbox(raw, srcW, srcH) {
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
      'Drawings mode: drag a box to move, drag corner pins to resize, and use wheel to zoom.',
    );
  }
  const rows = currentPreviewAnnotations();
  rows.forEach((row, idx) => {
    const draftMatch = String(row?.id || '') === activeId && previewRuntime.draftBox;
    const box = draftMatch ? normalizeEditableBbox(previewRuntime.draftBox) : normalizeOverlayBbox(row?.bbox, srcW, srcH);
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

    const showHandles = isSel && handleMode !== 'never';
    if (showHandles) {
      const handles = overlayResizeHandles(box, m);
      for (const handle of handles) {
        ctx.fillStyle = '#0f1724';
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
    const rawOff = row?.bubbleOffset && typeof row.bubbleOffset === 'object'
      ? {
          x: Number(row.bubbleOffset.x || 0),
          y: Number(row.bubbleOffset.y || 0),
        }
      : { x: -24, y: -24 };
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
        ctx.strokeStyle = '#ffffff';
        ctx.strokeText(label, lx, ly);
      }
      ctx.fillStyle = cfg.bubbleTextColor;
      ctx.fillText(label, lx, ly);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
  });
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

  const imageW = Math.max(1, Number(img.naturalWidth || img.width || 1));
  const imageH = Math.max(1, Number(img.naturalHeight || img.height || 1));
  const scale = Math.min(width / imageW, height / imageH);
  const drawW = imageW * scale;
  const drawH = imageH * scale;
  const offsetX = (width - drawW) / 2;
  const offsetY = (height - drawH) / 2;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, offsetX, offsetY, drawW, drawH);

  const srcW = Math.max(1, Number(doc.imageWidth || imageW || 1));
  const srcH = Math.max(1, Number(doc.imageHeight || imageH || 1));
  const cfg = readDisplaySettingsFromUi();
  const rows = currentPreviewAnnotations();
  const selectedId = String(state.selectedAnnId || '');
  rows.forEach((row, idx) => {
    const box = normalizeOverlayBbox(row?.bbox, srcW, srcH);
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
    const rawOff = row?.bubbleOffset && typeof row.bubbleOffset === 'object'
      ? { x: Number(row.bubbleOffset.x || 0), y: Number(row.bubbleOffset.y || 0) }
      : { x: -24, y: -24 };
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
        ctx.strokeStyle = '#ffffff';
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
          <div class="docMeta">${esc(doc.revision ? `Rev ${doc.revision} | ` : '')}${esc(`${annCount} master annotation(s) | ${linkCount} operation link(s)`)}</div>
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
    ? (doc.previewDataUrl ? 'preview ready' : (doc.mime?.includes('pdf') ? 'preview needed' : 'image ready'))
    : 'no preview';
  statsChip.textContent = `${annCount} master annotation${annCount === 1 ? '' : 's'} | ${previewState}`;
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
    img.hidden = true;
    frame.hidden = true;
    if (canvas) canvas.hidden = true;
    empty.hidden = false;
    typeChip.textContent = 'No document';
    return;
  }
  typeChip.textContent = doc.mime?.includes('pdf')
    ? (doc.previewDataUrl ? 'PDF document | OCR preview ready' : 'PDF document')
    : 'Image document';
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
  docsApi.upsertProductAnnotation({
    ...current,
    bbox: box,
    coordSpace: 'source',
  });
  setStatus(`Updated annotation ${annId}.`);
  return true;
}

export function bindPreviewInteractions() {
  const canvas = $('docOverlayCanvas');
  const wrap = $('docPreviewWrap');
  if (!canvas || !wrap || previewRuntime.bound) return;
  previewRuntime.bound = true;
  canvas.style.pointerEvents = 'auto';
  canvas.style.touchAction = 'none';

  const onPointerMove = (event) => {
    if (previewRuntime.pointerId == null || previewRuntime.pointerId !== event.pointerId) return;
    const m = previewMetrics();
    if (!m) return;
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
    }
  };

  const onPointerUp = (event) => {
    if (previewRuntime.pointerId == null || previewRuntime.pointerId !== event.pointerId) return;
    const changed = (previewRuntime.mode === 'move' || previewRuntime.mode === 'resize') && !!previewRuntime.draftBox;
    if (canvas.hasPointerCapture(event.pointerId)) {
      try { canvas.releasePointerCapture(event.pointerId); } catch {}
    }
    previewRuntime.pointerId = null;
    previewRuntime.mode = 'idle';
    previewRuntime.startBox = null;
    previewRuntime.activeHandle = '';
    if (changed && saveOverlayDraft()) {
      previewRuntime.draftBox = null;
      renderAnnotations();
    } else {
      previewRuntime.draftBox = null;
      renderPreviewOverlay();
    }
  };

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 && event.button !== 1) return;
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
    if (event.button === 1 || event.shiftKey || !hit.row) previewRuntime.mode = 'pan';
    else previewRuntime.mode = hit.handle ? 'resize' : 'move';
    try { canvas.setPointerCapture(event.pointerId); } catch {}
    event.preventDefault();
  });

  canvas.addEventListener('pointermove', (event) => {
    if (previewRuntime.pointerId != null) return;
    const m = previewMetrics();
    if (!m) return;
    const point = canvasEventPoint(event, m.canvas);
    const hit = hitPreviewBox(point, m);
    if (hit?.handle) canvas.style.cursor = 'nwse-resize';
    else if (hit?.row) canvas.style.cursor = 'move';
    else canvas.style.cursor = 'grab';
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
}

export function renderAnnotations() {
  const host = $('annList');
  if (!host) return;
  const rows = currentAnnotations();
  const annLinkCounts = new Map();
  for (const link of docsApi.listOperationAnnotationLinks({ productId: state.selectedProductId })) {
    const key = String(link.masterAnnotationId || '');
    if (!key) continue;
    annLinkCounts.set(key, Number(annLinkCounts.get(key) || 0) + 1);
  }
  host.innerHTML = rows.length ? rows.map((row) => `
    <article class="annCard ${String(row.id) === String(state.selectedAnnId) ? 'sel' : ''}" data-ann-card="${esc(row.id)}">
      <div class="annHead">
        <div class="inline">
          ${row.thumbnailDataUrl ? `<img class="thumb" src="${esc(row.thumbnailDataUrl)}" alt="thumb" />` : `<div class="thumbPlaceholder">${esc('none')}</div>`}
          <div>
            <div><strong>${esc(row.id || '--')}</strong> <span class="annMeta">${esc(row.sourceBubbleId ? `source ${row.sourceBubbleId}` : '')}</span></div>
            <div class="annMeta">${esc(row.documentId || 'No document')} | ${esc(row.characteristicId || 'No linked characteristic')} | ${esc(`${Number(annLinkCounts.get(String(row.id || '')) || 0)} operation link(s)`)}</div>
          </div>
        </div>
        <button class="btn bad" type="button" data-ann-delete="${esc(row.id)}">Delete</button>
      </div>
      <div class="annGrid">
        <input class="mono" data-ann-field="id" data-ann-id="${esc(row.id)}" type="text" value="${esc(row.id || '')}" readonly />
        <input data-ann-field="name" data-ann-id="${esc(row.id)}" type="text" value="${esc(row.name || '')}" placeholder="Name" />
        <input data-ann-field="nominal" data-ann-id="${esc(row.id)}" type="number" step="0.001" value="${esc(numText(row.nominal))}" placeholder="Nominal" />
        <input data-ann-field="lsl" data-ann-id="${esc(row.id)}" type="number" step="0.001" value="${esc(numText(row.lsl))}" placeholder="Min" />
        <input data-ann-field="usl" data-ann-id="${esc(row.id)}" type="number" step="0.001" value="${esc(numText(row.usl))}" placeholder="Max" />
        <input data-ann-field="lowerDeviation" data-ann-id="${esc(row.id)}" type="number" step="0.001" value="${esc(numText(row.lowerDeviation))}" placeholder="-tol" title="Lower deviation from nominal (usually negative)." />
        <input data-ann-field="upperDeviation" data-ann-id="${esc(row.id)}" type="number" step="0.001" value="${esc(numText(row.upperDeviation))}" placeholder="+tol" title="Upper deviation from nominal (usually positive)." />
        <input data-ann-field="toleranceSpec" data-ann-id="${esc(row.id)}" type="text" value="${esc(row.toleranceSpec || '')}" placeholder="H6 / ±0.1" list="tolSpecSuggestions" title="Tolerance class or explicit tolerance (example: H6, h6, ±0.1, +0.1 -0.05)." />
        <input data-ann-field="unit" data-ann-id="${esc(row.id)}" type="text" value="${esc(row.unit || '')}" placeholder="Unit" />
        <input data-ann-field="instrument" data-ann-id="${esc(row.id)}" type="text" value="${esc(row.instrument || '')}" placeholder="Instrument" />
      </div>
    </article>
  `).join('') : `<div class="empty">${esc(tt('blueprint.noAnnotations', 'No master annotations for this scope yet. Prepare them here, then link them from Router.'))}</div>`;
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
  if (!empty || !wrap || !thumbHost || !idChip || !usageChip || !list) return;
  const row = currentSelectedAnnotation();
  if (!row) {
    empty.hidden = false;
    wrap.hidden = true;
    return;
  }
  const usageCount = docsApi.listOperationAnnotationLinks({ productId: state.selectedProductId })
    .filter((link) => String(link.masterAnnotationId || '') === String(row.id || '')).length;
  empty.hidden = true;
  wrap.hidden = false;
  idChip.textContent = row.id || '--';
  usageChip.textContent = `${usageCount} operation link${usageCount === 1 ? '' : 's'}`;
  thumbHost.innerHTML = row.thumbnailDataUrl
    ? `<img class="thumbLarge" src="${esc(row.thumbnailDataUrl)}" alt="annotation thumb" />`
    : `<div class="thumbLargePlaceholder">${esc('No thumb')}</div>`;
  list.innerHTML = [
    `<div><strong>Name:</strong> ${esc(row.name || '--')}</div>`,
    `<div><strong>Document:</strong> <span class="mono">${esc(row.documentId || '--')}</span></div>`,
    `<div><strong>Characteristic:</strong> ${esc(row.characteristicId || 'No linked characteristic')}</div>`,
    `<div><strong>Nominal / Limits:</strong> ${esc(`${numText(row.nominal) || '-'} | ${numText(row.lsl) || '-'} -> ${numText(row.usl) || '-'}`)}</div>`,
    `<div><strong>Deviations / Spec:</strong> ${esc(`${numText(row.lowerDeviation) || '-'} / ${numText(row.upperDeviation) || '-'} | ${row.toleranceSpec || '-'}`)}</div>`,
    `<div><strong>Method / Instrument:</strong> ${esc(`${row.method || '-'} | ${row.instrument || '-'}`)}</div>`,
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
      ? `Managing product-level documents for ${product.code || '--'} - ${product.name || 'Product'}. Build previews and master marks here, then link them into Router.`
      : 'Pick a product to manage its global blueprint documents and master annotations.';
  }
}
