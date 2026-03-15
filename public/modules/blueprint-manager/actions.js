import { $, state, tt, setStatus, setBusyStatus, str, getProducts, getProductById, queryParams, docsApi, ocrApi } from './core.js';
import { renderAll, renderDocuments, renderAnnotations, renderPreviewOverlay, renderSettingsLivePreview, writeDocumentToInputs, bindPreviewInteractions } from './render.js';

const PRODUCT_DOC_HANDOFF_KEY = 'vmill:spacial:product-doc-handoff';
const DISPLAY_SETTINGS_KEY = 'vmill:spacial:display';
const NS_SPACIAL_CONFIG = 'spacial_config';
const SPACIAL_DISPLAY_SETTINGS_ID = 'bubble_display';

function defaultBubbleDisplaySettings() {
  return {
    boxColor: '#ff6b6b',
    bubbleColor: '#4dafff',
    selectedColor: '#00ff8f',
    bubbleTextColor: '#0f1724',
    bubbleSize: 14,
    bubbleFontSize: 12,
    boxVisible: true,
    bubbleVisible: true,
    textVisible: true,
    bubbleFill: true,
    rainbowExport: false,
    exportPreset: 'match',
    exportTextColor: '#0f1724',
    exportBubbleSize: 14,
    handleSize: 4,
    handleMode: 'hover',
  };
}

function clampDisplaySettingNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function normalizeHexColor(value, fallback) {
  const text = str(value || '');
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text : fallback;
}

function normalizeBubbleDisplaySettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const base = defaultBubbleDisplaySettings();
  return {
    boxColor: normalizeHexColor(src.boxColor, base.boxColor),
    bubbleColor: normalizeHexColor(src.bubbleColor, base.bubbleColor),
    selectedColor: normalizeHexColor(src.selectedColor, base.selectedColor),
    bubbleTextColor: normalizeHexColor(src.bubbleTextColor, base.bubbleTextColor),
    bubbleSize: clampDisplaySettingNumber(src.bubbleSize, 6, 44, base.bubbleSize),
    bubbleFontSize: clampDisplaySettingNumber(src.bubbleFontSize, 6, 36, base.bubbleFontSize),
    boxVisible: src.boxVisible !== false,
    bubbleVisible: src.bubbleVisible !== false,
    textVisible: src.textVisible !== false,
    bubbleFill: src.bubbleFill !== false,
    rainbowExport: src.rainbowExport === true,
    exportPreset: ['match', 'print', 'number', 'box-number', 'rainbow'].includes(String(src.exportPreset || '')) ? String(src.exportPreset) : base.exportPreset,
    exportTextColor: normalizeHexColor(src.exportTextColor, base.exportTextColor),
    exportBubbleSize: clampDisplaySettingNumber(src.exportBubbleSize, 6, 44, base.exportBubbleSize),
    handleSize: clampDisplaySettingNumber(src.handleSize, 2, 8, base.handleSize),
    handleMode: ['hover', 'always', 'never'].includes(String(src.handleMode || '')) ? String(src.handleMode) : base.handleMode,
  };
}

function readBubbleDisplaySettings() {
  try {
    const sharedRows = window.VMillData?.listRecords ? (window.VMillData.listRecords(NS_SPACIAL_CONFIG) || []) : [];
    const shared = sharedRows.find((row) => String(row?.id || '') === SPACIAL_DISPLAY_SETTINGS_ID);
    if (shared?.settings && typeof shared.settings === 'object') {
      return normalizeBubbleDisplaySettings(shared.settings);
    }
  } catch {}
  try {
    return normalizeBubbleDisplaySettings(JSON.parse(localStorage.getItem(DISPLAY_SETTINGS_KEY) || '{}'));
  } catch {
    return defaultBubbleDisplaySettings();
  }
}

function updateBubbleDisplaySettingsUi(settings = null) {
  const cfg = normalizeBubbleDisplaySettings(settings || readBubbleDisplaySettings());
  if ($('bubbleDisplayBoxColorIn')) $('bubbleDisplayBoxColorIn').value = cfg.boxColor;
  if ($('bubbleDisplayColorIn')) $('bubbleDisplayColorIn').value = cfg.bubbleColor;
  if ($('bubbleDisplaySelectedColorIn')) $('bubbleDisplaySelectedColorIn').value = cfg.selectedColor;
  if ($('bubbleDisplayTextColorIn')) $('bubbleDisplayTextColorIn').value = cfg.bubbleTextColor;
  if ($('bubbleDisplaySizeIn')) $('bubbleDisplaySizeIn').value = String(cfg.bubbleSize);
  if ($('bubbleDisplayFontSizeIn')) $('bubbleDisplayFontSizeIn').value = String(cfg.bubbleFontSize);
  if ($('bubbleDisplayShowBoxChk')) $('bubbleDisplayShowBoxChk').checked = !!cfg.boxVisible;
  if ($('bubbleDisplayShowBubbleChk')) $('bubbleDisplayShowBubbleChk').checked = !!cfg.bubbleVisible;
  if ($('bubbleDisplayShowTextChk')) $('bubbleDisplayShowTextChk').checked = !!cfg.textVisible;
  if ($('bubbleDisplayBubbleFillChk')) $('bubbleDisplayBubbleFillChk').checked = !!cfg.bubbleFill;
  if ($('bubbleDisplayRainbowExportChk')) $('bubbleDisplayRainbowExportChk').checked = !!cfg.rainbowExport;
  if ($('bubbleDisplayExportPresetSel')) $('bubbleDisplayExportPresetSel').value = cfg.exportPreset || 'match';
  if ($('bubbleDisplayExportTextColorIn')) $('bubbleDisplayExportTextColorIn').value = cfg.exportTextColor;
  if ($('bubbleDisplayExportSizeIn')) $('bubbleDisplayExportSizeIn').value = String(cfg.exportBubbleSize);
  if ($('bubbleDisplayHandleSizeIn')) $('bubbleDisplayHandleSizeIn').value = String(cfg.handleSize);
  if ($('bubbleDisplayHandleModeSel')) $('bubbleDisplayHandleModeSel').value = cfg.handleMode;
  const info = $('bubbleDisplaySettingsInfo');
  if (info) {
    const modeLabel = cfg.handleMode === 'always' ? 'always' : (cfg.handleMode === 'never' ? 'hidden' : 'on hover');
    const parts = [];
    if (cfg.boxVisible) parts.push('box');
    if (cfg.bubbleVisible) parts.push('bubble');
    if (cfg.textVisible) parts.push('number');
    const visualMode = parts.length ? parts.join(' + ') : 'hidden';
    info.textContent = `Bubble ${cfg.bubbleSize}px | Font ${cfg.bubbleFontSize}px | ${visualMode} | Export ${cfg.exportPreset} (${cfg.exportBubbleSize}px)${cfg.rainbowExport ? ' + rainbow' : ''} | Pins ${modeLabel}`;
  }
}

function bubbleDisplayPresetValues(name, current = null) {
  const base = normalizeBubbleDisplaySettings(current || readBubbleDisplaySettings());
  switch (String(name || '')) {
    case 'classic':
      return { ...base, boxVisible: true, bubbleVisible: true, textVisible: true, bubbleFill: true, rainbowExport: false, exportPreset: 'match', exportTextColor: base.bubbleTextColor, exportBubbleSize: base.bubbleSize };
    case 'number-only':
      return { ...base, boxVisible: false, bubbleVisible: false, textVisible: true, bubbleFill: false, rainbowExport: false, exportPreset: 'number', exportTextColor: base.bubbleTextColor, exportBubbleSize: base.bubbleSize };
    case 'box-number':
      return { ...base, boxVisible: true, bubbleVisible: false, textVisible: true, bubbleFill: false, rainbowExport: false, exportPreset: 'box-number', exportTextColor: base.bubbleTextColor, exportBubbleSize: base.bubbleSize };
    case 'rainbow-pdf':
      return { ...base, boxVisible: false, bubbleVisible: true, textVisible: true, bubbleFill: true, rainbowExport: true, exportPreset: 'rainbow', exportTextColor: base.bubbleTextColor, exportBubbleSize: Math.max(base.bubbleSize, 16) };
    default:
      return base;
  }
}

function applyBubbleDisplaySettings(nextSettings = null, options = {}) {
  const cfg = normalizeBubbleDisplaySettings(nextSettings || readBubbleDisplaySettings());
  updateBubbleDisplaySettingsUi(cfg);
  if (options?.persist !== false) {
    localStorage.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify(cfg));
    if (window.VMillData?.upsertRecord) {
      window.VMillData.upsertRecord(NS_SPACIAL_CONFIG, {
        id: SPACIAL_DISPLAY_SETTINGS_ID,
        settings: cfg,
        updatedAt: new Date().toISOString(),
      });
    }
  }
  return cfg;
}

function saveBubbleDisplaySettingsFromUi() {
  applyBubbleDisplaySettings({
    boxColor: $('bubbleDisplayBoxColorIn')?.value,
    bubbleColor: $('bubbleDisplayColorIn')?.value,
    selectedColor: $('bubbleDisplaySelectedColorIn')?.value,
    bubbleTextColor: $('bubbleDisplayTextColorIn')?.value,
    bubbleSize: $('bubbleDisplaySizeIn')?.value,
    bubbleFontSize: $('bubbleDisplayFontSizeIn')?.value,
    boxVisible: !!$('bubbleDisplayShowBoxChk')?.checked,
    bubbleVisible: !!$('bubbleDisplayShowBubbleChk')?.checked,
    textVisible: !!$('bubbleDisplayShowTextChk')?.checked,
    bubbleFill: !!$('bubbleDisplayBubbleFillChk')?.checked,
    rainbowExport: !!$('bubbleDisplayRainbowExportChk')?.checked,
    exportPreset: $('bubbleDisplayExportPresetSel')?.value,
    exportTextColor: $('bubbleDisplayExportTextColorIn')?.value,
    exportBubbleSize: $('bubbleDisplayExportSizeIn')?.value,
    handleSize: $('bubbleDisplayHandleSizeIn')?.value,
    handleMode: $('bubbleDisplayHandleModeSel')?.value,
  });
  renderPreviewOverlay();
}

function setSettingsModalOpen(open) {
  const modal = $('drawingSettingsModal');
  if (!modal) return;
  const nextOpen = !!open;
  modal.hidden = !nextOpen;
  if (nextOpen) modal.classList.add('show');
  else modal.classList.remove('show');
  document.body.classList.toggle('modalOpen', nextOpen);
  if (nextOpen) renderSettingsLivePreview();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('read_failed'));
    reader.readAsDataURL(file);
  });
}

function refresh() {
  const products = getProducts();
  state.products = products;
  if (!products.some((row) => String(row.id || '') === String(state.selectedProductId || ''))) {
    state.selectedProductId = products[0]?.id || '';
  }
  if (!docsApi.productAnnotationById(state.selectedAnnId, state.selectedProductId)) {
    state.selectedAnnId = '';
  }
  renderAll(products);
}

function selectedDocument() {
  return docsApi.productDocumentById(state.selectedDocId, state.selectedProductId) || null;
}

function selectedAnnotation() {
  return docsApi.productAnnotationById(state.selectedAnnId, state.selectedProductId) || null;
}

function saveDocumentFromInputs() {
  const productId = str(state.selectedProductId);
  if (!productId) {
    setStatus('Pick a product first.');
    return;
  }
  const current = selectedDocument();
  if (!current) {
    setStatus('Upload or select a document first.');
    return;
  }
  const next = docsApi.upsertProductDocument({
    ...current,
    name: $('docNameIn').value || current.name,
    revision: $('docRevisionIn').value,
    notes: $('docNotesIn').value,
  });
  state.selectedDocId = next?.id || current.id;
  state.selectedAnnId = '';
  refresh();
  setStatus(`Saved document ${next?.name || current.name}.`);
}

function extensionForMimeType(mime = '') {
  const normalized = String(mime || '').toLowerCase();
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return '.jpg';
  if (normalized === 'image/png') return '.png';
  if (normalized === 'image/webp') return '.webp';
  if (normalized === 'image/bmp') return '.bmp';
  if (normalized === 'image/tiff') return '.tiff';
  if (normalized === 'application/pdf') return '.pdf';
  if (normalized.startsWith('image/')) return '.png';
  return '';
}

async function dataUrlToFile(dataUrl, filename, fallbackType = 'application/octet-stream') {
  const res = await fetch(String(dataUrl || ''));
  const blob = await res.blob();
  const type = blob.type || fallbackType;
  let name = String(filename || 'document');
  const hasExt = /\.[a-z0-9]{2,6}$/i.test(name);
  const inferredExt = extensionForMimeType(type);
  if (!hasExt && inferredExt) name = `${name}${inferredExt}`;
  if (!hasExt && !inferredExt) name = `${name}.bin`;
  return new File([blob], name, { type });
}

async function buildPdfPreviewForDocument(doc, options = {}) {
  if (!doc || !/pdf/i.test(doc.mime || '')) {
    if (!options.silent) setStatus('Selected document is not a PDF.');
    return null;
  }
  if (!ocrApi) {
    if (!options.silent) setStatus('OCR runtime is not available on this page.');
    return null;
  }
  const sourceDataUrl = str(doc.dataUrl);
  if (!sourceDataUrl) {
    if (!options.silent) setStatus('This document has no stored PDF data to convert.');
    return null;
  }
  setBusyStatus(true, tt('blueprint.previewBuilding', 'Building PDF preview through OCR server...'));
  try {
    const uploadFile = await dataUrlToFile(sourceDataUrl, doc.sourceName || doc.name || 'document.pdf', doc.mime || 'application/pdf');
    const out = await ocrApi.callOcrPdfToImageWithRetry(uploadFile, ocrApi.ensureOcrUrlInput(), 0, 220);
    const imageDataUrl = str(out?.image?.data_url || out?.data_url || '');
    if (!/^data:image\//i.test(imageDataUrl)) throw new Error('converted-image-missing');
    const next = docsApi.upsertProductDocument({
      ...doc,
      previewDataUrl: imageDataUrl,
      previewMime: str(out?.image?.mime || 'image/png'),
      sourcePage: Number(out?.image?.page || 0) || 0,
      imageWidth: Math.max(0, Number(out?.image?.width || 0) || 0),
      imageHeight: Math.max(0, Number(out?.image?.height || 0) || 0),
      sourceDpi: Math.max(0, Number(out?.image?.dpi || 0) || 0),
      sourcePageWidthPt: Math.max(0, Number(out?.image?.page_width_pt || 0) || 0),
      sourcePageHeightPt: Math.max(0, Number(out?.image?.page_height_pt || 0) || 0),
      updatedAt: new Date().toISOString(),
    });
    state.selectedDocId = next?.id || doc.id;
    refresh();
    setStatus(`Preview ready for ${next?.name || doc.name || 'document'}.`);
    return next || doc;
  } catch (err) {
    if (!options.silent) setStatus(`PDF preview failed: ${err?.message || err || 'unknown error'}`);
    return null;
  } finally {
    setBusyStatus(false);
  }
}

async function uploadDocuments(files) {
  const productId = str(state.selectedProductId);
  if (!productId) {
    setStatus('Pick a product first.');
    return;
  }
  const rows = Array.from(files || []).filter(Boolean);
  if (!rows.length) return;
  let lastId = '';
  let pdfCount = 0;
  for (const file of rows) {
    const dataUrl = await readFileAsDataUrl(file);
    const isPdf = /pdf/i.test(file.type || '') || /\.pdf$/i.test(file.name || '');
    if (isPdf) pdfCount += 1;
    let previewDataUrl = isPdf ? '' : dataUrl;
    let previewMime = isPdf ? '' : (file.type || '');
    let sourcePage = 0;
    let imageWidth = 0;
    let imageHeight = 0;
    let sourceDpi = 0;
    let sourcePageWidthPt = 0;
    let sourcePageHeightPt = 0;
    if (isPdf && ocrApi) {
      try {
        setBusyStatus(true, `Generating preview for ${file.name}...`);
        const out = await ocrApi.callOcrPdfToImageWithRetry(file, ocrApi.ensureOcrUrlInput(), 0, 220);
        previewDataUrl = str(out?.image?.data_url || out?.data_url || '');
        previewMime = str(out?.image?.mime || 'image/png');
        sourcePage = Number(out?.image?.page || 0) || 0;
        imageWidth = Math.max(0, Number(out?.image?.width || 0) || 0);
        imageHeight = Math.max(0, Number(out?.image?.height || 0) || 0);
        sourceDpi = Math.max(0, Number(out?.image?.dpi || 0) || 0);
        sourcePageWidthPt = Math.max(0, Number(out?.image?.page_width_pt || 0) || 0);
        sourcePageHeightPt = Math.max(0, Number(out?.image?.page_height_pt || 0) || 0);
      } catch {
        previewDataUrl = '';
        previewMime = '';
      } finally {
        setBusyStatus(false);
      }
    }
    const doc = docsApi.upsertProductDocument({
      productId,
      name: file.name,
      mime: file.type || '',
      dataUrl,
      previewMime,
      previewDataUrl,
      sourceName: file.name,
      sourcePage,
      imageWidth,
      imageHeight,
      sourceDpi,
      sourcePageWidthPt,
      sourcePageHeightPt,
      revision: $('docRevisionIn').value,
      notes: $('docNotesIn').value,
    });
    lastId = String(doc?.id || '');
  }
  if (lastId) state.selectedDocId = lastId;
  state.selectedAnnId = '';
  refresh();
  setStatus(
    pdfCount
      ? `Imported ${rows.length} document${rows.length === 1 ? '' : 's'}. PDFs were converted to previews when the OCR server was available.`
      : `Imported ${rows.length} document${rows.length === 1 ? '' : 's'}.`
  );
}

function deleteCurrentDocument() {
  const doc = selectedDocument();
  if (!doc) return;
  if (!confirm(`Delete document ${doc.name || doc.id} and its master annotations?`)) return;
  docsApi.deleteProductDocument(doc.id, { deleteAnnotations: true });
  state.selectedDocId = '';
  state.selectedAnnId = '';
  refresh();
  setStatus(`Deleted ${doc.name || doc.id}.`);
}

function updateAnnotationField(annotationId, field, value) {
  const current = docsApi.productAnnotationById(annotationId, state.selectedProductId);
  if (!current) return;
  const next = { ...current };
  const numFields = ['nominal', 'lsl', 'usl', 'lowerDeviation', 'upperDeviation'];
  if (numFields.includes(field)) {
    const n = Number(String(value).replace(',', '.'));
    next[field] = value === '' || !Number.isFinite(n) ? null : n;
  } else {
    next[field] = value;
  }
  const toNumOrNull = (v) => {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };
  const parseToleranceSpecInput = (rawSpec = '') => {
    const spec = str(rawSpec || '').replace(/[−–—]/g, '-').replace(/,/g, '.');
    if (!spec) return null;
    const iso286ItToleranceMm = (diameterMm, grade) => {
      const g = Number(grade);
      const coeffByGrade = {
        5: 7,
        6: 10,
        7: 16,
        8: 25,
        9: 40,
        10: 64,
        11: 100,
        12: 160,
        13: 250,
        14: 400,
        15: 640,
        16: 1000,
      };
      const c = Number(coeffByGrade[g]);
      if (!Number.isFinite(c)) return null;
      const d = Math.max(1, Math.min(500, Math.abs(Number(diameterMm) || 25)));
      const iMicrons = (0.45 * Math.cbrt(d)) + (0.001 * d);
      return (c * iMicrons) / 1000;
    };
    const fitMatch = spec.match(/^(?:(\d+(?:\.\d+)?)\s*)?([A-Za-z]{1,2})\s*(\d{1,2})$/);
    if (fitMatch) {
      const fitNominal = toNumOrNull(fitMatch[1]);
      const rawLetter = fitMatch[2];
      const grade = Number(fitMatch[3]);
      const refNominal = fitNominal ?? nominal ?? 25;
      const it = iso286ItToleranceMm(refNominal, grade);
      if (Number.isFinite(it) && it > 0) {
        const letter = rawLetter.toLowerCase();
        const out = {
          lowerDeviation: null,
          upperDeviation: null,
          nominal: fitNominal,
        };
        if (letter === 'h') {
          out.lowerDeviation = -it;
          out.upperDeviation = 0;
          return out;
        }
        if (letter === 'js' || letter === 'j') {
          out.lowerDeviation = -(it / 2);
          out.upperDeviation = (it / 2);
          return out;
        }
        out.lowerDeviation = 0;
        out.upperDeviation = it;
        return out;
      }
    }
    const plusMinus = spec.match(/±\s*(\d+(?:\.\d+)?)/);
    if (plusMinus) {
      const tol = toNumOrNull(plusMinus[1]);
      if (tol != null) return { lowerDeviation: -Math.abs(tol), upperDeviation: Math.abs(tol) };
    }
    const explicit = spec.match(/\+\s*(\d+(?:\.\d+)?)\s*(?:\/|\s|;|,)?\s*-\s*(\d+(?:\.\d+)?)/);
    if (explicit) {
      const up = toNumOrNull(explicit[1]);
      const down = toNumOrNull(explicit[2]);
      if (up != null && down != null) return { lowerDeviation: -Math.abs(down), upperDeviation: Math.abs(up) };
    }
    const pair = spec.match(/(-?\d+(?:\.\d+)?)\s*(?:\/|;|,|\s)\s*(-?\d+(?:\.\d+)?)/);
    if (pair) {
      const a = toNumOrNull(pair[1]);
      const b = toNumOrNull(pair[2]);
      if (a != null && b != null && a <= 0 && b >= 0) return { lowerDeviation: a, upperDeviation: b };
    }
    return null;
  };
  const round6 = (n) => (n == null || !Number.isFinite(Number(n)) ? null : Number(Number(n).toFixed(6)));
  let nominal = toNumOrNull(next.nominal);
  let lsl = toNumOrNull(next.lsl);
  let usl = toNumOrNull(next.usl);
  let lowerDeviation = toNumOrNull(next.lowerDeviation);
  let upperDeviation = toNumOrNull(next.upperDeviation);

  if (field === 'toleranceSpec') {
    const fromSpec = parseToleranceSpecInput(next.toleranceSpec);
    if (fromSpec) {
      if (nominal == null && toNumOrNull(fromSpec.nominal) != null) nominal = round6(fromSpec.nominal);
      lowerDeviation = round6(fromSpec.lowerDeviation);
      upperDeviation = round6(fromSpec.upperDeviation);
    }
  }

  if (field === 'lowerDeviation' && lowerDeviation != null && lowerDeviation > 0) lowerDeviation = -Math.abs(lowerDeviation);
  if (field === 'upperDeviation' && upperDeviation != null && upperDeviation < 0) upperDeviation = Math.abs(upperDeviation);

  if (field === 'lsl' || field === 'usl') {
    if (lsl != null && usl != null) nominal = round6((lsl + usl) / 2);
    if (nominal != null && lsl != null) lowerDeviation = round6(lsl - nominal);
    if (nominal != null && usl != null) upperDeviation = round6(usl - nominal);
  } else if (['nominal', 'lowerDeviation', 'upperDeviation', 'toleranceSpec'].includes(field)) {
    if (nominal != null && lowerDeviation != null) lsl = round6(nominal + lowerDeviation);
    if (nominal != null && upperDeviation != null) usl = round6(nominal + upperDeviation);
    if (nominal == null && lsl != null && usl != null) nominal = round6((lsl + usl) / 2);
  }

  if (nominal != null && lsl != null && (field === 'nominal' || field === 'lsl')) lowerDeviation = round6(lsl - nominal);
  if (nominal != null && usl != null && (field === 'nominal' || field === 'usl')) upperDeviation = round6(usl - nominal);

  next.nominal = nominal;
  next.lsl = lsl;
  next.usl = usl;
  next.lowerDeviation = lowerDeviation;
  next.upperDeviation = upperDeviation;
  docsApi.upsertProductAnnotation(next);
}

function deleteAnnotation(annotationId) {
  const current = docsApi.productAnnotationById(annotationId, state.selectedProductId);
  if (!current) return;
  if (!confirm(`Delete master annotation ${current.id || annotationId}?`)) return;
  docsApi.deleteProductAnnotation(annotationId);
  refresh();
  setStatus(`Deleted annotation ${current.id || annotationId}.`);
}

function normalizeBbox(raw) {
  const x1 = Number(raw?.x1 ?? raw?.x ?? raw?.left);
  const y1 = Number(raw?.y1 ?? raw?.y ?? raw?.top);
  const x2Direct = Number(raw?.x2 ?? raw?.right);
  const y2Direct = Number(raw?.y2 ?? raw?.bottom);
  const width = Number(raw?.width);
  const height = Number(raw?.height);
  const x2 = Number.isFinite(x2Direct) ? x2Direct : (Number.isFinite(x1) && Number.isFinite(width) ? x1 + width : NaN);
  const y2 = Number.isFinite(y2Direct) ? y2Direct : (Number.isFinite(y1) && Number.isFinite(height) ? y1 + height : NaN);
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  const nx1 = Math.min(x1, x2);
  const ny1 = Math.min(y1, y2);
  const nx2 = Math.max(x1, x2);
  const ny2 = Math.max(y1, y2);
  if (Math.abs(nx2 - nx1) < 1e-6 || Math.abs(ny2 - ny1) < 1e-6) return null;
  return { x1: nx1, y1: ny1, x2: nx2, y2: ny2 };
}

async function imageDimensionsFromDataUrl(dataUrl) {
  const src = str(dataUrl);
  if (!src) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve({
        width: Math.max(0, Number(img.naturalWidth || img.width || 0)),
        height: Math.max(0, Number(img.naturalHeight || img.height || 0)),
      });
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function scaleNormalizedBboxToImage(bbox, imageSize) {
  const box = normalizeBbox(bbox);
  if (!box) return null;
  const width = Math.max(0, Number(imageSize?.width || 0));
  const height = Math.max(0, Number(imageSize?.height || 0));
  if (!width || !height) return box;
  const values = [box.x1, box.y1, box.x2, box.y2];
  const looksNormalized = values.every((v) => Number.isFinite(v) && v >= -0.02 && v <= 1.02);
  if (!looksNormalized) return box;
  return normalizeBbox({
    x1: box.x1 * width,
    y1: box.y1 * height,
    x2: box.x2 * width,
    y2: box.y2 * height,
  });
}

function bboxFromOcrZone(zone) {
  const z = zone && typeof zone === 'object' ? zone : {};
  if (z?.bbox && typeof z.bbox === 'object' && !Array.isArray(z.bbox)) return normalizeBbox(z.bbox);
  if (Array.isArray(z?.bbox) && z.bbox.length >= 4) {
    return normalizeBbox({ x1: z.bbox[0], y1: z.bbox[1], x2: z.bbox[2], y2: z.bbox[3] });
  }
  return normalizeBbox(z);
}

function extractOcrZones(payload) {
  const src = payload && typeof payload === 'object' ? payload : {};
  if (Array.isArray(src.zones)) return src.zones;
  if (Array.isArray(src.data?.zones)) return src.data.zones;
  if (Array.isArray(src.result?.zones)) return src.result.zones;
  return [];
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function toPositiveMagnitude(value) {
  const n = numberOrNull(value);
  if (n == null) return null;
  return Math.abs(n);
}

function normalizeOcrUnit(raw) {
  const txt = str(raw || '').toLowerCase();
  if (!txt) return '';
  if (txt === 'inch' || txt === 'inches') return 'in';
  if (txt === '°' || txt === 'deg' || txt === 'degree') return 'deg';
  return txt;
}

function parseOcrSpecFromText(rawText) {
  const raw = str(rawText || '').replace(/\s+/g, ' ').trim();
  if (!raw) {
    return {
      name: '',
      nominal: null,
      lsl: null,
      usl: null,
      lowerDeviation: null,
      upperDeviation: null,
      toleranceSpec: '',
      unit: '',
    };
  }
  const txt = raw
    .replace(/[−–—]/g, '-')
    .replace(/,/g, '.')
    .replace(/\s+/g, ' ')
    .trim();
  let nominal = null;
  let lsl = null;
  let usl = null;
  let lowerDeviation = null;
  let upperDeviation = null;
  let toleranceSpec = '';
  let unit = '';

  const unitMatch = txt.match(/\b(mm|cm|m|in|inch|inches|deg|°)\b/i);
  if (unitMatch) unit = normalizeOcrUnit(unitMatch[1]);

  const plusMinus = txt.match(/(-?\d+(?:\.\d+)?)\s*(?:±|\+\/-|\+\/−)\s*(\d+(?:\.\d+)?)/);
  if (plusMinus) {
    nominal = numberOrNull(plusMinus[1]);
    const tol = numberOrNull(plusMinus[2]);
    if (nominal != null && tol != null) {
      lowerDeviation = -Math.abs(tol);
      upperDeviation = Math.abs(tol);
      lsl = nominal + lowerDeviation;
      usl = nominal + upperDeviation;
      toleranceSpec = `±${Math.abs(tol)}`;
    }
  }

  if (nominal == null) {
    const plusMinusPair = txt.match(/(-?\d+(?:\.\d+)?)\s*\+\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
    if (plusMinusPair) {
      nominal = numberOrNull(plusMinusPair[1]);
      const up = numberOrNull(plusMinusPair[2]);
      const down = numberOrNull(plusMinusPair[3]);
      if (nominal != null && up != null && down != null) {
        upperDeviation = Math.abs(up);
        lowerDeviation = -Math.abs(down);
        lsl = nominal + lowerDeviation;
        usl = nominal + upperDeviation;
        toleranceSpec = `+${Math.abs(up)} -${Math.abs(down)}`;
      }
    }
  }

  if (nominal == null) {
    const stackedPair = txt.match(/(-?\d+(?:\.\d+)?)\s*\+\s*(\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/);
    if (stackedPair) {
      nominal = numberOrNull(stackedPair[1]);
      const up = numberOrNull(stackedPair[2]);
      const down = numberOrNull(stackedPair[3]);
      if (nominal != null && up != null && down != null) {
        upperDeviation = Math.abs(up);
        lowerDeviation = -Math.abs(down);
        lsl = nominal + lowerDeviation;
        usl = nominal + upperDeviation;
        toleranceSpec = `+${Math.abs(up)} -${Math.abs(down)}`;
      }
    }
  }

  if (nominal == null) {
    const range = txt.match(/(-?\d+(?:\.\d+)?)\s*(?:\.\.|->|to)\s*(-?\d+(?:\.\d+)?)/i);
    if (range) {
      const a = numberOrNull(range[1]);
      const b = numberOrNull(range[2]);
      if (a != null && b != null) {
        lsl = Math.min(a, b);
        usl = Math.max(a, b);
        nominal = (lsl + usl) / 2;
      }
    }
  }

  if (nominal == null) {
    const onlyOneNumber = txt.match(/-?\d+(?:\.\d+)?/);
    const textWithoutUnits = txt.replace(/\b(mm|cm|m|in|inch|inches|deg|°)\b/gi, '').trim();
    if (onlyOneNumber && /^[^A-Za-z]*-?\d+(?:\.\d+)?[^A-Za-z]*$/.test(textWithoutUnits)) {
      nominal = numberOrNull(onlyOneNumber[0]);
    }
  }

  return {
    name: raw,
    nominal,
    lsl,
    usl,
    lowerDeviation,
    upperDeviation,
    toleranceSpec,
    unit,
  };
}

function parseOcrSpecFromZone(zone, idx = 0) {
  const z = zone && typeof zone === 'object' ? zone : {};
  const tol = z?.tolerance_info && typeof z.tolerance_info === 'object'
    ? z.tolerance_info
    : (z?.toleranceInfo && typeof z.toleranceInfo === 'object' ? z.toleranceInfo : {});
  const fallbackName = `OCR ${idx + 1}`;
  const text = str(z?.text || z?.value || z?.label || z?.name || fallbackName);
  const parsedText = parseOcrSpecFromText(text);
  const tolValue = numberOrNull(tol?.value ?? tol?.nominal);
  const tolPlus = toPositiveMagnitude(tol?.tolerance_plus ?? tol?.plus ?? tol?.upper ?? tol?.upper_tol ?? tol?.upperTolerance);
  const tolMinus = toPositiveMagnitude(tol?.tolerance_minus ?? tol?.minus ?? tol?.lower ?? tol?.lower_tol ?? tol?.lowerTolerance);
  const nominal = numberOrNull(z?.nominal ?? z?.value_num ?? tolValue ?? parsedText.nominal);
  let lsl = numberOrNull(z?.lsl ?? z?.min ?? parsedText.lsl);
  let usl = numberOrNull(z?.usl ?? z?.max ?? parsedText.usl);
  let lowerDeviation = numberOrNull(z?.lowerDeviation ?? z?.lower_deviation ?? parsedText.lowerDeviation);
  let upperDeviation = numberOrNull(z?.upperDeviation ?? z?.upper_deviation ?? parsedText.upperDeviation);
  if (upperDeviation == null && tolPlus != null) upperDeviation = Math.abs(tolPlus);
  if (lowerDeviation == null && tolMinus != null) lowerDeviation = -Math.abs(tolMinus);
  if (nominal != null) {
    if (lsl == null && lowerDeviation != null) lsl = nominal + lowerDeviation;
    if (usl == null && upperDeviation != null) usl = nominal + upperDeviation;
  }
  let toleranceSpec = str(z?.toleranceSpec || z?.tolerance_spec || parsedText.toleranceSpec || '');
  if (!toleranceSpec && tol?.tolerance_class) toleranceSpec = str(tol.tolerance_class);
  if (!toleranceSpec && upperDeviation != null && lowerDeviation != null) {
    const up = Math.abs(upperDeviation);
    const down = Math.abs(lowerDeviation);
    toleranceSpec = up === down ? `±${up}` : `+${up} -${down}`;
  }
  const unit = normalizeOcrUnit(z?.unit || tol?.unit || parsedText.unit || 'mm') || 'mm';
  return {
    name: str(z?.name || parsedText.name || fallbackName),
    nominal,
    lsl,
    usl,
    lowerDeviation,
    upperDeviation,
    toleranceSpec,
    unit,
  };
}

function shouldImportOcrZone(zone, parsed) {
  const z = zone && typeof zone === 'object' ? zone : {};
  const hasDimFlag = z?.is_dimension === true || z?.isDimension === true;
  const category = str(z?.category || '').toLowerCase();
  const isDimensionCategory = category === 'dimension' || category === 'tolerance' || category === 'thread';
  const text = str(z?.text || z?.value || z?.label || '');
  const hasNumericSpec = [parsed?.nominal, parsed?.lsl, parsed?.usl, parsed?.lowerDeviation, parsed?.upperDeviation]
    .some((v) => Number.isFinite(Number(v)));
  const hasToleranceTag = !!str(parsed?.toleranceSpec || '').trim();
  const pureValueLike = /^[\sØ∅-]*\d+(?:[\.,]\d+)?(?:\s*(?:mm|cm|m|in|deg|°))?$/i.test(text);
  const symbolLike = /[±+\-]|(?:\b[HhGgFfEeDd][0-9]{1,2}\b)|(?:\bM\d)/.test(text);
  const looksLikeDimensionText = /\d/.test(text) && (pureValueLike || symbolLike);
  if (hasDimFlag || isDimensionCategory) return true;
  if (hasNumericSpec && looksLikeDimensionText) return true;
  if (hasToleranceTag && looksLikeDimensionText) return true;
  return false;
}

function numericMarkerOrNull(value) {
  const txt = str(value || '');
  if (!/^\d+$/.test(txt)) return null;
  const n = Number(txt);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function allocateNumericMarker(usedSet, preferred = 1) {
  let candidate = Math.max(1, Math.floor(Number(preferred) || 1));
  while (usedSet.has(candidate)) candidate += 1;
  usedSet.add(candidate);
  return String(candidate);
}

async function buildThumbForZone(imageDataUrl, bbox) {
  if (!ocrApi || !imageDataUrl || !bbox) return '';
  try {
    const out = await ocrApi.callOcrThumbnailWithRetry(imageDataUrl, bbox, ocrApi.ensureOcrUrlInput(), 0);
    return str(out?.thumbnail?.data_url || '');
  } catch {
    return '';
  }
}

async function autoOcrCurrentDocument() {
  const productId = str(state.selectedProductId);
  const doc = selectedDocument();
  if (!productId) {
    setStatus('Pick a product first.');
    return;
  }
  if (!doc) {
    setStatus('Pick a document first.');
    return;
  }
  if (!ocrApi) {
    setStatus('OCR runtime is not available on this page.');
    return;
  }
  const imageDataUrl = str(doc.previewDataUrl || doc.dataUrl || '');
  const mime = str(doc.previewMime || doc.mime || '');
  if (!/^data:image\//i.test(imageDataUrl) || /pdf/i.test(mime) && !str(doc.previewDataUrl)) {
    setStatus('This drawing needs an image preview before OCR can run.');
    return;
  }
  setBusyStatus(true, 'Running OCR on selected drawing...');
  try {
    const uploadFile = await dataUrlToFile(imageDataUrl, doc.name || 'drawing.png', mime || 'image/png');
    const out = await ocrApi.callOcrProcessWithRetry(uploadFile, 'accurate', ocrApi.ensureOcrUrlInput(), 0);
    const zones = extractOcrZones(out);
    const imageSize = await imageDimensionsFromDataUrl(imageDataUrl);
    const existingDocAnnotations = docsApi.listProductAnnotations(productId, doc.id) || [];
    const existingById = new Map(existingDocAnnotations.map((row) => [str(row?.id), row]));
    const usedMarkers = new Set(
      existingDocAnnotations
        .map((row) => numericMarkerOrNull(row?.sourceBubbleId))
        .filter((n) => n != null),
    );
    let imported = 0;
    for (let idx = 0; idx < zones.length; idx += 1) {
      const zone = zones[idx];
      const bbox = scaleNormalizedBboxToImage(bboxFromOcrZone(zone), imageSize);
      if (!bbox) continue;
      const parsed = parseOcrSpecFromZone(zone, idx);
      if (!shouldImportOcrZone(zone, parsed)) continue;
      const annId = str(zone?.id) || docsApi.normalizeProductAnnotation({}).id;
      const existing = existingById.get(annId) || null;
      const existingMarker = numericMarkerOrNull(existing?.sourceBubbleId);
      const sourceBubbleId = existingMarker != null
        ? String(existingMarker)
        : allocateNumericMarker(usedMarkers, idx + 1);
      const parsedName = str(parsed?.name || '');
      const normalizedName = /^ocr[_\s-]*zone[_\s-]*\d+$/i.test(parsedName) ? sourceBubbleId : parsedName;
      const thumb = await buildThumbForZone(imageDataUrl, bbox);
      docsApi.upsertProductAnnotation({
        id: annId,
        productId,
        documentId: doc.id,
        sourceBubbleId,
        name: normalizedName,
        nominal: parsed.nominal,
        lsl: parsed.lsl,
        usl: parsed.usl,
        lowerDeviation: parsed.lowerDeviation,
        upperDeviation: parsed.upperDeviation,
        toleranceSpec: parsed.toleranceSpec,
        method: 'OCR',
        unit: parsed.unit,
        bbox,
        thumbnailDataUrl: thumb,
        thumbnailBBox: bbox,
      });
      imported += 1;
    }
    refresh();
    setStatus(imported ? `Imported ${imported} OCR annotation${imported === 1 ? '' : 's'} to this drawing.` : 'OCR found no usable annotation boxes.');
  } catch (err) {
    setStatus(`Auto OCR failed: ${err?.message || err || 'unknown error'}`);
  } finally {
    setBusyStatus(false);
  }
}

function openSpacialWithDocument() {
  const product = getProductById(state.selectedProductId);
  const ann = selectedAnnotation();
  const doc = ann?.documentId
    ? docsApi.productDocumentById(ann.documentId, state.selectedProductId)
    : selectedDocument();
  if (!product?.id) {
    setStatus('Pick a product first.');
    return;
  }
  if (doc?.mime?.includes('pdf') && !str(doc?.previewDataUrl)) {
    setStatus('This PDF still needs a preview image before Router can place linked marks on it.');
    return;
  }
  const url = new URL('./SPaCial.html', window.location.href);
  if (product?.id) url.searchParams.set('product', String(product.id || ''));
  if (doc?.id) {
    localStorage.setItem(PRODUCT_DOC_HANDOFF_KEY, JSON.stringify({
      productId: product?.id || '',
      documentId: doc.id,
      createdAt: new Date().toISOString(),
    }));
    url.searchParams.set('documentId', String(doc.id || ''));
  }
  window.location.href = url.toString();
}

async function buildCurrentDocumentPreview() {
  const doc = selectedDocument();
  if (!doc) {
    setStatus('Pick a document first.');
    return;
  }
  await buildPdfPreviewForDocument(doc);
}

function bindEvents() {
  $('openHubBtn')?.addEventListener('click', () => { window.location.href = './vmill_hub.html#blueprint-manager'; });
  $('openSpacialBtn')?.addEventListener('click', () => { window.location.href = './SPaCial.html'; });
  $('openDrawingSettingsBtn')?.addEventListener('click', () => setSettingsModalOpen(true));
  $('closeDrawingSettingsBtn')?.addEventListener('click', () => setSettingsModalOpen(false));
  $('drawingSettingsModal')?.addEventListener('click', (event) => {
    if (event.target === $('drawingSettingsModal')) setSettingsModalOpen(false);
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setSettingsModalOpen(false);
  });
  $('productSel')?.addEventListener('change', () => {
    state.selectedProductId = str($('productSel').value);
    state.selectedDocId = '';
    state.selectedAnnId = '';
    refresh();
  });
  $('docSel')?.addEventListener('change', () => {
    state.selectedDocId = str($('docSel').value);
    state.selectedAnnId = '';
    renderDocuments();
    renderAnnotations();
  });
  $('annScopeSel')?.addEventListener('change', () => {
    state.annScope = str($('annScopeSel').value) || 'document';
    renderAnnotations();
  });
  $('annSearchIn')?.addEventListener('input', () => {
    state.annSearch = $('annSearchIn').value || '';
    renderAnnotations();
  });
  $('uploadDocBtn')?.addEventListener('click', () => $('docInput')?.click());
  $('docInput')?.addEventListener('change', async (event) => {
    try {
      await uploadDocuments(event.target.files);
    } catch (err) {
      setStatus(`Upload failed: ${err?.message || err || 'unknown error'}`);
    } finally {
      event.target.value = '';
    }
  });
  $('buildPreviewBtn')?.addEventListener('click', buildCurrentDocumentPreview);
  $('autoOcrDocBtn')?.addEventListener('click', autoOcrCurrentDocument);
  $('saveDocBtn')?.addEventListener('click', saveDocumentFromInputs);
  $('deleteDocBtn')?.addEventListener('click', deleteCurrentDocument);
  $('openInSpacialBtn')?.addEventListener('click', openSpacialWithDocument);
  $('annDetailOpenSpacialBtn')?.addEventListener('click', openSpacialWithDocument);
  $('bubbleOcrUrlIn')?.addEventListener('change', () => {
    if (!ocrApi) return;
    const normalized = ocrApi.normalizeHttpBaseUrl($('bubbleOcrUrlIn').value);
    if (normalized) $('bubbleOcrUrlIn').value = normalized;
  });
  $('bubbleOcrSaveBtn')?.addEventListener('click', () => {
    if (!ocrApi) {
      setStatus('OCR runtime is not available on this page.');
      return;
    }
    ocrApi.saveOcrServerSettings();
  });
  $('bubbleOcrTestBtn')?.addEventListener('click', async () => {
    if (!ocrApi) {
      setStatus('OCR runtime is not available on this page.');
      return;
    }
    await ocrApi.testOcrConnection();
  });
  [
    'bubbleDisplayBoxColorIn',
    'bubbleDisplayColorIn',
    'bubbleDisplaySelectedColorIn',
    'bubbleDisplayTextColorIn',
    'bubbleDisplaySizeIn',
    'bubbleDisplayFontSizeIn',
    'bubbleDisplayShowBoxChk',
    'bubbleDisplayShowBubbleChk',
    'bubbleDisplayShowTextChk',
    'bubbleDisplayBubbleFillChk',
    'bubbleDisplayRainbowExportChk',
    'bubbleDisplayExportPresetSel',
    'bubbleDisplayExportTextColorIn',
    'bubbleDisplayExportSizeIn',
    'bubbleDisplayHandleSizeIn',
    'bubbleDisplayHandleModeSel',
  ].forEach((id) => {
    $(id)?.addEventListener('input', saveBubbleDisplaySettingsFromUi);
    $(id)?.addEventListener('change', saveBubbleDisplaySettingsFromUi);
  });
  document.querySelectorAll('[data-bubble-display-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = btn.getAttribute('data-bubble-display-preset');
      applyBubbleDisplaySettings(bubbleDisplayPresetValues(preset));
      renderPreviewOverlay();
      setStatus(`Applied drawing display preset: ${preset || 'default'}.`);
    });
  });
  $('bubbleDisplayResetBtn')?.addEventListener('click', () => {
    localStorage.removeItem(DISPLAY_SETTINGS_KEY);
    applyBubbleDisplaySettings(defaultBubbleDisplaySettings());
    renderPreviewOverlay();
    setStatus('Drawing display settings reset to factory defaults.');
  });
  $('docList')?.addEventListener('click', (event) => {
    const card = event.target.closest('[data-doc-card]');
    if (!card) return;
    state.selectedDocId = str(card.getAttribute('data-doc-card'));
    state.selectedAnnId = '';
    renderDocuments();
    renderAnnotations();
  });
  $('annList')?.addEventListener('click', (event) => {
    const delBtn = event.target.closest('[data-ann-delete]');
    if (delBtn) {
      deleteAnnotation(str(delBtn.getAttribute('data-ann-delete')));
      return;
    }
    if (event.target.closest('input, textarea, select, button, label')) {
      return;
    }
    const card = event.target.closest('[data-ann-card]');
    if (card) {
      state.selectedAnnId = str(card.getAttribute('data-ann-card'));
      renderAnnotations();
    }
  });
  $('annList')?.addEventListener('change', (event) => {
    const input = event.target.closest('[data-ann-field][data-ann-id]');
    if (!input) return;
    updateAnnotationField(str(input.getAttribute('data-ann-id')), str(input.getAttribute('data-ann-field')), input.value);
    state.selectedAnnId = str(input.getAttribute('data-ann-id'));
    renderAnnotations();
    setStatus(`Updated annotation ${input.getAttribute('data-ann-id')}.`);
  });
  window.addEventListener('vmill:data:changed', refresh);
  window.addEventListener('storage', refresh);
  window.addEventListener('resize', () => renderPreviewOverlay());
}

export function boot() {
  const params = queryParams();
  state.selectedProductId = str(params.get('productId') || params.get('product') || '');
  state.selectedDocId = str(params.get('documentId') || params.get('doc') || '');
  state.annScope = str($('annScopeSel')?.value || 'document') || 'document';
  bindEvents();
  bindPreviewInteractions();
  if (ocrApi?.updateOcrSettingsUi) ocrApi.updateOcrSettingsUi(ocrApi.defaultOcrUrl());
  updateBubbleDisplaySettingsUi(readBubbleDisplaySettings());
  refresh();
  if (state.selectedDocId) writeDocumentToInputs(selectedDocument());
  setStatus(tt('blueprint.ready', 'Drawing Manager ready.'));
}
