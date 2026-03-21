(() => {
  function createRuntime(deps = {}) {
    const $ = deps.$ || ((id) => document.getElementById(id));
    const tt = deps.tt || ((_key, fallback = "") => fallback);
    const strOrEmpty = deps.strOrEmpty || ((value) => String(value == null ? "" : value).trim());
    const escHtml = deps.escHtml || ((value) => String(value == null ? "" : value));
    const normalizeIdList = deps.normalizeIdList || ((rows) => Array.isArray(rows) ? rows : []);
    const normalizeBbox = deps.normalizeBbox || (() => null);
    const ensureOperationFiles = deps.ensureOperationFiles || (() => []);
    const listProductCharacteristics = deps.listProductCharacteristics || (() => []);
    const sanitizeStructuredMarker = deps.sanitizeStructuredMarker || ((value) => String(value || ""));
    const csvCell = deps.csvCell || ((value) => JSON.stringify(value == null ? "" : value));
    const safeRecordToken = deps.safeRecordToken || ((value) => String(value || "").replace(/[^a-z0-9_-]+/gi, "_"));
    const selectedOperationFile = deps.selectedOperationFile || (() => null);
    const getSelectedOperation = deps.getSelectedOperation || (() => null);
    const getRoutePlan = deps.getRoutePlan || (() => null);
    const getSelectedOpFileId = deps.getSelectedOpFileId || (() => "");
    const currentRouteProductId = deps.currentRouteProductId || (() => "");
    const characteristicNameById = deps.characteristicNameById || (() => "");
    const characteristicById = deps.characteristicById || (() => null);
    const cssThemeHex = deps.cssThemeHex || ((_name, fallback = "") => fallback);
    const hexToRgba = deps.hexToRgba || ((hex) => String(hex || ""));
    const normalizeBubbleDisplaySettings = deps.normalizeBubbleDisplaySettings || ((value) => value || {});
    const defaultBubbleDisplaySettings = deps.defaultBubbleDisplaySettings || (() => ({}));
    const resolveExportBubbleDisplaySettings = deps.resolveExportBubbleDisplaySettings || (() => ({}));
    const clampDisplaySettingNumber = deps.clampDisplaySettingNumber || ((value, _min, _max, fallback) => fallback);
    const defaultBubbleOffset = deps.defaultBubbleOffset || (() => ({ x: 28, y: -28 }));
    const isImageDataUrl = deps.isImageDataUrl || (() => false);
    const cssSizeFromPoints = deps.cssSizeFromPoints || (() => "");

    function exportJsonFile(name, payload) {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

    function exportTextFile(name, text, type = "text/plain") {
      const blob = new Blob([text], { type });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

    function safeFilename(name, fallback = "file") {
      const base = String(name || "").trim().replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ");
      return base || fallback;
    }

    function resolveBubbleBoxForTarget(bubble, targetWidth = 0, targetHeight = 0, sourceWidth = 0, sourceHeight = 0) {
      const box = normalizeBbox(bubble?.bbox);
      if (!box) return null;
      const values = [box.x1, box.y1, box.x2, box.y2];
      const looksNormalized = values.every((v) => Number.isFinite(v) && v >= -0.02 && v <= 1.02);
      if (looksNormalized && targetWidth > 0 && targetHeight > 0) {
        return normalizeBbox({
          x1: box.x1 * targetWidth,
          y1: box.y1 * targetHeight,
          x2: box.x2 * targetWidth,
          y2: box.y2 * targetHeight,
        });
      }
      if (String(bubble?.coordSpace || "") === "source" && sourceWidth > 0 && sourceHeight > 0 && targetWidth > 0 && targetHeight > 0) {
        return normalizeBbox({
          x1: box.x1 * (targetWidth / sourceWidth),
          y1: box.y1 * (targetHeight / sourceHeight),
          x2: box.x2 * (targetWidth / sourceWidth),
          y2: box.y2 * (targetHeight / sourceHeight),
        });
      }
      return box;
    }

    function routeRowsForExport(plan) {
      const rows = [];
      if (!plan) return rows;
      const charsById = new Map(
        listProductCharacteristics(strOrEmpty(plan.productId))
          .map((x) => [String(x.id || ""), x])
      );
      const ops = Array.isArray(plan.operations) ? plan.operations : [];
      for (const op of ops) {
        const opChars = normalizeIdList(op?.characteristicIds || []);
        const files = ensureOperationFiles(op);
        if (!files.length) continue;
        for (const f of files) {
          const bubbles = Array.isArray(f.bubbles) ? f.bubbles : [];
          if (!bubbles.length) {
            rows.push({
              routeName: plan.routeName,
              revision: plan.revision,
              productRef: plan.productRef,
              jobName: plan.jobName,
              station: plan.stationLabel,
              opSeq: op.seq,
              opName: op.name,
              opStation: op.stationCode,
              opWorkstation: op.workstation,
              opEstMin: op.estimatedTimeMin,
              opEstQtyBase: op.estimatedQtyBase ?? "",
              opSampleSize: op.sampleSize,
              opFrequency: op.frequency,
              opControl: sanitizeStructuredMarker(op.controlMethod),
              opCritical: op.critical ? "YES" : "NO",
              opNotes: op.notes,
              opCharacteristics: opChars.join("|"),
              opFileId: f.id || "",
              opFileName: f.name || "",
              opFileType: f.mime || "",
              bubbleId: "",
              characteristicId: "",
              characteristicName: "",
              bubbleName: "",
              nominal: "",
              lsl: "",
              usl: "",
              unit: "",
              method: "",
              instrument: "",
              reaction: "",
              bubbleX1: "",
              bubbleY1: "",
              bubbleX2: "",
              bubbleY2: "",
              bubbleWidth: "",
              bubbleHeight: "",
              bubbleLabelX: "",
              bubbleLabelY: "",
            });
            continue;
          }
          for (const b of bubbles) {
            const bb = resolveBubbleBoxForTarget(
              b,
              Number(f?.imageWidth || 0) || 0,
              Number(f?.imageHeight || 0) || 0,
              Number(f?.imageWidth || 0) || 0,
              Number(f?.imageHeight || 0) || 0,
            );
            const off = (b?.bubbleOffset && Number.isFinite(Number(b.bubbleOffset.x)) && Number.isFinite(Number(b.bubbleOffset.y)))
              ? { x: Number(b.bubbleOffset.x), y: Number(b.bubbleOffset.y) }
              : null;
            const linkedChar = charsById.get(String(b?.characteristicId || ""));
            rows.push({
              routeName: plan.routeName,
              revision: plan.revision,
              productRef: plan.productRef,
              jobName: plan.jobName,
              station: plan.stationLabel,
              opSeq: op.seq,
              opName: op.name,
              opStation: op.stationCode,
              opWorkstation: op.workstation,
              opEstMin: op.estimatedTimeMin ?? "",
              opEstQtyBase: op.estimatedQtyBase ?? "",
              opSampleSize: op.sampleSize ?? "",
              opFrequency: op.frequency,
              opControl: sanitizeStructuredMarker(op.controlMethod),
              opCritical: op.critical ? "YES" : "NO",
              opNotes: op.notes,
              opCharacteristics: opChars.join("|"),
              opFileId: f.id || "",
              opFileName: f.name || "",
              opFileType: f.mime || "",
              bubbleId: b.id,
              characteristicId: b.characteristicId || "",
              characteristicName: linkedChar?.name || "",
              bubbleName: b.name,
              nominal: b.nominal ?? "",
              lsl: b.lsl ?? "",
              usl: b.usl ?? "",
              unit: b.unit,
              method: b.method,
              instrument: b.instrument,
              reaction: b.reactionPlan,
              bubbleX1: bb?.x1 ?? "",
              bubbleY1: bb?.y1 ?? "",
              bubbleX2: bb?.x2 ?? "",
              bubbleY2: bb?.y2 ?? "",
              bubbleWidth: bb ? (bb.x2 - bb.x1) : "",
              bubbleHeight: bb ? (bb.y2 - bb.y1) : "",
              bubbleLabelX: off?.x ?? "",
              bubbleLabelY: off?.y ?? "",
            });
          }
        }
      }
      return rows;
    }

    function exportRouteJson() {
      const routePlan = getRoutePlan();
      if (!routePlan) return;
      exportJsonFile(`Route_${safeRecordToken(routePlan.routeName || routePlan.productRef || "route")}_${new Date().toISOString().slice(0, 10)}.json`, routePlan);
    }

    function exportRouteCsv() {
      const routePlan = getRoutePlan();
      if (!routePlan) return;
      const rows = routeRowsForExport(routePlan);
      const headers = ["routeName","revision","productRef","station","opSeq","opName","opStation","opWorkstation","opEstMin","opEstQtyBase","opSampleSize","opFrequency","opControl","opCritical","opNotes","opCharacteristics","opFileId","opFileName","opFileType","bubbleId","characteristicId","characteristicName","bubbleName","nominal","lsl","usl","unit","method","instrument","reaction","bubbleX1","bubbleY1","bubbleX2","bubbleY2","bubbleWidth","bubbleHeight","bubbleLabelX","bubbleLabelY"];
      const lines = [headers.join(",")];
      for (const row of rows) lines.push(headers.map((h) => csvCell(row[h])).join(","));
      exportTextFile(`Route_${safeRecordToken(routePlan.routeName || routePlan.productRef || "route")}_${new Date().toISOString().slice(0, 10)}.csv`, lines.join("\n"), "text/csv");
    }

    function exportRoutePdf() {
      const routePlan = getRoutePlan();
      if (!routePlan) return;
      const rows = routeRowsForExport(routePlan);
      const win = window.open("", "_blank", "width=1200,height=900");
      if (!win) {
        alert(tt("spacial.popupBlocked", "Popup blocked. Allow popups to export PDF."));
        return;
      }
      const cs = getComputedStyle(document.documentElement);
      const popupText = escHtml((cs.getPropertyValue("--text") || "").trim() || "#222");
      const popupBorder = escHtml((cs.getPropertyValue("--border") || "").trim() || "#bbb");
      const popupHead = escHtml((cs.getPropertyValue("--panel") || "").trim() || "#eee");
      const tableRows = rows.map((r) => `
        <tr>
          <td>${escHtml(r.opSeq)}</td>
          <td>${escHtml(r.opName)}</td>
          <td>${escHtml(r.opFileName)}</td>
          <td>${escHtml(r.opStation)}</td>
          <td>${escHtml(r.opWorkstation)}</td>
          <td>${escHtml(r.opControl)}</td>
          <td>${escHtml(r.opCharacteristics)}</td>
          <td>${escHtml(r.bubbleId)}</td>
          <td>${escHtml(r.characteristicId)}</td>
          <td>${escHtml(r.characteristicName)}</td>
          <td>${escHtml(r.bubbleName)}</td>
          <td>${escHtml(r.nominal)}</td>
          <td>${escHtml(r.lsl)}</td>
          <td>${escHtml(r.usl)}</td>
          <td>${escHtml(r.unit)}</td>
          <td>${escHtml(r.method)}</td>
          <td>${escHtml(r.instrument)}</td>
          <td>${escHtml(r.bubbleX1)}</td>
          <td>${escHtml(r.bubbleY1)}</td>
          <td>${escHtml(r.bubbleX2)}</td>
          <td>${escHtml(r.bubbleY2)}</td>
        </tr>
      `).join("");
      win.document.write(`
        <!doctype html>
        <html>
        <head>
          <meta charset="utf-8" />
          <title>${escHtml(tt("spacial.section.route", "Route"))}</title>
          <style>
            body{font-family:Arial,sans-serif;padding:14px;color:${popupText};}
            h1,h2{margin:0 0 8px 0;}
            .m{margin-bottom:12px;font-size:12px;}
            table{width:100%;border-collapse:collapse;font-size:11px;}
            th,td{border:1px solid ${popupBorder};padding:4px 6px;text-align:left;}
            th{background:${popupHead};}
          </style>
        </head>
        <body>
          <h1>${escHtml(tt("spacial.routing.title", "Routing and Dimensional Control"))}</h1>
          <div class="m">${escHtml(tt("spacial.section.route", "Route"))}: ${escHtml(routePlan.routeName)} | Rev: ${escHtml(routePlan.revision)} | Product: ${escHtml(routePlan.productRef)} | ${escHtml(tt("spacial.stationDefault", "Station"))}: ${escHtml(routePlan.stationLabel)}</div>
          <table>
            <thead>
              <tr>
                <th>${escHtml(tt("spacial.op.seq", "Seq"))}</th><th>${escHtml(tt("spacial.section.operations", "Operations"))}</th><th>${escHtml(tt("spacial.file.label", "File"))}</th><th>${escHtml(tt("spacial.stationDefault", "Station"))}</th><th>${escHtml(tt("spacial.op.workstation", "Workstation"))}</th><th>${escHtml(tt("spacial.op.method", "Control method"))}</th><th>${escHtml(tt("spacial.op.characteristics", "Operation characteristics"))}</th>
                <th>${escHtml(tt("spacial.characteristics.id", "Characteristic ID"))}</th><th>${escHtml(tt("spacial.characteristics.name", "Characteristic"))}</th>
                <th>${escHtml(tt("spacial.table.annotation", "Annotation"))}</th><th>${escHtml(tt("spacial.table.name", "Name"))}</th><th>${escHtml(tt("spacial.annotation.nominal", "Nominal"))}</th><th>${escHtml(tt("spacial.annotation.lsl", "Lower limit"))}</th><th>${escHtml(tt("spacial.annotation.usl", "Upper limit"))}</th><th>${escHtml(tt("spacial.annotation.unit", "Unit"))}</th><th>${escHtml(tt("spacial.annotation.method", "Method"))}</th><th>${escHtml(tt("spacial.annotation.instrument", "Instrument"))}</th><th>${escHtml(tt("spacial.annotation.x1", "X1"))}</th><th>${escHtml(tt("spacial.annotation.y1", "Y1"))}</th><th>${escHtml(tt("spacial.annotation.x2", "X2"))}</th><th>${escHtml(tt("spacial.annotation.y2", "Y2"))}</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </body>
        </html>
      `);
      win.document.close();
      win.focus();
      win.print();
    }

    function exportShowBoxesEnabled() {
      return !!resolveExportBubbleDisplaySettings().boxVisible;
    }

    function exportPdfIncludeBlueprintEnabled() {
      const input = $("bubblePdfIncludeImageChk");
      return input ? input.checked !== false : true;
    }

    function rainbowPaletteHex() {
      return ["#ff595e", "#ff924c", "#ffca3a", "#8ac926", "#52b788", "#00b4d8", "#1982c4", "#4361ee", "#6a4c93", "#c77dff", "#f72585", "#90be6d"];
    }

    function exportBubbleColorForIndex(idx, display, theme, options = {}) {
      if (options?.rainbow) {
        const palette = rainbowPaletteHex();
        return palette[Math.abs(Number(idx) || 0) % palette.length];
      }
      return display?.bubbleColor || theme?.accent || "#4dafff";
    }

    function drawOperationBubblesToCanvas(ctx, bubbles, theme, options = {}) {
      const display = normalizeBubbleDisplaySettings(options?.displaySettings || resolveExportBubbleDisplaySettings() || defaultBubbleDisplaySettings());
      const ok = display.selectedColor || theme?.ok || display.bubbleColor || theme?.accent || "#4dafff";
      const text = display.bubbleTextColor || theme?.text || "#ffffff";
      const boxColor = display.boxColor || display.bubbleColor || theme?.accent || "#4dafff";
      const showBoxes = options?.showBoxes !== false && display.boxVisible !== false;
      const showBubble = display.bubbleVisible !== false;
      const showText = display.textVisible !== false;
      const fillBubble = display.bubbleFill !== false;
      const rainbow = !!options?.rainbow;
      const selectedId = strOrEmpty(options?.selectedId);
      const fontSize = clampDisplaySettingNumber(display?.bubbleFontSize, 6, 36, 12);
      const bubbleRadius = clampDisplaySettingNumber(display?.bubbleSize, 6, 44, 14);
      const targetWidth = Math.max(1, Number(ctx?.canvas?.width || 1));
      const targetHeight = Math.max(1, Number(ctx?.canvas?.height || 1));
      const sourceWidth = Math.max(0, Number(options?.sourceWidth || 0) || 0);
      const sourceHeight = Math.max(0, Number(options?.sourceHeight || 0) || 0);
      for (let i = 0; i < bubbles.length; i += 1) {
        const b = bubbles[i];
        const box = resolveBubbleBoxForTarget(b, targetWidth, targetHeight, sourceWidth, sourceHeight);
        if (!box) continue;
        const isSel = selectedId ? String(b.id || "") === selectedId : false;
        const accent = exportBubbleColorForIndex(i, display, theme, { rainbow });
        if (showBoxes) {
          const boxAccent = rainbow ? accent : boxColor;
          ctx.strokeStyle = isSel ? ok : boxAccent;
          ctx.lineWidth = isSel ? 3 : 2;
          ctx.fillStyle = isSel ? hexToRgba(ok, 0.10) : hexToRgba(boxAccent, 0.08);
          ctx.strokeRect(box.x1, box.y1, box.x2 - box.x1, box.y2 - box.y1);
          ctx.fillRect(box.x1, box.y1, box.x2 - box.x1, box.y2 - box.y1);
        }
        const offset = b?.bubbleOffset && Number.isFinite(Number(b.bubbleOffset.x)) && Number.isFinite(Number(b.bubbleOffset.y))
          ? { x: Number(b.bubbleOffset.x), y: Number(b.bubbleOffset.y) }
          : defaultBubbleOffset(display, box);
        const label = { x: box.x1 + offset.x, y: box.y1 + offset.y, r: bubbleRadius };
        if (!label || (!showBubble && !showText)) continue;
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        if (showBubble) {
          if (fillBubble) {
            ctx.fillStyle = isSel ? hexToRgba(ok, 0.92) : hexToRgba(accent, 0.88);
            ctx.beginPath();
            ctx.arc(label.x, label.y, label.r, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.strokeStyle = isSel ? ok : accent;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(label.x, label.y, label.r, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (showText) {
          if (!showBubble) {
            ctx.lineWidth = Math.max(2, Math.round(fontSize / 5));
            ctx.strokeStyle = hexToRgba("#ffffff", 0.96);
            ctx.strokeText(String(i + 1), label.x, label.y);
          }
          ctx.fillStyle = text;
          ctx.fillText(String(i + 1), label.x, label.y);
        }
      }
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    }

    function loadImageElement(dataUrl) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("image-load-failed"));
        img.src = String(dataUrl || "");
      });
    }

    async function waitForPopupImages(win) {
      if (!win?.document) return;
      const images = Array.from(win.document.images || []);
      if (!images.length) return;
      await Promise.all(images.map((img) => {
        if (img.complete && img.naturalWidth > 0) {
          if (typeof img.decode === "function") {
            return img.decode().catch(() => {});
          }
          return Promise.resolve();
        }
        return new Promise((resolve) => {
          const done = () => resolve();
          img.addEventListener("load", done, { once: true });
          img.addEventListener("error", done, { once: true });
        });
      }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await new Promise((resolve) => setTimeout(resolve, 120));
    }

    async function renderOperationExportCanvas(file, options = {}) {
      const showBoxes = options?.showBoxes !== false;
      const includeImage = options?.includeImage !== false;
      const exportDisplay = resolveExportBubbleDisplaySettings(options?.displaySettings || null);
      let width = 1400;
      let height = 900;
      let img = null;
      if (includeImage && isImageDataUrl(file?.dataUrl)) {
        img = await loadImageElement(file.dataUrl);
        width = Math.max(1, Number(img.width || width));
        height = Math.max(1, Number(img.height || height));
      }
      const cv = document.createElement("canvas");
      cv.width = width;
      cv.height = height;
      const ctx = cv.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = options?.background || "#ffffff";
      ctx.fillRect(0, 0, cv.width, cv.height);
      if (img) ctx.drawImage(img, 0, 0, cv.width, cv.height);
      drawOperationBubblesToCanvas(ctx, Array.isArray(file?.bubbles) ? file.bubbles : [], {
        accent: cssThemeHex("--accent", "#4dafff"),
        ok: cssThemeHex("--ok", "#00ff8f"),
        text: cssThemeHex("--text", "#ffffff"),
        bg: cssThemeHex("--bg", "#0f1724"),
      }, {
        showBoxes,
        selectedId: "",
        rainbow: !!exportDisplay.rainbowExport,
        displaySettings: exportDisplay,
        sourceWidth: Number(file?.imageWidth || 0) || width,
        sourceHeight: Number(file?.imageHeight || 0) || height,
      });
      return cv;
    }

    async function exportSelectedOperationAnnotatedJpg() {
      const routePlan = getRoutePlan();
      const op = getSelectedOperation();
      const file = selectedOperationFile(op);
      if (!op || !file) return;
      if (!isImageDataUrl(file.dataUrl)) {
        alert(tt("spacial.alert.imageFileRequired", "Current file is not an image. Upload/select an image file first."));
        return;
      }
      try {
        const cv = await renderOperationExportCanvas(file, {
          includeImage: true,
          showBoxes: exportShowBoxesEnabled(),
          background: "#ffffff",
        });
        if (!cv) throw new Error("canvas-create-failed");
        const name = safeFilename(`${routePlan?.routeName || routePlan?.productRef || "route"}_${op.seq || "op"}_${file.name || "file"}_annotated`, "operation_annotated");
        if (cv.toBlob) {
          cv.toBlob((blob) => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${name}.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
          }, "image/png");
        } else {
          const a = document.createElement("a");
          a.href = cv.toDataURL("image/png");
          a.download = `${name}.png`;
          document.body.appendChild(a);
          a.click();
          a.remove();
        }
      } catch {
        alert(tt("spacial.alert.imageLoadFailed", "Failed to load image for export."));
      }
    }

    function downloadBlob(filename, blob) {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

    function xmlEsc(v) {
      return String(v ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
    }

    function excelColName(idx1) {
      let n = Math.max(1, Number(idx1) || 1);
      let out = "";
      while (n > 0) {
        const rem = (n - 1) % 26;
        out = String.fromCharCode(65 + rem) + out;
        n = Math.floor((n - 1) / 26);
      }
      return out;
    }

    function buildSheetXml(rows) {
      const rowXml = (rows || []).map((row, ridx) => {
        const r = ridx + 1;
        const cells = (row || []).map((value, cidx) => {
          const ref = `${excelColName(cidx + 1)}${r}`;
          if (typeof value === "number" && Number.isFinite(value)) {
            return `<c r="${ref}"><v>${String(value)}</v></c>`;
          }
          const text = String(value ?? "");
          const preserve = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : "";
          return `<c r="${ref}" t="inlineStr"><is><t${preserve}>${xmlEsc(text)}</t></is></c>`;
        }).join("");
        return `<row r="${r}">${cells}</row>`;
      }).join("");
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\n  <sheetData>${rowXml}</sheetData>\n</worksheet>`;
    }

    function concatBytes(chunks) {
      const total = chunks.reduce((sum, c) => sum + (c?.length || 0), 0);
      const out = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        if (!chunk?.length) continue;
        out.set(chunk, offset);
        offset += chunk.length;
      }
      return out;
    }

    let spacialCrcTable = null;
    function crc32(bytes) {
      if (!spacialCrcTable) {
        spacialCrcTable = new Uint32Array(256);
        for (let n = 0; n < 256; n += 1) {
          let c = n;
          for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
          spacialCrcTable[n] = c >>> 0;
        }
      }
      let c = 0xFFFFFFFF;
      for (let i = 0; i < bytes.length; i += 1) c = spacialCrcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
      return (c ^ 0xFFFFFFFF) >>> 0;
    }

    function writeU16(view, offset, value) {
      view.setUint16(offset, Number(value) & 0xFFFF, true);
    }

    function writeU32(view, offset, value) {
      view.setUint32(offset, Number(value) >>> 0, true);
    }

    function createZipBlob(fileEntries) {
      const enc = new TextEncoder();
      const localChunks = [];
      const centralChunks = [];
      let offset = 0;
      for (const entry of fileEntries) {
        const nameBytes = enc.encode(String(entry.name || ""));
        const dataBytes = entry.bytes instanceof Uint8Array ? entry.bytes : enc.encode(String(entry.bytes || ""));
        const crc = crc32(dataBytes);
        const local = new Uint8Array(30 + nameBytes.length + dataBytes.length);
        const lv = new DataView(local.buffer);
        writeU32(lv, 0, 0x04034b50);
        writeU16(lv, 4, 20);
        writeU16(lv, 6, 0);
        writeU16(lv, 8, 0);
        writeU16(lv, 10, 0);
        writeU16(lv, 12, 0);
        writeU32(lv, 14, crc);
        writeU32(lv, 18, dataBytes.length);
        writeU32(lv, 22, dataBytes.length);
        writeU16(lv, 26, nameBytes.length);
        writeU16(lv, 28, 0);
        local.set(nameBytes, 30);
        local.set(dataBytes, 30 + nameBytes.length);
        localChunks.push(local);

        const central = new Uint8Array(46 + nameBytes.length);
        const cv = new DataView(central.buffer);
        writeU32(cv, 0, 0x02014b50);
        writeU16(cv, 4, 20);
        writeU16(cv, 6, 20);
        writeU16(cv, 8, 0);
        writeU16(cv, 10, 0);
        writeU16(cv, 12, 0);
        writeU16(cv, 14, 0);
        writeU32(cv, 16, crc);
        writeU32(cv, 20, dataBytes.length);
        writeU32(cv, 24, dataBytes.length);
        writeU16(cv, 28, nameBytes.length);
        writeU16(cv, 30, 0);
        writeU16(cv, 32, 0);
        writeU16(cv, 34, 0);
        writeU16(cv, 36, 0);
        writeU32(cv, 38, 0);
        writeU32(cv, 42, offset);
        central.set(nameBytes, 46);
        centralChunks.push(central);
        offset += local.length;
      }
      const centralData = concatBytes(centralChunks);
      const end = new Uint8Array(22);
      const ev = new DataView(end.buffer);
      writeU32(ev, 0, 0x06054b50);
      writeU16(ev, 8, fileEntries.length);
      writeU16(ev, 10, fileEntries.length);
      writeU32(ev, 12, centralData.length);
      writeU32(ev, 16, offset);
      const zipBytes = concatBytes([...localChunks, centralData, end]);
      return new Blob([zipBytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    }

    function buildSimpleXlsxBlob(sheets) {
      const cleanSheets = (sheets || [])
        .filter((s) => s && Array.isArray(s.rows))
        .map((s, idx) => ({
          name: String(s.name || `Sheet${idx + 1}`).slice(0, 31) || `Sheet${idx + 1}`,
          rows: s.rows,
        }));
      if (!cleanSheets.length) return null;
      const enc = new TextEncoder();
      const sheetOverrides = cleanSheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
      const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n  <Default Extension="xml" ContentType="application/xml"/>\n  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>\n  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>\n  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>\n  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>\n  ${sheetOverrides}\n</Types>`;
      const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>\n  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>\n  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>\n</Relationships>`;
      const nowIso = new Date().toISOString();
      const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">\n  <Application>VMill SPaCial</Application>\n</Properties>`;
      const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n  <dc:creator>VMill SPaCial</dc:creator>\n  <cp:lastModifiedBy>VMill SPaCial</cp:lastModifiedBy>\n  <dcterms:created xsi:type="dcterms:W3CDTF">${xmlEsc(nowIso)}</dcterms:created>\n  <dcterms:modified xsi:type="dcterms:W3CDTF">${xmlEsc(nowIso)}</dcterms:modified>\n</cp:coreProperties>`;
      const workbookSheets = cleanSheets.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("");
      const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n  <sheets>${workbookSheets}</sheets>\n</workbook>`;
      const workbookRelsSheets = cleanSheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("");
      const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n  ${workbookRelsSheets}\n  <Relationship Id="rId${cleanSheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>\n</Relationships>`;
      const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\n  <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>\n  <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>\n  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>\n  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>\n  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>\n  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>\n</styleSheet>`;
      const entries = [
        { name: "[Content_Types].xml", bytes: enc.encode(contentTypes) },
        { name: "_rels/.rels", bytes: enc.encode(rootRels) },
        { name: "docProps/app.xml", bytes: enc.encode(appXml) },
        { name: "docProps/core.xml", bytes: enc.encode(coreXml) },
        { name: "xl/workbook.xml", bytes: enc.encode(workbookXml) },
        { name: "xl/_rels/workbook.xml.rels", bytes: enc.encode(workbookRels) },
        { name: "xl/styles.xml", bytes: enc.encode(stylesXml) },
      ];
      cleanSheets.forEach((sheet, idx) => {
        entries.push({ name: `xl/worksheets/sheet${idx + 1}.xml`, bytes: enc.encode(buildSheetXml(sheet.rows)) });
      });
      return createZipBlob(entries);
    }

    function autocontrolExportRowsForFile(_op, file) {
      const productId = currentRouteProductId();
      return (Array.isArray(file?.bubbles) ? file.bubbles : []).map((b) => {
        const linkedLabel = characteristicNameById(b.characteristicId, productId);
        return [
          b.id || "",
          linkedLabel || b.name || "",
          b.nominal ?? "",
          b.lowerDeviation ?? "",
          b.upperDeviation ?? "",
          b.lsl ?? "",
          b.usl ?? "",
          b.unit || "",
          b.method || "",
          b.instrument || "",
          file?.name || "",
        ];
      });
    }

    function autocontrolTemplateMeasurementRowsForFile(file) {
      const productId = currentRouteProductId();
      return (Array.isArray(file?.bubbles) ? file.bubbles : []).map((b, idx) => {
        const linked = characteristicById(b.characteristicId, productId);
        return {
          point: strOrEmpty(b.id) || String(idx + 1),
          characteristic: strOrEmpty(linked?.name || linked?.id || b.name || ""),
          nominal: b.nominal ?? "",
          tolMin: b.lsl ?? "",
          tolMax: b.usl ?? "",
          instrument: strOrEmpty(b.instrument || b.method || ""),
          instrumentId: "",
          operator: "",
          date: "",
          result: "",
        };
      });
    }

    function parseAutocontrolProductRef(routePlan) {
      const raw = strOrEmpty(routePlan?.productRef || "");
      if (!raw) return { code: "", name: "" };
      const parts = raw.split(/\s+-\s+/);
      if (parts.length >= 2) {
        return {
          code: strOrEmpty(parts.shift()),
          name: strOrEmpty(parts.join(" - ")),
        };
      }
      return { code: raw, name: raw };
    }

    function buildAutocontrolDocNumber(routePlan, op, file, productParts = null) {
      const product = productParts || parseAutocontrolProductRef(routePlan);
      const bits = [
        strOrEmpty(product?.code || ""),
        strOrEmpty(routePlan?.revision || ""),
        safeFilename(strOrEmpty(op?.name || "operation"), "operation").replace(/_/g, "-"),
        safeFilename(strOrEmpty(file?.name || "file"), "file").replace(/_/g, "-"),
      ].filter(Boolean);
      return bits.join("_");
    }

    function templateCell(ref, value) {
      return { ref, value: value == null ? "" : value };
    }

    function appendAutocontrolTableCells(cells, rows, startRow, endRow, cols) {
      const capacity = Math.max(0, Number(endRow || 0) - Number(startRow || 0) + 1);
      for (let i = 0; i < capacity; i += 1) {
        const excelRow = Number(startRow || 0) + i;
        const row = rows[i] || null;
        cells.push(templateCell(`${cols.point}${excelRow}`, row?.point || ""));
        cells.push(templateCell(`${cols.characteristic}${excelRow}`, row?.characteristic || ""));
        cells.push(templateCell(`${cols.nominal}${excelRow}`, row?.nominal ?? ""));
        cells.push(templateCell(`${cols.tolMin}${excelRow}`, row?.tolMin ?? ""));
        cells.push(templateCell(`${cols.tolMax}${excelRow}`, row?.tolMax ?? ""));
        cells.push(templateCell(`${cols.instrument}${excelRow}`, row?.instrument || ""));
        if (cols.instrumentId) cells.push(templateCell(`${cols.instrumentId}${excelRow}`, row?.instrumentId || ""));
        if (cols.operator) cells.push(templateCell(`${cols.operator}${excelRow}`, row?.operator || ""));
        if (cols.date) cells.push(templateCell(`${cols.date}${excelRow}`, row?.date || ""));
        if (cols.result) cells.push(templateCell(`${cols.result}${excelRow}`, row?.result || ""));
      }
    }

    async function exportAutocontrolXlsxFromServerTemplate(sheets, filename) {
      const payloadSheets = (Array.isArray(sheets) ? sheets : [])
        .filter((sheet) => sheet && (Array.isArray(sheet.cells) ? sheet.cells.length : Array.isArray(sheet.rows) ? sheet.rows.length : 0))
        .map((sheet, idx) => ({
          name: String(sheet.name || `Sheet${idx + 1}`).slice(0, 31) || `Sheet${idx + 1}`,
          cells: Array.isArray(sheet.cells) ? sheet.cells : [],
          rows: Array.isArray(sheet.rows) ? sheet.rows : [],
        }));
      if (!payloadSheets.length) throw new Error("no_template_sheets");
      const tokenKey = String(window.VMillData?.keys?.AUTH_TOKEN_KEY || "vmill:auth:token");
      const token = String(localStorage.getItem(tokenKey) || "");
      const headers = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch("/api/reports/spacial/template-xlsx", {
        method: "POST",
        headers,
        body: JSON.stringify({
          template: "spacial_autocontrol_template.xlsx",
          filename: String(filename || "spacial_autocontrol.xlsx"),
          sheets: payloadSheets,
        }),
      });
      if (!res.ok) {
        let detail = `HTTP_${res.status || 0}`;
        try {
          const err = await res.json();
          if (err && typeof err === "object" && err.error) detail = String(err.error);
        } catch {}
        throw new Error(detail);
      }
      const blob = await res.blob();
      if (!blob || !blob.size) throw new Error("empty_blob");
      return blob;
    }

    function pickAutocontrolRectifFile(files, selectedFileId = "") {
      const rows = Array.isArray(files) ? files : [];
      const byName = rows.find((file) => /rectif|apres|after|final/i.test(strOrEmpty(file?.name || "")));
      if (byName) return byName;
      const selected = rows.find((file) => String(file?.id || "") === String(selectedFileId || ""));
      if (selected) return selected;
      return rows[rows.length - 1] || null;
    }

    function buildAutocontrolTemplateSheets(routePlan, op) {
      if (!op || !routePlan) return [];
      const files = ensureOperationFiles(op);
      const selectedFile = selectedOperationFile(op);
      const product = parseAutocontrolProductRef(routePlan);
      const pvRows = files.flatMap((file) => autocontrolTemplateMeasurementRowsForFile(file));
      const pvCells = [
        templateCell("D2", product.code || routePlan.productRef || ""),
        templateCell("D3", routePlan.revision || ""),
        templateCell("D4", product.name || routePlan.productRef || ""),
        templateCell("F7", `N° :${buildAutocontrolDocNumber(routePlan, op, selectedFile || files[0] || {}, product)}`),
      ];
      appendAutocontrolTableCells(pvCells, pvRows, 15, 50, {
        point: "A",
        characteristic: "B",
        nominal: "C",
        tolMin: "D",
        tolMax: "E",
        instrument: "P",
        instrumentId: "R",
        operator: "S",
        date: "T",
        result: "U",
      });
      const tcnSectionRanges = [
        { startRow: 9, endRow: 15 },
        { startRow: 20, endRow: 34 },
        { startRow: 39, endRow: 40 },
        { startRow: 45, endRow: 48 },
      ];
      const tcnCells = [
        templateCell("D2", product.code || routePlan.productRef || ""),
        templateCell("D3", routePlan.revision || ""),
        templateCell("D4", product.name || routePlan.productRef || ""),
      ];
      tcnSectionRanges.forEach((section, idx) => {
        const file = files[idx] || null;
        const rows = file ? autocontrolTemplateMeasurementRowsForFile(file) : [];
        appendAutocontrolTableCells(tcnCells, rows, section.startRow, section.endRow, {
          point: "A",
          characteristic: "B",
          nominal: "C",
          tolMin: "D",
          tolMax: "E",
          instrument: "P",
          instrumentId: "",
          operator: "R",
          date: "S",
          result: "",
        });
      });
      const rectifFile = pickAutocontrolRectifFile(files, getSelectedOpFileId());
      const rectifRows = rectifFile ? autocontrolTemplateMeasurementRowsForFile(rectifFile) : [];
      const rectifCells = [
        templateCell("D2", product.code || routePlan.productRef || ""),
        templateCell("D3", routePlan.revision || ""),
        templateCell("D4", product.name || routePlan.productRef || ""),
        templateCell("F7", `N° :${buildAutocontrolDocNumber(routePlan, op, rectifFile || selectedFile || files[0] || {}, product)}`),
      ];
      appendAutocontrolTableCells(rectifCells, rectifRows, 15, 22, {
        point: "A",
        characteristic: "B",
        nominal: "C",
        tolMin: "D",
        tolMax: "E",
        instrument: "K",
        instrumentId: "M",
        operator: "N",
        date: "O",
        result: "P",
      });
      const instrumentSet = new Set(["Tridimensionnelle", "Palmer", "Pied à Coulisse", "Colonne de mesure"]);
      pvRows.forEach((row) => {
        const instrument = strOrEmpty(row?.instrument || "");
        if (instrument) instrumentSet.add(instrument);
      });
      const instrumentRows = Array.from(instrumentSet).slice(0, 40);
      const dataCells = [templateCell("A1", "Moyens")];
      instrumentRows.forEach((instrument, idx) => {
        dataCells.push(templateCell(`A${idx + 2}`, instrument));
      });
      for (let row = instrumentRows.length + 2; row <= 50; row += 1) {
        dataCells.push(templateCell(`A${row}`, ""));
      }
      return [
        { name: "PV", cells: pvCells },
        { name: " TCN OP 1-2-3", cells: tcnCells },
        { name: "APRES RECTIF", cells: rectifCells },
        { name: "Data", cells: dataCells },
      ];
    }

    async function exportSelectedOperationAutocontrolXlsx() {
      const routePlan = getRoutePlan();
      const op = getSelectedOperation();
      if (!op || !routePlan) return;
      const files = ensureOperationFiles(op);
      const measurementRows = [];
      for (const file of files) measurementRows.push(...autocontrolExportRowsForFile(op, file));
      const rows = [
        ["AUTOCONTROL REPORT"],
        [],
        ["Route", routePlan.routeName || "", "Revision", routePlan.revision || "", "Operation", `${op.seq || ""} - ${op.name || ""}`],
        ["Station", routePlan.stationLabel || "", "Product", routePlan.productRef || "", "Exported", new Date().toISOString().slice(0, 10)],
        [],
        ["Point de controle", "Caracteristique", "Valeur nominale", "Tol min", "Tol max", "LSL", "USL", "Unite", "Methode", "Instrument", "Fichier"],
        ...measurementRows,
      ];
      const dataSheet = {
        name: "Data",
        rows: [
          ["Instrument"],
          ["Tridimensionnelle"],
          ["Palmer"],
          ["Pied a Coulisse"],
          ["Colonne de mesure"],
        ],
      };
      const safeRoute = safeFilename(routePlan.routeName || "route");
      const safeOp = safeFilename(op.name || `op_${op.seq || "0"}`);
      const filename = `${safeRoute}_${safeOp}_autocontrol.xlsx`;
      try {
        const templateBlob = await exportAutocontrolXlsxFromServerTemplate(buildAutocontrolTemplateSheets(routePlan, op), filename);
        downloadBlob(filename, templateBlob);
        return;
      } catch (err) {
        console.warn("SPaCial template XLSX export failed, falling back to built-in export:", err);
      }
      const blob = buildSimpleXlsxBlob([
        { name: "PV", rows },
        dataSheet,
      ]);
      if (!blob) {
        alert(tt("spacial.alert.exportFailed", "Unable to build export file."));
        return;
      }
      downloadBlob(filename, blob);
    }

    function operationFileRowsForPdf(file) {
      const bubbles = Array.isArray(file?.bubbles) ? file.bubbles : [];
      if (!bubbles.length) {
        return `<tr><td colspan="11" style="padding:6px;">${escHtml(tt("spacial.none.annotations", "No annotations yet for this operation."))}</td></tr>`;
      }
      const productId = currentRouteProductId();
      const display = resolveExportBubbleDisplaySettings();
      const rainbow = !!display.rainbowExport;
      const theme = { accent: cssThemeHex("--accent", "#4dafff") };
      return bubbles.map((b, idx) => {
        const color = exportBubbleColorForIndex(idx, display, theme, { rainbow });
        const rowStyle = rainbow ? ` style="background:${hexToRgba(color, 0.08)};"` : "";
        const annBadgeStyle = [
          "display:inline-block",
          "padding:2px 8px",
          "border-radius:999px",
          `border:1px solid ${color}`,
          `background:${hexToRgba(color, display.bubbleFill === false ? 0.02 : 0.18)}`,
          `color:${display.bubbleTextColor || "#111111"}`,
          "font-weight:700",
        ].join(";");
        return `
          <tr${rowStyle}>
            <td><span style="${annBadgeStyle}">${escHtml(b.id || "")}</span></td>
            <td>${escHtml(characteristicNameById(b.characteristicId, productId) || b.name || "")}</td>
            <td>${escHtml(b.nominal ?? "")}</td>
            <td>${escHtml(b.lowerDeviation ?? "")}</td>
            <td>${escHtml(b.upperDeviation ?? "")}</td>
            <td>${escHtml(b.lsl ?? "")}</td>
            <td>${escHtml(b.usl ?? "")}</td>
            <td>${escHtml(b.unit || "")}</td>
            <td>${escHtml(b.method || "")}</td>
            <td>${escHtml(b.instrument || "")}</td>
            <td>${escHtml(b.toleranceSpec || "")}</td>
          </tr>
        `;
      }).join("");
    }

    function exportSelectedOperationPdf() {
      const routePlan = getRoutePlan();
      const op = getSelectedOperation();
      if (!op || !routePlan) return;
      const files = ensureOperationFiles(op);
      const win = window.open("", "_blank", "width=1200,height=900");
      if (!win) {
        alert(tt("spacial.popupBlocked", "Popup blocked. Allow popups to export PDF."));
        return;
      }
      const cs = getComputedStyle(document.documentElement);
      const popupText = escHtml((cs.getPropertyValue("--text") || "").trim() || "#222");
      const popupBorder = escHtml((cs.getPropertyValue("--border") || "").trim() || "#bbb");
      const popupMuted = escHtml((cs.getPropertyValue("--muted") || "").trim() || "#666");
      const opTitle = `${op.seq || ""} - ${op.name || tt("spacial.section.operations", "Operations")}`;
      const includeBlueprint = exportPdfIncludeBlueprintEnabled();
      Promise.all(files.map(async (file, idx) => {
        let previewHtml = "";
        if (includeBlueprint) {
          if (isImageDataUrl(file.dataUrl)) {
            try {
              const cv = await renderOperationExportCanvas(file, {
                includeImage: true,
                showBoxes: exportShowBoxesEnabled(),
                background: "#ffffff",
              });
              const dataUrl = cv ? cv.toDataURL("image/png") : "";
              const printWidth = cssSizeFromPoints(file?.sourcePageWidthPt, file?.imageWidth);
              const printHeight = cssSizeFromPoints(file?.sourcePageHeightPt, file?.imageHeight);
              const printStyle = [
                printWidth ? `width:${printWidth};` : "",
                printHeight ? `height:${printHeight};` : "",
                (!printWidth && !printHeight) ? "max-width:100%;max-height:420px;" : "max-width:100%;height:auto;",
              ].join("");
              previewHtml = dataUrl
                ? `<img src="${dataUrl}" style="${printStyle}display:block;border:1px solid ${popupBorder};border-radius:6px;margin-bottom:8px;" />`
                : `<div style="margin:0 0 8px;font-size:12px;color:${popupMuted};">${escHtml(tt("spacial.file.previewNA", "Preview not available for this file type."))}</div>`;
            } catch {
              previewHtml = `<div style="margin:0 0 8px;font-size:12px;color:${popupMuted};">${escHtml(tt("spacial.file.previewNA", "Preview not available for this file type."))}</div>`;
            }
          } else {
            previewHtml = `<div style="margin:0 0 8px;font-size:12px;color:${popupMuted};">${escHtml(tt("spacial.file.previewNA", "Preview not available for this file type."))}</div>`;
          }
        }
        return `
        <section style="margin:0 0 18px;">
          <h3 style="margin:0 0 6px;">${escHtml(tt("spacial.file.label", "File"))} ${idx + 1}: ${escHtml(file.name || "")}</h3>
          <div style="margin:0 0 8px;font-size:11px;color:${popupMuted};">
            ${escHtml(file.mime || "")}
            ${file?.sourceDpi ? ` | ${escHtml(`${file.sourceDpi} DPI`)}` : ""}
          </div>
          ${previewHtml}
          <table style="width:100%;border-collapse:collapse;font-size:11px;">
            <thead>
              <tr>
                <th style="border:1px solid ${popupBorder};padding:4px 6px;text-align:left;">${escHtml(tt("spacial.table.annotation", "Annotation"))}</th>
                <th style="border:1px solid ${popupBorder};padding:4px 6px;text-align:left;">${escHtml(tt("spacial.characteristics.name", "Characteristic"))}</th>
                <th style="border:1px solid ${popupBorder};padding:4px 6px;text-align:left;">${escHtml(tt("spacial.annotation.nominal", "Nominal"))}</th>
                <th style="border:1px solid ${popupBorder};padding:4px 6px;text-align:left;">Tol -</th>
                <th style="border:1px solid ${popupBorder};padding:4px 6px;text-align:left;">Tol +</th>
                <th style="border:1px solid ${popupBorder};padding:4px 6px;text-align:left;">${escHtml(tt("spacial.annotation.lsl", "Lower limit"))}</th>
                <th style="border:1px solid ${popupBorder};padding:4px 6px;text-align:left;">${escHtml(tt("spacial.annotation.usl", "Upper limit"))}</th>
                <th style="border:1px solid ${popupBorder};padding:4px 6px;text-align:left;">${escHtml(tt("spacial.annotation.unit", "Unit"))}</th>
                <th style="border:1px solid ${popupBorder};padding:4px 6px;text-align:left;">${escHtml(tt("spacial.annotation.method", "Method"))}</th>
                <th style="border:1px solid ${popupBorder};padding:4px 6px;text-align:left;">${escHtml(tt("spacial.annotation.instrument", "Instrument"))}</th>
                <th style="border:1px solid ${popupBorder};padding:4px 6px;text-align:left;">Fit / Tol spec</th>
              </tr>
            </thead>
            <tbody>${operationFileRowsForPdf(file)}</tbody>
          </table>
        </section>
      `;
      })).then((blocks) => {
        win.document.write(`
          <!doctype html>
          <html>
            <head>
              <meta charset="utf-8" />
              <title>${escHtml(opTitle)}</title>
              <style>
                html,body{
                  font-family:Arial,sans-serif;
                  padding:0;
                  margin:0;
                  background:#ffffff;
                  color:${popupText};
                  -webkit-print-color-adjust:exact;
                  print-color-adjust:exact;
                }
                body{padding:14px;}
                h1,h2,h3{margin:0 0 8px;}
                img{display:block;page-break-inside:avoid;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
                *{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
              </style>
            </head>
            <body>
              <h1>${escHtml(tt("spacial.routing.title", "Routing and Dimensional Control"))}</h1>
              <h2>${escHtml(opTitle)}</h2>
              <div style="margin:0 0 12px;font-size:12px;">${escHtml(tt("spacial.section.route", "Route"))}: ${escHtml(routePlan.routeName || "")} | ${escHtml(tt("spacial.stationDefault", "Station"))}: ${escHtml(routePlan.stationLabel || "")}</div>
              ${blocks.join("")}
            </body>
          </html>
        `);
        win.document.close();
        waitForPopupImages(win).then(() => {
          win.focus();
          win.print();
        }).catch(() => {
          win.focus();
          win.print();
        });
      }).catch(() => {
        win.document.write(`
          <!doctype html>
          <html>
            <head><meta charset="utf-8" /><title>${escHtml(opTitle)}</title></head>
            <body style="font-family:Arial,sans-serif;padding:14px;color:${popupText};">
              <h1>${escHtml(tt("spacial.routing.title", "Routing and Dimensional Control"))}</h1>
              <h2>${escHtml(opTitle)}</h2>
              <div>${escHtml(tt("spacial.file.previewNA", "Preview not available for this file type."))}</div>
            </body>
          </html>
        `);
        win.document.close();
        win.focus();
      });
    }

    return {
      routeRowsForExport,
      exportRouteJson,
      exportRouteCsv,
      exportRoutePdf,
      exportSelectedOperationAnnotatedJpg,
      exportSelectedOperationAutocontrolXlsx,
      exportSelectedOperationPdf,
    };
  }

  window.VMillSpacialExport = { createRuntime };
})();
