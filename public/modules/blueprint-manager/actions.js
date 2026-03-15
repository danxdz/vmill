import { $, state, tt, setStatus, setBusyStatus, str, getProducts, getProductById, queryParams, docsApi, ocrApi } from './core.js';
import { renderAll, renderDocuments, renderAnnotations, renderPreviewOverlay, renderSettingsLivePreview, writeDocumentToInputs, bindPreviewInteractions, clearAnnPopover } from './render.js';

const PRODUCT_DOC_HANDOFF_KEY = 'vmill:spacial:product-doc-handoff';
const DISPLAY_SETTINGS_KEY = 'vmill:spacial:display';
const NS_SPACIAL_CONFIG = 'spacial_config';
const SPACIAL_DISPLAY_SETTINGS_ID = 'bubble_display';
const thumbnailRefreshTimers = new Map();

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
    thumbListMax: 50,
    thumbListMin: 24,
    thumbDetailMax: 176,
    thumbDetailMin: 72,
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
  const thumbListMax = clampDisplaySettingNumber(src.thumbListMax, 24, 96, base.thumbListMax);
  const thumbListMin = clampDisplaySettingNumber(src.thumbListMin, 16, 64, base.thumbListMin);
  const thumbDetailMax = clampDisplaySettingNumber(src.thumbDetailMax, 96, 320, base.thumbDetailMax);
  const thumbDetailMin = clampDisplaySettingNumber(src.thumbDetailMin, 48, 180, base.thumbDetailMin);
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
    thumbListMax: Math.max(thumbListMin, thumbListMax),
    thumbListMin: Math.min(thumbListMin, thumbListMax),
    thumbDetailMax: Math.max(thumbDetailMin, thumbDetailMax),
    thumbDetailMin: Math.min(thumbDetailMin, thumbDetailMax),
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
  if ($('bubbleDisplayThumbListMaxIn')) $('bubbleDisplayThumbListMaxIn').value = String(cfg.thumbListMax);
  if ($('bubbleDisplayThumbListMinIn')) $('bubbleDisplayThumbListMinIn').value = String(cfg.thumbListMin);
  if ($('bubbleDisplayThumbDetailMaxIn')) $('bubbleDisplayThumbDetailMaxIn').value = String(cfg.thumbDetailMax);
  if ($('bubbleDisplayThumbDetailMinIn')) $('bubbleDisplayThumbDetailMinIn').value = String(cfg.thumbDetailMin);
  const info = $('bubbleDisplaySettingsInfo');
  if (info) {
    const modeLabel = cfg.handleMode === 'always' ? 'always' : (cfg.handleMode === 'never' ? 'hidden' : 'on hover');
    const parts = [];
    if (cfg.boxVisible) parts.push('box');
    if (cfg.bubbleVisible) parts.push('bubble');
    if (cfg.textVisible) parts.push('number');
    const visualMode = parts.length ? parts.join(' + ') : 'hidden';
    info.textContent = `Bubble ${cfg.bubbleSize}px | Font ${cfg.bubbleFontSize}px | Thumbs ${cfg.thumbListMax}/${cfg.thumbDetailMax}px | ${visualMode} | Export ${cfg.exportPreset} (${cfg.exportBubbleSize}px)${cfg.rainbowExport ? ' + rainbow' : ''} | Pins ${modeLabel}`;
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
    thumbListMax: $('bubbleDisplayThumbListMaxIn')?.value,
    thumbListMin: $('bubbleDisplayThumbListMinIn')?.value,
    thumbDetailMax: $('bubbleDisplayThumbDetailMaxIn')?.value,
    thumbDetailMin: $('bubbleDisplayThumbDetailMinIn')?.value,
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
  applyStaticUiText();
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

function applyStaticUiText() {
  document.title = tt('blueprint.pageTitle', 'Drawing Manager');
  if ($('pageTitle')) $('pageTitle').textContent = tt('blueprint.pageTitle', 'Drawing Manager');
  if ($('pageSub')) $('pageSub').textContent = tt('blueprint.pageSub', 'Product drawings, OCR, and bubbles for Router.');
  if ($('openHubBtn')) $('openHubBtn').textContent = tt('common.hub', 'Hub');
  if ($('openSpacialBtn')) $('openSpacialBtn').textContent = tt('common.router', 'Router');
  if ($('openDrawingSettingsBtn')) $('openDrawingSettingsBtn').textContent = tt('blueprint.drawingSettings', 'Drawing Settings');
  if ($('contextTitle')) $('contextTitle').textContent = tt('common.context', 'Context');
  const setLabel = (forId, key, fallback) => {
    const el = document.querySelector(`label[for="${forId}"]`);
    if (el) el.textContent = tt(key, fallback);
  };
  setLabel('productSel', 'common.product', 'Product');
  setLabel('docSel', 'common.document', 'Document');
  setLabel('docRevisionIn', 'common.revision', 'Revision');
  setLabel('docNameIn', 'blueprint.documentName', 'Document Name');
  setLabel('docNotesIn', 'common.notes', 'Notes');
  setLabel('annSearchIn', 'common.search', 'Search');
  setLabel('annScopeSel', 'common.scope', 'Scope');
  setLabel('bubbleOcrUrlIn', 'blueprint.ocrServerUrl', 'OCR Server URL');
  setLabel('bubbleOcrPortIn', 'common.port', 'Port');
  setLabel('bubbleDisplayBoxColorIn', 'blueprint.boxColor', 'Box Color');
  setLabel('bubbleDisplayColorIn', 'blueprint.bubbleColor', 'Bubble Color');
  setLabel('bubbleDisplaySelectedColorIn', 'blueprint.selectedColor', 'Selected Color');
  setLabel('bubbleDisplayTextColorIn', 'blueprint.textColor', 'Text Color');
  setLabel('bubbleDisplaySizeIn', 'blueprint.bubbleSize', 'Bubble Size');
  setLabel('bubbleDisplayFontSizeIn', 'blueprint.fontSize', 'Font Size');
  setLabel('bubbleDisplayHandleSizeIn', 'blueprint.resizePinSize', 'Resize Pin Size');
  setLabel('bubbleDisplayHandleModeSel', 'blueprint.resizePins', 'Resize Pins');
  setLabel('bubbleDisplayThumbListMaxIn', 'blueprint.listThumbMax', 'List Thumb Max');
  setLabel('bubbleDisplayThumbListMinIn', 'blueprint.listThumbMin', 'List Thumb Min');
  setLabel('bubbleDisplayThumbDetailMaxIn', 'blueprint.detailThumbMax', 'Detail Thumb Max');
  setLabel('bubbleDisplayThumbDetailMinIn', 'blueprint.detailThumbMin', 'Detail Thumb Min');
  setLabel('bubbleDisplayShowBoxChk', 'blueprint.showBox', 'Show Box');
  setLabel('bubbleDisplayShowBubbleChk', 'blueprint.showBubble', 'Show Bubble');
  setLabel('bubbleDisplayShowTextChk', 'blueprint.showNumber', 'Show Number');
  setLabel('bubbleDisplayBubbleFillChk', 'blueprint.fillBubble', 'Fill Bubble');
  setLabel('bubbleDisplayRainbowExportChk', 'blueprint.rainbowExport', 'Rainbow Export');
  setLabel('bubbleDisplayExportPresetSel', 'blueprint.exportPreset', 'Export Preset');
  setLabel('bubbleDisplayExportTextColorIn', 'blueprint.exportTextColor', 'Export Text Color');
  setLabel('bubbleDisplayExportSizeIn', 'blueprint.exportBubbleSize', 'Export Bubble Size');
  if ($('docRevisionIn')) $('docRevisionIn').placeholder = tt('blueprint.revisionPlaceholder', 'A / B / AB-000');
  if ($('docNameIn')) $('docNameIn').placeholder = tt('blueprint.documentNamePlaceholder', 'Blueprint / PDF name');
  if ($('docNotesIn')) $('docNotesIn').placeholder = tt('blueprint.documentNotesPlaceholder', 'Optional notes about this document or revision');
  if ($('uploadDocBtn')) $('uploadDocBtn').textContent = tt('blueprint.addDocs', '+ Add Doc(s)');
  if ($('buildPreviewBtn')) $('buildPreviewBtn').textContent = tt('blueprint.buildPdfPreview', 'Build PDF Preview');
  if ($('autoOcrDocBtn')) $('autoOcrDocBtn').textContent = tt('blueprint.autoOcrDrawing', 'Auto OCR This Drawing');
  if ($('saveDocBtn')) $('saveDocBtn').textContent = tt('blueprint.saveDoc', 'Save Doc');
  if ($('deleteDocBtn')) $('deleteDocBtn').textContent = tt('blueprint.deleteDoc', 'Delete Doc');
  if ($('openInSpacialBtn')) $('openInSpacialBtn').textContent = tt('blueprint.openInRouter', 'Open In Router');
  if ($('drawingSettingsTitle')) $('drawingSettingsTitle').textContent = tt('blueprint.drawingSettings', 'Drawing Settings');
  if ($('drawingSettingsSubHint')) $('drawingSettingsSubHint').textContent = tt('blueprint.drawingSettingsHint', 'OCR server, drawing display style, and export presets.');
  if ($('closeDrawingSettingsBtn')) $('closeDrawingSettingsBtn').textContent = tt('common.close', 'Close');
  if ($('drawingSettingsLivePreviewTitle')) $('drawingSettingsLivePreviewTitle').textContent = tt('blueprint.livePreview', 'Live Preview');
  if ($('drawingSettingsPreviewHint')) $('drawingSettingsPreviewHint').textContent = tt('blueprint.livePreviewHint', 'Current drawing with bubble style updates in real time.');
  if ($('drawingSettingsPreviewEmpty')) $('drawingSettingsPreviewEmpty').textContent = tt('blueprint.selectDrawingPreviewStyles', 'Select a drawing to preview style changes here.');
  if ($('drawingDisplayTitle')) $('drawingDisplayTitle').textContent = tt('blueprint.drawingDisplayExport', 'Drawing Display And Export');
  if ($('ocrWorkflowTitle')) $('ocrWorkflowTitle').textContent = tt('blueprint.ocrWorkflow', 'OCR Workflow');
  if ($('bubbleOcrUrlIn')) $('bubbleOcrUrlIn').placeholder = tt('blueprint.ocrServerUrlPlaceholder', 'http://localhost:8000');
  if ($('bubbleOcrSaveBtn')) $('bubbleOcrSaveBtn').textContent = tt('blueprint.saveOcrSettings', 'Save OCR Settings');
  if ($('bubbleOcrTestBtn')) $('bubbleOcrTestBtn').textContent = tt('blueprint.testOcrServer', 'Test OCR Server');
  if ($('ocrHint')) $('ocrHint').textContent = tt('blueprint.ocrHint', 'PDF previews are generated through the OCR server so Router can reuse the same marks later.');
  if ($('documentPreviewTitle')) $('documentPreviewTitle').textContent = tt('blueprint.documentPreview', 'Document Preview');
  if ($('docPreviewEmpty')) $('docPreviewEmpty').textContent = tt('blueprint.pickDocumentPreview', 'Pick a product document to preview it here.');
  if ($('docImagePreview')) $('docImagePreview').alt = tt('blueprint.previewAlt', 'Blueprint preview');
  if ($('docPdfPreview')) $('docPdfPreview').title = tt('blueprint.pdfPreviewTitle', 'Blueprint PDF preview');
  if ($('docZoomFitBtn')) $('docZoomFitBtn').textContent = tt('common.fit', 'Fit');
  if ($('docFullscreenBtn')) {
    $('docFullscreenBtn').textContent = tt('common.fullscreen', 'Fullscreen');
    $('docFullscreenBtn').title = tt('blueprint.expandFullscreen', 'Expand to fullscreen');
  }
  if ($('annotationsTitle')) $('annotationsTitle').textContent = tt('blueprint.annotations', 'Annotations');
  if ($('annSearchIn')) $('annSearchIn').placeholder = tt('blueprint.annotationSearchPlaceholder', 'Filter by id, name, characteristic');
  const scopeSel = $('annScopeSel');
  if (scopeSel?.options?.[0]) scopeSel.options[0].text = tt('blueprint.scopeDocumentOnly', 'Selected document only');
  if (scopeSel?.options?.[1]) scopeSel.options[1].text = tt('blueprint.scopeAllProduct', 'All product annotations');
  if ($('annHint')) $('annHint').textContent = tt('blueprint.annotationsHint', 'These are the saved marks for this product. Router links to them instead of recreating them each time.');
  if ($('selectedAnnotationTitle')) $('selectedAnnotationTitle').textContent = tt('blueprint.selectedAnnotation', 'Selected Annotation');
  if ($('annDetailEmpty')) $('annDetailEmpty').textContent = tt('blueprint.annotationDetailEmpty', 'Pick an annotation to inspect its thumbnail, characteristic link, and operation usage.');
  if ($('annDetailOpenSpacialBtn')) $('annDetailOpenSpacialBtn').textContent = tt('blueprint.openDocInRouter', 'Open Doc In Router');
  if ($('bubbleDisplayResetBtn')) $('bubbleDisplayResetBtn').textContent = tt('blueprint.resetDisplay', 'Reset Display');
}

function saveDocumentFromInputs() {
  const productId = str(state.selectedProductId);
  if (!productId) {
    setStatus(tt('blueprint.pickProductFirst', 'Pick a product first.'));
    return;
  }
  const current = selectedDocument();
  if (!current) {
    setStatus(tt('blueprint.uploadOrSelectDocumentFirst', 'Upload or select a document first.'));
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
  setStatus(tt('blueprint.documentSaved', `Saved document ${next?.name || current.name}.`));
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

function normalizeCardinalRotation(angle, defaultAngle = 0) {
  const v = Number(angle);
  if (!Number.isFinite(v)) return Number(defaultAngle) || 0;
  const snapped = Math.round(v / 90) * 90;
  const norm = ((snapped % 360) + 360) % 360;
  return [0, 90, 180, 270].includes(norm) ? norm : (Number(defaultAngle) || 0);
}

function zoneRotationToCorrection(textRotation) {
  const r = normalizeCardinalRotation(textRotation, 0);
  return normalizeCardinalRotation((360 - r) % 360, 0);
}

function wrapDisplayRotation(angle) {
  const v = Number(angle);
  if (!Number.isFinite(v)) return 0;
  let norm = ((v % 360) + 360) % 360;
  if (norm > 180) norm -= 360;
  return norm;
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
    if (!options.silent) setStatus(tt('blueprint.selectedDocumentNotPdf', 'Selected document is not a PDF.'));
    return null;
  }
  if (!ocrApi) {
    if (!options.silent) setStatus(tt('blueprint.ocrRuntimeUnavailable', 'OCR runtime is not available on this page.'));
    return null;
  }
  const sourceDataUrl = str(doc.dataUrl);
  if (!sourceDataUrl) {
    if (!options.silent) setStatus(tt('blueprint.documentNoStoredPdfData', 'This document has no stored PDF data to convert.'));
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
    setStatus(tt('blueprint.previewReadyForDocument', `Preview ready for ${next?.name || doc.name || 'document'}.`));
    return next || doc;
  } catch (err) {
    if (!options.silent) setStatus(tt('blueprint.pdfPreviewFailed', `PDF preview failed: ${err?.message || err || 'unknown error'}`));
    return null;
  } finally {
    setBusyStatus(false);
  }
}

async function uploadDocuments(files) {
  const productId = str(state.selectedProductId);
  if (!productId) {
    setStatus(tt('blueprint.pickProductFirst', 'Pick a product first.'));
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
        setBusyStatus(true, tt('blueprint.generatingPreview', `Generating preview for ${file.name}...`));
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
      ? tt('blueprint.documentsImportedWithPdfPreview', `Imported ${rows.length} document${rows.length === 1 ? '' : 's'}. PDFs were converted to previews when the OCR server was available.`)
      : tt('blueprint.documentsImported', `Imported ${rows.length} document${rows.length === 1 ? '' : 's'}.`)
  );
}

function deleteCurrentDocument() {
  const doc = selectedDocument();
  if (!doc) return;
  if (!confirm(tt('blueprint.deleteDocumentConfirm', `Delete document ${doc.name || doc.id} and its annotations?`))) return;
  docsApi.deleteProductDocument(doc.id, { deleteAnnotations: true });
  state.selectedDocId = '';
  state.selectedAnnId = '';
  refresh();
  setStatus(tt('blueprint.documentDeleted', `Deleted ${doc.name || doc.id}.`));
}

function updateAnnotationField(annotationId, field, value) {
  const current = docsApi.productAnnotationById(annotationId, state.selectedProductId);
  if (!current) return;
  if (current.validated) {
    setStatus(tt('blueprint.annotationLocked', 'Annotation is locked. Unlock it before editing.'));
    return;
  }
  const next = { ...current };
  if (field === 'thumbnailRotation') {
    const desired = wrapDisplayRotation(value);
    const autoCorrection = wrapDisplayRotation(zoneRotationToCorrection(Number(current.ocrRotation ?? 0)));
    next.thumbnailRotation = wrapDisplayRotation(desired - autoCorrection);
    docsApi.upsertProductAnnotation(next);
    refresh();
    return;
  }
  const numFields = ['nominal', 'lsl', 'usl', 'lowerDeviation', 'upperDeviation', 'thumbnailRotation', 'ocrRotation'];
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
  state.pendingDeleteAnnId = '';
  docsApi.deleteProductAnnotation(annotationId);
  refresh();
  setStatus(tt('blueprint.annotationDeleted', `Deleted annotation ${current.id || annotationId}.`));
}

function setPendingDeleteAnnotation(annotationId = '') {
  state.pendingDeleteAnnId = str(annotationId || '');
  renderAnnotations();
}

function setAnnotationValidated(annotationId, validated) {
  const current = docsApi.productAnnotationById(annotationId, state.selectedProductId);
  if (!current) return;
  docsApi.upsertProductAnnotation({
    ...current,
    validated: validated === true,
  });
  state.pendingDeleteAnnId = '';
  refresh();
  setStatus(validated
    ? tt('blueprint.annotationLockedStatus', 'Annotation validated and locked.')
    : tt('blueprint.annotationUnlockedStatus', 'Annotation unlocked.'));
}

async function rebuildAnnotationThumbnail(annotationId) {
  const annId = str(annotationId);
  const current = docsApi.productAnnotationById(annId, state.selectedProductId);
  if (!current || !ocrApi || !current.bbox) return false;
  const doc = current.documentId
    ? docsApi.productDocumentById(current.documentId, state.selectedProductId)
    : selectedDocument();
  const imageDataUrl = str(doc?.previewDataUrl || doc?.dataUrl || '');
  if (!imageDataUrl) return false;
  const ocrRotation = normalizeCardinalRotation(Number(current.ocrRotation ?? 0), 0);
  const serverRotation = zoneRotationToCorrection(ocrRotation);
  const thumb = await buildThumbForZone(imageDataUrl, current.bbox, serverRotation);
  if (!thumb) return false;
  docsApi.upsertProductAnnotation({
    ...current,
    thumbnailDataUrl: thumb,
    thumbnailBBox: current.bbox,
    thumbnailRotation: Number(current.thumbnailRotation ?? 0) || 0,
  });
  refresh();
  return true;
}

function scheduleAnnotationThumbnailRefresh(annotationId, delayMs = 1000) {
  const annId = str(annotationId);
  if (!annId) return;
  const prev = thumbnailRefreshTimers.get(annId);
  if (prev) clearTimeout(prev);
  const timer = setTimeout(async () => {
    thumbnailRefreshTimers.delete(annId);
    try {
      const ok = await rebuildAnnotationThumbnail(annId);
      if (ok) setStatus(tt('blueprint.thumbnailUpdated', `Updated thumbnail for ${annId}.`));
    } catch {}
  }, Math.max(0, Number(delayMs || 0)));
  thumbnailRefreshTimers.set(annId, timer);
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

function chooseInstrumentForTolerance(parsed) {
  const n = Number(parsed?.nominal);
  const lsl = Number(parsed?.lsl);
  const usl = Number(parsed?.usl);
  const lowerDev = Number(parsed?.lowerDeviation);
  const upperDev = Number(parsed?.upperDeviation);
  let span = NaN;
  if (Number.isFinite(lsl) && Number.isFinite(usl)) {
    span = Math.abs(usl - lsl);
  } else if (Number.isFinite(lowerDev) && Number.isFinite(upperDev)) {
    span = Math.abs(upperDev - lowerDev);
  } else if (Number.isFinite(lowerDev) && Number.isFinite(n)) {
    span = Math.abs(lowerDev) * 2;
  } else if (Number.isFinite(upperDev) && Number.isFinite(n)) {
    span = Math.abs(upperDev) * 2;
  }
  if (!Number.isFinite(span)) return '';
  if (span < 0.05) return 'micrometer';
  if (span >= 0.1) return 'caliper';
  return '';
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
  const plainNumericText = /^[Ø∅Φ]?\s*-?\d+(?:[.,]\d+)?(?:\s*(?:mm|cm|m|in|inch|inches|deg|°))?$/i.test(text);
  const parsedLooksPrecise = Number.isFinite(parsedText.nominal) && /[.,]\d+/.test(text);
  const tolValue = numberOrNull(tol?.value ?? tol?.nominal);
  const tolPlus = toPositiveMagnitude(tol?.tolerance_plus ?? tol?.plus ?? tol?.upper ?? tol?.upper_tol ?? tol?.upperTolerance);
  const tolMinus = toPositiveMagnitude(tol?.tolerance_minus ?? tol?.minus ?? tol?.lower ?? tol?.lower_tol ?? tol?.lowerTolerance);
  const nominal = plainNumericText && parsedLooksPrecise
    ? numberOrNull(parsedText.nominal)
    : numberOrNull(z?.nominal ?? z?.value_num ?? tolValue ?? parsedText.nominal);
  let lsl = plainNumericText && parsedLooksPrecise
    ? null
    : numberOrNull(z?.lsl ?? z?.min ?? parsedText.lsl);
  let usl = plainNumericText && parsedLooksPrecise
    ? null
    : numberOrNull(z?.usl ?? z?.max ?? parsedText.usl);
  let lowerDeviation = plainNumericText && parsedLooksPrecise
    ? null
    : numberOrNull(z?.lowerDeviation ?? z?.lower_deviation ?? parsedText.lowerDeviation);
  let upperDeviation = plainNumericText && parsedLooksPrecise
    ? null
    : numberOrNull(z?.upperDeviation ?? z?.upper_deviation ?? parsedText.upperDeviation);
  if (upperDeviation == null && tolPlus != null) upperDeviation = Math.abs(tolPlus);
  if (lowerDeviation == null && tolMinus != null) lowerDeviation = -Math.abs(tolMinus);
  if (nominal != null) {
    if (lsl == null && lowerDeviation != null) lsl = nominal + lowerDeviation;
    if (usl == null && upperDeviation != null) usl = nominal + upperDeviation;
  }
  let toleranceSpec = plainNumericText && parsedLooksPrecise
    ? ''
    : str(z?.toleranceSpec || z?.tolerance_spec || parsedText.toleranceSpec || '');
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

async function buildThumbForZone(imageDataUrl, bbox, rotationCorrection = 0) {
  if (!ocrApi || !imageDataUrl || !bbox) return '';
  try {
    const out = await ocrApi.callOcrThumbnailWithRetry(imageDataUrl, bbox, ocrApi.ensureOcrUrlInput(), rotationCorrection);
    return str(out?.thumbnail?.data_url || '');
  } catch {
    return '';
  }
}

async function reocrAnnotation(annId) {
  const doc = selectedDocument();
  const productId = str(state.selectedProductId);
  if (!doc || !productId || !ocrApi) {
    setStatus('Select a document and ensure OCR server is configured.');
    return;
  }
  const current = docsApi.productAnnotationById(annId, productId);
  if (!current) {
    setStatus('Annotation not found.');
    return;
  }
  if (current.validated) {
    setStatus(tt('blueprint.annotationLocked', 'Annotation is locked. Unlock it before editing.'));
    return;
  }
  const imageDataUrl = str(doc.previewDataUrl || doc.dataUrl || '');
  if (!/^data:image\//i.test(imageDataUrl)) {
    setStatus('Document needs an image preview to re-OCR.');
    return;
  }
  const bbox = current.bbox || {};
  const x1 = Number(bbox.x1 ?? 0);
  const y1 = Number(bbox.y1 ?? 0);
  const x2 = Number(bbox.x2 ?? 0);
  const y2 = Number(bbox.y2 ?? 0);
  const centerX = (x1 + x2) / 2;
  const centerY = (y1 + y2) / 2;
  const effectiveRotation = wrapDisplayRotation(zoneRotationToCorrection(Number(current.ocrRotation ?? 0)) + (Number(current.thumbnailRotation ?? 0) || 0));
  setBusyStatus(true, `Re-OCR zone ${current.sourceBubbleId || annId}...`);
  try {
    const out = Math.abs(effectiveRotation % 90) > 0.001
      ? await ocrApi.callOcrProcessCenterWithRetry(
          imageDataUrl,
          { x: centerX, y: centerY },
          { x1, y1, x2, y2 },
          ocrApi.ensureOcrUrlInput(),
          effectiveRotation
        )
      : await ocrApi.callOcrAnnotationClickWithRetry(
          imageDataUrl,
          { x: centerX, y: centerY },
          'hardcore',
          ocrApi.ensureOcrUrlInput(),
          effectiveRotation
        );
    const zone = out?.zone;
    if (!zone) {
      setStatus('No text detected at this zone.');
      return;
    }
    const parsed = parseOcrSpecFromZone(zone, 0);
    const newBbox = zone.bbox
      ? {
          x1: Number(zone.bbox.x1 ?? x1),
          y1: Number(zone.bbox.y1 ?? y1),
          x2: Number(zone.bbox.x2 ?? x2),
          y2: Number(zone.bbox.y2 ?? y2),
          width: Number(zone.bbox.width ?? (zone.bbox.x2 - zone.bbox.x1)),
          height: Number(zone.bbox.height ?? (zone.bbox.y2 - zone.bbox.y1)),
        }
      : current.bbox;
    const rawRotation = Number(zone.rotation ?? zone.text_orientation ?? 0);
    const detectedOcrRotation = normalizeCardinalRotation(rawRotation, 0);
    const ocrRotation = current.ocrRotation == null
      ? detectedOcrRotation
      : normalizeCardinalRotation(Number(current.ocrRotation ?? 0), 0);
    const thumbRotation = zoneRotationToCorrection(ocrRotation);
    const thumbDataUrl = await buildThumbForZone(imageDataUrl, newBbox, thumbRotation) || (current.thumbnailDataUrl || '');
    const conf = Number(zone.confidence);
    const confPct = Number.isFinite(conf) ? Math.round(conf * 100) : null;
    docsApi.upsertProductAnnotation({
      ...current,
      name: parsed?.name || str(zone.text) || current.name,
      nominal: parsed?.nominal,
      lsl: parsed?.lsl,
      usl: parsed?.usl,
      lowerDeviation: parsed?.lowerDeviation,
      upperDeviation: parsed?.upperDeviation,
      toleranceSpec: parsed?.toleranceSpec || current.toleranceSpec,
      unit: parsed?.unit || current.unit || 'mm',
      instrument: current.instrument || chooseInstrumentForTolerance(parsed) || '',
      ocrConfidence: confPct != null ? confPct / 100 : (current.ocrConfidence ?? null),
      bbox: newBbox,
      thumbnailDataUrl: thumbDataUrl,
      thumbnailBBox: newBbox,
      thumbnailRotation: Number(current.thumbnailRotation ?? 0) || 0,
      ocrRotation,
    });
    refresh();
    setStatus(confPct != null ? `Re-OCR: "${zone.text}" (${confPct}% confidence)` : `Re-OCR: "${zone.text}"`);
  } catch (err) {
    setStatus(`Re-OCR failed: ${err?.message || err}`);
  } finally {
    setBusyStatus(false);
  }
}

async function createAnnotationFromPreviewPoint(sourcePoint) {
  const doc = selectedDocument();
  const productId = str(state.selectedProductId);
  if (!doc || !productId || !ocrApi) {
    setStatus('Select a document and ensure OCR server is configured.');
    return;
  }
  const x = Number(sourcePoint?.x);
  const y = Number(sourcePoint?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const imageDataUrl = str(doc.previewDataUrl || doc.dataUrl || '');
  if (!/^data:image\//i.test(imageDataUrl)) {
    setStatus('Document needs an image preview before OCR can run.');
    return;
  }
  setBusyStatus(true, 'Creating OCR annotation from click...');
  try {
    const out = await ocrApi.callOcrAnnotationClickWithRetry(
      imageDataUrl,
      { x, y },
      'hardcore',
      ocrApi.ensureOcrUrlInput(),
      0
    );
    const zone = out?.zone;
    if (!zone) {
      setStatus('No text detected at this click point.');
      return;
    }
    const imageSize = await imageDimensionsFromDataUrl(imageDataUrl);
    const bbox = scaleNormalizedBboxToImage(bboxFromOcrZone(zone), imageSize);
    if (!bbox) {
      setStatus('OCR found text but returned no usable box.');
      return;
    }
    const existingDocAnnotations = docsApi.listProductAnnotations(productId, doc.id) || [];
    const usedMarkers = new Set(
      existingDocAnnotations
        .map((row) => numericMarkerOrNull(row?.sourceBubbleId))
        .filter((n) => n != null),
    );
    const sourceBubbleId = allocateNumericMarker(usedMarkers, existingDocAnnotations.length + 1);
    const parsed = parseOcrSpecFromZone(zone, existingDocAnnotations.length);
    const parsedName = str(parsed?.name || '');
    const normalizedName = /^ocr[_\s-]*zone[_\s-]*\d+$/i.test(parsedName) ? sourceBubbleId : parsedName;
    const rawRotation = Number(zone?.rotation ?? zone?.text_orientation ?? zone?.textOrientation ?? 0);
    const ocrRotation = normalizeCardinalRotation(rawRotation, 0);
    const thumbRotation = zoneRotationToCorrection(ocrRotation);
    const thumbDataUrl = out?.thumbnail?.data_url
      ? str(out.thumbnail.data_url)
      : await buildThumbForZone(imageDataUrl, bbox, thumbRotation);
    const zoneConf = Number(zone?.confidence);
    const ocrConfidence = Number.isFinite(zoneConf) ? zoneConf : null;
    const annId = str(zone?.id) || docsApi.normalizeProductAnnotation({}).id;
    docsApi.upsertProductAnnotation({
      id: annId,
      productId,
      documentId: doc.id,
      sourceBubbleId,
      name: normalizedName || sourceBubbleId,
      nominal: parsed.nominal,
      lsl: parsed.lsl,
      usl: parsed.usl,
      lowerDeviation: parsed.lowerDeviation,
      upperDeviation: parsed.upperDeviation,
      toleranceSpec: parsed.toleranceSpec,
      method: 'OCR',
      unit: parsed.unit || 'mm',
      instrument: chooseInstrumentForTolerance(parsed),
      ocrConfidence,
      bbox,
      thumbnailDataUrl: thumbDataUrl,
      thumbnailBBox: bbox,
      thumbnailRotation: 0,
      ocrRotation,
    });
    state.selectedAnnId = annId;
    refresh();
    const confPct = Number.isFinite(zoneConf) ? Math.round(zoneConf * 100) : null;
    setStatus(confPct != null ? `Created OCR annotation "${normalizedName || zone.text || sourceBubbleId}" (${confPct}% confidence)` : `Created OCR annotation "${normalizedName || zone.text || sourceBubbleId}"`);
  } catch (err) {
    setStatus(`Create OCR annotation failed: ${err?.message || err}`);
  } finally {
    setBusyStatus(false);
  }
}

async function autoOcrCurrentDocument() {
  const productId = str(state.selectedProductId);
  const doc = selectedDocument();
  if (!productId) {
    setStatus(tt('blueprint.pickProductFirst', 'Pick a product first.'));
    return;
  }
  if (!doc) {
    setStatus('Pick a document first.');
    return;
  }
  if (!ocrApi) {
    setStatus(tt('blueprint.ocrRuntimeUnavailable', 'OCR runtime is not available on this page.'));
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
    const out = await ocrApi.callOcrProcessWithRetry(uploadFile, 'hardcore', ocrApi.ensureOcrUrlInput(), 0);
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
      const rawRotation = Number(zone?.rotation ?? zone?.text_orientation ?? zone?.textOrientation ?? 0);
      const detectedOcrRotation = normalizeCardinalRotation(rawRotation, 0);
      const ocrRotation = existing?.ocrRotation == null
        ? detectedOcrRotation
        : normalizeCardinalRotation(Number(existing.ocrRotation ?? 0), 0);
      const thumbRotation = zoneRotationToCorrection(ocrRotation);
      const thumb = await buildThumbForZone(imageDataUrl, bbox, thumbRotation);
      const instrument = chooseInstrumentForTolerance(parsed);
      const zoneConf = Number(zone?.confidence);
      const ocrConfidence = Number.isFinite(zoneConf) ? zoneConf : null;
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
        instrument,
        ocrConfidence,
        bbox,
        thumbnailDataUrl: thumb,
        thumbnailBBox: bbox,
        thumbnailRotation: existing ? (Number(existing.thumbnailRotation ?? 0) || 0) : 0,
        ocrRotation,
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
    setStatus(tt('blueprint.pickProductFirst', 'Pick a product first.'));
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
  $('annDetailReocrBtn')?.addEventListener('click', (event) => {
    const id = str(event.currentTarget?.getAttribute('data-ann-reocr-btn'));
    if (!id) return;
    reocrAnnotation(id);
  });
  $('annDetailRotateSel')?.addEventListener('change', (event) => {
    const input = event.currentTarget;
    const annId = str(input?.getAttribute('data-ann-id'));
    if (!annId) return;
    updateAnnotationField(annId, 'thumbnailRotation', input.value);
    state.selectedAnnId = annId;
    renderAnnotations();
    setStatus(tt('blueprint.annotationUpdated', `Updated annotation ${annId}.`));
  });
  $('bubbleOcrUrlIn')?.addEventListener('change', () => {
    if (!ocrApi) return;
    const normalized = ocrApi.normalizeHttpBaseUrl($('bubbleOcrUrlIn').value);
    if (normalized) $('bubbleOcrUrlIn').value = normalized;
  });
  $('bubbleOcrSaveBtn')?.addEventListener('click', () => {
    if (!ocrApi) {
      setStatus(tt('blueprint.ocrRuntimeUnavailable', 'OCR runtime is not available on this page.'));
      return;
    }
    ocrApi.saveOcrServerSettings();
  });
  $('bubbleOcrTestBtn')?.addEventListener('click', async () => {
    if (!ocrApi) {
      setStatus(tt('blueprint.ocrRuntimeUnavailable', 'OCR runtime is not available on this page.'));
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
    'bubbleDisplayThumbListMaxIn',
    'bubbleDisplayThumbListMinIn',
    'bubbleDisplayThumbDetailMaxIn',
    'bubbleDisplayThumbDetailMinIn',
  ].forEach((id) => {
    $(id)?.addEventListener('input', saveBubbleDisplaySettingsFromUi);
    $(id)?.addEventListener('change', saveBubbleDisplaySettingsFromUi);
  });
  document.querySelectorAll('[data-bubble-display-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = btn.getAttribute('data-bubble-display-preset');
      applyBubbleDisplaySettings(bubbleDisplayPresetValues(preset));
      renderPreviewOverlay();
      setStatus(tt('blueprint.appliedDisplayPreset', `Applied drawing display preset: ${preset || 'default'}.`));
    });
  });
  $('bubbleDisplayResetBtn')?.addEventListener('click', () => {
    localStorage.removeItem(DISPLAY_SETTINGS_KEY);
    applyBubbleDisplaySettings(defaultBubbleDisplaySettings());
    renderPreviewOverlay();
    setStatus(tt('blueprint.displaySettingsReset', 'Drawing display settings reset to factory defaults.'));
  });
  $('docList')?.addEventListener('click', (event) => {
    const card = event.target.closest('[data-doc-card]');
    if (!card) return;
    state.selectedDocId = str(card.getAttribute('data-doc-card'));
    state.selectedAnnId = '';
    renderDocuments();
    renderAnnotations();
  });
  $('annList')?.addEventListener('dblclick', async (event) => {
    const wrap = event.target.closest('[data-ann-reocr]');
    if (!wrap) return;
    event.preventDefault();
    event.stopPropagation();
    const annId = str(wrap.getAttribute('data-ann-reocr'));
    if (!annId) return;
    await reocrAnnotation(annId);
  });
  $('annList')?.addEventListener('click', (event) => {
    const lockBtn = event.target.closest('[data-ann-lock]');
    if (lockBtn) {
      const annId = str(lockBtn.getAttribute('data-ann-lock'));
      const nextValidated = str(lockBtn.getAttribute('data-ann-lock-next')) === '1';
      setAnnotationValidated(annId, nextValidated);
      return;
    }
    const reocrBtn = event.target.closest('[data-ann-reocr-btn]');
    if (reocrBtn) {
      reocrAnnotation(str(reocrBtn.getAttribute('data-ann-reocr-btn')));
      return;
    }
    const delReqBtn = event.target.closest('[data-ann-delete-request]');
    if (delReqBtn) {
      setPendingDeleteAnnotation(str(delReqBtn.getAttribute('data-ann-delete-request')));
      return;
    }
    const delConfirmBtn = event.target.closest('[data-ann-delete-confirm]');
    if (delConfirmBtn) {
      deleteAnnotation(str(delConfirmBtn.getAttribute('data-ann-delete-confirm')));
      return;
    }
    const delCancelBtn = event.target.closest('[data-ann-delete-cancel]');
    if (delCancelBtn) {
      setPendingDeleteAnnotation('');
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
    setStatus(tt('blueprint.annotationUpdated', `Updated annotation ${input.getAttribute('data-ann-id')}.`));
  });
  document.addEventListener('change', (event) => {
    if (!event.target.closest('#annOverlayPopover')) return;
    const input = event.target.closest('[data-ann-id][data-ann-field]');
    if (!input) return;
    updateAnnotationField(str(input.getAttribute('data-ann-id')), str(input.getAttribute('data-ann-field')), input.value);
    state.selectedAnnId = str(input.getAttribute('data-ann-id'));
    renderAnnotations();
    setStatus(tt('blueprint.annotationUpdatedFromViewer', 'Updated annotation from viewer.'));
  });
  window.addEventListener('vmill:refresh-annotation-thumbnail', (event) => {
    const raw = event && typeof event === 'object' && 'detail' in event ? event.detail : null;
    const annId = str(raw?.id || '');
    const delayMs = Number(raw?.delayMs || 1000) || 1000;
    if (!annId) return;
    scheduleAnnotationThumbnailRefresh(annId, delayMs);
  });
  document.addEventListener('click', (event) => {
    const popoverRemove = event.target.closest('#annOverlayPopover [data-ann-delete]');
    if (popoverRemove) {
      deleteAnnotation(str(popoverRemove.getAttribute('data-ann-delete')));
      clearAnnPopover();
    }
  });
  window.addEventListener('vmill:delete-annotation', (event) => {
    const id = event?.detail?.id;
    if (id) deleteAnnotation(id);
  });
  window.addEventListener('vmill:reocr-annotation', async (event) => {
    try {
      const raw = event && typeof event === 'object' && 'detail' in event ? event.detail : null;
      const annId = str(raw?.id || '');
      if (annId) {
        await reocrAnnotation(annId);
        return;
      }
      if (raw?.sourcePoint) {
        await createAnnotationFromPreviewPoint(raw.sourcePoint);
      }
    } catch {}
  });
  window.addEventListener('vmill:data:changed', refresh);
  window.addEventListener('storage', refresh);
  window.addEventListener('vmill:lang:changed', refresh);
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
  applyStaticUiText();
  refresh();
  if (state.selectedDocId) writeDocumentToInputs(selectedDocument());
  setStatus(tt('blueprint.ready', 'Drawing Manager ready.'));
}
