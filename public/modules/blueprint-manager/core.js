export const state = {
  products: [],
  selectedProductId: '',
  selectedDocId: '',
  selectedAnnId: '',
  annScope: 'document',
  annSearch: '',
};

export const $ = (id) => document.getElementById(id);

export function tt(key, fallback) {
  try {
    return window.VMillLang?.t ? window.VMillLang.t(key, fallback) : fallback;
  } catch {
    return fallback;
  }
}

export function setStatus(text) {
  const el = $('status');
  if (el) el.textContent = text || 'Ready.';
}

export function setBusyStatus(active, text = '') {
  const ids = [
    'uploadDocBtn',
    'buildPreviewBtn',
    'saveDocBtn',
    'deleteDocBtn',
    'openInSpacialBtn',
    'openInSpacialAutoBtn',
    'openInSpacialClickBtn',
    'bubbleOcrSaveBtn',
    'bubbleOcrTestBtn',
  ];
  ids.forEach((id) => {
    const el = $(id);
    if (el) el.disabled = !!active;
  });
  if (text) setStatus(text);
}

export function applyTheme() {
  try {
    window.VMillTheme?.applyTheme(document, 'blueprint-manager');
  } catch {}
}

export function str(value) {
  return String(value || '').trim();
}

export function readState() {
  try {
    const app = window.VMillData?.readAppState ? window.VMillData.readAppState() : null;
    return app && typeof app === 'object' ? app : { products: [] };
  } catch {
    return { products: [] };
  }
}

export function getProducts() {
  const raw = Array.isArray(readState()?.products) ? readState().products : [];
  return raw
    .map((row) => ({ id: str(row?.id), code: str(row?.code), name: str(row?.name) }))
    .filter((row) => row.id)
    .sort((a, b) => `${a.code} ${a.name}`.localeCompare(`${b.code} ${b.name}`));
}

export function getProductById(productId) {
  const wanted = str(productId);
  return getProducts().find((row) => row.id === wanted) || null;
}

export function queryParams() {
  try {
    return new URL(window.location.href).searchParams;
  } catch {
    return new URLSearchParams();
  }
}

export const docsApi = window.VMillSpacialProductDocs.createRuntime({
  VMillData: window.VMillData,
});

export const ocrApi = window.VMillSpacialOcr?.createRuntime
  ? window.VMillSpacialOcr.createRuntime({
      $,
      tt,
      setOcrStatus: setStatus,
      applyOcrBusyState: setBusyStatus,
      getServerUrl: () => '',
    })
  : null;
