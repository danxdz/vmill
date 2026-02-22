import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { SidebarModuleProps, ToolVisualProfile } from './modules/moduleTypes';

type ToolShapePreset =
  | 'endmill'
  | 'bullnose'
  | 'ballnose'
  | 'drill'
  | 'center-drill'
  | 'chamfer-drill'
  | 'reamer'
  | 'tap'
  | 'taper-endmill'
  | 'holder-cylindrical'
  | 'holder-bt40'
  | 'holder-hsk63'
  | 'holder-cat40'
  | 'holder-slim'
  | 'extension-straight';

type HolderPreset = 'cylindrical' | 'bt40' | 'hsk63' | 'cat40' | 'slim';
type LenParamKey = 'l1' | 'l2' | 'l3';
type DiaParamKey = 'd1' | 'd2' | 'd3';

function toNum(raw: string): number | null {
  const v = Number.parseFloat(raw.replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

function clampPos(v: number, min = 0.1, max = 500): number {
  return Math.max(min, Math.min(max, v));
}

function normalizeHexColor(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  const v = raw.trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
}

function tipLengthFromDiameterAngle(diameter: number, angleDeg: number): number {
  const d = Math.max(0.1, diameter);
  const a = clampPos(angleDeg, 20, 170);
  const half = (a * Math.PI) / 360;
  return Math.max(0.5, (d * 0.5) / Math.tan(half));
}

function holderPresetValues(preset: HolderPreset, baseDia: number) {
  const dia = Math.max(6, baseDia);
  switch (preset) {
    case 'bt40':
      return { useHolder: true, holderLength: 62, holderDiameterTop: 42, holderDiameterBottom: 24 };
    case 'hsk63':
      return { useHolder: true, holderLength: 52, holderDiameterTop: 38, holderDiameterBottom: 20 };
    case 'cat40':
      return { useHolder: true, holderLength: 58, holderDiameterTop: 40, holderDiameterBottom: 24 };
    case 'slim':
      return { useHolder: true, holderLength: 46, holderDiameterTop: Math.max(10, dia * 1.15), holderDiameterBottom: Math.max(8, dia * 0.95) };
    default:
      return { useHolder: true, holderLength: 45, holderDiameterTop: Math.max(12, dia * 1.6), holderDiameterBottom: Math.max(12, dia * 1.6) };
  }
}

function profileFromTool(length: number, radius: number, shape: ToolShapePreset, tipAngleDeg: number): ToolVisualProfile {
  const total = Math.max(12, length || 28);
  const dia = Math.max(1, radius > 0 ? radius * 2 : 8);
  const holderPresetForShape: Record<string, HolderPreset> = {
    'holder-cylindrical': 'cylindrical',
    'holder-bt40': 'bt40',
    'holder-hsk63': 'hsk63',
    'holder-cat40': 'cat40',
    'holder-slim': 'slim',
    'extension-straight': 'cylindrical',
  };

  if (shape in holderPresetForShape) {
    const holderPreset = holderPresetForShape[shape];
    const holder = holderPresetValues(holderPreset, dia);
    const l1 = clampPos(total * 0.24);
    const l2 = clampPos(total * 0.28);
    const l3 = clampPos(total - l1 - l2);
    const extensionDia = shape === 'extension-straight'
      ? Math.max(4, dia * 1.6)
      : Math.max(6, dia * 1.15);
    const coneMid = Math.max(holder.holderDiameterBottom, extensionDia);
    const bodyDia = Math.max(holder.holderDiameterTop, extensionDia * 1.05);
    return {
      l1, d1: extensionDia, d1Top: extensionDia, d1Bottom: extensionDia, g1Type: 'cylinder', g1Cut: false, g1Color: '#9ca3af',
      l2, d2: coneMid, d2Top: bodyDia, d2Bottom: coneMid, g2Type: shape === 'extension-straight' ? 'cylinder' : 'cone', g2Cut: false, g2Color: '#6b7280',
      l3, d3: bodyDia, d3Top: holder.holderDiameterTop, d3Bottom: holder.holderDiameterBottom, g3Type: shape === 'extension-straight' ? 'cylinder' : 'cone', g3Cut: false, g3Color: '#4b5563',
      useHolder: true,
      holderLength: holder.holderLength,
      holderDiameter: Math.max(holder.holderDiameterTop, holder.holderDiameterBottom),
      holderDiameterTop: holder.holderDiameterTop,
      holderDiameterBottom: holder.holderDiameterBottom,
      stickout: total,
    };
  }

  if (shape === 'drill') {
    const l1 = clampPos(Math.min(total * 0.36, tipLengthFromDiameterAngle(dia, tipAngleDeg)));
    const l2 = clampPos(total * 0.42);
    const l3 = clampPos(total - l1 - l2);
    const d3 = Math.max(dia, dia * 1.15);
    return {
      l1, d1: dia, d1Top: dia, d1Bottom: 0.2, g1Type: 'cone', g1Cut: true,
      l2, d2: dia, d2Top: dia, d2Bottom: dia, g2Type: 'cylinder', g2Cut: true,
      l3, d3, d3Top: d3, d3Bottom: d3, g3Type: 'cylinder', g3Cut: false,
    };
  }
  if (shape === 'center-drill') {
    const pilot = Math.max(0.5, dia * 0.5);
    const l1 = clampPos(Math.min(total * 0.25, tipLengthFromDiameterAngle(pilot, tipAngleDeg)));
    const l2 = clampPos(total * 0.25);
    const l3 = clampPos(total - l1 - l2);
    const d3 = Math.max(dia, dia * 1.3);
    return {
      l1, d1: pilot, d1Top: pilot, d1Bottom: 0.2, g1Type: 'cone', g1Cut: true,
      l2, d2: dia, d2Top: dia, d2Bottom: dia, g2Type: 'cylinder', g2Cut: true,
      l3, d3, d3Top: d3, d3Bottom: d3, g3Type: 'cylinder', g3Cut: false,
    };
  }
  if (shape === 'chamfer-drill') {
    const l1 = clampPos(Math.min(total * 0.5, tipLengthFromDiameterAngle(dia, tipAngleDeg)));
    const l2 = clampPos(total * 0.2);
    const l3 = clampPos(total - l1 - l2);
    const d2 = Math.max(0.5, dia * 0.85);
    const d3 = Math.max(dia, dia * 1.2);
    return {
      l1, d1: dia, d1Top: dia, d1Bottom: 0.2, g1Type: 'cone', g1Cut: true,
      l2, d2, d2Top: d2, d2Bottom: d2, g2Type: 'cylinder', g2Cut: true,
      l3, d3, d3Top: d3, d3Bottom: d3, g3Type: 'cylinder', g3Cut: false,
    };
  }
  if (shape === 'ballnose') {
    const l1 = clampPos(total * 0.22);
    const l2 = clampPos(total * 0.28);
    const l3 = clampPos(total - l1 - l2);
    const d3 = Math.max(dia, dia * 1.1);
    return {
      l1, d1: dia, d1Top: dia, d1Bottom: dia, g1Type: 'sphere', g1Cut: true,
      l2, d2: dia, d2Top: dia, d2Bottom: dia, g2Type: 'cylinder', g2Cut: true,
      l3, d3, d3Top: d3, d3Bottom: d3, g3Type: 'cylinder', g3Cut: false,
    };
  }

  if (shape === 'bullnose') {
    const l1 = clampPos(total * 0.32);
    const l2 = clampPos(total * 0.26);
    const l3 = clampPos(total - l1 - l2);
    const cornerDia = Math.max(0.5, dia * 0.7);
    const d3 = Math.max(dia, dia * 1.12);
    return {
      l1, d1: dia, d1Top: dia, d1Bottom: cornerDia, g1Type: 'cone', g1Cut: true,
      l2, d2: dia, d2Top: dia, d2Bottom: dia, g2Type: 'cylinder', g2Cut: true,
      l3, d3, d3Top: d3, d3Bottom: d3, g3Type: 'cylinder', g3Cut: false,
    };
  }

  if (shape === 'reamer') {
    const l1 = clampPos(total * 0.46);
    const l2 = clampPos(total * 0.2);
    const l3 = clampPos(total - l1 - l2);
    const d3 = Math.max(dia, dia * 1.08);
    return {
      l1, d1: dia, d1Top: dia, d1Bottom: dia, g1Type: 'cylinder', g1Cut: true,
      l2, d2: dia, d2Top: dia, d2Bottom: dia, g2Type: 'cylinder', g2Cut: true,
      l3, d3, d3Top: d3, d3Bottom: d3, g3Type: 'cylinder', g3Cut: false,
    };
  }

  if (shape === 'tap') {
    const l1 = clampPos(total * 0.3);
    const l2 = clampPos(total * 0.26);
    const l3 = clampPos(total - l1 - l2);
    const coreDia = Math.max(0.5, dia * 0.82);
    const d3 = Math.max(dia, dia * 1.15);
    return {
      l1, d1: dia, d1Top: dia, d1Bottom: dia, g1Type: 'cylinder', g1Cut: true,
      l2, d2: coreDia, d2Top: coreDia, d2Bottom: coreDia, g2Type: 'cylinder', g2Cut: true,
      l3, d3, d3Top: d3, d3Bottom: d3, g3Type: 'cylinder', g3Cut: false,
    };
  }

  if (shape === 'taper-endmill') {
    const l1 = clampPos(total * 0.42);
    const l2 = clampPos(total * 0.2);
    const l3 = clampPos(total - l1 - l2);
    const tipDia = Math.max(0.5, dia * 0.5);
    const d3 = Math.max(dia, dia * 1.2);
    return {
      l1, d1: dia, d1Top: dia, d1Bottom: tipDia, g1Type: 'cone', g1Cut: true,
      l2, d2: dia, d2Top: dia, d2Bottom: dia, g2Type: 'cylinder', g2Cut: true,
      l3, d3, d3Top: d3, d3Bottom: d3, g3Type: 'cylinder', g3Cut: false,
    };
  }

  const l1 = clampPos(total * 0.35);
  const l2 = clampPos(total * 0.25);
  const l3 = clampPos(total - l1 - l2);
  const d1 = dia;
  const d2 = Math.max(d1 + 1, d1 * 1.2);
  const d3 = Math.max(d2 + 1, d1 * 1.5);
  return {
    l1, d1, d1Top: d1, d1Bottom: d1, g1Type: 'cylinder', g1Cut: true,
    l2, d2, d2Top: d2, d2Bottom: d2, g2Type: 'cylinder', g2Cut: false,
    l3, d3, d3Top: d3, d3Bottom: d3, g3Type: 'cylinder', g3Cut: false,
  };
}

export default function ToolVisualPanel({ runtime }: SidebarModuleProps) {
  const profile = runtime.telemetry.toolVisualProfile;
  const ch0 = useMemo(() => runtime.telemetry.channels[0], [runtime.telemetry.channels]);
  const [draft, setDraft] = useState(() => ({
    shape: 'endmill' as ToolShapePreset,
    tipAngle: '118.000',
    l1: profile.l1.toFixed(3),
    lenParam1: (profile.lenParam1 ?? 'l1') as LenParamKey,
    d1Top: (profile.d1Top ?? profile.d1).toFixed(3),
    diaParam1: (profile.diaParam1 ?? 'd1') as DiaParamKey,
    d1Bottom: (profile.d1Bottom ?? profile.d1).toFixed(3),
    g1Type: profile.g1Type ?? 'cylinder',
    g1Cut: profile.g1Cut ?? true,
    g1Color: normalizeHexColor(profile.g1Color, '#ef4444'),
    l2: profile.l2.toFixed(3),
    lenParam2: (profile.lenParam2 ?? 'l2') as LenParamKey,
    d2Top: (profile.d2Top ?? profile.d2).toFixed(3),
    diaParam2: (profile.diaParam2 ?? 'd2') as DiaParamKey,
    d2Bottom: (profile.d2Bottom ?? profile.d2).toFixed(3),
    g2Type: profile.g2Type ?? 'cylinder',
    g2Cut: profile.g2Cut ?? false,
    g2Color: normalizeHexColor(profile.g2Color, '#94a3b8'),
    l3: profile.l3.toFixed(3),
    lenParam3: (profile.lenParam3 ?? 'l3') as LenParamKey,
    d3Top: (profile.d3Top ?? profile.d3).toFixed(3),
    diaParam3: (profile.diaParam3 ?? 'd3') as DiaParamKey,
    d3Bottom: (profile.d3Bottom ?? profile.d3).toFixed(3),
    g3Type: profile.g3Type ?? 'cylinder',
    g3Cut: profile.g3Cut ?? false,
    g3Color: normalizeHexColor(profile.g3Color, '#64748b'),
    useHolder: !!profile.useHolder,
    holderLength: Number(profile.holderLength ?? 45).toFixed(3),
    holderTop: Number(profile.holderDiameterTop ?? profile.holderDiameter ?? 24).toFixed(3),
    holderBottom: Number(profile.holderDiameterBottom ?? profile.holderDiameter ?? 24).toFixed(3),
  }));

  useEffect(() => {
    setDraft({
      shape: 'endmill',
      tipAngle: '118.000',
      l1: profile.l1.toFixed(3),
      lenParam1: (profile.lenParam1 ?? 'l1'),
      d1Top: (profile.d1Top ?? profile.d1).toFixed(3),
      diaParam1: (profile.diaParam1 ?? 'd1'),
      d1Bottom: (profile.d1Bottom ?? profile.d1).toFixed(3),
      g1Type: profile.g1Type ?? 'cylinder',
      g1Cut: profile.g1Cut ?? true,
      g1Color: normalizeHexColor(profile.g1Color, '#ef4444'),
      l2: profile.l2.toFixed(3),
      lenParam2: (profile.lenParam2 ?? 'l2'),
      d2Top: (profile.d2Top ?? profile.d2).toFixed(3),
      diaParam2: (profile.diaParam2 ?? 'd2'),
      d2Bottom: (profile.d2Bottom ?? profile.d2).toFixed(3),
      g2Type: profile.g2Type ?? 'cylinder',
      g2Cut: profile.g2Cut ?? false,
      g2Color: normalizeHexColor(profile.g2Color, '#94a3b8'),
      l3: profile.l3.toFixed(3),
      lenParam3: (profile.lenParam3 ?? 'l3'),
      d3Top: (profile.d3Top ?? profile.d3).toFixed(3),
      diaParam3: (profile.diaParam3 ?? 'd3'),
      d3Bottom: (profile.d3Bottom ?? profile.d3).toFixed(3),
      g3Type: profile.g3Type ?? 'cylinder',
      g3Cut: profile.g3Cut ?? false,
      g3Color: normalizeHexColor(profile.g3Color, '#64748b'),
      useHolder: !!profile.useHolder,
      holderLength: Number(profile.holderLength ?? 45).toFixed(3),
      holderTop: Number(profile.holderDiameterTop ?? profile.holderDiameter ?? 24).toFixed(3),
      holderBottom: Number(profile.holderDiameterBottom ?? profile.holderDiameter ?? 24).toFixed(3),
    });
  }, [
    profile.l1, profile.d1, profile.d1Top, profile.d1Bottom, profile.g1Type, profile.g1Cut, profile.g1Color,
    profile.l2, profile.d2, profile.d2Top, profile.d2Bottom, profile.g2Type, profile.g2Cut, profile.g2Color,
    profile.l3, profile.d3, profile.d3Top, profile.d3Bottom, profile.g3Type, profile.g3Cut, profile.g3Color,
    profile.lenParam1, profile.diaParam1, profile.lenParam2, profile.diaParam2, profile.lenParam3, profile.diaParam3,
    profile.useHolder, profile.holderLength, profile.holderDiameter, profile.holderDiameterTop, profile.holderDiameterBottom,
  ]);

  const applyDraft = () => {
    const tipAngle = toNum(draft.tipAngle);
    const l1 = toNum(draft.l1);
    const d1Top = toNum(draft.d1Top);
    const d1Bottom = toNum(draft.d1Bottom);
    const l2 = toNum(draft.l2);
    const d2Top = toNum(draft.d2Top);
    const d2Bottom = toNum(draft.d2Bottom);
    const l3 = toNum(draft.l3);
    const d3Top = toNum(draft.d3Top);
    const d3Bottom = toNum(draft.d3Bottom);
    const holderLength = toNum(draft.holderLength);
    const holderTop = toNum(draft.holderTop);
    const holderBottom = toNum(draft.holderBottom);
    if ([tipAngle, l1, d1Top, d1Bottom, l2, d2Top, d2Bottom, l3, d3Top, d3Bottom, holderLength, holderTop, holderBottom].some((v) => v === null)) return;
    const g1Type = draft.g1Type as 'cylinder' | 'cone' | 'sphere';
    const g2Type = draft.g2Type as 'cylinder' | 'cone' | 'sphere';
    const g3Type = draft.g3Type as 'cylinder' | 'cone' | 'sphere';
    const lenParamMap: Record<LenParamKey, number> = {
      l1: clampPos(l1!),
      l2: clampPos(l2!, 0, 500),
      l3: clampPos(l3!, 0, 500),
    };
    const diaParamMap: Record<DiaParamKey, number> = {
      d1: clampPos(d1Top!),
      d2: clampPos(d2Top!),
      d3: clampPos(d3Top!),
    };
    const scaleBottom = (topRaw: number, bottomRaw: number, mappedTop: number) => {
      const t = Math.max(0.0001, topRaw);
      const ratio = Math.max(0.05, bottomRaw / t);
      return clampPos(mappedTop * ratio, 0.2, 500);
    };
    const nL1 = lenParamMap[draft.lenParam1 as LenParamKey];
    const nL2 = lenParamMap[draft.lenParam2 as LenParamKey];
    const nL3 = lenParamMap[draft.lenParam3 as LenParamKey];
    const mappedD1Top = diaParamMap[draft.diaParam1 as DiaParamKey];
    const mappedD2Top = diaParamMap[draft.diaParam2 as DiaParamKey];
    const mappedD3Top = diaParamMap[draft.diaParam3 as DiaParamKey];
    const nD1Top = mappedD1Top;
    const nD1Bottom = g1Type === 'cone'
      ? scaleBottom(clampPos(d1Top!), clampPos(d1Bottom!, 0.2), mappedD1Top)
      : nD1Top;
    const nD2Top = mappedD2Top;
    const nD2Bottom = g2Type === 'cone'
      ? scaleBottom(clampPos(d2Top!), clampPos(d2Bottom!, 0.2), mappedD2Top)
      : nD2Top;
    const nD3Top = mappedD3Top;
    const nD3Bottom = g3Type === 'cone'
      ? scaleBottom(clampPos(d3Top!), clampPos(d3Bottom!, 0.2), mappedD3Top)
      : nD3Top;
    runtime.can.emit('command', {
      type: 'ui.set_tool_visual_profile',
      profile: {
        ...profile,
        l1: nL1,
        lenParam1: draft.lenParam1 as LenParamKey,
        diaParam1: draft.diaParam1 as DiaParamKey,
        d1: Math.max(nD1Top, nD1Bottom),
        d1Top: nD1Top,
        d1Bottom: nD1Bottom,
        g1Type,
        g1Cut: !!draft.g1Cut,
        g1Color: normalizeHexColor(draft.g1Color, '#ef4444'),
        l2: nL2,
        lenParam2: draft.lenParam2 as LenParamKey,
        diaParam2: draft.diaParam2 as DiaParamKey,
        d2: Math.max(nD2Top, nD2Bottom),
        d2Top: nD2Top,
        d2Bottom: nD2Bottom,
        g2Type,
        g2Cut: !!draft.g2Cut,
        g2Color: normalizeHexColor(draft.g2Color, '#94a3b8'),
        l3: nL3,
        lenParam3: draft.lenParam3 as LenParamKey,
        diaParam3: draft.diaParam3 as DiaParamKey,
        d3: Math.max(nD3Top, nD3Bottom),
        d3Top: nD3Top,
        d3Bottom: nD3Bottom,
        g3Type,
        g3Cut: !!draft.g3Cut,
        g3Color: normalizeHexColor(draft.g3Color, '#64748b'),
        useHolder: !!draft.useHolder,
        holderLength: clampPos(holderLength!, 1, 500),
        holderDiameter: Math.max(clampPos(holderTop!, 0.5, 300), clampPos(holderBottom!, 0.5, 300)),
        holderDiameterTop: clampPos(holderTop!, 0.5, 300),
        holderDiameterBottom: clampPos(holderBottom!, 0.5, 300),
      },
    });
  };

  const segLabel1 = `S1 ${String(draft.lenParam1).toUpperCase()}/${String(draft.diaParam1).toUpperCase()}`;
  const segLabel2 = `S2 ${String(draft.lenParam2).toUpperCase()}/${String(draft.diaParam2).toUpperCase()}`;
  const segLabel3 = `S3 ${String(draft.lenParam3).toUpperCase()}/${String(draft.diaParam3).toUpperCase()}`;

  return (
    <div style={s.wrap}>
      <div style={s.gridOne}>
        <span style={s.label}>Shape</span>
        <select
          style={s.select}
          value={draft.shape}
          onChange={(e) => {
            const shape = e.target.value as ToolShapePreset;
            const tip = toNum(draft.tipAngle) ?? 118;
            const p = profileFromTool(ch0?.tool_length ?? 28, ch0?.tool_radius ?? 4, shape, tip);
            setDraft((d) => ({
              ...d,
              shape,
              l1: p.l1.toFixed(3),
              d1Top: (p.d1Top ?? p.d1).toFixed(3),
              d1Bottom: (p.d1Bottom ?? p.d1).toFixed(3),
              g1Type: p.g1Type ?? d.g1Type,
              g1Cut: p.g1Cut ?? d.g1Cut,
              g1Color: normalizeHexColor(p.g1Color, d.g1Color),
              l2: p.l2.toFixed(3),
              d2Top: (p.d2Top ?? p.d2).toFixed(3),
              d2Bottom: (p.d2Bottom ?? p.d2).toFixed(3),
              g2Type: p.g2Type ?? d.g2Type,
              g2Cut: p.g2Cut ?? d.g2Cut,
              g2Color: normalizeHexColor(p.g2Color, d.g2Color),
              l3: p.l3.toFixed(3),
              d3Top: (p.d3Top ?? p.d3).toFixed(3),
              d3Bottom: (p.d3Bottom ?? p.d3).toFixed(3),
              g3Type: p.g3Type ?? d.g3Type,
              g3Cut: p.g3Cut ?? d.g3Cut,
              g3Color: normalizeHexColor(p.g3Color, d.g3Color),
              useHolder: p.useHolder ?? d.useHolder,
              holderLength: Number(p.holderLength ?? d.holderLength).toFixed(3),
              holderTop: Number(p.holderDiameterTop ?? p.holderDiameter ?? d.holderTop).toFixed(3),
              holderBottom: Number(p.holderDiameterBottom ?? p.holderDiameter ?? d.holderBottom).toFixed(3),
            }));
          }}
        >
          <option value="endmill">End mill</option>
          <option value="bullnose">Bull nose</option>
          <option value="ballnose">Ball nose</option>
          <option value="drill">Drill</option>
          <option value="center-drill">Center drill</option>
          <option value="chamfer-drill">Chamfer drill</option>
          <option value="reamer">Reamer</option>
          <option value="tap">Tap</option>
          <option value="taper-endmill">Taper endmill</option>
          <option value="holder-cylindrical">Holder - Cyl</option>
          <option value="holder-bt40">Holder - BT40</option>
          <option value="holder-hsk63">Holder - HSK63</option>
          <option value="holder-cat40">Holder - CAT40</option>
          <option value="holder-slim">Holder - Slim</option>
          <option value="extension-straight">Extension - Straight</option>
        </select>
        <span style={s.label}>Tip Angle</span>
        <input style={s.input} value={draft.tipAngle} onChange={(e) => setDraft((p) => ({ ...p, tipAngle: e.target.value }))} />
      </div>
      <div style={s.btnRow}>
        <button
          style={s.btn}
          onClick={() => {
            const l3 = toNum(draft.l3) ?? 0;
            const l2 = toNum(draft.l2) ?? 0;
            if (l3 > 0.001) setDraft((p) => ({ ...p, l3: '0.000' }));
            else if (l2 > 0.001) setDraft((p) => ({ ...p, l2: '0.000' }));
          }}
        >
          - SEG
        </button>
        <button
          style={s.btn}
          onClick={() => {
            const l2 = toNum(draft.l2) ?? 0;
            const l3 = toNum(draft.l3) ?? 0;
            if (l2 <= 0.001) setDraft((p) => ({ ...p, l2: '8.000' }));
            else if (l3 <= 0.001) setDraft((p) => ({ ...p, l3: '8.000' }));
          }}
        >
          + SEG
        </button>
      </div>

      <div style={s.geomHead}>
        <span style={s.label}>SEG</span>
        <span style={s.label}>TYPE</span>
        <span style={s.label}>LEN SRC</span>
        <span style={s.label}>DIA SRC</span>
        <span style={s.label}>CUT</span>
        <span style={s.label}>COLOR</span>
      </div>
      <div style={s.geomRow}>
        <span style={s.label}>{segLabel1}</span>
        <select
          style={s.select}
          value={draft.g1Type}
          onChange={(e) => setDraft((p) => ({ ...p, g1Type: e.target.value as 'cylinder' | 'cone' | 'sphere' }))}
        >
          <option value="cylinder">Cylinder</option>
          <option value="cone">Cone</option>
          <option value="sphere">Sphere</option>
        </select>
        <select
          style={s.select}
          value={draft.lenParam1}
          onChange={(e) => setDraft((p) => ({ ...p, lenParam1: e.target.value as LenParamKey }))}
        >
          <option value="l1">L1</option>
          <option value="l2">L2</option>
          <option value="l3">L3</option>
        </select>
        <select
          style={s.select}
          value={draft.diaParam1}
          onChange={(e) => setDraft((p) => ({ ...p, diaParam1: e.target.value as DiaParamKey }))}
        >
          <option value="d1">D1</option>
          <option value="d2">D2</option>
          <option value="d3">D3</option>
        </select>
        <button
          style={{ ...s.smallBtn, ...(draft.g1Cut ? s.btnOn : {}) }}
          onClick={() => setDraft((p) => ({ ...p, g1Cut: !p.g1Cut }))}
        >
          {draft.g1Cut ? 'YES' : 'NO'}
        </button>
        <input
          type="color"
          style={s.colorInput}
          value={normalizeHexColor(draft.g1Color, '#ef4444')}
          onChange={(e) => setDraft((p) => ({ ...p, g1Color: e.target.value }))}
        />
      </div>
      <div style={s.geomRow}>
        <span style={s.label}>{segLabel2}</span>
        <select
          style={s.select}
          value={draft.g2Type}
          onChange={(e) => setDraft((p) => ({ ...p, g2Type: e.target.value as 'cylinder' | 'cone' | 'sphere' }))}
        >
          <option value="cylinder">Cylinder</option>
          <option value="cone">Cone</option>
          <option value="sphere">Sphere</option>
        </select>
        <select
          style={s.select}
          value={draft.lenParam2}
          onChange={(e) => setDraft((p) => ({ ...p, lenParam2: e.target.value as LenParamKey }))}
        >
          <option value="l1">L1</option>
          <option value="l2">L2</option>
          <option value="l3">L3</option>
        </select>
        <select
          style={s.select}
          value={draft.diaParam2}
          onChange={(e) => setDraft((p) => ({ ...p, diaParam2: e.target.value as DiaParamKey }))}
        >
          <option value="d1">D1</option>
          <option value="d2">D2</option>
          <option value="d3">D3</option>
        </select>
        <button
          style={{ ...s.smallBtn, ...(draft.g2Cut ? s.btnOn : {}) }}
          onClick={() => setDraft((p) => ({ ...p, g2Cut: !p.g2Cut }))}
        >
          {draft.g2Cut ? 'YES' : 'NO'}
        </button>
        <input
          type="color"
          style={s.colorInput}
          value={normalizeHexColor(draft.g2Color, '#94a3b8')}
          onChange={(e) => setDraft((p) => ({ ...p, g2Color: e.target.value }))}
        />
      </div>
      <div style={s.geomRow}>
        <span style={s.label}>{segLabel3}</span>
        <select
          style={s.select}
          value={draft.g3Type}
          onChange={(e) => setDraft((p) => ({ ...p, g3Type: e.target.value as 'cylinder' | 'cone' | 'sphere' }))}
        >
          <option value="cylinder">Cylinder</option>
          <option value="cone">Cone</option>
          <option value="sphere">Sphere</option>
        </select>
        <select
          style={s.select}
          value={draft.lenParam3}
          onChange={(e) => setDraft((p) => ({ ...p, lenParam3: e.target.value as LenParamKey }))}
        >
          <option value="l1">L1</option>
          <option value="l2">L2</option>
          <option value="l3">L3</option>
        </select>
        <select
          style={s.select}
          value={draft.diaParam3}
          onChange={(e) => setDraft((p) => ({ ...p, diaParam3: e.target.value as DiaParamKey }))}
        >
          <option value="d1">D1</option>
          <option value="d2">D2</option>
          <option value="d3">D3</option>
        </select>
        <button
          style={{ ...s.smallBtn, ...(draft.g3Cut ? s.btnOn : {}) }}
          onClick={() => setDraft((p) => ({ ...p, g3Cut: !p.g3Cut }))}
        >
          {draft.g3Cut ? 'YES' : 'NO'}
        </button>
        <input
          type="color"
          style={s.colorInput}
          value={normalizeHexColor(draft.g3Color, '#64748b')}
          onChange={(e) => setDraft((p) => ({ ...p, g3Color: e.target.value }))}
        />
      </div>
      <div style={s.legendRow}>
        <span style={s.legendItem}>
          <span style={{ ...s.swatch, background: '#ef4444' }} /> Cut part
        </span>
        <span style={s.legendItem}>
          <span style={{ ...s.swatch, background: '#94a3b8' }} /> Non-cut part
        </span>
      </div>

      <div style={s.btnRow}>
        <button style={{ ...s.btn, ...s.btnOn }} onClick={applyDraft}>
          APPLY
        </button>
        <button
          style={s.btn}
          onClick={() => {
            const tip = toNum(draft.tipAngle) ?? 118;
            const p = profileFromTool(ch0?.tool_length ?? 28, ch0?.tool_radius ?? 4, draft.shape, tip);
            setDraft((d) => ({
              ...d,
              l1: p.l1.toFixed(3),
              d1Top: (p.d1Top ?? p.d1).toFixed(3),
              d1Bottom: (p.d1Bottom ?? p.d1).toFixed(3),
              g1Type: p.g1Type ?? 'cylinder',
              g1Cut: p.g1Cut ?? true,
              g1Color: normalizeHexColor(p.g1Color, d.g1Color),
              l2: p.l2.toFixed(3),
              d2Top: (p.d2Top ?? p.d2).toFixed(3),
              d2Bottom: (p.d2Bottom ?? p.d2).toFixed(3),
              g2Type: p.g2Type ?? 'cylinder',
              g2Cut: p.g2Cut ?? false,
              g2Color: normalizeHexColor(p.g2Color, d.g2Color),
              l3: p.l3.toFixed(3),
              d3Top: (p.d3Top ?? p.d3).toFixed(3),
              d3Bottom: (p.d3Bottom ?? p.d3).toFixed(3),
              g3Type: p.g3Type ?? 'cylinder',
              g3Cut: p.g3Cut ?? false,
              g3Color: normalizeHexColor(p.g3Color, d.g3Color),
              useHolder: p.useHolder ?? d.useHolder,
              holderLength: Number(p.holderLength ?? d.holderLength).toFixed(3),
              holderTop: Number(p.holderDiameterTop ?? p.holderDiameter ?? d.holderTop).toFixed(3),
              holderBottom: Number(p.holderDiameterBottom ?? p.holderDiameter ?? d.holderBottom).toFixed(3),
            }));
          }}
        >
          SHAPE PRESET
        </button>
        <button
          style={s.btn}
          onClick={() => {
            const tip = toNum(draft.tipAngle) ?? 118;
            const p = profileFromTool(ch0?.tool_length ?? 28, ch0?.tool_radius ?? 4, draft.shape, tip);
            setDraft({
              shape: draft.shape,
              tipAngle: tip.toFixed(3),
              l1: p.l1.toFixed(3),
              lenParam1: draft.lenParam1,
              d1Top: (p.d1Top ?? p.d1).toFixed(3),
              diaParam1: draft.diaParam1,
              d1Bottom: (p.d1Bottom ?? p.d1).toFixed(3),
              g1Type: p.g1Type ?? 'cylinder',
              g1Cut: p.g1Cut ?? true,
              g1Color: normalizeHexColor(p.g1Color, draft.g1Color),
              l2: p.l2.toFixed(3),
              lenParam2: draft.lenParam2,
              d2Top: (p.d2Top ?? p.d2).toFixed(3),
              diaParam2: draft.diaParam2,
              d2Bottom: (p.d2Bottom ?? p.d2).toFixed(3),
              g2Type: p.g2Type ?? 'cylinder',
              g2Cut: p.g2Cut ?? false,
              g2Color: normalizeHexColor(p.g2Color, draft.g2Color),
              l3: p.l3.toFixed(3),
              lenParam3: draft.lenParam3,
              d3Top: (p.d3Top ?? p.d3).toFixed(3),
              diaParam3: draft.diaParam3,
              d3Bottom: (p.d3Bottom ?? p.d3).toFixed(3),
              g3Type: p.g3Type ?? 'cylinder',
              g3Cut: p.g3Cut ?? false,
              g3Color: normalizeHexColor(p.g3Color, draft.g3Color),
              useHolder: p.useHolder ?? draft.useHolder,
              holderLength: Number(p.holderLength ?? draft.holderLength).toFixed(3),
              holderTop: Number(p.holderDiameterTop ?? p.holderDiameter ?? draft.holderTop).toFixed(3),
              holderBottom: Number(p.holderDiameterBottom ?? p.holderDiameter ?? draft.holderBottom).toFixed(3),
            });
          }}
        >
          FROM H/R
        </button>
        <button
          style={s.btn}
          onClick={() =>
            setDraft({
              shape: draft.shape,
              tipAngle: draft.tipAngle,
              l1: profile.l1.toFixed(3),
              lenParam1: draft.lenParam1,
              d1Top: (profile.d1Top ?? profile.d1).toFixed(3),
              diaParam1: draft.diaParam1,
              d1Bottom: (profile.d1Bottom ?? profile.d1).toFixed(3),
              g1Type: profile.g1Type ?? 'cylinder',
              g1Cut: profile.g1Cut ?? true,
              g1Color: normalizeHexColor(profile.g1Color, '#ef4444'),
              l2: profile.l2.toFixed(3),
              lenParam2: draft.lenParam2,
              d2Top: (profile.d2Top ?? profile.d2).toFixed(3),
              diaParam2: draft.diaParam2,
              d2Bottom: (profile.d2Bottom ?? profile.d2).toFixed(3),
              g2Type: profile.g2Type ?? 'cylinder',
              g2Cut: profile.g2Cut ?? false,
              g2Color: normalizeHexColor(profile.g2Color, '#94a3b8'),
              l3: profile.l3.toFixed(3),
              lenParam3: draft.lenParam3,
              d3Top: (profile.d3Top ?? profile.d3).toFixed(3),
              diaParam3: draft.diaParam3,
              d3Bottom: (profile.d3Bottom ?? profile.d3).toFixed(3),
              g3Type: profile.g3Type ?? 'cylinder',
              g3Cut: profile.g3Cut ?? false,
              g3Color: normalizeHexColor(profile.g3Color, '#64748b'),
              useHolder: !!profile.useHolder,
              holderLength: Number(profile.holderLength ?? 45).toFixed(3),
              holderTop: Number(profile.holderDiameterTop ?? profile.holderDiameter ?? 24).toFixed(3),
              holderBottom: Number(profile.holderDiameterBottom ?? profile.holderDiameter ?? 24).toFixed(3),
            })
          }
        >
          RESET
        </button>
      </div>
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 6 },
  gridOne: {
    display: 'grid',
    gridTemplateColumns: '74px 1fr',
    gap: 4,
    alignItems: 'center',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '74px 1fr 1fr',
    gap: 4,
    alignItems: 'center',
  },
  geomHead: {
    display: 'grid',
    gridTemplateColumns: '0.95fr 1.2fr 0.9fr 0.9fr 0.7fr 0.7fr',
    gap: 4,
    alignItems: 'center',
  },
  geomRow: {
    display: 'grid',
    gridTemplateColumns: '0.95fr 1.2fr 0.9fr 0.9fr 0.7fr 0.7fr',
    gap: 4,
    alignItems: 'center',
  },
  typeCell: {
    width: '100%',
    boxSizing: 'border-box',
    background: '#0f1726',
    border: '1px solid #2f3b52',
    borderRadius: 3,
    color: '#9fb4da',
    padding: '4px 6px',
    fontSize: 10,
    fontFamily: 'monospace',
    textAlign: 'center',
  },
  label: { color: '#8ca0c5', fontSize: 10 },
  holderTitle: {
    color: '#93c5fd',
    fontSize: 10,
    letterSpacing: '0.08em',
    fontWeight: 700,
    marginTop: 2,
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    background: '#1a2332',
    border: '1px solid #334155',
    borderRadius: 3,
    color: '#e2e8f0',
    padding: '4px 6px',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  select: {
    width: '100%',
    boxSizing: 'border-box',
    background: '#1a2332',
    border: '1px solid #334155',
    borderRadius: 3,
    color: '#e2e8f0',
    padding: '4px 6px',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  colorInput: {
    width: '100%',
    height: 24,
    boxSizing: 'border-box',
    background: '#1a2332',
    border: '1px solid #334155',
    borderRadius: 3,
    padding: 1,
    cursor: 'pointer',
  },
  legendRow: { display: 'flex', gap: 10, alignItems: 'center' },
  legendItem: { color: '#8ca0c5', fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 5 },
  swatch: { width: 10, height: 10, borderRadius: 2, border: '1px solid #334155', display: 'inline-block' },
  btnRow: { display: 'flex', gap: 4 },
  btn: {
    flex: 1,
    background: '#142238',
    border: '1px solid #2f4a73',
    borderRadius: 3,
    color: '#94a3b8',
    cursor: 'pointer',
    fontSize: 10,
    padding: '4px 0',
    fontFamily: 'monospace',
    fontWeight: 700,
  },
  btnOn: {
    background: '#14532d',
    border: '1px solid #166534',
    color: '#86efac',
  },
  smallBtn: {
    background: '#142238',
    border: '1px solid #2f4a73',
    borderRadius: 3,
    color: '#94a3b8',
    cursor: 'pointer',
    fontSize: 10,
    padding: '4px 0',
    fontFamily: 'monospace',
    fontWeight: 700,
  },
};
