(() => {
  function createRuntime(config = {}) {
    const $ = typeof config.$ === 'function' ? config.$ : (id) => document.getElementById(id);
    const strOrEmpty = typeof config.strOrEmpty === 'function'
      ? config.strOrEmpty
      : (value) => String(value == null ? '' : value).trim();
    const tt = typeof config.tt === 'function' ? config.tt : (_key, fallback = '') => fallback;
    const setOcrStatus = typeof config.setOcrStatus === 'function' ? config.setOcrStatus : () => {};
    const applyOcrBusyState = typeof config.applyOcrBusyState === 'function' ? config.applyOcrBusyState : () => {};
    const getServerUrl = typeof config.getServerUrl === 'function' ? config.getServerUrl : () => '';
    const OCR_URL_KEY = String(config.OCR_URL_KEY || 'vmill:ocr:url');
    const OCR_PORT_KEY = String(config.OCR_PORT_KEY || 'vmill:ocr:port');

    function normalizeHttpBaseUrl(raw) {
      const src = strOrEmpty(raw);
      if (!src) return '';
      const cleaned = src
        .replace(/\/+$/, '')
        .replace(/\/ocr\/process(?:\?.*)?$/i, '')
        .replace(/\/ocr\/process-with-lines(?:\?.*)?$/i, '')
        .replace(/\/ocr\/pdf-to-image(?:\?.*)?$/i, '');
      const withProto = /^[a-z]+:\/\//i.test(cleaned) ? cleaned : `http://${cleaned}`;
      try {
        const u = new URL(withProto);
        return `${u.protocol}//${u.host}`;
      } catch {
        return '';
      }
    }

    function normalizePortValue(raw, fallback = 8000) {
      const port = Number(raw);
      if (Number.isFinite(port) && port >= 1 && port <= 65535) return String(Math.round(port));
      return String(Number(fallback || 8000) || 8000);
    }

    function extractPortFromBaseUrl(raw) {
      const normalized = normalizeHttpBaseUrl(raw);
      if (!normalized) return '';
      try {
        const u = new URL(normalized);
        return String(u.port || '');
      } catch {
        return '';
      }
    }

    function defaultOcrUrl() {
      const stored = normalizeHttpBaseUrl(localStorage.getItem(OCR_URL_KEY) || '');
      if (stored) return stored;
      const preferredPort = normalizePortValue(localStorage.getItem(OCR_PORT_KEY) || '8000', 8000);
      const base = normalizeHttpBaseUrl(getServerUrl() || '');
      if (base) {
        try {
          const u = new URL(base);
          return `${u.protocol || 'http:'}//${u.hostname}:${preferredPort}`;
        } catch {}
      }
      return `http://localhost:${preferredPort}`;
    }

    function updateOcrSettingsUi(baseUrl = '') {
      const normalized = normalizeHttpBaseUrl(baseUrl || defaultOcrUrl());
      const urlEl = $('bubbleOcrUrlIn');
      const portEl = $('bubbleOcrPortIn');
      if (urlEl && normalized) urlEl.value = normalized;
      if (portEl) {
        portEl.value = normalizePortValue(
          extractPortFromBaseUrl(normalized) || localStorage.getItem(OCR_PORT_KEY) || '8000',
          8000,
        );
      }
    }

    function syncResolvedBaseUrl(baseUrl) {
      const normalized = normalizeHttpBaseUrl(baseUrl);
      if (!normalized) return '';
      const urlInput = $('bubbleOcrUrlIn');
      if (urlInput && urlInput.value !== normalized) urlInput.value = normalized;
      localStorage.setItem(OCR_URL_KEY, normalized);
      localStorage.setItem(OCR_PORT_KEY, normalizePortValue(extractPortFromBaseUrl(normalized) || '8000', 8000));
      updateOcrSettingsUi(normalized);
      return normalized;
    }

    function ocrCandidateBaseUrls(preferred) {
      const set = new Set();
      const add = (value) => {
        const normalized = normalizeHttpBaseUrl(value);
        if (normalized) set.add(normalized);
      };
      add(preferred);
      add(localStorage.getItem(OCR_URL_KEY) || '');
      const savedPort = normalizePortValue(
        localStorage.getItem(OCR_PORT_KEY) || extractPortFromBaseUrl(preferred) || '8000',
        8000,
      );
      const loc = window.location;
      if (loc && /^https?:$/i.test(loc.protocol || '')) {
        add(`${loc.protocol}//${loc.hostname}:${savedPort}`);
        add(`${loc.protocol}//${loc.hostname}:8000`);
        add(`${loc.protocol}//${loc.hostname}:8081`);
      }
      add(`http://127.0.0.1:${savedPort}`);
      add(`http://localhost:${savedPort}`);
      add('http://127.0.0.1:8000');
      add('http://localhost:8000');
      add('http://127.0.0.1:8081');
      add('http://localhost:8081');
      return Array.from(set);
    }

    function normalizeCardinalRotation(value, fallback = 0) {
      const raw = Number(value);
      if (!Number.isFinite(raw)) return fallback;
      const rounded = Math.round(raw / 90) * 90;
      const normalized = ((rounded % 360) + 360) % 360;
      return [0, 90, 180, 270].includes(normalized) ? normalized : fallback;
    }

    function zoneRotationToCorrection(value) {
      const zoneRot = normalizeCardinalRotation(value, 0);
      return normalizeCardinalRotation(360 - zoneRot, 0);
    }

    async function fetchJsonWithRetry(buildRequest, preferredBaseUrl, timeoutMs, errorMessage) {
      const candidates = ocrCandidateBaseUrls(preferredBaseUrl);
      let lastError = null;
      for (const baseUrl of candidates) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const request = buildRequest(baseUrl, controller.signal);
          const res = await fetch(request.url, request.options);
          let out = {};
          try {
            out = await res.json();
          } catch {
            out = {};
          }
          if (!res.ok) {
            const detail = out?.detail;
            const detailMsg = typeof detail === 'string' ? detail : (detail?.message || detail?.error || '');
            throw new Error(detailMsg || out?.error || `${res.status} ${res.statusText}`);
          }
          syncResolvedBaseUrl(baseUrl);
          return out;
        } catch (err) {
          lastError = err;
        } finally {
          clearTimeout(timeoutId);
        }
      }
      throw lastError || new Error(errorMessage || 'OCR server not reachable');
    }

    async function callOcrProcessWithRetry(uploadFile, mode, preferredBaseUrl, rotation = 0) {
      const safeRotation = normalizeCardinalRotation(rotation, 0);
      return fetchJsonWithRetry((baseUrl, signal) => {
        const formData = new FormData();
        formData.append('file', uploadFile, uploadFile.name);
        return {
          url: `${baseUrl}/ocr/process?mode=${encodeURIComponent(mode)}&rotation=${encodeURIComponent(safeRotation)}`,
          options: { method: 'POST', body: formData, signal },
        };
      }, preferredBaseUrl, 25000, 'OCR server not reachable');
    }

    async function callOcrPdfToImageWithRetry(uploadFile, preferredBaseUrl, page = 0, dpi = 220) {
      const safePage = Math.max(0, Number(page || 0) || 0);
      const safeDpi = Math.max(120, Math.min(400, Number(dpi || 220) || 220));
      return fetchJsonWithRetry((baseUrl, signal) => {
        const formData = new FormData();
        formData.append('file', uploadFile, uploadFile.name);
        return {
          url: `${baseUrl}/ocr/pdf-to-image?page=${encodeURIComponent(safePage)}&dpi=${encodeURIComponent(safeDpi)}`,
          options: { method: 'POST', body: formData, signal },
        };
      }, preferredBaseUrl, 30000, 'OCR server not reachable');
    }

    async function callOcrJsonWithRetry(path, payload, preferredBaseUrl) {
      return fetchJsonWithRetry((baseUrl, signal) => ({
        url: `${baseUrl}${path}`,
        options: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload || {}),
          signal,
        },
      }), preferredBaseUrl, 25000, 'OCR server not reachable');
    }

    async function callOcrAnnotationClickWithRetry(imageDataUrl, point, mode, preferredBaseUrl, rotation = 0) {
      return callOcrJsonWithRetry('/ocr/annotation-click', {
        image: imageDataUrl,
        point: { x: Number(point?.x || 0), y: Number(point?.y || 0) },
        mode: strOrEmpty(mode || 'fast') || 'fast',
        rotation: normalizeCardinalRotation(rotation, 0),
        thumbnail: true,
        max_thumb: 160,
        thumb_padding: 8,
      }, preferredBaseUrl);
    }

    async function callOcrThumbnailWithRetry(imageDataUrl, bbox, preferredBaseUrl, rotation = 0) {
      return callOcrJsonWithRetry('/ocr/annotation-thumbnail', {
        image: imageDataUrl,
        bbox,
        rotation: normalizeCardinalRotation(rotation, 0),
        max_size: 160,
        padding: 8,
        quality: 85,
      }, preferredBaseUrl);
    }

    function ensureOcrUrlInput() {
      const el = $('bubbleOcrUrlIn');
      if (!el) return defaultOcrUrl();
      if (!strOrEmpty(el.value)) el.value = defaultOcrUrl();
      const normalized = normalizeHttpBaseUrl(el.value);
      if (normalized && normalized !== el.value) el.value = normalized;
      return normalizeHttpBaseUrl(el.value) || defaultOcrUrl();
    }

    function saveOcrServerSettings() {
      const urlEl = $('bubbleOcrUrlIn');
      const portEl = $('bubbleOcrPortIn');
      const fallbackBase = defaultOcrUrl();
      const normalizedUrl = normalizeHttpBaseUrl(urlEl?.value || fallbackBase) || normalizeHttpBaseUrl(fallbackBase) || 'http://localhost:8000';
      const port = normalizePortValue(portEl?.value || extractPortFromBaseUrl(normalizedUrl) || '8000', 8000);
      let finalUrl = normalizedUrl;
      try {
        const u = new URL(normalizedUrl);
        u.port = port;
        finalUrl = `${u.protocol}//${u.host}`;
      } catch {}
      localStorage.setItem(OCR_PORT_KEY, port);
      localStorage.setItem(OCR_URL_KEY, finalUrl);
      updateOcrSettingsUi(finalUrl);
      setOcrStatus('info', `OCR server saved: ${finalUrl}`);
      return finalUrl;
    }

    async function testOcrConnection() {
      const base = ensureOcrUrlInput();
      if (!base) {
        setOcrStatus('danger', tt('spacial.ocr.alert.urlInvalid', 'Invalid OCR URL.'));
        return;
      }
      applyOcrBusyState(true);
      setOcrStatus('info', tt('spacial.ocr.testing', 'Testing OCR server...'));
      let timeoutId = null;
      try {
        const controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), 8000);
        const paths = ['/health', '/'];
        let ok = false;
        for (const path of paths) {
          try {
            const res = await fetch(`${base}${path}`, { method: 'GET', signal: controller.signal });
            if (res.ok || res.status < 500) {
              ok = true;
              break;
            }
          } catch {}
        }
        if (!ok) throw new Error(tt('spacial.ocr.notReachable', 'Server not reachable'));
        syncResolvedBaseUrl(base);
        setOcrStatus('ok', tt('spacial.ocr.connected', 'OCR server connected.'));
      } catch (err) {
        setOcrStatus('danger', tt('spacial.ocr.alert.failed', 'OCR detection failed: {err}', {
          err: err?.message || String(err || 'unknown'),
        }));
      } finally {
        if (timeoutId != null) clearTimeout(timeoutId);
        applyOcrBusyState(false);
      }
    }

    return {
      normalizeHttpBaseUrl,
      normalizePortValue,
      extractPortFromBaseUrl,
      updateOcrSettingsUi,
      ocrCandidateBaseUrls,
      normalizeCardinalRotation,
      zoneRotationToCorrection,
      callOcrProcessWithRetry,
      callOcrPdfToImageWithRetry,
      callOcrJsonWithRetry,
      callOcrAnnotationClickWithRetry,
      callOcrThumbnailWithRetry,
      defaultOcrUrl,
      ensureOcrUrlInput,
      saveOcrServerSettings,
      testOcrConnection,
    };
  }

  window.VMillSpacialOcr = {
    createRuntime,
  };
})();
