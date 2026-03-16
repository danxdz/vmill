(() => {
  function str(value) {
    return String(value || '').trim();
  }

  function uid(prefix = 'id') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function numOrNull(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function clone(value, fallback) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return fallback;
    }
  }

  function createRuntime(config = {}) {
    const VMillData = config.VMillData || window.VMillData || null;
    const normalizeBbox = typeof config.normalizeBbox === 'function'
      ? config.normalizeBbox
      : (bbox) => {
          const x1 = Number(bbox?.x1);
          const y1 = Number(bbox?.y1);
          const x2 = Number(bbox?.x2);
          const y2 = Number(bbox?.y2);
          if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
          return { x1: Math.min(x1, x2), y1: Math.min(y1, y2), x2: Math.max(x1, x2), y2: Math.max(y1, y2) };
        };

    const NS_PRODUCT_DOCS = 'spacial_product_documents';
    const NS_PRODUCT_ANNOT = 'spacial_product_annotations';
    const NS_OPERATION_ANNOT_LINKS = 'spacial_operation_annotation_links';
    const SHARED_CACHE_KEY = '__VMILL_PRODUCT_DOCS_CACHE_STATE__';
    const MODULE_DIRTY_TOPICS = new Set(['data:module:updated', 'data:snapshot:imported']);

    function getSharedCacheState() {
      const existing = window[SHARED_CACHE_KEY];
      if (existing && typeof existing === 'object') return existing;
      const created = { epoch: 1, listenerBound: false };
      window[SHARED_CACHE_KEY] = created;
      return created;
    }

    const sharedCache = getSharedCacheState();
    if (!sharedCache.listenerBound && typeof window.CANBus?.onMessage === 'function') {
      window.CANBus.onMessage((msg) => {
        const type = str(msg?.type || '');
        if (!MODULE_DIRTY_TOPICS.has(type)) return;
        sharedCache.epoch += 1;
      });
      sharedCache.listenerBound = true;
    }

    const localCache = {
      epoch: 0,
      docsAll: null,
      docsByProduct: new Map(),
      annotationsAll: null,
      annotationsByFilter: new Map(),
      linksAll: null,
      linksByFilter: new Map(),
    };

    function resetLocalCache() {
      localCache.docsAll = null;
      localCache.docsByProduct.clear();
      localCache.annotationsAll = null;
      localCache.annotationsByFilter.clear();
      localCache.linksAll = null;
      localCache.linksByFilter.clear();
    }

    function ensureCacheFresh() {
      if (localCache.epoch === Number(sharedCache.epoch || 0)) return;
      resetLocalCache();
      localCache.epoch = Number(sharedCache.epoch || 0);
    }

    function invalidateCaches() {
      sharedCache.epoch = Number(sharedCache.epoch || 0) + 1;
      ensureCacheFresh();
    }

    function normalizeProductDocument(raw, idx = 0, productIdHint = '') {
      const src = raw && typeof raw === 'object' ? raw : {};
      const mime = str(src.mime || src.type || '');
      const dataUrl = str(src.dataUrl || src.imageUrl || src.src || '');
      const explicitPreviewDataUrl = str(src.previewDataUrl || src.renderDataUrl || src.previewSrc || '');
      const explicitPreviewMime = str(src.previewMime || src.previewType || src.renderMime || '');
      const isImageSource = /^data:image\//i.test(dataUrl) || /^image\//i.test(mime);
      return {
        id: str(src.id) || uid('pdoc'),
        productId: str(src.productId || productIdHint),
        name: str(src.name) || `Blueprint ${idx + 1}`,
        mime,
        dataUrl,
        previewMime: explicitPreviewMime || (isImageSource ? mime : ''),
        previewDataUrl: explicitPreviewDataUrl || (isImageSource ? dataUrl : ''),
        revision: str(src.revision),
        notes: str(src.notes),
        sourceName: str(src.sourceName),
        sourcePage: Number(src.sourcePage || 0) || 0,
        imageWidth: Math.max(0, Number(src.imageWidth || src.width || 0) || 0),
        imageHeight: Math.max(0, Number(src.imageHeight || src.height || 0) || 0),
        sourceDpi: Math.max(0, Number(src.sourceDpi || src.dpi || 0) || 0),
        sourcePageWidthPt: Math.max(0, Number(src.sourcePageWidthPt || src.pageWidthPt || 0) || 0),
        sourcePageHeightPt: Math.max(0, Number(src.sourcePageHeightPt || src.pageHeightPt || 0) || 0),
        sourceOperationId: str(src.sourceOperationId),
        sourceOpFileId: str(src.sourceOpFileId),
        annotationIds: Array.isArray(src.annotationIds) ? src.annotationIds.map((x) => str(x)).filter(Boolean) : [],
        createdAt: str(src.createdAt || new Date().toISOString()),
        updatedAt: str(src.updatedAt || new Date().toISOString()),
      };
    }

    function normalizeProductAnnotation(raw, idx = 0, productIdHint = '', documentIdHint = '') {
      const src = raw && typeof raw === 'object' ? raw : {};
      const bbox = normalizeBbox(src.bbox || src.thumbnailBBox || null);
      const offX = Number(src?.bubbleOffset?.x);
      const offY = Number(src?.bubbleOffset?.y);
      return {
        id: str(src.id) || uid('pann'),
        productId: str(src.productId || productIdHint),
        documentId: str(src.documentId || documentIdHint),
        sourceBubbleId: str(src.sourceBubbleId || src.bubbleId),
        characteristicId: str(src.characteristicId),
        name: str(src.name) || `Annotation ${idx + 1}`,
        nominal: numOrNull(src.nominal),
        lsl: numOrNull(src.lsl),
        usl: numOrNull(src.usl),
        lowerDeviation: numOrNull(src.lowerDeviation ?? src.lower_deviation),
        upperDeviation: numOrNull(src.upperDeviation ?? src.upper_deviation),
        toleranceSpec: str(src.toleranceSpec || src.tolerance_spec || src.fitCode),
        unit: str(src.unit || 'mm'),
        method: str(src.method),
        instrument: str(src.instrument || src.gauge || src.gage),
        reactionPlan: str(src.reactionPlan || src.reaction),
        coordSpace: str(src.coordSpace || src.coordinateSpace),
        bubbleOffsetSpace: str(src.bubbleOffsetSpace),
        bbox,
        bubbleOffset: Number.isFinite(offX) && Number.isFinite(offY) ? { x: offX, y: offY } : null,
        thumbnailDataUrl: str(src.thumbnailDataUrl || src.thumbnail?.data_url),
        thumbnailBBox: normalizeBbox(src.thumbnailBBox || src.thumbnail?.source_bbox || null),
        thumbnailRotation: Number.isFinite(Number(src.thumbnailRotation)) ? Number(src.thumbnailRotation) : 0,
        ocrRotation: Number.isFinite(Number(src.ocrRotation)) ? Number(src.ocrRotation) : 0,
        ocrConfidence: src.ocrConfidence != null && Number.isFinite(Number(src.ocrConfidence)) ? Number(src.ocrConfidence) : null,
        validated: src.validated === true || src.locked === true,
        createdAt: str(src.createdAt || new Date().toISOString()),
        updatedAt: str(src.updatedAt || new Date().toISOString()),
      };
    }

    function cleanOverrides(raw = {}) {
      const src = raw && typeof raw === 'object' ? raw : {};
      const out = {};
      const textFields = ['name', 'characteristicId', 'toleranceSpec', 'unit', 'method', 'instrument', 'reactionPlan', 'thumbnailDataUrl', 'coordSpace', 'bubbleOffsetSpace'];
      const numFields = ['nominal', 'lsl', 'usl', 'lowerDeviation', 'upperDeviation', 'thumbnailRotation', 'ocrRotation'];
      for (const key of textFields) {
        if (Object.prototype.hasOwnProperty.call(src, key)) out[key] = str(src[key]);
      }
      for (const key of numFields) {
        if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
        if (src[key] == null || src[key] === '') out[key] = null;
        else out[key] = numOrNull(src[key]);
      }
      if (Object.prototype.hasOwnProperty.call(src, 'bbox')) out.bbox = normalizeBbox(src.bbox || null);
      if (Object.prototype.hasOwnProperty.call(src, 'bubbleOffset')) {
        const x = Number(src?.bubbleOffset?.x);
        const y = Number(src?.bubbleOffset?.y);
        out.bubbleOffset = Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
      }
      if (Object.prototype.hasOwnProperty.call(src, 'thumbnailBBox')) out.thumbnailBBox = normalizeBbox(src.thumbnailBBox || null);
      if (Object.prototype.hasOwnProperty.call(src, 'validated')) out.validated = src.validated === true;
      return out;
    }

    function normalizeOperationAnnotationLink(raw, idx = 0, productIdHint = '', routeIdHint = '', operationIdHint = '', operationFileIdHint = '') {
      const src = raw && typeof raw === 'object' ? raw : {};
      return {
        id: str(src.id) || uid('olink'),
        productId: str(src.productId || productIdHint),
        routeId: str(src.routeId || routeIdHint),
        operationId: str(src.operationId || operationIdHint),
        operationFileId: str(src.operationFileId || operationFileIdHint),
        productDocumentId: str(src.productDocumentId),
        masterAnnotationId: str(src.masterAnnotationId || src.productAnnotationId),
        bubbleId: str(src.bubbleId || src.sourceBubbleId),
        enabled: src.enabled !== false,
        sortOrder: Number.isFinite(Number(src.sortOrder)) ? Number(src.sortOrder) : idx,
        overrides: cleanOverrides(src.overrides || src.override || {}),
        createdAt: str(src.createdAt || new Date().toISOString()),
        updatedAt: str(src.updatedAt || new Date().toISOString()),
      };
    }

    function listRecords(ns) {
      return VMillData?.listRecords ? (VMillData.listRecords(ns) || []) : [];
    }

    function allProductDocuments() {
      ensureCacheFresh();
      if (localCache.docsAll) return localCache.docsAll;
      localCache.docsAll = listRecords(NS_PRODUCT_DOCS)
        .map((row, idx) => normalizeProductDocument(row, idx))
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || String(a.name || '').localeCompare(String(b.name || '')));
      return localCache.docsAll;
    }

    function listProductDocuments(productId = '') {
      const pid = str(productId);
      const all = allProductDocuments();
      if (!pid) return all.slice();
      if (localCache.docsByProduct.has(pid)) return (localCache.docsByProduct.get(pid) || []).slice();
      const filtered = all.filter((row) => String(row.productId || '') === pid);
      localCache.docsByProduct.set(pid, filtered);
      return filtered.slice();
    }

    function productDocumentById(documentId, productId = '') {
      const wanted = str(documentId);
      if (!wanted) return null;
      return listProductDocuments(productId).find((row) => String(row.id || '') === wanted) || null;
    }

    function listProductAnnotations(productId = '', documentId = '') {
      const pid = str(productId);
      const did = str(documentId);
      ensureCacheFresh();
      if (!localCache.annotationsAll) {
        localCache.annotationsAll = listRecords(NS_PRODUCT_ANNOT)
          .map((row, idx) => normalizeProductAnnotation(row, idx))
          .sort((a, b) => String(a.documentId || '').localeCompare(String(b.documentId || '')) || String(a.sourceBubbleId || a.id || '').localeCompare(String(b.sourceBubbleId || b.id || '')));
      }
      const key = `${pid}::${did}`;
      if (localCache.annotationsByFilter.has(key)) return (localCache.annotationsByFilter.get(key) || []).slice();
      const filtered = localCache.annotationsAll
        .filter((row) => (!pid || String(row.productId || '') === pid) && (!did || String(row.documentId || '') === did));
      localCache.annotationsByFilter.set(key, filtered);
      return filtered.slice();
    }

    function productAnnotationById(annotationId, productId = '') {
      const wanted = str(annotationId);
      if (!wanted) return null;
      return listProductAnnotations(productId).find((row) => String(row.id || '') === wanted) || null;
    }

    function listOperationAnnotationLinks(filters = {}) {
      const wantedProductId = str(filters.productId);
      const wantedRouteId = str(filters.routeId);
      const wantedOperationId = str(filters.operationId);
      const wantedOperationFileId = str(filters.operationFileId);
      const wantedDocumentId = str(filters.productDocumentId);
      const wantedIds = Array.isArray(filters.ids) ? new Set(filters.ids.map((x) => str(x)).filter(Boolean)) : null;
      ensureCacheFresh();
      if (!localCache.linksAll) {
        localCache.linksAll = listRecords(NS_OPERATION_ANNOT_LINKS)
          .map((row, idx) => normalizeOperationAnnotationLink(row, idx))
          .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || String(a.bubbleId || '').localeCompare(String(b.bubbleId || '')));
      }
      const idsKey = wantedIds ? [...wantedIds].sort().join('|') : '';
      const key = `${wantedProductId}::${wantedRouteId}::${wantedOperationId}::${wantedOperationFileId}::${wantedDocumentId}::${idsKey}`;
      if (localCache.linksByFilter.has(key)) return (localCache.linksByFilter.get(key) || []).slice();
      const filtered = localCache.linksAll
        .filter((row) => (!wantedIds || wantedIds.has(String(row.id || '')))
          && (!wantedProductId || String(row.productId || '') === wantedProductId)
          && (!wantedRouteId || String(row.routeId || '') === wantedRouteId)
          && (!wantedOperationId || String(row.operationId || '') === wantedOperationId)
          && (!wantedOperationFileId || String(row.operationFileId || '') === wantedOperationFileId)
          && (!wantedDocumentId || String(row.productDocumentId || '') === wantedDocumentId));
      localCache.linksByFilter.set(key, filtered);
      return filtered.slice();
    }

    function operationAnnotationLinkById(linkId, filters = {}) {
      const wanted = str(linkId);
      if (!wanted) return null;
      return listOperationAnnotationLinks({ ...filters, ids: [wanted] })[0] || null;
    }

    function upsertProductDocument(doc) {
      if (!VMillData?.upsertRecord) return null;
      const normalized = normalizeProductDocument({ ...clone(doc, {}), updatedAt: new Date().toISOString() });
      VMillData.upsertRecord(NS_PRODUCT_DOCS, normalized);
      invalidateCaches();
      return normalized;
    }

    function upsertProductAnnotation(annotation) {
      if (!VMillData?.upsertRecord) return null;
      const normalized = normalizeProductAnnotation({ ...clone(annotation, {}), updatedAt: new Date().toISOString() });
      VMillData.upsertRecord(NS_PRODUCT_ANNOT, normalized);
      invalidateCaches();
      return normalized;
    }

    function upsertOperationAnnotationLink(link) {
      if (!VMillData?.upsertRecord) return null;
      const normalized = normalizeOperationAnnotationLink({ ...clone(link, {}), updatedAt: new Date().toISOString() });
      VMillData.upsertRecord(NS_OPERATION_ANNOT_LINKS, normalized);
      invalidateCaches();
      return normalized;
    }

    function deleteProductAnnotation(annotationId) {
      if (!VMillData?.deleteRecord) return;
      const id = str(annotationId);
      if (!id) return;
      VMillData.deleteRecord(NS_PRODUCT_ANNOT, id);
      invalidateCaches();
    }

    function deleteProductDocument(documentId, options = {}) {
      if (!VMillData?.deleteRecord) return;
      const id = str(documentId);
      if (!id) return;
      if (options.deleteAnnotations !== false) {
        listProductAnnotations('', id).forEach((annotation) => deleteProductAnnotation(annotation.id));
      }
      VMillData.deleteRecord(NS_PRODUCT_DOCS, id);
      invalidateCaches();
    }

    function deleteOperationAnnotationLink(linkId) {
      if (!VMillData?.deleteRecord) return;
      const id = str(linkId);
      if (!id) return;
      VMillData.deleteRecord(NS_OPERATION_ANNOT_LINKS, id);
      invalidateCaches();
    }

    function bubbleToProductAnnotation(bubble, meta = {}) {
      const bbox = normalizeBbox(bubble?.bbox || null);
      const source = bubble && typeof bubble === 'object' ? bubble : {};
      return normalizeProductAnnotation({
        id: meta.id || source.masterAnnotationId || source.id || uid('pann'),
        productId: meta.productId,
        documentId: meta.documentId,
        sourceBubbleId: str(meta.sourceBubbleId || source.id),
        characteristicId: source.characteristicId,
        name: source.name,
        nominal: source.nominal,
        lsl: source.lsl,
        usl: source.usl,
        lowerDeviation: source.lowerDeviation,
        upperDeviation: source.upperDeviation,
        toleranceSpec: source.toleranceSpec,
        unit: source.unit,
        method: source.method,
        instrument: source.instrument,
        reactionPlan: source.reactionPlan,
        coordSpace: source.coordSpace,
        bubbleOffsetSpace: source.bubbleOffsetSpace,
        bbox,
        bubbleOffset: clone(source.bubbleOffset, null),
        thumbnailDataUrl: source.thumbnailDataUrl,
        thumbnailBBox: clone(source.thumbnailBBox, null),
        thumbnailRotation: source.thumbnailRotation,
        ocrRotation: source.ocrRotation,
        validated: source.validated === true,
      }, 0, meta.productId, meta.documentId);
    }

    function productAnnotationToBubble(annotation, idx = 0) {
      const src = normalizeProductAnnotation(annotation, idx);
      return {
        id: str(src.sourceBubbleId || src.id) || `B${String(idx + 1).padStart(3, '0')}`,
        masterAnnotationId: src.id,
        characteristicId: src.characteristicId,
        name: src.name,
        nominal: src.nominal,
        lsl: src.lsl,
        usl: src.usl,
        lowerDeviation: src.lowerDeviation,
        upperDeviation: src.upperDeviation,
        toleranceSpec: src.toleranceSpec,
        unit: src.unit,
        method: src.method,
        instrument: src.instrument,
        reactionPlan: src.reactionPlan,
        coordSpace: src.coordSpace,
        bubbleOffsetSpace: src.bubbleOffsetSpace,
        bbox: clone(src.bbox, null),
        bubbleOffset: clone(src.bubbleOffset, null),
        thumbnailDataUrl: src.thumbnailDataUrl,
        thumbnailBBox: clone(src.thumbnailBBox, null),
        thumbnailRotation: src.thumbnailRotation,
        ocrRotation: src.ocrRotation,
        validated: src.validated === true,
      };
    }

    function bubbleToOperationAnnotationLink(bubble, meta = {}) {
      const source = bubble && typeof bubble === 'object' ? bubble : {};
      const master = meta.masterAnnotationId ? productAnnotationById(meta.masterAnnotationId, meta.productId) : null;
      const base = master ? productAnnotationToBubble(master, 0) : null;
      const normalized = {
        id: str(source.id),
        masterAnnotationId: str(meta.masterAnnotationId || source.masterAnnotationId),
        name: str(source.name),
        characteristicId: str(source.characteristicId),
        nominal: numOrNull(source.nominal),
        lsl: numOrNull(source.lsl),
        usl: numOrNull(source.usl),
        lowerDeviation: numOrNull(source.lowerDeviation),
        upperDeviation: numOrNull(source.upperDeviation),
        toleranceSpec: str(source.toleranceSpec),
        unit: str(source.unit),
        method: str(source.method),
        instrument: str(source.instrument),
        reactionPlan: str(source.reactionPlan),
        coordSpace: str(source.coordSpace || source.coordinateSpace),
        bubbleOffsetSpace: str(source.bubbleOffsetSpace),
        bbox: normalizeBbox(source.bbox || null),
        bubbleOffset: clone(source.bubbleOffset, null),
        thumbnailDataUrl: str(source.thumbnailDataUrl),
        thumbnailBBox: normalizeBbox(source.thumbnailBBox || null),
        thumbnailRotation: numOrNull(source.thumbnailRotation),
        ocrRotation: numOrNull(source.ocrRotation),
      };
      const overrides = {};
      const compareFields = ['name', 'characteristicId', 'nominal', 'lsl', 'usl', 'lowerDeviation', 'upperDeviation', 'toleranceSpec', 'unit', 'method', 'instrument', 'reactionPlan', 'thumbnailDataUrl', 'thumbnailRotation', 'ocrRotation', 'coordSpace', 'bubbleOffsetSpace', 'validated'];
      for (const key of compareFields) {
        const current = normalized[key];
        const baseValue = base ? (base[key] ?? '') : undefined;
        const same = JSON.stringify(current ?? null) === JSON.stringify(baseValue ?? null);
        if (!same && current !== '' && current != null) overrides[key] = current;
      }
      if (normalized.bbox) overrides.bbox = normalized.bbox;
      if (normalized.bubbleOffset) overrides.bubbleOffset = normalized.bubbleOffset;
      if (normalized.thumbnailBBox) overrides.thumbnailBBox = normalized.thumbnailBBox;
      return normalizeOperationAnnotationLink({
        id: meta.id || source.linkId || '',
        productId: meta.productId,
        routeId: meta.routeId,
        operationId: meta.operationId,
        operationFileId: meta.operationFileId,
        productDocumentId: meta.productDocumentId,
        masterAnnotationId: normalized.masterAnnotationId,
        bubbleId: normalized.id,
        sortOrder: meta.sortOrder,
        overrides,
      });
    }

    function operationAnnotationLinkToBubble(link, idx = 0) {
      const src = normalizeOperationAnnotationLink(link, idx);
      let master = src.masterAnnotationId ? productAnnotationById(src.masterAnnotationId, src.productId) : null;
      if (!master && src.masterAnnotationId) {
        master = productAnnotationById(src.masterAnnotationId, '') || null;
      }
      if (!master) {
        const byBubble = listProductAnnotations(src.productId, src.productDocumentId)
          .find((row) => String(row.sourceBubbleId || row.id || '') === String(src.bubbleId || '')) || null;
        if (byBubble) master = byBubble;
      }
      const base = master ? productAnnotationToBubble(master, idx) : { id: src.bubbleId || `B${String(idx + 1).padStart(3, '0')}`, masterAnnotationId: src.masterAnnotationId };
      const merged = {
        ...base,
        ...clone(src.overrides, {}),
        id: str(src.bubbleId || base.id),
        linkId: src.id,
        masterAnnotationId: str(src.masterAnnotationId || base.masterAnnotationId),
      };
      return merged;
    }

    return {
      NS_PRODUCT_DOCS,
      NS_PRODUCT_ANNOT,
      NS_OPERATION_ANNOT_LINKS,
      normalizeProductDocument,
      normalizeProductAnnotation,
      normalizeOperationAnnotationLink,
      listProductDocuments,
      productDocumentById,
      listProductAnnotations,
      productAnnotationById,
      listOperationAnnotationLinks,
      operationAnnotationLinkById,
      upsertProductDocument,
      upsertProductAnnotation,
      upsertOperationAnnotationLink,
      deleteProductDocument,
      deleteProductAnnotation,
      deleteOperationAnnotationLink,
      bubbleToProductAnnotation,
      productAnnotationToBubble,
      bubbleToOperationAnnotationLink,
      operationAnnotationLinkToBubble,
    };
  }

  window.VMillSpacialProductDocs = { createRuntime };
})();
