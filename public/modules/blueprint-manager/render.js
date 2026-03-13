import { $, state, tt, str, getProductById, docsApi } from './core.js';

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
    img.hidden = true;
    frame.hidden = true;
    empty.hidden = false;
    typeChip.textContent = 'No document';
    return;
  }
  typeChip.textContent = doc.mime?.includes('pdf')
    ? (doc.previewDataUrl ? 'PDF document | OCR preview ready' : 'PDF document')
    : 'Image document';
  if (doc.mime?.includes('pdf') && !doc.previewDataUrl) {
    frame.src = doc.dataUrl;
    frame.hidden = false;
    img.hidden = true;
  } else {
    img.src = imageUrl;
    img.hidden = false;
    frame.hidden = true;
  }
  empty.hidden = true;
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
        <input data-ann-field="unit" data-ann-id="${esc(row.id)}" type="text" value="${esc(row.unit || '')}" placeholder="Unit" />
        <input data-ann-field="instrument" data-ann-id="${esc(row.id)}" type="text" value="${esc(row.instrument || '')}" placeholder="Instrument" />
      </div>
    </article>
  `).join('') : `<div class="empty">${esc(tt('blueprint.noAnnotations', 'No master annotations for this scope yet. Push them from SPaCial first, then manage them here.'))}</div>`;
  renderAnnotationDetails();
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
      ? `Managing product-level documents for ${product.code || '--'} - ${product.name || 'Product'}. Build previews and launch SPaCial only when you need box authoring.`
      : 'Pick a product to manage its global blueprint documents and master annotations.';
  }
}
