import { $, state, tt, setStatus, setBusyStatus, str, getProducts, getProductById, queryParams, docsApi, ocrApi } from './core.js';
import { renderAll, renderDocuments, renderAnnotations, writeDocumentToInputs } from './render.js';

const PRODUCT_DOC_HANDOFF_KEY = 'vmill:spacial:product-doc-handoff';

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

async function dataUrlToFile(dataUrl, filename, fallbackType = 'application/octet-stream') {
  const res = await fetch(String(dataUrl || ''));
  const blob = await res.blob();
  const name = String(filename || 'document.bin');
  const type = blob.type || fallbackType;
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
  const next = { ...current, [field]: value };
  if (['nominal', 'lsl', 'usl'].includes(field)) next[field] = value === '' ? null : Number(value);
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

function openSpacialWithDocument(mode = '') {
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
    setStatus('This PDF still needs a preview image before SPaCial can place annotations on it.');
    return;
  }
  const url = new URL('./SPaCial.html', window.location.href);
  if (product?.id) url.searchParams.set('product', String(product.id || ''));
  if (doc?.id) {
    localStorage.setItem(PRODUCT_DOC_HANDOFF_KEY, JSON.stringify({
      productId: product?.id || '',
      documentId: doc.id,
      ocrMode: str(mode),
      createdAt: new Date().toISOString(),
    }));
    url.searchParams.set('documentId', String(doc.id || ''));
    if (str(mode)) url.searchParams.set('ocrMode', str(mode));
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
  $('saveDocBtn')?.addEventListener('click', saveDocumentFromInputs);
  $('deleteDocBtn')?.addEventListener('click', deleteCurrentDocument);
  $('openInSpacialBtn')?.addEventListener('click', () => openSpacialWithDocument(''));
  $('openInSpacialAutoBtn')?.addEventListener('click', () => openSpacialWithDocument('auto'));
  $('openInSpacialClickBtn')?.addEventListener('click', () => openSpacialWithDocument('click'));
  $('annDetailOpenSpacialBtn')?.addEventListener('click', () => openSpacialWithDocument(''));
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
}

export function boot() {
  const params = queryParams();
  state.selectedProductId = str(params.get('productId') || params.get('product') || '');
  state.selectedDocId = str(params.get('documentId') || params.get('doc') || '');
  state.annScope = str($('annScopeSel')?.value || 'document') || 'document';
  bindEvents();
  if (ocrApi?.updateOcrSettingsUi) ocrApi.updateOcrSettingsUi(ocrApi.defaultOcrUrl());
  refresh();
  if (state.selectedDocId) writeDocumentToInputs(selectedDocument());
  setStatus(tt('blueprint.ready', 'Drawing Manager ready.'));
}
