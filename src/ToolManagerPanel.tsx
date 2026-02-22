import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { SidebarModuleProps, ToolVisualProfile } from './modules/moduleTypes';
import ToolAssemblyManagerModal from './ToolAssemblyManagerModal';
import { STARTER_ASSEMBLIES, STARTER_TOOL_ITEMS } from './tooling/starterExamples';

type ToolItemKind = 'tool' | 'holder' | 'extension';
type StepFace = '+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z';
type StepViewMode = 'step' | 'param' | 'both';
type MachineAxisLabel = 'X' | 'Y' | 'Z';
type ToolShapeType =
  | 'endmill'
  | 'bullnose'
  | 'ballnose'
  | 'drill'
  | 'center-drill'
  | 'chamfer-drill'
  | 'reamer'
  | 'tap'
  | 'taper-endmill'
  | 'custom';

interface ToolItem {
  id: string;
  kind: ToolItemKind;
  toolType: ToolShapeType;
  tipAngleDeg: number;
  name: string;
  note: string;
  length: number; // H
  radius: number; // R
  stickout: number; // Tool protrusion from holder nose
  toolStickInMax: number; // Max insertion depth accepted by holder/extension
  mountFace?: StepFace; // face used to connect this item to parent side
  outputFace?: StepFace; // face used to connect child side / tool tip side
  mountOffset?: number; // offset from mount face to parent gauge/seat
  stepMeshId?: string; // IndexedDB key when STEP mesh is persisted
  stepRotX?: number;
  stepRotY?: number;
  stepRotZ?: number;
  stepPosX?: number;
  stepPosY?: number;
  stepPosZ?: number;
  stepAnchorToGauge?: boolean;
  stepViewMode?: StepViewMode;
  visual: ToolVisualProfile;
}

const STORAGE_KEY = 'vmill_tool_library_v1';
const ASSEMBLY_KEY = 'vmill_tool_assemblies_v1';
const STEP_MESH_DB = 'vmill_step_mesh_v1';
const STEP_MESH_STORE = 'meshes';

interface ToolAssembly {
  id: string;
  name: string;
  note: string;
  toolId: string;
  holderId: string | null;
  extensionId: string | null;
  toolOut?: number;
  toolColor?: string;
  holderColor?: string;
  extensionColor?: string;
  length: number;
  radius: number;
  visual: ToolVisualProfile;
}

type OcctFactory = (args?: { locateFile?: (path: string, scriptDir: string) => string }) => Promise<any>;
let occtRuntimePromise: Promise<any> | null = null;

async function getOcctRuntime() {
  if (!occtRuntimePromise) {
    occtRuntimePromise = (async () => {
      const [factoryMod, wasmUrlMod] = await Promise.all([
        import('occt-import-js/dist/occt-import-js.js'),
        import('occt-import-js/dist/occt-import-js.wasm?url'),
      ]);
      const factory = ((factoryMod as any).default ?? factoryMod) as OcctFactory;
      const wasmUrl = String((wasmUrlMod as any).default ?? wasmUrlMod);
      return factory({
        locateFile: (path: string) => (path.endsWith('.wasm') ? wasmUrl : path),
      });
    })();
  }
  return occtRuntimePromise;
}

function uid() {
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  const uuid = g.crypto?.randomUUID?.();
  if (uuid) return `tool_${uuid}`;
  return `tool_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
}

function parseNum(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const v = Number.parseFloat(raw.trim().replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function clampPos(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function normalizeColorHex(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  return /^#[0-9a-fA-F]{6}$/.test(raw.trim()) ? raw.trim() : fallback;
}

const ALL_STEP_FACES: StepFace[] = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];

function stepFacesForPreferredAxis(axis: MachineAxisLabel): StepFace[] {
  if (axis === 'X') return ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];
  if (axis === 'Y') return ['+Y', '-Y', '+X', '-X', '+Z', '-Z'];
  return ['+Z', '-Z', '+X', '-X', '+Y', '-Y'];
}

function isStepFace(raw: unknown): raw is StepFace {
  return typeof raw === 'string' && ALL_STEP_FACES.includes(raw as StepFace);
}

function signFromFace(face: StepFace): 1 | -1 {
  return face.startsWith('+') ? 1 : -1;
}

// Machine -> STEP raw mesh axis mapping (scene convention):
// machine X -> scene X, machine Y -> scene -Z, machine Z -> scene Y.
function axisFromFace(face: StepFace): 'x' | 'y' | 'z' {
  if (face.endsWith('X')) return 'x';
  if (face.endsWith('Y')) return 'z';
  return 'y';
}

// Sign in STEP raw axis coordinates for a MACHINE face.
function stepSignFromMachineFace(face: StepFace): 1 | -1 {
  const s = signFromFace(face);
  if (face.endsWith('Y')) return s === 1 ? -1 : 1;
  return s;
}

// STEP raw axis/sign -> MACHINE face label.
function faceFromAxisSign(axis: 'x' | 'y' | 'z', sign: 1 | -1): StepFace {
  if (axis === 'x') return sign > 0 ? '+X' : '-X';
  if (axis === 'z') return sign > 0 ? '-Y' : '+Y';
  return sign > 0 ? '+Z' : '-Z';
}

function stepAxisFromMachineAxis(axis: MachineAxisLabel): 'x' | 'y' | 'z' {
  if (axis === 'X') return 'x';
  if (axis === 'Y') return 'z';
  return 'y';
}

function defaultFacesForMachineAxis(axis: MachineAxisLabel): { mountFace: StepFace; outputFace: StepFace } {
  if (axis === 'X') return { mountFace: '+X', outputFace: '-X' };
  if (axis === 'Y') return { mountFace: '+Y', outputFace: '-Y' };
  return { mountFace: '+Z', outputFace: '-Z' };
}

function pickMachineAxisFromNames(names: string[]): MachineAxisLabel | null {
  const up = names.map((n) => String(n || '').trim().toUpperCase());
  if (up.includes('Z')) return 'Z';
  if (up.includes('Y')) return 'Y';
  if (up.includes('X')) return 'X';
  return null;
}

function inferPreferredSpindleMachineAxis(
  telemetryAxes: Array<{ physical_name: string }>
): MachineAxisLabel {
  try {
    const rawMachines = localStorage.getItem('vmill_machines');
    const activeMachineId = localStorage.getItem('vmill_active_machine');
    if (rawMachines) {
      const machines = JSON.parse(rawMachines) as Array<any>;
      if (Array.isArray(machines) && machines.length > 0) {
        const active = machines.find((m) => String(m?.id ?? '') === String(activeMachineId ?? '')) ?? machines[0];
        const axes = Array.isArray(active?.axes) ? active.axes : [];
        const toolLinearNames = axes
          .filter((ax: any) =>
            String(ax?.side ?? '').toLowerCase() === 'tool'
            && String(ax?.kind ?? 'linear').toLowerCase() === 'linear'
          )
          .map((ax: any) => String(ax?.name ?? ax?.physical_name ?? '').trim().toUpperCase());
        const pickedTool = pickMachineAxisFromNames(toolLinearNames);
        if (pickedTool) return pickedTool;
        const linearNames = axes
          .filter((ax: any) => String(ax?.kind ?? 'linear').toLowerCase() === 'linear')
          .map((ax: any) => String(ax?.name ?? ax?.physical_name ?? '').trim().toUpperCase());
        const pickedLinear = pickMachineAxisFromNames(linearNames);
        if (pickedLinear) return pickedLinear;
      }
    }
  } catch {
    // Ignore malformed localStorage and fall back to runtime telemetry.
  }
  const telemetryNames = telemetryAxes.map((ax) => String(ax?.physical_name ?? '').trim().toUpperCase());
  return pickMachineAxisFromNames(telemetryNames) ?? 'Z';
}

function defaultMountFace(_kind: ToolItemKind): StepFace {
  return '+Z';
}

function defaultOutputFace(_kind: ToolItemKind): StepFace {
  return '-Z';
}

function holderAngleFromDiametersDeg(dStart: number, dEnd: number, length: number): number {
  const l = Math.max(0.001, length);
  return round3((Math.atan((dStart - dEnd) / (2 * l)) * 180) / Math.PI);
}

function defaultToolType(kind: ToolItemKind): ToolShapeType {
  return kind === 'tool' ? 'endmill' : 'custom';
}

function tipLengthFromDiameterAngle(diameter: number, angleDeg: number): number {
  const d = Math.max(0.1, diameter);
  const a = clampPos(angleDeg, 20, 170);
  const half = (a * Math.PI) / 360;
  return round3(Math.max(0.5, (d * 0.5) / Math.tan(half)));
}

function ensureSegmentDiameters(base: ToolVisualProfile): ToolVisualProfile {
  const d1 = Math.max(0.2, Number(base.d1 || 1));
  const d2 = Math.max(0.2, Number(base.d2 || 1));
  const d3 = Math.max(0.2, Number(base.d3 || 1));
  const d1Top = round3(Math.max(0.2, Number(base.d1Top ?? d1)));
  const d1Bottom = round3(Math.max(0.2, Number(base.d1Bottom ?? d1)));
  const d2Top = round3(Math.max(0.2, Number(base.d2Top ?? d2)));
  const d2Bottom = round3(Math.max(0.2, Number(base.d2Bottom ?? d2)));
  const d3Top = round3(Math.max(0.2, Number(base.d3Top ?? d3)));
  const d3Bottom = round3(Math.max(0.2, Number(base.d3Bottom ?? d3)));
  const g1Type = base.g1Type ?? (Math.abs(d1Top - d1Bottom) > 1e-6 ? 'cone' : 'cylinder');
  const g2Type = base.g2Type ?? (Math.abs(d2Top - d2Bottom) > 1e-6 ? 'cone' : 'cylinder');
  const g3Type = base.g3Type ?? (Math.abs(d3Top - d3Bottom) > 1e-6 ? 'cone' : 'cylinder');
  return {
    ...base,
    d1Top,
    d1Bottom,
    g1Type,
    g1Cut: base.g1Cut ?? true,
    g1Color: normalizeColorHex((base as any).g1Color, '#ef4444'),
    d2Top,
    d2Bottom,
    g2Type,
    g2Cut: base.g2Cut ?? false,
    g2Color: normalizeColorHex((base as any).g2Color, '#94a3b8'),
    d3Top,
    d3Bottom,
    g3Type,
    g3Cut: base.g3Cut ?? false,
    g3Color: normalizeColorHex((base as any).g3Color, '#64748b'),
  };
}

function buildVisualFromShapeType(
  shape: ToolShapeType,
  length: number,
  radius: number,
  tipAngleDeg: number,
  current?: ToolVisualProfile
): ToolVisualProfile {
  const total = Math.max(6, Number.isFinite(length) ? length : 50);
  const dia = Math.max(0.5, radius > 0 ? radius * 2 : Number(current?.d1 ?? 8));
  const holderDia = round3(Math.max(12, dia * 1.2));

  const baseVisual: ToolVisualProfile = {
    l1: round3(Math.max(1, total * 0.35)),
    d1: round3(dia),
    l2: round3(Math.max(1, total * 0.25)),
    d2: round3(dia),
    l3: round3(Math.max(1, total * 0.4)),
    d3: round3(Math.max(dia, dia * 1.1)),
    g1Type: 'cylinder',
    g1Cut: true,
    g2Type: 'cylinder',
    g2Cut: false,
    g3Type: 'cylinder',
    g3Cut: false,
    useHolder: false,
    holderLength: 18,
    holderDiameter: holderDia,
    holderDiameterTop: holderDia,
    holderDiameterBottom: holderDia,
    holderTaperAngleDeg: 0,
    stickout: round3(total),
  };

  if (shape === 'custom') {
    return ensureSegmentDiameters(current ? { ...current } : baseVisual);
  }

  if (shape === 'endmill') {
    const l1 = round3(Math.max(2, total * 0.4));
    const l2 = round3(Math.max(2, total * 0.2));
    const l3 = round3(Math.max(2, total - l1 - l2));
    return ensureSegmentDiameters({
      ...baseVisual,
      l1,
      d1: round3(dia),
      l2,
      d2: round3(dia),
      l3,
      d3: round3(Math.max(dia, dia * 1.1)),
      d1Top: round3(dia),
      d1Bottom: round3(dia),
      g1Type: 'cylinder',
      g1Cut: true,
      d2Top: round3(dia),
      d2Bottom: round3(dia),
      g2Type: 'cylinder',
      g2Cut: false,
      d3Top: round3(Math.max(dia, dia * 1.1)),
      d3Bottom: round3(Math.max(dia, dia * 1.1)),
      g3Type: 'cylinder',
      g3Cut: false,
    });
  }

  if (shape === 'bullnose') {
    const l1 = round3(Math.max(2, total * 0.32));
    const l2 = round3(Math.max(2, total * 0.26));
    const l3 = round3(Math.max(2, total - l1 - l2));
    const cornerDia = round3(Math.max(0.5, dia * 0.7));
    return ensureSegmentDiameters({
      ...baseVisual,
      l1,
      d1: round3(dia),
      l2,
      d2: round3(dia),
      l3,
      d3: round3(Math.max(dia, dia * 1.12)),
      d1Top: round3(dia),
      d1Bottom: cornerDia,
      g1Type: 'cone',
      g1Cut: true,
      d2Top: round3(dia),
      d2Bottom: round3(dia),
      g2Type: 'cylinder',
      g2Cut: true,
      d3Top: round3(Math.max(dia, dia * 1.12)),
      d3Bottom: round3(Math.max(dia, dia * 1.12)),
      g3Type: 'cylinder',
      g3Cut: false,
    });
  }

  if (shape === 'ballnose') {
    const l1 = round3(Math.max(2, total * 0.22));
    const l2 = round3(Math.max(2, total * 0.28));
    const l3 = round3(Math.max(2, total - l1 - l2));
    return ensureSegmentDiameters({
      ...baseVisual,
      l1,
      d1: round3(dia),
      l2,
      d2: round3(dia),
      l3,
      d3: round3(Math.max(dia, dia * 1.1)),
      d1Top: round3(dia),
      d1Bottom: round3(dia),
      g1Type: 'sphere',
      g1Cut: true,
      d2Top: round3(dia),
      d2Bottom: round3(dia),
      g2Type: 'cylinder',
      g2Cut: true,
      d3Top: round3(Math.max(dia, dia * 1.1)),
      d3Bottom: round3(Math.max(dia, dia * 1.1)),
      g3Type: 'cylinder',
      g3Cut: false,
    });
  }

  if (shape === 'reamer') {
    const l1 = round3(Math.max(2, total * 0.46));
    const l2 = round3(Math.max(2, total * 0.2));
    const l3 = round3(Math.max(2, total - l1 - l2));
    const shankDia = round3(Math.max(dia, dia * 1.08));
    return ensureSegmentDiameters({
      ...baseVisual,
      l1,
      d1: round3(dia),
      l2,
      d2: round3(dia),
      l3,
      d3: shankDia,
      d1Top: round3(dia),
      d1Bottom: round3(dia),
      g1Type: 'cylinder',
      g1Cut: true,
      d2Top: round3(dia),
      d2Bottom: round3(dia),
      g2Type: 'cylinder',
      g2Cut: true,
      d3Top: shankDia,
      d3Bottom: shankDia,
      g3Type: 'cylinder',
      g3Cut: false,
    });
  }

  if (shape === 'tap') {
    const l1 = round3(Math.max(2, total * 0.3));
    const l2 = round3(Math.max(2, total * 0.26));
    const l3 = round3(Math.max(2, total - l1 - l2));
    const coreDia = round3(Math.max(0.5, dia * 0.82));
    const shankDia = round3(Math.max(dia, dia * 1.15));
    return ensureSegmentDiameters({
      ...baseVisual,
      l1,
      d1: round3(dia),
      l2,
      d2: coreDia,
      l3,
      d3: shankDia,
      d1Top: round3(dia),
      d1Bottom: round3(dia),
      g1Type: 'cylinder',
      g1Cut: true,
      d2Top: coreDia,
      d2Bottom: coreDia,
      g2Type: 'cylinder',
      g2Cut: true,
      d3Top: shankDia,
      d3Bottom: shankDia,
      g3Type: 'cylinder',
      g3Cut: false,
    });
  }

  if (shape === 'taper-endmill') {
    const l1 = round3(Math.max(2, total * 0.42));
    const l2 = round3(Math.max(2, total * 0.2));
    const l3 = round3(Math.max(2, total - l1 - l2));
    const tipDia = round3(Math.max(0.5, dia * 0.5));
    const shankDia = round3(Math.max(dia, dia * 1.2));
    return ensureSegmentDiameters({
      ...baseVisual,
      l1,
      d1: round3(dia),
      l2,
      d2: round3(dia),
      l3,
      d3: shankDia,
      d1Top: round3(dia),
      d1Bottom: tipDia,
      g1Type: 'cone',
      g1Cut: true,
      d2Top: round3(dia),
      d2Bottom: round3(dia),
      g2Type: 'cylinder',
      g2Cut: true,
      d3Top: shankDia,
      d3Bottom: shankDia,
      g3Type: 'cylinder',
      g3Cut: false,
    });
  }

  if (shape === 'drill') {
    const tip = Math.min(total * 0.36, tipLengthFromDiameterAngle(dia, tipAngleDeg));
    const l1 = round3(Math.max(1, tip));
    const l2 = round3(Math.max(2, total * 0.42));
    const l3 = round3(Math.max(2, total - l1 - l2));
    return ensureSegmentDiameters({
      ...baseVisual,
      l1,
      d1: round3(dia),
      l2,
      d2: round3(dia),
      l3,
      d3: round3(Math.max(dia, dia * 1.15)),
      d1Top: round3(dia),
      d1Bottom: 0.2,
      g1Type: 'cone',
      g1Cut: true,
      d2Top: round3(dia),
      d2Bottom: round3(dia),
      g2Type: 'cylinder',
      g2Cut: true,
      d3Top: round3(Math.max(dia, dia * 1.15)),
      d3Bottom: round3(Math.max(dia, dia * 1.15)),
      g3Type: 'cylinder',
      g3Cut: false,
    });
  }

  if (shape === 'center-drill') {
    const pilotDia = Math.max(0.5, dia * 0.5);
    const tip = Math.min(total * 0.25, tipLengthFromDiameterAngle(pilotDia, tipAngleDeg));
    const l1 = round3(Math.max(1, tip));
    const l2 = round3(Math.max(1.5, total * 0.25));
    const l3 = round3(Math.max(1.5, total - l1 - l2));
    return ensureSegmentDiameters({
      ...baseVisual,
      l1,
      d1: round3(pilotDia),
      l2,
      d2: round3(dia),
      l3,
      d3: round3(Math.max(dia, dia * 1.3)),
      d1Top: round3(pilotDia),
      d1Bottom: 0.2,
      g1Type: 'cone',
      g1Cut: true,
      d2Top: round3(dia),
      d2Bottom: round3(dia),
      g2Type: 'cylinder',
      g2Cut: true,
      d3Top: round3(Math.max(dia, dia * 1.3)),
      d3Bottom: round3(Math.max(dia, dia * 1.3)),
      g3Type: 'cylinder',
      g3Cut: false,
    });
  }

  const tip = Math.min(total * 0.5, tipLengthFromDiameterAngle(dia, tipAngleDeg));
  const l1 = round3(Math.max(1, tip));
  const l2 = round3(Math.max(1.5, total * 0.2));
  const l3 = round3(Math.max(1.5, total - l1 - l2));
  return ensureSegmentDiameters({
    ...baseVisual,
    l1,
    d1: round3(dia),
    l2,
    d2: round3(Math.max(0.5, dia * 0.85)),
    l3,
    d3: round3(Math.max(dia, dia * 1.2)),
    d1Top: round3(dia),
    d1Bottom: 0.2,
    g1Type: 'cone',
    g1Cut: true,
    d2Top: round3(Math.max(0.5, dia * 0.85)),
    d2Bottom: round3(Math.max(0.5, dia * 0.85)),
    g2Type: 'cylinder',
    g2Cut: true,
    d3Top: round3(Math.max(dia, dia * 1.2)),
    d3Bottom: round3(Math.max(dia, dia * 1.2)),
    g3Type: 'cylinder',
    g3Cut: false,
  });
}

interface ParsedToolImport {
  name: string;
  manufacturer?: string;
  diameter: number | null;
  length: number | null;
  cuttingLength: number | null;
  shoulderLength: number | null;
  shaftDiameter: number | null;
  neckDiameter: number | null;
  stickout: number | null;
  edgeCount: number | null;
  sourceStandard: 'DIN4000' | 'OMTDX' | 'ISO13399' | 'STEP-OCC';
}

interface StepPreviewMeshPayload {
  positions: Float32Array;
  indices: Uint32Array | null;
}

interface StepPreviewEventDetail {
  enabled: boolean;
  showStep?: boolean;
  showParametric?: boolean;
  parametricMask?: 'all' | 'tool-only' | 'holder-only' | 'none';
  parametricOpacity?: number;
  meshes?: StepPreviewMeshPayload[];
  rotationDeg?: { x: number; y: number; z: number };
  offset?: { x: number; y: number; z: number };
  anchorToGauge?: boolean;
  mountFace?: StepFace;
  mountOffset?: number;
}

interface PendingImport {
  fileName: string;
  parsed: ParsedToolImport;
  importKind: ToolItemKind;
  name: string;
  length: number;
  radius: number;
  stickout: number;
  toolStickInMax: number;
  mountFace: StepFace;
  outputFace: StepFace;
  mountOffset: number;
  toolType: ToolShapeType;
  tipAngleDeg: number;
  visual: ToolVisualProfile;
  note: string;
  stepPreview: { meshes: StepPreviewMeshPayload[] } | null;
  stepBounds: {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
  } | null;
  stepRotX: number;
  stepRotY: number;
  stepRotZ: number;
  stepPosX: number;
  stepPosY: number;
  stepPosZ: number;
  stepAnchorToGauge: boolean;
  stepViewMode: StepViewMode;
}

type StepFacePickMode = 'off' | 'mount' | 'output';

function stepViewFlags(
  mode: StepViewMode,
  showStepToggle = true,
  showParamToggle = true
): { showStep: boolean; showParametric: boolean } {
  if (mode === 'step') return { showStep: true, showParametric: false };
  if (mode === 'param') return { showStep: false, showParametric: true };
  return { showStep: showStepToggle, showParametric: showParamToggle };
}

function openStepMeshDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(STEP_MESH_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STEP_MESH_STORE)) {
        db.createObjectStore(STEP_MESH_STORE, { keyPath: 'itemId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open STEP mesh database'));
  });
}

async function saveStepMeshesForItem(itemId: string, meshes: StepPreviewMeshPayload[]): Promise<void> {
  const db = await openStepMeshDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STEP_MESH_STORE, 'readwrite');
      tx.objectStore(STEP_MESH_STORE).put({
        itemId,
        meshes: meshes.map((m) => ({
          positions: m.positions instanceof Float32Array ? m.positions : Float32Array.from(m.positions),
          indices: m.indices
            ? (m.indices instanceof Uint32Array ? m.indices : Uint32Array.from(m.indices))
            : null,
        })),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to save STEP mesh'));
      tx.onabort = () => reject(tx.error ?? new Error('STEP mesh save aborted'));
    });
  } finally {
    db.close();
  }
}

async function loadStepMeshesForItem(itemId: string): Promise<StepPreviewMeshPayload[] | null> {
  const db = await openStepMeshDb();
  try {
    const rec = await new Promise<any>((resolve, reject) => {
      const tx = db.transaction(STEP_MESH_STORE, 'readonly');
      const req = tx.objectStore(STEP_MESH_STORE).get(itemId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Failed to load STEP mesh'));
    });
    if (!rec?.meshes || !Array.isArray(rec.meshes)) return null;
    return rec.meshes.map((m: any) => ({
      positions: m.positions instanceof Float32Array ? m.positions : Float32Array.from(m.positions ?? []),
      indices: m.indices
        ? (m.indices instanceof Uint32Array ? m.indices : Uint32Array.from(m.indices ?? []))
        : null,
    }));
  } finally {
    db.close();
  }
}

async function deleteStepMeshesForItem(itemId: string): Promise<void> {
  const db = await openStepMeshDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STEP_MESH_STORE, 'readwrite');
      tx.objectStore(STEP_MESH_STORE).delete(itemId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to delete STEP mesh'));
      tx.onabort = () => reject(tx.error ?? new Error('STEP mesh delete aborted'));
    });
  } finally {
    db.close();
  }
}

async function cloneStepMeshesForItem(sourceItemId: string, targetItemId: string): Promise<void> {
  const meshes = await loadStepMeshesForItem(sourceItemId);
  if (!meshes || meshes.length === 0) return;
  await saveStepMeshesForItem(targetItemId, meshes);
}

function pickFirstNum(
  map: Map<string, string>,
  keys: string[]
): number | null {
  for (const key of keys) {
    const val = parseNum(map.get(key));
    if (val !== null) return val;
  }
  return null;
}

function buildVisualFromImport(parsed: ParsedToolImport, fallbackLength: number, fallbackRadius: number): ToolVisualProfile {
  const d1 = Math.max(0.5, parsed.diameter ?? fallbackRadius * 2);
  const d2 = Math.max(0.5, parsed.neckDiameter ?? d1);
  const d3 = Math.max(0.5, parsed.shaftDiameter ?? d2);
  const total = Math.max(1, parsed.length ?? fallbackLength);
  const l1 = Math.max(0.5, parsed.cuttingLength ?? total * 0.35);
  const shoulder = parsed.shoulderLength ?? l1;
  const l2 = Math.max(0.1, shoulder - l1);
  const l3 = Math.max(0.5, total - l1 - l2);
  const stickout = Math.max(0.5, parsed.stickout ?? total);
  return ensureSegmentDiameters({
    l1: round3(l1),
    d1: round3(d1),
    l2: round3(l2),
    d2: round3(d2),
    l3: round3(l3),
    d3: round3(d3),
    useHolder: false,
    holderLength: 18,
    holderDiameter: round3(Math.max(12, d3 * 1.2)),
    stickout: round3(stickout),
  });
}

function inferToolShapeFromImport(parsed: ParsedToolImport): ToolShapeType {
  const edge = parsed.edgeCount ?? 0;
  if (edge > 0 && edge <= 2) return 'drill';
  if (parsed.sourceStandard === 'STEP-OCC') return 'custom';
  return 'endmill';
}

function parseDinToolXml(doc: Document): ParsedToolImport {
  const props = Array.from(doc.querySelectorAll('Property-Data'));
  const map = new Map<string, string>();
  for (const p of props) {
    const code = p.querySelector('PropertyName')?.textContent?.trim()?.toUpperCase();
    const val = p.querySelector('Value')?.textContent?.trim();
    if (code && val) map.set(code, val);
  }
  const name =
    doc.querySelector('Tool > Main-Data > PrimaryId')?.textContent?.trim()
    || doc.querySelector('Tool > Main-Data > CustomerMaterialId')?.textContent?.trim()
    || 'DIN tool';
  const manufacturer =
    doc.querySelector('Tool > Main-Data > Manufacturer')?.textContent?.trim()
    || undefined;

  // DIN4000 + ISO13399-like aliases where available.
  const diameter = pickFirstNum(map, ['C3', 'A1', 'DC', 'DCON']);
  const length = pickFirstNum(map, ['B5', 'B71', 'OAL', 'LF']);
  const cuttingLength = pickFirstNum(map, ['B2', 'APMX', 'LCF']);
  const shoulderLength = pickFirstNum(map, ['B3', 'LU']);
  const shaftDiameter = pickFirstNum(map, ['A1', 'DCONMS', 'C3']);
  const neckDiameter = pickFirstNum(map, ['A5', 'DCONWS', 'D2']);
  const stickout = pickFirstNum(map, ['B71', 'LU', 'LF']);
  const edgeCount = pickFirstNum(map, ['F8', 'NOF', 'Z']);

  return {
    name,
    manufacturer,
    diameter,
    length,
    cuttingLength,
    shoulderLength,
    shaftDiameter,
    neckDiameter,
    stickout,
    edgeCount,
    sourceStandard: 'DIN4000',
  };
}

function parseOmtdxToolXml(doc: Document): ParsedToolImport {
  const tool = doc.querySelector('tools > tool');
  const getParam = (name: string) =>
    tool?.querySelector(`param[name="${name}"]`)?.getAttribute('value')?.trim() ?? null;
  const name = tool?.getAttribute('name')?.trim() || getParam('orderingCode') || 'OMTDX tool';
  const manufacturer = getParam('manufacturer') ?? undefined;
  return {
    name,
    manufacturer,
    diameter: parseNum(getParam('toolDiameter')),
    length: parseNum(getParam('toolTotalLength')),
    cuttingLength: parseNum(getParam('cuttingLength')),
    shoulderLength: parseNum(getParam('taperHeight')),
    shaftDiameter: parseNum(getParam('toolShaftDiameter')),
    neckDiameter: parseNum(getParam('tipDiameter')) || parseNum(getParam('toolDiameter')),
    stickout: parseNum(getParam('toolTotalLength')),
    edgeCount: parseNum(getParam('cuttingEdges')),
    sourceStandard: 'OMTDX',
  };
}

async function parseStepAsTool(file: File): Promise<{
  parsed: ParsedToolImport;
  preview: { meshes: StepPreviewMeshPayload[] };
  bounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
}> {
  const occt = await getOcctRuntime();
  const content = new Uint8Array(await file.arrayBuffer());
  const result = occt.ReadStepFile(content, {
    linearUnit: 'millimeter',
    linearDeflectionType: 'bounding_box_ratio',
    linearDeflection: 0.002,
    angularDeflection: 0.5,
  });
  if (!result?.success || !Array.isArray(result.meshes) || result.meshes.length === 0) {
    throw new Error('STEP import failed');
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let foundVertex = false;
  const previewMeshes: StepPreviewMeshPayload[] = [];

  for (const mesh of result.meshes as any[]) {
    const arr = mesh?.attributes?.position?.array;
    if (!arr || typeof arr.length !== 'number') continue;
    const pos = arr instanceof Float32Array
      ? arr
      : Float32Array.from(arr as ArrayLike<number>);
    const idxRaw = mesh?.index?.array;
    const indices = idxRaw && typeof idxRaw.length === 'number'
      ? (idxRaw instanceof Uint32Array ? idxRaw : Uint32Array.from(idxRaw as ArrayLike<number>))
      : null;
    previewMeshes.push({
      positions: new Float32Array(pos),
      indices: indices ? new Uint32Array(indices) : null,
    });
    for (let i = 0; i + 2 < arr.length; i += 3) {
      const x = Number(arr[i]);
      const y = Number(arr[i + 1]);
      const z = Number(arr[i + 2]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
      foundVertex = true;
    }
  }

  if (!foundVertex) {
    throw new Error('STEP geometry is empty');
  }

  const dx = Math.max(0.001, maxX - minX);
  const dy = Math.max(0.001, maxY - minY);
  const dz = Math.max(0.001, maxZ - minZ);
  const sorted = [dx, dy, dz].sort((a, b) => a - b);
  const diameter = round3(Math.max(0.5, (sorted[0] + sorted[1]) * 0.5));
  const length = round3(Math.max(5, sorted[2]));
  const stem = file.name.replace(/\.[^.]+$/, '');

  return {
    parsed: {
      name: stem || 'STEP Tool',
      manufacturer: undefined,
      diameter,
      length,
      cuttingLength: round3(Math.max(1, length * 0.35)),
      shoulderLength: round3(Math.max(1, length * 0.55)),
      shaftDiameter: diameter,
      neckDiameter: diameter,
      stickout: length,
      edgeCount: null,
      sourceStandard: 'STEP-OCC',
    },
    preview: {
      meshes: previewMeshes,
    },
    bounds: {
      minX: round3(minX),
      minY: round3(minY),
      minZ: round3(minZ),
      maxX: round3(maxX),
      maxY: round3(maxY),
      maxZ: round3(maxZ),
    },
  };
}

function fromTool(length: number, radius: number): ToolVisualProfile {
  return buildVisualFromShapeType('endmill', length, radius, 118);
}

function ensureVisualForKind(
  kind: ToolItemKind,
  length: number,
  radius: number,
  visual?: ToolVisualProfile
): ToolVisualProfile {
  const base = ensureSegmentDiameters(visual ?? fromTool(length, radius));
  const baseTotal = Math.max(
    0.5,
    Number(base.l1 ?? 0) + Number(base.l2 ?? 0) + Number(base.l3 ?? 0)
  );
  const holderLen = clampPos(
    Number(base.holderLength ?? (kind === 'tool' ? 18 : Math.max(1, length))),
    1,
    500
  );
  const nominalHolderDia = clampPos(
    Number(base.holderDiameter ?? Math.max(1, radius * 2)),
    0.5,
    300
  );
  const holderDiameterTop = clampPos(
    Number(base.holderDiameterTop ?? nominalHolderDia),
    0.5,
    300
  );
  const holderDiameterBottom = clampPos(
    Number(base.holderDiameterBottom ?? nominalHolderDia),
    0.5,
    300
  );
  const keepHolderOnTool = kind === 'tool' ? Boolean(base.useHolder) : false;
  const next: ToolVisualProfile = {
    ...base,
    g1Color: normalizeColorHex(base.g1Color, '#ef4444'),
    g2Color: normalizeColorHex(base.g2Color, '#94a3b8'),
    g3Color: normalizeColorHex(base.g3Color, '#64748b'),
    useHolder: keepHolderOnTool,
    holderLength: round3(holderLen),
    holderDiameter: round3(Math.max(holderDiameterTop, holderDiameterBottom)),
    holderColor: normalizeColorHex(base.holderColor, '#94a3b8'),
    holderDiameterTop: round3(holderDiameterTop),
    holderDiameterBottom: round3(holderDiameterBottom),
    holderTaperAngleDeg: holderAngleFromDiametersDeg(holderDiameterTop, holderDiameterBottom, holderLen),
    stickout: kind === 'tool'
      ? round3(clampPos(Number(base.stickout ?? length), 0.5, 1000))
      : round3(baseTotal),
  };
  if (kind !== 'tool') {
    next.g1Type = 'cylinder';
    next.g2Type = 'cylinder';
    next.g3Type = 'cylinder';
    next.g1Cut = false;
    next.g2Cut = false;
    next.g3Cut = false;
  }
  return next;
}

function emptyItem(kind: ToolItemKind): ToolItem {
  const baseLen = kind === 'tool' ? 50 : 25;
  const baseRad = kind === 'tool' ? 4 : 8;
  const toolType = defaultToolType(kind);
  const tipAngleDeg = kind === 'tool' ? 118 : 0;
  const baseVisual = kind === 'tool'
    ? buildVisualFromShapeType(toolType, baseLen, baseRad, tipAngleDeg)
    : fromTool(baseLen, baseRad);
  const visual = ensureVisualForKind(kind, baseLen, baseRad, baseVisual);
  return {
    id: uid(),
    kind,
    toolType,
    tipAngleDeg,
    name: kind === 'tool' ? 'New Tool' : kind === 'holder' ? 'New Holder' : 'New Extension',
    note: '',
    length: baseLen,
    radius: baseRad,
    stickout: kind === 'tool' ? baseLen : 0,
    toolStickInMax: kind === 'tool' ? 0 : baseLen,
    mountFace: defaultMountFace(kind),
    outputFace: defaultOutputFace(kind),
    mountOffset: 0,
    stepMeshId: undefined,
    stepRotX: 0,
    stepRotY: 0,
    stepRotZ: 0,
    stepPosX: 0,
    stepPosY: 0,
    stepPosZ: 0,
    stepAnchorToGauge: false,
    stepViewMode: 'both',
    visual,
  };
}

function normalizeItem(raw: Partial<ToolItem>): ToolItem {
  const kind: ToolItemKind =
    raw.kind === 'holder' || raw.kind === 'extension' || raw.kind === 'tool'
      ? raw.kind
      : 'tool';
  const lengthRaw = Number(raw.length);
  const radiusRaw = Number(raw.radius);
  const length = Number.isFinite(lengthRaw) ? lengthRaw : (kind === 'tool' ? 50 : 25);
  const radius = Number.isFinite(radiusRaw) ? radiusRaw : (kind === 'tool' ? 4 : 8);
  const stickoutRaw = Number(raw.stickout);
  const stickout = Number.isFinite(stickoutRaw) ? stickoutRaw : (kind === 'tool' ? length : 0);
  const stickInRaw = Number((raw as any).toolStickInMax);
  const toolStickInMax = kind === 'tool'
    ? 0
    : round3(clampPos(Number.isFinite(stickInRaw) ? stickInRaw : length, 0, Math.max(0.1, length)));
  const rawType = typeof (raw as any).toolType === 'string'
    ? (raw as any).toolType as ToolShapeType
    : defaultToolType(kind);
  const toolType: ToolShapeType =
    kind === 'tool'
      ? (rawType === 'endmill'
        || rawType === 'bullnose'
        || rawType === 'ballnose'
        || rawType === 'drill'
        || rawType === 'center-drill'
        || rawType === 'chamfer-drill'
        || rawType === 'reamer'
        || rawType === 'tap'
        || rawType === 'taper-endmill'
        || rawType === 'custom'
        ? rawType
        : 'endmill')
      : 'custom';
  const tipRaw = Number((raw as any).tipAngleDeg);
  const tipAngleDeg = kind === 'tool'
    ? round3(clampPos(Number.isFinite(tipRaw) ? tipRaw : 118, 20, 170))
    : 0;
  const fallbackVisual = kind === 'tool'
    ? buildVisualFromShapeType(toolType, length, radius, tipAngleDeg)
    : fromTool(length, radius);
  const mountFace = isStepFace((raw as any).mountFace) ? (raw as any).mountFace : defaultMountFace(kind);
  const outputFace = isStepFace((raw as any).outputFace) ? (raw as any).outputFace : defaultOutputFace(kind);
  const mountOffsetRaw = Number((raw as any).mountOffset);
  const mountOffset = round3(Math.max(0, Number.isFinite(mountOffsetRaw) ? mountOffsetRaw : 0));
  const stepMeshId = typeof (raw as any).stepMeshId === 'string' && (raw as any).stepMeshId
    ? String((raw as any).stepMeshId)
    : undefined;
  const stepRotX = round3(Number.isFinite(Number((raw as any).stepRotX)) ? Number((raw as any).stepRotX) : 0);
  const stepRotY = round3(Number.isFinite(Number((raw as any).stepRotY)) ? Number((raw as any).stepRotY) : 0);
  const stepRotZ = round3(Number.isFinite(Number((raw as any).stepRotZ)) ? Number((raw as any).stepRotZ) : 0);
  const stepPosX = round3(Number.isFinite(Number((raw as any).stepPosX)) ? Number((raw as any).stepPosX) : 0);
  const stepPosY = round3(Number.isFinite(Number((raw as any).stepPosY)) ? Number((raw as any).stepPosY) : 0);
  const stepPosZ = round3(Number.isFinite(Number((raw as any).stepPosZ)) ? Number((raw as any).stepPosZ) : 0);
  const stepAnchorToGauge = typeof (raw as any).stepAnchorToGauge === 'boolean'
    ? Boolean((raw as any).stepAnchorToGauge)
    : false;
  const rawStepViewMode = (raw as any).stepViewMode;
  const stepViewMode: StepViewMode =
    rawStepViewMode === 'step' || rawStepViewMode === 'param' || rawStepViewMode === 'both'
      ? rawStepViewMode
      : 'both';
  return {
    id: raw.id || uid(),
    kind,
    toolType,
    tipAngleDeg,
    name: raw.name || (kind === 'tool' ? 'Tool' : kind === 'holder' ? 'Holder' : 'Extension'),
    note: raw.note || '',
    length,
    radius,
    stickout,
    toolStickInMax,
    mountFace,
    outputFace,
    mountOffset,
    stepMeshId,
    stepRotX,
    stepRotY,
    stepRotZ,
    stepPosX,
    stepPosY,
    stepPosZ,
    stepAnchorToGauge,
    stepViewMode,
    visual: ensureVisualForKind(kind, length, radius, raw.visual ?? fallbackVisual),
  };
}

function ensureStarterItems(items: ToolItem[]): ToolItem[] {
  const byId = new Map(items.map((it) => [it.id, it]));
  for (const seed of STARTER_TOOL_ITEMS) {
    if (!byId.has(seed.id)) byId.set(seed.id, normalizeItem(seed as Partial<ToolItem>));
  }
  return Array.from(byId.values());
}

function ensureStarterAssemblies(assemblies: ToolAssembly[], items: ToolItem[]): ToolAssembly[] {
  const byId = new Map(assemblies.map((a) => [a.id, a]));
  for (const seed of STARTER_ASSEMBLIES) {
    if (!byId.has(seed.id)) {
      byId.set(seed.id, resolveAssembly(seed, items));
    }
  }
  return Array.from(byId.values());
}

function getSocketStickInMax(item: ToolItem | null): number {
  if (!item || item.kind === 'tool') return 0;
  const raw = Number(item.toolStickInMax);
  if (Number.isFinite(raw)) return Math.max(0, raw);
  return Math.max(0, Number(item.length) || 0);
}

function resolveToolStickout(
  tool: ToolItem | null,
  holder: ToolItem | null,
  extension: ToolItem | null,
  requestedStickoutOverride?: number
) {
  const toolLength = Math.max(0.1, Number(tool?.length ?? 50));
  const requestedRaw = Number.isFinite(Number(requestedStickoutOverride))
    ? Number(requestedStickoutOverride)
    : Number(tool?.stickout ?? toolLength);
  const requestedStickout = clampPos(requestedRaw, 0, toolLength);
  const hasSocket = Boolean(holder || extension);
  const maxStickIn = hasSocket
    ? getSocketStickInMax(holder) + getSocketStickInMax(extension)
    : 0;
  const minAllowedStickout = hasSocket ? Math.max(0, toolLength - maxStickIn) : 0;
  const effectiveStickout = clampPos(requestedStickout, minAllowedStickout, toolLength);
  const usedStickIn = Math.max(0, toolLength - effectiveStickout);
  return {
    toolLength: round3(toolLength),
    requestedStickout: round3(requestedStickout),
    effectiveStickout: round3(effectiveStickout),
    maxStickIn: round3(maxStickIn),
    usedStickIn: round3(usedStickIn),
  };
}

function emptyAssembly(toolId = ''): ToolAssembly {
  return {
    id: uid(),
    name: 'New Assembly',
    note: '',
    toolId,
    holderId: null,
    extensionId: null,
    toolOut: 50,
    length: 50,
    radius: 4,
    visual: fromTool(50, 4),
  };
}

function resolveAssembly(raw: Partial<ToolAssembly>, items: ToolItem[]): ToolAssembly {
  const rawToolId = typeof raw.toolId === 'string' ? raw.toolId : '';
  const rawHolderId = typeof raw.holderId === 'string' ? raw.holderId : null;
  const rawExtensionId = typeof raw.extensionId === 'string' ? raw.extensionId : null;

  const tool = items.find((it) => it.kind === 'tool' && it.id === rawToolId) ?? null;
  const holder = rawHolderId ? (items.find((it) => it.kind === 'holder' && it.id === rawHolderId) ?? null) : null;
  const extension = rawExtensionId ? (items.find((it) => it.kind === 'extension' && it.id === rawExtensionId) ?? null) : null;

  const resolvedStick = resolveToolStickout(tool, holder, extension, Number((raw as any).toolOut));
  const rawLength = Number(raw.length);
  const rawRadius = Number(raw.radius);
  const fallbackLength = Number.isFinite(rawLength) ? Math.max(0.1, rawLength) : resolvedStick.toolLength;
  const fallbackRadius = Number.isFinite(rawRadius) ? Math.max(0.1, rawRadius) : Math.max(0.1, tool?.radius ?? 4);
  const toolLength = tool ? resolvedStick.toolLength : fallbackLength;
  const toolStickout = resolvedStick.effectiveStickout;
  const holderLength = holder?.length ?? 0;
  const extensionLength = extension?.length ?? 0;
  const holderMountOffset = Math.max(0, Number(holder?.mountOffset ?? 0));
  const extensionMountOffset = Math.max(0, Number(extension?.mountOffset ?? 0));
  const radius = Math.max(0.1, tool?.radius ?? fallbackRadius);
  const holderStackLength = Math.max(0, holderLength + extensionLength + holderMountOffset + extensionMountOffset);
  const totalLength = tool
    ? Math.max(0.1, holderStackLength + toolStickout)
    : fallbackLength;

  const rawVisual = raw.visual && typeof raw.visual === 'object'
    ? (raw.visual as ToolVisualProfile)
    : undefined;
  const toolVisual = tool?.visual ?? rawVisual ?? fromTool(toolLength, radius);
  const holderDia = Math.max(0, (holder?.radius ?? 0) * 2);
  const holderTopDia = Math.max(
    0,
    Number(holder?.visual?.holderDiameterTop ?? holder?.visual?.holderDiameter ?? holderDia)
  );
  const holderBottomDia = Math.max(
    0,
    Number(holder?.visual?.holderDiameterBottom ?? holder?.visual?.holderDiameter ?? holderDia)
  );
  const extDia = Math.max(0, (extension?.radius ?? 0) * 2);
  const toolShankTopDia = Math.max(0.2, Number(toolVisual.d3Top ?? toolVisual.d3));
  const toolShankBottomDia = Math.max(0.2, Number(toolVisual.d3Bottom ?? toolVisual.d3));
  const stackTopDia = Math.max(toolShankTopDia, extDia, holderTopDia || holderDia);
  const stackBottomDia = Math.max(toolShankBottomDia, extDia, holderBottomDia || holderDia);
  const visTotal = Math.max(0.1, toolVisual.l1 + toolVisual.l2 + toolVisual.l3);
  const scale = toolStickout / visTotal;
  const resolvedHolderLength = round3(Math.max(1, holderStackLength || 18));
  const visual: ToolVisualProfile = {
    l1: round3(Math.max(0.5, toolVisual.l1 * scale)),
    d1: round3(toolVisual.d1),
    d1Top: round3(toolVisual.d1Top ?? toolVisual.d1),
    d1Bottom: round3(toolVisual.d1Bottom ?? toolVisual.d1),
    g1Type: toolVisual.g1Type ?? 'cylinder',
    g1Cut: toolVisual.g1Cut ?? true,
    g1Color: normalizeColorHex((raw as any).toolColor ?? toolVisual.g1Color, '#ef4444'),
    l2: round3(Math.max(0.5, toolVisual.l2 * scale)),
    d2: round3(toolVisual.d2),
    d2Top: round3(toolVisual.d2Top ?? toolVisual.d2),
    d2Bottom: round3(toolVisual.d2Bottom ?? toolVisual.d2),
    g2Type: toolVisual.g2Type ?? 'cylinder',
    g2Cut: toolVisual.g2Cut ?? false,
    g2Color: normalizeColorHex((raw as any).toolColor ?? toolVisual.g2Color, '#94a3b8'),
    l3: round3(Math.max(0.5, toolVisual.l3 * scale)),
    d3: round3(toolVisual.d3),
    d3Top: round3(toolVisual.d3Top ?? toolVisual.d3),
    d3Bottom: round3(toolVisual.d3Bottom ?? toolVisual.d3),
    g3Type: toolVisual.g3Type ?? 'cylinder',
    g3Cut: toolVisual.g3Cut ?? false,
    g3Color: normalizeColorHex((raw as any).toolColor ?? toolVisual.g3Color, '#64748b'),
    useHolder: holderStackLength > 0.001,
    holderLength: resolvedHolderLength,
    holderDiameter: round3(Math.max(stackTopDia, stackBottomDia, radius * 2 * 1.2)),
    holderColor: normalizeColorHex(
      (raw as any).holderColor
      ?? (raw as any).extensionColor
      ?? holder?.visual?.holderColor
      ?? extension?.visual?.holderColor,
      '#94a3b8'
    ),
    holderDiameterTop: round3(stackTopDia),
    holderDiameterBottom: round3(stackBottomDia),
    holderTaperAngleDeg: holderAngleFromDiametersDeg(stackTopDia, stackBottomDia, resolvedHolderLength),
    stickout: toolStickout,
  };

  return {
    id: raw.id || uid(),
    name: raw.name || (tool ? `${tool.name} ASM` : (rawToolId ? `${rawToolId} ASM` : 'Assembly')),
    note: raw.note || '',
    toolId: tool?.id ?? rawToolId,
    holderId: holder?.id ?? rawHolderId,
    extensionId: extension?.id ?? rawExtensionId,
    toolOut: round3(toolStickout),
    toolColor: normalizeColorHex((raw as any).toolColor ?? tool?.visual?.g1Color, '#ef4444'),
    holderColor: normalizeColorHex((raw as any).holderColor ?? holder?.visual?.holderColor, '#94a3b8'),
    extensionColor: normalizeColorHex((raw as any).extensionColor ?? extension?.visual?.holderColor, '#94a3b8'),
    length: round3(totalLength),
    radius: round3(radius),
    visual,
  };
}

function extentFromBounds(
  bounds: NonNullable<PendingImport['stepBounds']>,
  axis: 'x' | 'y' | 'z'
): number {
  if (axis === 'x') return Math.max(0.001, bounds.maxX - bounds.minX);
  if (axis === 'y') return Math.max(0.001, bounds.maxY - bounds.minY);
  return Math.max(0.001, bounds.maxZ - bounds.minZ);
}

function inferDraftDimsFromBounds(draft: PendingImport): { length: number; radius: number } {
  if (!draft.stepBounds) {
    return {
      length: Math.max(0.5, Number(draft.length || 50)),
      radius: Math.max(0.1, Number(draft.radius || 4)),
    };
  }
  const axis = axisFromFace(draft.mountFace);
  const length = round3(Math.max(0.5, extentFromBounds(draft.stepBounds, axis)));
  const diaAxes: Array<'x' | 'y' | 'z'> =
    axis === 'x' ? ['y', 'z'] : axis === 'y' ? ['x', 'z'] : ['x', 'y'];
  const dA = extentFromBounds(draft.stepBounds, diaAxes[0]);
  const dB = extentFromBounds(draft.stepBounds, diaAxes[1]);
  const radius = round3(Math.max(0.1, ((dA + dB) * 0.5) * 0.5));
  return { length, radius };
}

function inferVisualFromStepMeshes(
  meshes: StepPreviewMeshPayload[] | null,
  mountFace: StepFace,
  outputFace: StepFace,
  kind: ToolItemKind
): ToolVisualProfile | null {
  if (!meshes || meshes.length === 0) return null;
  const axis = axisFromFace(mountFace);
  const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const o1 = axisIdx === 0 ? 1 : 0;
  const o2 = axisIdx === 2 ? 1 : 2;
  const outputSign = stepSignFromMachineFace(outputFace);

  let minA = Number.POSITIVE_INFINITY;
  let maxA = Number.NEGATIVE_INFINITY;
  let minO1Global = Number.POSITIVE_INFINITY;
  let maxO1Global = Number.NEGATIVE_INFINITY;
  let minO2Global = Number.POSITIVE_INFINITY;
  let maxO2Global = Number.NEGATIVE_INFINITY;
  let hasPt = false;

  for (const mesh of meshes) {
    const p = mesh?.positions;
    if (!p || p.length < 3) continue;
    for (let i = 0; i + 2 < p.length; i += 3) {
      const coords = [Number(p[i]), Number(p[i + 1]), Number(p[i + 2])];
      const a = coords[axisIdx];
      const v1 = coords[o1];
      const v2 = coords[o2];
      if (!Number.isFinite(a) || !Number.isFinite(v1) || !Number.isFinite(v2)) continue;
      hasPt = true;
      minA = Math.min(minA, a);
      maxA = Math.max(maxA, a);
      minO1Global = Math.min(minO1Global, v1);
      maxO1Global = Math.max(maxO1Global, v1);
      minO2Global = Math.min(minO2Global, v2);
      maxO2Global = Math.max(maxO2Global, v2);
    }
  }
  if (!hasPt || !Number.isFinite(minA) || !Number.isFinite(maxA)) return null;

  const span = Math.max(0.001, maxA - minA);
  const bins = [
    { minO1: Number.POSITIVE_INFINITY, maxO1: Number.NEGATIVE_INFINITY, minO2: Number.POSITIVE_INFINITY, maxO2: Number.NEGATIVE_INFINITY, count: 0 },
    { minO1: Number.POSITIVE_INFINITY, maxO1: Number.NEGATIVE_INFINITY, minO2: Number.POSITIVE_INFINITY, maxO2: Number.NEGATIVE_INFINITY, count: 0 },
    { minO1: Number.POSITIVE_INFINITY, maxO1: Number.NEGATIVE_INFINITY, minO2: Number.POSITIVE_INFINITY, maxO2: Number.NEGATIVE_INFINITY, count: 0 },
  ];

  for (const mesh of meshes) {
    const p = mesh?.positions;
    if (!p || p.length < 3) continue;
    for (let i = 0; i + 2 < p.length; i += 3) {
      const coords = [Number(p[i]), Number(p[i + 1]), Number(p[i + 2])];
      const a = coords[axisIdx];
      const v1 = coords[o1];
      const v2 = coords[o2];
      if (!Number.isFinite(a) || !Number.isFinite(v1) || !Number.isFinite(v2)) continue;
      const t = outputSign > 0 ? (maxA - a) / span : (a - minA) / span;
      const clampedT = Math.max(0, Math.min(0.999999, t));
      const bi = clampedT < (1 / 3) ? 0 : clampedT < (2 / 3) ? 1 : 2;
      const b = bins[bi];
      b.minO1 = Math.min(b.minO1, v1);
      b.maxO1 = Math.max(b.maxO1, v1);
      b.minO2 = Math.min(b.minO2, v2);
      b.maxO2 = Math.max(b.maxO2, v2);
      b.count += 1;
    }
  }

  const globalDia = Math.max(
    0.5,
    ((maxO1Global - minO1Global) + (maxO2Global - minO2Global)) * 0.5
  );
  const diaAt = (i: number): number => {
    const b = bins[i];
    if (b.count <= 0) return round3(globalDia);
    const d = ((b.maxO1 - b.minO1) + (b.maxO2 - b.minO2)) * 0.5;
    return round3(Math.max(0.5, d));
  };

  const totalLen = round3(Math.max(0.5, span));
  const l1 = round3(Math.max(0.5, totalLen / 3));
  const l2 = round3(Math.max(0.5, totalLen / 3));
  const l3 = round3(Math.max(0.5, Math.max(0.5, totalLen - l1 - l2)));
  const d1 = diaAt(0);
  const d2 = diaAt(1);
  const d3 = diaAt(2);

  const base: ToolVisualProfile = {
    l1, d1,
    d1Top: d1,
    d1Bottom: d1,
    g1Type: 'cylinder',
    g1Cut: kind === 'tool',
    g1Color: kind === 'tool' ? '#ef4444' : '#94a3b8',
    l2, d2,
    d2Top: d2,
    d2Bottom: d2,
    g2Type: 'cylinder',
    g2Cut: false,
    g2Color: '#94a3b8',
    l3, d3,
    d3Top: d3,
    d3Bottom: d3,
    g3Type: 'cylinder',
    g3Cut: false,
    g3Color: '#64748b',
    useHolder: false,
    holderLength: Math.max(1, totalLen * 0.35),
    holderDiameter: Math.max(d1, d2, d3),
    holderDiameterTop: Math.max(d1, d2, d3),
    holderDiameterBottom: Math.max(d1, d2, d3),
    stickout: kind === 'tool' ? totalLen : 0,
  };
  return ensureSegmentDiameters(base);
}

function inferMountOutputFacesFromStep(
  stepBounds: PendingImport['stepBounds'],
  stepPreview: { meshes: StepPreviewMeshPayload[] } | null,
  preferredAxis: MachineAxisLabel = 'Z',
): { mountFace: StepFace; outputFace: StepFace } {
  const defaults = defaultFacesForMachineAxis(preferredAxis);
  if (!stepBounds) {
    return defaults;
  }

  const axis = stepAxisFromMachineAxis(preferredAxis);

  const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const o1 = axisIdx === 0 ? 1 : 0;
  const o2 = axisIdx === 2 ? 1 : 2;
  const minA = axis === 'x' ? Number(stepBounds.minX) : axis === 'y' ? Number(stepBounds.minY) : Number(stepBounds.minZ);
  const maxA = axis === 'x' ? Number(stepBounds.maxX) : axis === 'y' ? Number(stepBounds.maxY) : Number(stepBounds.maxZ);
  const axisSpan = Math.max(0.001, maxA - minA);
  const capTol = Math.max(0.01, axisSpan * 0.08);

  const capAtMin = {
    minO1: Number.POSITIVE_INFINITY,
    maxO1: Number.NEGATIVE_INFINITY,
    minO2: Number.POSITIVE_INFINITY,
    maxO2: Number.NEGATIVE_INFINITY,
    count: 0,
  };
  const capAtMax = {
    minO1: Number.POSITIVE_INFINITY,
    maxO1: Number.NEGATIVE_INFINITY,
    minO2: Number.POSITIVE_INFINITY,
    maxO2: Number.NEGATIVE_INFINITY,
    count: 0,
  };

  for (const mesh of stepPreview?.meshes ?? []) {
    const p = mesh?.positions;
    if (!p || p.length < 3) continue;
    for (let i = 0; i + 2 < p.length; i += 3) {
      const coords = [Number(p[i]), Number(p[i + 1]), Number(p[i + 2])];
      const a = coords[axisIdx];
      const v1 = coords[o1];
      const v2 = coords[o2];
      if (!Number.isFinite(a) || !Number.isFinite(v1) || !Number.isFinite(v2)) continue;
      if (a <= minA + capTol) {
        capAtMin.minO1 = Math.min(capAtMin.minO1, v1);
        capAtMin.maxO1 = Math.max(capAtMin.maxO1, v1);
        capAtMin.minO2 = Math.min(capAtMin.minO2, v2);
        capAtMin.maxO2 = Math.max(capAtMin.maxO2, v2);
        capAtMin.count += 1;
      }
      if (a >= maxA - capTol) {
        capAtMax.minO1 = Math.min(capAtMax.minO1, v1);
        capAtMax.maxO1 = Math.max(capAtMax.maxO1, v1);
        capAtMax.minO2 = Math.min(capAtMax.minO2, v2);
        capAtMax.maxO2 = Math.max(capAtMax.maxO2, v2);
        capAtMax.count += 1;
      }
    }
  }

  const capDia = (cap: typeof capAtMin): number => {
    if (cap.count <= 0) return 0;
    return Math.max(0, ((cap.maxO1 - cap.minO1) + (cap.maxO2 - cap.minO2)) * 0.5);
  };

  const diaMin = capDia(capAtMin);
  const diaMax = capDia(capAtMax);
  const mountSign: 1 | -1 = diaMax >= diaMin ? 1 : -1;
  return {
    mountFace: faceFromAxisSign(axis, mountSign),
    outputFace: faceFromAxisSign(axis, mountSign === 1 ? -1 : 1),
  };
}

function recalcDraftFromMount(draft: PendingImport): PendingImport {
  const dims = inferDraftDimsFromBounds(draft);
  const importKind = draft.importKind;
  const length = dims.length;
  const radius = dims.radius;
  const toolType = importKind === 'tool' ? draft.toolType : 'custom';
  const tipAngleDeg = importKind === 'tool' ? draft.tipAngleDeg : 0;
  const stickout = importKind === 'tool'
    ? round3(clampPos(Number(draft.stickout || length), 0.1, Math.max(0.1, length)))
    : 0;
  const toolStickInMax = importKind === 'tool'
    ? 0
    : round3(Math.max(0.1, clampPos(Number(draft.toolStickInMax || length * 0.6), 0.1, length)));
  const stepVisual = draft.stepPreview
    ? inferVisualFromStepMeshes(
      draft.stepPreview.meshes,
      draft.mountFace,
      draft.outputFace,
      importKind
    )
    : null;
  const visualBase = importKind === 'tool'
    ? (toolType === 'custom'
      ? (stepVisual ?? draft.visual)
      : buildVisualFromShapeType(toolType, length, radius, tipAngleDeg, draft.visual))
    : (stepVisual ?? fromTool(length, radius));
  const visual = ensureVisualForKind(importKind, length, radius, {
    ...visualBase,
    stickout: importKind === 'tool' ? stickout : 0,
  });

  return {
    ...draft,
    length,
    radius,
    stickout,
    toolStickInMax,
    toolType,
    tipAngleDeg,
    visual,
  };
}

export default function ToolManagerPanel({ runtime }: SidebarModuleProps) {
  const [items, setItems] = useState<ToolItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [assemblies, setAssemblies] = useState<ToolAssembly[]>([]);
  const [selectedAssemblyId, setSelectedAssemblyId] = useState<string>('');
  const [hydrated, setHydrated] = useState(false);
  const [importStatus, setImportStatus] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [showAssemblyManager, setShowAssemblyManager] = useState(false);
  const [importPreviewOn, setImportPreviewOn] = useState(false);
  const [importShowStepMesh, setImportShowStepMesh] = useState(true);
  const [importShowParametric, setImportShowParametric] = useState(true);
  const [stepFacePickMode, setStepFacePickMode] = useState<StepFacePickMode>('off');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const previewBaselineRef = useRef<{ length: number; radius: number; profile: ToolVisualProfile } | null>(null);
  const stepPreviewBaselineRef = useRef<StepPreviewEventDetail>({ enabled: false });
  const lastStepPreviewDetailRef = useRef<StepPreviewEventDetail>({ enabled: false });
  const preferredSpindleAxis = useMemo<MachineAxisLabel>(
    () => inferPreferredSpindleMachineAxis(runtime.telemetry.axes),
    [runtime.telemetry.axes]
  );
  const stepFaceOptions = useMemo(
    () => stepFacesForPreferredAxis(preferredSpindleAxis),
    [preferredSpindleAxis]
  );
  const pendingImportIsStepOnly = Boolean(pendingImport?.stepPreview && pendingImport.stepViewMode === 'step');

  const emitStepPreview = (enabled: boolean, draft: PendingImport | null = null) => {
    const mode: StepViewMode = draft?.stepViewMode ?? 'both';
    const { showStep, showParametric } = stepViewFlags(mode, importShowStepMesh, importShowParametric);
    const detail: StepPreviewEventDetail = enabled
      ? {
        enabled: true,
        showStep,
        showParametric,
        parametricOpacity: 0.5,
        meshes: draft?.stepPreview?.meshes ?? [],
        rotationDeg: {
          x: Number(draft?.stepRotX ?? 0),
          y: Number(draft?.stepRotY ?? 0),
          z: Number(draft?.stepRotZ ?? 0),
        },
        offset: {
          x: Number(draft?.stepPosX ?? 0),
          y: Number(draft?.stepPosY ?? 0),
          z: Number(draft?.stepPosZ ?? 0),
        },
        anchorToGauge: draft?.stepAnchorToGauge ?? false,
        mountFace: draft?.mountFace ?? '+Z',
        mountOffset: Number(draft?.mountOffset ?? 0),
      }
      : { enabled: false };
    window.dispatchEvent(new CustomEvent('vmill:step-preview', {
      detail,
    }));
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const rawAssemblies = localStorage.getItem(ASSEMBLY_KEY);
      if (!raw) {
        const defaults = ensureStarterItems([emptyItem('tool'), emptyItem('holder'), emptyItem('extension')]);
        setItems(defaults);
        setSelectedId(defaults[0].id);
        const seededAsm = ensureStarterAssemblies([], defaults);
        const asm = seededAsm[0] ?? resolveAssembly(emptyAssembly(defaults[0].id), defaults);
        setAssemblies(seededAsm.length ? seededAsm : [asm]);
        setSelectedAssemblyId((seededAsm[0] ?? asm).id);
        setHydrated(true);
        return;
      }
      const parsed = ensureStarterItems((JSON.parse(raw) as Partial<ToolItem>[]).map(normalizeItem));
      setItems(parsed);
      setSelectedId(parsed[0]?.id ?? '');
      let parsedAsm: ToolAssembly[] = [];
      if (rawAssemblies) {
        try {
          parsedAsm = (JSON.parse(rawAssemblies) as Partial<ToolAssembly>[]).map((a) => resolveAssembly(a, parsed));
        } catch (err) {
          console.warn('Failed to parse saved assemblies, keeping tool library intact', err);
          parsedAsm = [];
        }
      }
      const validAsm = ensureStarterAssemblies(parsedAsm.filter((a) => String(a.toolId ?? '').trim().length > 0), parsed);
      if (validAsm.length > 0) {
        setAssemblies(validAsm);
        setSelectedAssemblyId(validAsm[0].id);
        setHydrated(true);
      } else {
        const firstTool = parsed.find((it) => it.kind === 'tool');
        if (firstTool) {
          const asm = resolveAssembly(emptyAssembly(firstTool.id), parsed);
          asm.name = `${firstTool.name} ASM`;
          setAssemblies([asm]);
          setSelectedAssemblyId(asm.id);
        }
        setHydrated(true);
      }
    } catch {
      const fallback = ensureStarterItems([emptyItem('tool')]);
      setItems(fallback);
      setSelectedId(fallback[0].id);
      const seededAsm = ensureStarterAssemblies([], fallback);
      const asm = seededAsm[0] ?? resolveAssembly(emptyAssembly(fallback[0].id), fallback);
      setAssemblies(seededAsm.length ? seededAsm : [asm]);
      setSelectedAssemblyId((seededAsm[0] ?? asm).id);
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent('vmill:tool-library-changed'));
  }, [items, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(ASSEMBLY_KEY, JSON.stringify(assemblies));
    window.dispatchEvent(new CustomEvent('vmill:tool-assemblies-changed'));
  }, [assemblies, hydrated]);

  useEffect(() => {
    setAssemblies((prev) => {
      const next = prev
        .map((a) => resolveAssembly(a, items))
        .filter((a) => String(a.toolId ?? '').trim().length > 0);
      const stillSelected = next.some((a) => a.id === selectedAssemblyId);
      if (!stillSelected) setSelectedAssemblyId(next[0]?.id ?? '');
      return next;
    });
  }, [items, selectedAssemblyId]);

  useEffect(() => {
    if (!importPreviewOn || !pendingImport) return;
    applyImportPreviewToMachine(pendingImport);
    emitStepPreview(true, pendingImport);
  }, [importPreviewOn, pendingImport, importShowStepMesh, importShowParametric]);

  useEffect(() => {
    const onStepPreview = (ev: Event) => {
      const detail = (ev as CustomEvent<StepPreviewEventDetail>).detail;
      lastStepPreviewDetailRef.current = detail ?? { enabled: false };
    };
    window.addEventListener('vmill:step-preview', onStepPreview as EventListener);
    return () => window.removeEventListener('vmill:step-preview', onStepPreview as EventListener);
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('vmill:step-face-pick', {
      detail: { enabled: stepFacePickMode !== 'off' },
    }));
  }, [stepFacePickMode]);

  useEffect(() => {
    const onPicked = (ev: Event) => {
      const detail = (ev as CustomEvent<{ face?: StepFace }>).detail;
      const face = detail?.face;
      if (!face || !pendingImport || stepFacePickMode === 'off') return;
      if (stepFacePickMode === 'mount') {
        setPendingImport((p) => (p ? recalcDraftFromMount({ ...p, mountFace: face }) : p));
      } else if (stepFacePickMode === 'output') {
        setPendingImport((p) => (p ? recalcDraftFromMount({ ...p, outputFace: face }) : p));
      }
      setStepFacePickMode('off');
    };
    window.addEventListener('vmill:step-face-picked', onPicked as EventListener);
    return () => window.removeEventListener('vmill:step-face-picked', onPicked as EventListener);
  }, [pendingImport, stepFacePickMode]);

  useEffect(() => () => {
    restoreImportPreviewBaseline();
    emitStepPreview(false);
    window.dispatchEvent(new CustomEvent('vmill:step-face-pick', { detail: { enabled: false } }));
  }, []);

  const selected = useMemo(
    () => items.find((t) => t.id === selectedId) ?? null,
    [items, selectedId]
  );
  const selectedAssembly = useMemo(
    () => assemblies.find((a) => a.id === selectedAssemblyId) ?? null,
    [assemblies, selectedAssemblyId]
  );
  const selectedAssemblyStickInfo = useMemo(() => {
    if (!selectedAssembly) return { maxStickIn: 0, usedStickIn: 0 };
    const tool = items.find((it) => it.kind === 'tool' && it.id === selectedAssembly.toolId) ?? null;
    const holder = items.find((it) => it.kind === 'holder' && it.id === selectedAssembly.holderId) ?? null;
    const extension = items.find((it) => it.kind === 'extension' && it.id === selectedAssembly.extensionId) ?? null;
    const resolved = resolveToolStickout(tool, holder, extension, Number(selectedAssembly.toolOut));
    return { maxStickIn: resolved.maxStickIn, usedStickIn: resolved.usedStickIn };
  }, [selectedAssembly, items]);
  const tools = useMemo(() => items.filter((it) => it.kind === 'tool'), [items]);
  const holders = useMemo(() => items.filter((it) => it.kind === 'holder'), [items]);
  const extensions = useMemo(() => items.filter((it) => it.kind === 'extension'), [items]);
  const shapeLabel1 =
    selected?.kind === 'tool'
      ? (selected.toolType === 'drill'
        || selected.toolType === 'center-drill'
        || selected.toolType === 'chamfer-drill'
        ? 'Tip L/D'
        : selected.toolType === 'ballnose'
          ? 'Nose L/D'
          : 'Cut L/D')
      : 'L1/D1';
  const shapeLabel2 =
    selected?.kind === 'tool'
      ? (selected.toolType === 'drill'
        || selected.toolType === 'center-drill'
        || selected.toolType === 'chamfer-drill'
        ? 'Flute L/D'
        : 'Neck L/D')
      : 'L2/D2';
  const shapeLabel3 =
    selected?.kind === 'tool'
      ? 'Shank L/D'
      : 'L3/D3';

  const toolShapeNeedsAngle = (shape: ToolShapeType) =>
    shape === 'drill' || shape === 'center-drill' || shape === 'chamfer-drill';

  const getToolVisualForItem = (
    kind: ToolItemKind,
    shape: ToolShapeType,
    length: number,
    radius: number,
    tipAngleDeg: number,
    current?: ToolVisualProfile
  ) => {
    if (kind !== 'tool') return ensureVisualForKind(kind, length, radius, current ?? fromTool(length, radius));
    const built = buildVisualFromShapeType(shape, length, radius, tipAngleDeg, current);
    return ensureVisualForKind('tool', length, radius, built);
  };

  const applySelectedShapePreset = (
    shape: ToolShapeType,
    tipAngleDeg: number,
    length: number,
    radius: number
  ) => {
    if (!selected) return;
    const tip = round3(clampPos(tipAngleDeg, 20, 170));
    setSelectedPatch({
      toolType: shape,
      tipAngleDeg: tip,
      visual: getToolVisualForItem(selected.kind, shape, length, radius, tip, selected.visual),
    });
  };

  const setSelectedPatch = (patch: Partial<ToolItem>) => {
    if (!selected) return;
    setItems((prev) => prev.map((it) => (it.id === selected.id ? { ...it, ...patch } : it)));
  };

  const setSelectedVisualPatch = (patch: Partial<ToolVisualProfile>) => {
    if (!selected) return;
    const nextVisual = ensureVisualForKind(
      selected.kind,
      selected.length,
      selected.radius,
      { ...selected.visual, ...patch }
    );
    setSelectedPatch({ visual: nextVisual });
  };

  const selectedSegmentCount = selected
    ? ((selected.visual.l3 > 0.001 ? 3 : selected.visual.l2 > 0.001 ? 2 : 1) as 1 | 2 | 3)
    : 1;

  const setSelectedSegmentCount = (count: 1 | 2 | 3) => {
    if (!selected) return;
    const v = selected.visual;
    const next: Partial<ToolVisualProfile> = {};
    if (count === 1) {
      next.l2 = 0;
      next.l3 = 0;
    } else if (count === 2) {
      next.l2 = Math.max(0.5, v.l2 > 0.001 ? v.l2 : Math.max(1, selected.length * 0.25));
      next.l3 = 0;
    } else {
      next.l2 = Math.max(0.5, v.l2 > 0.001 ? v.l2 : Math.max(1, selected.length * 0.2));
      next.l3 = Math.max(0.5, v.l3 > 0.001 ? v.l3 : Math.max(1, selected.length * 0.2));
    }
    setSelectedVisualPatch(next);
  };

  const setSelectedAssemblyPatch = (patch: Partial<ToolAssembly>) => {
    if (!selectedAssembly) return;
    setAssemblies((prev) =>
      prev.map((asm) =>
        asm.id === selectedAssembly.id ? resolveAssembly({ ...asm, ...patch }, items) : asm
      )
    );
  };

  const applyStepMeshForItem = async (
    item: ToolItem | null
  ) => {
    if (!item?.stepMeshId) {
      emitStepPreview(false);
      return;
    }
    const viewMode: StepViewMode = item.stepViewMode ?? 'both';
    if (viewMode === 'param') {
      emitStepPreview(false);
      return;
    }
    const meshes = await loadStepMeshesForItem(item.stepMeshId);
    if (!meshes || meshes.length === 0) {
      emitStepPreview(false);
      return;
    }
    const flags = stepViewFlags(viewMode, true, true);
    const parametricMask: StepPreviewEventDetail['parametricMask'] =
      item.kind === 'tool' ? 'holder-only' : 'tool-only';
    const detail: StepPreviewEventDetail = {
      enabled: true,
      showStep: flags.showStep,
      showParametric: flags.showParametric,
      parametricMask,
      parametricOpacity: 1,
      meshes,
      rotationDeg: {
        x: Number(item.stepRotX ?? 0),
        y: Number(item.stepRotY ?? 0),
        z: Number(item.stepRotZ ?? 0),
      },
      offset: {
        x: Number(item.stepPosX ?? 0),
        y: Number(item.stepPosY ?? 0),
        z: Number(item.stepPosZ ?? 0),
      },
      anchorToGauge: item.stepAnchorToGauge ?? false,
      mountFace: item.mountFace ?? defaultMountFace(item.kind),
      mountOffset: Number(item.mountOffset ?? 0),
    };
    window.dispatchEvent(new CustomEvent('vmill:step-preview', { detail }));
  };

  function resolveAssemblyStepSource(assembly: ToolAssembly | null): ToolItem | null {
    if (!assembly) return null;
    const holder = assembly.holderId
      ? (items.find((it) => it.kind === 'holder' && it.id === assembly.holderId) ?? null)
      : null;
    const extension = assembly.extensionId
      ? (items.find((it) => it.kind === 'extension' && it.id === assembly.extensionId) ?? null)
      : null;
    const tool = assembly.toolId
      ? (items.find((it) => it.kind === 'tool' && it.id === assembly.toolId) ?? null)
      : null;
    const candidates = [tool, holder, extension].filter((it): it is ToolItem => !!it && !!it.stepMeshId);
    if (candidates.length === 0) return null;
    const explicitStepOnly = candidates.find((it) => (it.stepViewMode ?? 'both') === 'step');
    return explicitStepOnly ?? candidates[0];
  }

  const applyToMachine = () => {
    if (!selected) return;
    runtime.can.emit('command', { type: 'tool.set_length', channelIndex: 0, value: selected.length });
    runtime.can.emit('command', { type: 'tool.set_radius', channelIndex: 0, value: selected.radius });
    runtime.can.emit('command', { type: 'ui.set_tool_visual_profile', profile: selected.visual });
    void applyStepMeshForItem(selected);
  };

  const applyAssemblyToMachine = () => {
    if (!selectedAssembly || !selectedAssembly.toolId) return;
    runtime.can.emit('command', { type: 'tool.set_length', channelIndex: 0, value: selectedAssembly.length });
    runtime.can.emit('command', { type: 'tool.set_radius', channelIndex: 0, value: selectedAssembly.radius });
    runtime.can.emit('command', { type: 'ui.set_tool_visual_profile', profile: selectedAssembly.visual });
    const stepSource = resolveAssemblyStepSource(selectedAssembly);
    if (!stepSource) {
      emitStepPreview(false);
      return;
    }
    void applyStepMeshForItem(stepSource);
  };

  const saveAssemblyAsToolItem = () => {
    if (!selectedAssembly || !selectedAssembly.toolId) return;
    const sourceTool = items.find((it) => it.id === selectedAssembly.toolId);
    const holder = selectedAssembly.holderId ? items.find((it) => it.id === selectedAssembly.holderId) : null;
    const extension = selectedAssembly.extensionId ? items.find((it) => it.id === selectedAssembly.extensionId) : null;
    const item = emptyItem('tool');
    item.name = `${selectedAssembly.name} [ASM]`;
    item.toolType = 'custom';
    item.tipAngleDeg = sourceTool?.tipAngleDeg ?? 118;
    item.length = round3(Math.max(0.1, selectedAssembly.length));
    item.radius = round3(Math.max(0.1, selectedAssembly.radius));
    item.stickout = round3(Math.max(0.1, Number(selectedAssembly.visual.stickout ?? selectedAssembly.length)));
    item.toolStickInMax = 0;
    item.visual = ensureVisualForKind('tool', item.length, item.radius, {
      ...selectedAssembly.visual,
      useHolder: true,
      stickout: item.stickout,
    });
    const parts: string[] = [];
    if (sourceTool) parts.push(`Tool=${sourceTool.name}`);
    if (holder) parts.push(`Holder=${holder.name}`);
    if (extension) parts.push(`Ext=${extension.name}`);
    item.note = `Saved from assembly ${selectedAssembly.name}${parts.length ? ` | ${parts.join(' | ')}` : ''}`;
    if (sourceTool?.stepMeshId) {
      item.stepMeshId = uid();
      item.mountFace = sourceTool.mountFace ?? item.mountFace;
      item.outputFace = sourceTool.outputFace ?? item.outputFace;
      item.mountOffset = Number(sourceTool.mountOffset ?? item.mountOffset ?? 0);
      item.stepRotX = Number(sourceTool.stepRotX ?? 0);
      item.stepRotY = Number(sourceTool.stepRotY ?? 0);
      item.stepRotZ = Number(sourceTool.stepRotZ ?? 0);
      item.stepPosX = Number(sourceTool.stepPosX ?? 0);
      item.stepPosY = Number(sourceTool.stepPosY ?? 0);
      item.stepPosZ = Number(sourceTool.stepPosZ ?? 0);
      item.stepAnchorToGauge = sourceTool.stepAnchorToGauge ?? false;
      item.stepViewMode = sourceTool.stepViewMode ?? 'both';
    }
    setItems((prev) => [item, ...prev]);
    setSelectedId(item.id);
    if (sourceTool?.stepMeshId && item.stepMeshId) {
      void cloneStepMeshesForItem(sourceTool.stepMeshId, item.stepMeshId).catch((err) => {
        console.warn('Failed to clone STEP mesh for saved assembly tool', err);
      });
    }
  };

  const createAssembly = () => {
    const firstTool = tools[0];
    if (!firstTool) return;
    const asm = resolveAssembly(emptyAssembly(firstTool.id), items);
    asm.name = `${firstTool.name} ASM`;
    setAssemblies((prev) => [asm, ...prev]);
    setSelectedAssemblyId(asm.id);
  };

  const duplicateAssembly = () => {
    if (!selectedAssembly) return;
    const copy = resolveAssembly(
      { ...selectedAssembly, id: uid(), name: `${selectedAssembly.name} (copy)` },
      items
    );
    setAssemblies((prev) => [copy, ...prev]);
    setSelectedAssemblyId(copy.id);
  };

  const deleteAssembly = () => {
    if (!selectedAssembly) return;
    setAssemblies((prev) => {
      const remain = prev.filter((a) => a.id !== selectedAssembly.id);
      setSelectedAssemblyId(remain[0]?.id ?? '');
      return remain;
    });
  };

  const applyImportPreviewToMachine = (draft: PendingImport) => {
    runtime.can.emit('command', { type: 'tool.set_length', channelIndex: 0, value: draft.length });
    runtime.can.emit('command', { type: 'tool.set_radius', channelIndex: 0, value: draft.radius });
    runtime.can.emit('command', { type: 'ui.set_tool_visual_profile', profile: draft.visual });
  };

  const captureImportPreviewBaseline = () => {
    if (previewBaselineRef.current) return;
    const ch0 = runtime.telemetry.channels[0];
    previewBaselineRef.current = {
      length: Number(ch0?.tool_length ?? 0),
      radius: Math.max(0, Number(ch0?.tool_radius ?? 0)),
      profile: { ...runtime.telemetry.toolVisualProfile },
    };
    stepPreviewBaselineRef.current = lastStepPreviewDetailRef.current ?? { enabled: false };
  };

  const restoreImportPreviewBaseline = () => {
    const b = previewBaselineRef.current;
    if (!b) return;
    runtime.can.emit('command', { type: 'tool.set_length', channelIndex: 0, value: b.length });
    runtime.can.emit('command', { type: 'tool.set_radius', channelIndex: 0, value: b.radius });
    runtime.can.emit('command', { type: 'ui.set_tool_visual_profile', profile: b.profile });
    const previewBaseline = stepPreviewBaselineRef.current;
    if (previewBaseline?.enabled) {
      window.dispatchEvent(new CustomEvent('vmill:step-preview', { detail: previewBaseline }));
    } else {
      emitStepPreview(false);
    }
    previewBaselineRef.current = null;
    stepPreviewBaselineRef.current = { enabled: false };
  };

  const stopImportPreview = () => {
    restoreImportPreviewBaseline();
    setImportPreviewOn(false);
    setStepFacePickMode('off');
  };

  const buildImportedToolDraft = (
    fileName: string,
    parsed: ParsedToolImport,
    stepPreview: { meshes: StepPreviewMeshPayload[] } | null = null,
    stepBounds: PendingImport['stepBounds'] = null
  ): PendingImport => {
    const stepFaces = inferMountOutputFacesFromStep(stepBounds, stepPreview, preferredSpindleAxis);
    const d = Math.max(0.5, parsed.diameter ?? 8);
    const r = round3(Math.max(0.5, d * 0.5));
    const h = round3(Math.max(5, parsed.length ?? 50));
    const inferredFromStep = inferVisualFromStepMeshes(
      stepPreview?.meshes ?? null,
      stepFaces.mountFace,
      stepFaces.outputFace,
      'tool'
    );
    const visual = inferredFromStep
      ? ensureVisualForKind('tool', h, r, inferredFromStep)
      : buildVisualFromImport(parsed, h, r);
    const meta: string[] = [];
    meta.push(`STD ${parsed.sourceStandard}`);
    if (parsed.manufacturer) meta.push(`MFG ${parsed.manufacturer}`);
    if (parsed.edgeCount !== null) meta.push(`Z ${round3(parsed.edgeCount)}`);
    if (parsed.cuttingLength !== null) meta.push(`LCF ${round3(parsed.cuttingLength)}`);
    if (parsed.shoulderLength !== null) meta.push(`LU ${round3(parsed.shoulderLength)}`);
    if (parsed.shaftDiameter !== null) meta.push(`DCONMS ${round3(parsed.shaftDiameter)}`);
    if (parsed.sourceStandard === 'STEP-OCC') {
      meta.push('Auto-sized from STEP mesh bounding box');
    }
    return {
      fileName,
      parsed,
      importKind: 'tool',
      name: parsed.name || fileName,
      length: h,
      radius: r,
      stickout: round3(Math.max(0.5, parsed.stickout ?? h)),
      toolStickInMax: round3(Math.max(0.5, h * 0.6)),
      mountFace: stepFaces.mountFace,
      outputFace: stepFaces.outputFace,
      mountOffset: 0,
      toolType: inferToolShapeFromImport(parsed),
      tipAngleDeg: 118,
      visual,
      note: meta.join(' | '),
      stepPreview,
      stepBounds,
      stepRotX: 0,
      stepRotY: 0,
      stepRotZ: 0,
      stepPosX: 0,
      stepPosY: 0,
      stepPosZ: 0,
      stepAnchorToGauge: false,
      stepViewMode: stepPreview ? 'both' : 'param',
    };
  };

  const createImportedTool = async (draft: PendingImport) => {
    const item = emptyItem(draft.importKind);
    item.toolType = draft.importKind === 'tool' ? draft.toolType : 'custom';
    item.tipAngleDeg = draft.importKind === 'tool' ? draft.tipAngleDeg : 0;
    item.name = draft.name;
    item.length = round3(Math.max(0.5, draft.length));
    item.radius = round3(Math.max(0.1, draft.radius));
    item.stickout = draft.importKind === 'tool' ? round3(Math.max(0.5, draft.stickout)) : 0;
    item.toolStickInMax = draft.importKind === 'tool' ? 0 : round3(Math.max(0.1, draft.toolStickInMax));
    item.mountFace = draft.mountFace;
    item.outputFace = draft.outputFace;
    item.mountOffset = round3(Math.max(0, draft.mountOffset));
    item.stepRotX = draft.stepPreview ? round3(draft.stepRotX) : undefined;
    item.stepRotY = draft.stepPreview ? round3(draft.stepRotY) : undefined;
    item.stepRotZ = draft.stepPreview ? round3(draft.stepRotZ) : undefined;
    item.stepPosX = draft.stepPreview ? round3(draft.stepPosX) : undefined;
    item.stepPosY = draft.stepPreview ? round3(draft.stepPosY) : undefined;
    item.stepPosZ = draft.stepPreview ? round3(draft.stepPosZ) : undefined;
    item.stepAnchorToGauge = draft.stepPreview ? !!draft.stepAnchorToGauge : undefined;
    item.stepViewMode = draft.stepPreview ? draft.stepViewMode : 'param';
    item.visual = ensureVisualForKind(draft.importKind, item.length, item.radius, draft.visual);
    if (draft.stepPreview?.meshes?.length) {
      try {
        await saveStepMeshesForItem(item.id, draft.stepPreview.meshes);
        item.stepMeshId = item.id;
      } catch (err) {
        console.warn('Failed to persist STEP mesh for imported item', err);
      }
    }
    const poseMeta = draft.stepPreview
      ? ` | STEP_POSE R(${round3(draft.stepRotX)},${round3(draft.stepRotY)},${round3(draft.stepRotZ)}) P(${round3(draft.stepPosX)},${round3(draft.stepPosY)},${round3(draft.stepPosZ)}) A(${draft.stepAnchorToGauge ? 'GAUGE' : 'FREE'}) MF(${draft.mountFace}) OF(${draft.outputFace}) MO(${round3(draft.mountOffset)})`
      : '';
    item.note = `${draft.note}${poseMeta}`;
    setItems((prev) => [item, ...prev]);
    setSelectedId(item.id);
    return item;
  };

  const importFileAsTool = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    setImportBusy(true);
    setImportStatus('');
    stopImportPreview();
    try {
      let parsed: ParsedToolImport | null = null;
      let stepPreview: { meshes: StepPreviewMeshPayload[] } | null = null;
      let stepBounds: PendingImport['stepBounds'] = null;
      if (ext === 'xml') {
        const xml = await file.text();
        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        if (doc.querySelector('parsererror')) {
          throw new Error('Invalid XML file.');
        }
        parsed = doc.querySelector('Tool-Data > Tool') ? parseDinToolXml(doc) : parseOmtdxToolXml(doc);
      } else if (ext === 'step' || ext === 'stp') {
        const step = await parseStepAsTool(file);
        parsed = step.parsed;
        stepPreview = step.preview;
        stepBounds = step.bounds;
      } else {
        throw new Error('Unsupported file type. Use XML or STEP/STP.');
      }

      const draft = recalcDraftFromMount(buildImportedToolDraft(file.name, parsed, stepPreview, stepBounds));
      captureImportPreviewBaseline();
      setPendingImport(draft);
      setImportShowStepMesh(true);
      setImportShowParametric(true);
      setImportPreviewOn(true);
      setImportStatus(`Parsed ${draft.name} (${parsed.sourceStandard}). Validate then import.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed.';
      setImportStatus(message);
    } finally {
      setImportBusy(false);
    }
  };

  return (
    <div style={s.wrap}>
      <div style={s.topRow}>
        <select
          style={s.select}
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          {items.map((it) => (
            <option key={it.id} value={it.id}>
              {it.kind.toUpperCase()} - {it.name}
            </option>
          ))}
        </select>
        <button style={s.btn} onClick={applyToMachine}>APPLY</button>
      </div>

      <div style={s.btnRow}>
        <button style={s.btn} onClick={() => {
          const it = emptyItem('tool');
          setItems((p) => [it, ...p]);
          setSelectedId(it.id);
        }}>+ TOOL</button>
        <button style={s.btn} onClick={() => {
          const it = emptyItem('holder');
          setItems((p) => [it, ...p]);
          setSelectedId(it.id);
        }}>+ HOLDER</button>
        <button style={s.btn} onClick={() => {
          const it = emptyItem('extension');
          setItems((p) => [it, ...p]);
          setSelectedId(it.id);
        }}>+ EXT</button>
      </div>

      <div style={s.btnRow}>
        <button style={s.btn} onClick={() => fileRef.current?.click()}>
          {importBusy ? 'IMPORTING...' : 'IMPORT FILE'}
        </button>
        <button
          style={s.btn}
          onClick={() => {
            if (!selected) return;
            const copy = {
              ...selected,
              id: uid(),
              name: `${selected.name} (copy)`,
              stepMeshId: selected.stepMeshId ? uid() : undefined,
            };
            setItems((p) => [copy, ...p]);
            setSelectedId(copy.id);
            if (selected.stepMeshId && copy.stepMeshId) {
              void cloneStepMeshesForItem(selected.stepMeshId, copy.stepMeshId);
            }
          }}
        >
          DUPLICATE
        </button>
        <button
          style={s.btnDanger}
          onClick={() => {
            if (!selected) return;
            const stepMeshId = selected.stepMeshId;
            setItems((prev) => {
              const remain = prev.filter((it) => it.id !== selected.id);
              setSelectedId(remain[0]?.id ?? '');
              return remain;
            });
            if (stepMeshId) {
              void deleteStepMeshesForItem(stepMeshId);
            }
          }}
        >
          DELETE
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".xml,text/xml,application/xml,.step,.stp,model/step,application/step"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importFileAsTool(f);
          e.currentTarget.value = '';
        }}
      />
      {importStatus ? <div style={s.msg}>{importStatus}</div> : null}
      {pendingImport && (
        <div style={s.pendingWrap}>
          <div style={s.sectionTitle}>IMPORT VALIDATION</div>
          <div style={s.grid}>
            <span style={s.label}>File</span>
            <input style={s.input} value={pendingImport.fileName} readOnly />
            <span style={s.label}>Name</span>
            <input
              style={s.input}
              value={pendingImport.name}
              onChange={(e) => setPendingImport((p) => (p ? { ...p, name: e.target.value } : p))}
            />
            <span style={s.label}>Import As</span>
            <select
              style={s.select}
              value={pendingImport.importKind}
              onChange={(e) => {
                const kind = e.target.value as ToolItemKind;
                setPendingImport((p) => {
                  if (!p) return p;
                  const next = {
                    ...p,
                    importKind: kind,
                    toolType: kind === 'tool' ? p.toolType : 'custom',
                    tipAngleDeg: kind === 'tool' ? p.tipAngleDeg : 0,
                  };
                  return recalcDraftFromMount(next);
                });
              }}
            >
              <option value="tool">Tool</option>
              <option value="holder">Holder</option>
              <option value="extension">Extension</option>
            </select>
            {pendingImport.stepPreview && (
              <>
                <span style={s.label}>
                  {pendingImport.importKind === 'tool' ? 'Conn Face' : 'Spindle Face'}
                </span>
                <select
                  style={s.select}
                  value={pendingImport.mountFace}
                  onChange={(e) => {
                    const face = e.target.value as StepFace;
                    setPendingImport((p) => (p ? recalcDraftFromMount({ ...p, mountFace: face }) : p));
                  }}
                >
                  {stepFaceOptions.map((face) => (
                    <option key={face} value={face}>{face}</option>
                  ))}
                </select>
                <span style={s.label}>Pick Mount</span>
                <button
                  style={{ ...s.btn, ...(stepFacePickMode === 'mount' ? s.btnOn : {}) }}
                  onClick={() => {
                    if (!pendingImport) return;
                    if (!importPreviewOn) {
                      captureImportPreviewBaseline();
                      setImportPreviewOn(true);
                    }
                    setStepFacePickMode((m) => (m === 'mount' ? 'off' : 'mount'));
                  }}
                >
                  {stepFacePickMode === 'mount' ? 'CLICK FACE...' : 'PICK IN 3D'}
                </button>
                <span style={s.label}>
                  {pendingImport.importKind === 'tool' ? 'Tip Face' : 'Socket Face'}
                </span>
                <select
                  style={s.select}
                  value={pendingImport.outputFace}
                  onChange={(e) => {
                    const face = e.target.value as StepFace;
                    setPendingImport((p) => (p ? recalcDraftFromMount({ ...p, outputFace: face }) : p));
                  }}
                >
                  {stepFaceOptions.map((face) => (
                    <option key={face} value={face}>{face}</option>
                  ))}
                </select>
                <span style={s.label}>Pick Output</span>
                <button
                  style={{ ...s.btn, ...(stepFacePickMode === 'output' ? s.btnOn : {}) }}
                  onClick={() => {
                    if (!pendingImport) return;
                    if (!importPreviewOn) {
                      captureImportPreviewBaseline();
                      setImportPreviewOn(true);
                    }
                    setStepFacePickMode((m) => (m === 'output' ? 'off' : 'output'));
                  }}
                >
                  {stepFacePickMode === 'output' ? 'CLICK FACE...' : 'PICK IN 3D'}
                </button>
                {pendingImport.importKind !== 'tool' && (
                  <>
                    <span style={s.label}>Mount Offset</span>
                    <input
                      style={s.input}
                      value={pendingImport.mountOffset}
                      onChange={(e) => {
                        const v = parseNum(e.target.value);
                        if (v === null) return;
                        setPendingImport((p) => (p ? { ...p, mountOffset: round3(Math.max(0, v)) } : p));
                      }}
                    />
                  </>
                )}
                <span style={s.label}>View Mode</span>
                <select
                  style={s.select}
                  value={pendingImport.stepViewMode}
                  onChange={(e) =>
                    setPendingImport((p) => (p ? { ...p, stepViewMode: e.target.value as StepViewMode } : p))
                  }
                >
                  <option value="both">STEP + Param</option>
                  <option value="step">STEP only</option>
                  <option value="param">Param only</option>
                </select>
                {!pendingImportIsStepOnly && (
                  <>
                    <span style={s.label}>STEP '&gt; Param</span>
                    <button
                      style={s.btn}
                      onClick={() => {
                        setPendingImport((p) => {
                          if (!p?.stepPreview) return p;
                          const fitted = inferVisualFromStepMeshes(
                            p.stepPreview.meshes,
                            p.mountFace,
                            p.outputFace,
                            p.importKind
                          );
                          if (!fitted) return p;
                          return {
                            ...p,
                            toolType: 'custom',
                            visual: ensureVisualForKind(p.importKind, p.length, p.radius, fitted),
                          };
                        });
                      }}
                    >
                      FIT SEGMENTS
                    </button>
                  </>
                )}
              </>
            )}
            {!pendingImportIsStepOnly && (
              <>
                <span style={s.label}>Shape</span>
                <select
                  style={s.select}
                  value={pendingImport.toolType}
                  disabled={pendingImport.importKind !== 'tool'}
                  onChange={(e) => {
                    const shape = e.target.value as ToolShapeType;
                    setPendingImport((p) => {
                      if (!p) return p;
                      const visual = buildVisualFromShapeType(shape, p.length, p.radius, p.tipAngleDeg, p.visual);
                      return { ...p, toolType: shape, visual: ensureVisualForKind('tool', p.length, p.radius, visual) };
                    });
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
                  <option value="custom">Custom</option>
                </select>
                <span style={s.label}>H (Length)</span>
                <input
                  style={s.input}
                  value={pendingImport.length}
                  onChange={(e) => {
                    const v = parseNum(e.target.value);
                    if (v === null) return;
                    setPendingImport((p) => {
                      if (!p) return p;
                      const length = round3(Math.max(0.5, v));
                      if (p.importKind === 'tool') {
                        const visual = p.toolType === 'custom'
                          ? ensureVisualForKind('tool', length, p.radius, { ...p.visual, stickout: Math.max(0.5, p.stickout) })
                          : ensureVisualForKind('tool', length, p.radius, buildVisualFromShapeType(p.toolType, length, p.radius, p.tipAngleDeg, p.visual));
                        return { ...p, length, stickout: Math.max(0.5, p.stickout), visual };
                      }
                      return {
                        ...p,
                        length,
                        toolStickInMax: round3(clampPos(p.toolStickInMax, 0.1, length)),
                        visual: ensureVisualForKind(p.importKind, length, p.radius, p.visual),
                      };
                    });
                  }}
                />
                <span style={s.label}>R (Radius)</span>
                <input
                  style={s.input}
                  value={pendingImport.radius}
                  onChange={(e) => {
                    const v = parseNum(e.target.value);
                    if (v === null) return;
                    setPendingImport((p) => {
                      if (!p) return p;
                      const radius = round3(Math.max(0.1, v));
                      if (p.importKind === 'tool') {
                        const visual = p.toolType === 'custom'
                          ? ensureVisualForKind('tool', p.length, radius, p.visual)
                          : ensureVisualForKind('tool', p.length, radius, buildVisualFromShapeType(p.toolType, p.length, radius, p.tipAngleDeg, p.visual));
                        return { ...p, radius, visual };
                      }
                      return { ...p, radius, visual: ensureVisualForKind(p.importKind, p.length, radius, p.visual) };
                    });
                  }}
                />
                <span style={s.label}>{pendingImport.importKind === 'tool' ? 'Stickout' : 'Stick-In Max'}</span>
                {pendingImport.importKind === 'tool' ? (
                  <input
                    style={s.input}
                    value={pendingImport.stickout}
                    onChange={(e) => {
                      const v = parseNum(e.target.value);
                      if (v === null) return;
                      setPendingImport((p) => {
                        if (!p) return p;
                        const stickout = round3(Math.max(0.5, v));
                        const visual = ensureVisualForKind('tool', p.length, p.radius, { ...p.visual, stickout });
                        return { ...p, stickout, visual };
                      });
                    }}
                  />
                ) : (
                  <input
                    style={s.input}
                    value={pendingImport.toolStickInMax}
                    onChange={(e) => {
                      const v = parseNum(e.target.value);
                      if (v === null) return;
                      setPendingImport((p) => (p ? { ...p, toolStickInMax: round3(clampPos(v, 0.1, p.length)) } : p));
                    }}
                  />
                )}
              </>
            )}
            {pendingImport.stepPreview && (
              <>
                <span style={s.label}>STEP Rot XYZ</span>
                <div style={s.triple}>
                  <input
                    style={s.input}
                    value={pendingImport.stepRotX}
                    onChange={(e) => {
                      const v = parseNum(e.target.value);
                      if (v === null) return;
                      setPendingImport((p) => (p ? { ...p, stepRotX: round3(v) } : p));
                    }}
                  />
                  <input
                    style={s.input}
                    value={pendingImport.stepRotY}
                    onChange={(e) => {
                      const v = parseNum(e.target.value);
                      if (v === null) return;
                      setPendingImport((p) => (p ? { ...p, stepRotY: round3(v) } : p));
                    }}
                  />
                  <input
                    style={s.input}
                    value={pendingImport.stepRotZ}
                    onChange={(e) => {
                      const v = parseNum(e.target.value);
                      if (v === null) return;
                      setPendingImport((p) => (p ? { ...p, stepRotZ: round3(v) } : p));
                    }}
                  />
                </div>
                <span style={s.label}>STEP Pos XYZ</span>
                <div style={s.triple}>
                  <input
                    style={s.input}
                    value={pendingImport.stepPosX}
                    onChange={(e) => {
                      const v = parseNum(e.target.value);
                      if (v === null) return;
                      setPendingImport((p) => (p ? { ...p, stepPosX: round3(v) } : p));
                    }}
                  />
                  <input
                    style={s.input}
                    value={pendingImport.stepPosY}
                    onChange={(e) => {
                      const v = parseNum(e.target.value);
                      if (v === null) return;
                      setPendingImport((p) => (p ? { ...p, stepPosY: round3(v) } : p));
                    }}
                  />
                  <input
                    style={s.input}
                    value={pendingImport.stepPosZ}
                    onChange={(e) => {
                      const v = parseNum(e.target.value);
                      if (v === null) return;
                      setPendingImport((p) => (p ? { ...p, stepPosZ: round3(v) } : p));
                    }}
                  />
                </div>
                <span style={s.label}>Anchor Gauge</span>
                <button
                  style={{ ...s.btn, ...(pendingImport.stepAnchorToGauge ? s.btnOn : {}) }}
                  onClick={() => setPendingImport((p) => (p ? { ...p, stepAnchorToGauge: !p.stepAnchorToGauge } : p))}
                >
                  {pendingImport.stepAnchorToGauge ? 'ON' : 'OFF'}
                </button>
              </>
            )}
            {!pendingImportIsStepOnly && pendingImport.importKind === 'tool' && (pendingImport.toolType === 'drill'
              || pendingImport.toolType === 'center-drill'
              || pendingImport.toolType === 'chamfer-drill') && (
              <>
                <span style={s.label}>Tip Angle</span>
                <input
                  style={s.input}
                  value={pendingImport.tipAngleDeg}
                  onChange={(e) => {
                    const v = parseNum(e.target.value);
                    if (v === null) return;
                    setPendingImport((p) => {
                      if (!p) return p;
                      const tipAngleDeg = round3(clampPos(v, 20, 170));
                      const visual = ensureVisualForKind(
                        'tool',
                        p.length,
                        p.radius,
                        buildVisualFromShapeType(p.toolType, p.length, p.radius, tipAngleDeg, p.visual)
                      );
                      return { ...p, tipAngleDeg, visual };
                    });
                  }}
                />
              </>
            )}
          </div>
          <div style={s.btnRow}>
            <button
              style={{ ...s.btn, ...(importShowStepMesh ? s.btnOn : {}) }}
              disabled={!pendingImport.stepPreview || pendingImport.stepViewMode === 'param'}
              onClick={() => setImportShowStepMesh((v) => !v)}
            >
              STEP {importShowStepMesh ? 'ON' : 'OFF'}
            </button>
            {!pendingImportIsStepOnly && (
              <>
                <button
                  style={{ ...s.btn, ...(importShowParametric ? s.btnOn : {}) }}
                  disabled={pendingImport.stepViewMode === 'step'}
                  onClick={() => setImportShowParametric((v) => !v)}
                >
                  PARAM {importShowParametric ? 'ON' : 'OFF'}
                </button>
                <button style={s.btn} disabled>PARAM OP 50%</button>
              </>
            )}
          </div>
          <div style={s.btnRow}>
            <button
              style={{ ...s.btn, ...(importPreviewOn ? s.btnOn : {}) }}
              onClick={() => {
                if (!pendingImport) return;
                if (!importPreviewOn) {
                  captureImportPreviewBaseline();
                  setImportPreviewOn(true);
                } else {
                  stopImportPreview();
                }
              }}
            >
              {importPreviewOn ? 'PREVIEW OFF' : 'PREVIEW IN SCENE'}
            </button>
            <button
              style={s.btn}
              onClick={() => {
                stopImportPreview();
                setPendingImport(null);
                setImportStatus('Import canceled.');
              }}
            >
              CANCEL
            </button>
            <button
              style={{ ...s.btn, ...s.btnOn }}
              onClick={() => {
                if (!pendingImport) return;
                void (async () => {
                  const draft = pendingImport;
                  const item = await createImportedTool(draft);
                  stopImportPreview();
                  setPendingImport(null);
                  setImportStatus(`Imported ${item.name} (${draft.parsed.sourceStandard})`);
                })();
              }}
            >
              IMPORT ITEM
            </button>
          </div>
        </div>
      )}

      {selected ? (
        <>
          <div style={s.grid}>
            <span style={s.label}>Kind</span>
            <select
              style={s.select}
              value={selected.kind}
              onChange={(e) => {
                const kind = e.target.value as ToolItemKind;
                const toolType = defaultToolType(kind);
                const tipAngleDeg = kind === 'tool' ? 118 : 0;
                setSelectedPatch({
                  kind,
                  toolType,
                  tipAngleDeg,
                  stickout: kind === 'tool' ? Math.max(0.5, selected.stickout || selected.length) : 0,
                  toolStickInMax: kind === 'tool'
                    ? 0
                    : round3(Math.max(0.1, Math.min(selected.toolStickInMax || selected.length, selected.length))),
                  mountFace: selected.mountFace ?? defaultMountFace(kind),
                  outputFace: selected.outputFace ?? defaultOutputFace(kind),
                  mountOffset: kind === 'tool' ? 0 : round3(Math.max(0, selected.mountOffset ?? 0)),
                  visual: getToolVisualForItem(
                    kind,
                    toolType,
                    selected.length,
                    selected.radius,
                    tipAngleDeg,
                    selected.visual
                  ),
                });
              }}
            >
              <option value="tool">Tool</option>
              <option value="holder">Holder</option>
              <option value="extension">Extension</option>
            </select>
            {selected.kind === 'tool' && (
              <>
                <span style={s.label}>Shape Type</span>
                <select
                  style={s.select}
                  value={selected.toolType}
                  onChange={(e) => {
                    const shape = e.target.value as ToolShapeType;
                    if (shape === 'custom') {
                      setSelectedPatch({ toolType: 'custom' });
                      return;
                    }
                    applySelectedShapePreset(shape, selected.tipAngleDeg || 118, selected.length, selected.radius);
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
                  <option value="custom">Custom</option>
                </select>
                {toolShapeNeedsAngle(selected.toolType) && (
                  <>
                    <span style={s.label}>Tip Angle</span>
                    <input
                      style={s.input}
                      value={selected.tipAngleDeg}
                      onChange={(e) => {
                        const v = parseNum(e.target.value);
                        if (v === null) return;
                        const angle = round3(clampPos(v, 20, 170));
                        if (selected.toolType === 'custom') {
                          setSelectedPatch({ tipAngleDeg: angle });
                          return;
                        }
                        applySelectedShapePreset(selected.toolType, angle, selected.length, selected.radius);
                      }}
                    />
                  </>
                )}
                <span style={s.label}>Rebuild</span>
                <button
                  style={s.btn}
                  onClick={() =>
                    applySelectedShapePreset(
                      selected.toolType,
                      selected.tipAngleDeg || 118,
                      selected.length,
                      selected.radius
                    )
                  }
                >
                  REBUILD SHAPE
                </button>
              </>
            )}
            <span style={s.label}>Name</span>
            <input style={s.input} value={selected.name} onChange={(e) => setSelectedPatch({ name: e.target.value })} />
            <span style={s.label}>H (Length)</span>
            <input
              style={s.input}
              value={selected.length}
              onChange={(e) => {
                const v = parseNum(e.target.value);
                if (v !== null) {
                  const nextLen = Math.max(0.1, v);
                  const nextVisual = selected.kind === 'tool' && selected.toolType !== 'custom'
                    ? getToolVisualForItem(
                      'tool',
                      selected.toolType,
                      nextLen,
                      selected.radius,
                      selected.tipAngleDeg,
                      selected.visual
                    )
                    : ensureVisualForKind(
                      selected.kind,
                      nextLen,
                      selected.radius,
                      {
                        ...selected.visual,
                        holderLength: selected.kind === 'tool'
                          ? selected.visual.holderLength
                          : nextLen,
                      }
                    );
                  setSelectedPatch({
                    length: nextLen,
                    toolStickInMax: selected.kind === 'tool'
                      ? 0
                      : round3(Math.max(0, Math.min(selected.toolStickInMax, nextLen))),
                    visual: nextVisual,
                  });
                }
              }}
            />
            <span style={s.label}>R (Radius)</span>
            <input
              style={s.input}
              value={selected.radius}
              onChange={(e) => {
                const v = parseNum(e.target.value);
                if (v !== null) {
                  const nextRadius = Math.max(0.1, v);
                  const nextVisual = selected.kind === 'tool' && selected.toolType !== 'custom'
                    ? getToolVisualForItem(
                      'tool',
                      selected.toolType,
                      selected.length,
                      nextRadius,
                      selected.tipAngleDeg,
                      selected.visual
                    )
                    : ensureVisualForKind(selected.kind, selected.length, nextRadius, selected.visual);
                  setSelectedPatch({
                    radius: nextRadius,
                    visual: nextVisual,
                  });
                }
              }}
            />
            {selected.kind === 'tool' ? (
              <>
                <span style={s.label}>Stickout</span>
                <input
                  style={s.input}
                  value={selected.stickout}
                  onChange={(e) => {
                    const v = parseNum(e.target.value);
                    if (v !== null) setSelectedPatch({ stickout: Math.max(0.1, v) });
                  }}
                />
              </>
            ) : (
              <>
                <span style={s.label}>Stick-In Max</span>
                <input
                  style={s.input}
                  value={selected.toolStickInMax}
                  onChange={(e) => {
                    const v = parseNum(e.target.value);
                    if (v !== null) {
                      setSelectedPatch({
                        toolStickInMax: round3(clampPos(v, 0, Math.max(0.1, selected.length))),
                      });
                    }
                  }}
                />
              </>
            )}
            <span style={s.label}>{selected.kind === 'tool' ? 'Conn Face' : 'Mount Face'}</span>
            <select
              style={s.select}
              value={selected.mountFace ?? defaultMountFace(selected.kind)}
              onChange={(e) => setSelectedPatch({ mountFace: e.target.value as StepFace })}
            >
              {stepFaceOptions.map((face) => (
                <option key={face} value={face}>{face}</option>
              ))}
            </select>
            <span style={s.label}>{selected.kind === 'tool' ? 'Tip Face' : 'Socket Face'}</span>
            <select
              style={s.select}
              value={selected.outputFace ?? defaultOutputFace(selected.kind)}
              onChange={(e) => setSelectedPatch({ outputFace: e.target.value as StepFace })}
            >
              {stepFaceOptions.map((face) => (
                <option key={face} value={face}>{face}</option>
              ))}
            </select>
            {selected.kind !== 'tool' && (
              <>
                <span style={s.label}>Mount Offset</span>
                <input
                  style={s.input}
                  value={selected.mountOffset ?? 0}
                  onChange={(e) => {
                    const v = parseNum(e.target.value);
                    if (v !== null) setSelectedPatch({ mountOffset: round3(Math.max(0, v)) });
                  }}
                />
              </>
            )}
            {selected.stepMeshId && (
              <>
                <span style={s.label}>STEP View</span>
                <select
                  style={s.select}
                  value={selected.stepViewMode ?? 'both'}
                  onChange={(e) => setSelectedPatch({ stepViewMode: e.target.value as StepViewMode })}
                >
                  <option value="both">STEP + Param</option>
                  <option value="step">STEP only</option>
                  <option value="param">Param only</option>
                </select>
              </>
            )}
            <span style={s.label}>{selected.kind === 'tool' ? 'Tool Color' : 'Body Color'}</span>
            <input
              type="color"
              style={s.colorInput}
              value={selected.kind === 'tool'
                ? normalizeColorHex(selected.visual.g1Color, '#ef4444')
                : normalizeColorHex(selected.visual.holderColor, '#94a3b8')}
              onChange={(e) => {
                const c = normalizeColorHex(e.target.value, selected.kind === 'tool' ? '#ef4444' : '#94a3b8');
                if (selected.kind === 'tool') {
                  setSelectedVisualPatch({ g1Color: c, g2Color: c, g3Color: c });
                } else {
                  setSelectedVisualPatch({ holderColor: c });
                }
              }}
            />
            <span style={s.label}>{selected.kind === 'tool' ? 'Tool Opacity %' : 'Body Opacity %'}</span>
            <div style={s.sliderRow}>
              <input
                style={s.range}
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(
                  clampPos(
                    Number(selected.kind === 'tool' ? selected.visual.toolOpacity ?? 1 : selected.visual.holderOpacity ?? 1) * 100,
                    0,
                    100
                  )
                )}
                onChange={(e) => {
                  const v = clampPos(Number(e.target.value), 0, 100);
                  if (selected.kind === 'tool') setSelectedVisualPatch({ toolOpacity: round3(v / 100) });
                  else setSelectedVisualPatch({ holderOpacity: round3(v / 100) });
                }}
              />
              <span style={s.sliderVal}>
                {Math.round(
                  clampPos(
                    Number(selected.kind === 'tool' ? selected.visual.toolOpacity ?? 1 : selected.visual.holderOpacity ?? 1) * 100,
                    0,
                    100
                  )
                )}
              </span>
            </div>
          </div>

          <div style={{ ...s.btnRow, gridTemplateColumns: '74px 1fr 1fr 1fr' }}>
            <span style={s.label}>Segments</span>
            <button style={s.btn} onClick={() => setSelectedSegmentCount(1)}>1</button>
            <button style={{ ...s.btn, ...(selectedSegmentCount >= 2 ? s.btnOn : {}) }} onClick={() => setSelectedSegmentCount(2)}>2</button>
            <button style={{ ...s.btn, ...(selectedSegmentCount >= 3 ? s.btnOn : {}) }} onClick={() => setSelectedSegmentCount(3)}>3</button>
          </div>

          <div style={s.grid2}>
            <span style={s.label}>{shapeLabel1}</span>
            <input style={s.input} value={selected.visual.l1} onChange={(e) => {
              const v = parseNum(e.target.value); if (v !== null) setSelectedVisualPatch({ l1: v });
            }} />
            <input style={s.input} value={selected.visual.d1} onChange={(e) => {
              const v = parseNum(e.target.value); if (v !== null) setSelectedVisualPatch({ d1: v });
            }} />
            <span style={s.label}>{shapeLabel2}</span>
            <input style={s.input} value={selected.visual.l2} onChange={(e) => {
              const v = parseNum(e.target.value); if (v !== null) setSelectedVisualPatch({ l2: v });
            }} disabled={selectedSegmentCount < 2} />
            <input style={s.input} value={selected.visual.d2} onChange={(e) => {
              const v = parseNum(e.target.value); if (v !== null) setSelectedVisualPatch({ d2: v });
            }} disabled={selectedSegmentCount < 2} />
            <span style={s.label}>{shapeLabel3}</span>
            <input style={s.input} value={selected.visual.l3} onChange={(e) => {
              const v = parseNum(e.target.value); if (v !== null) setSelectedVisualPatch({ l3: v });
            }} disabled={selectedSegmentCount < 3} />
            <input style={s.input} value={selected.visual.d3} onChange={(e) => {
              const v = parseNum(e.target.value); if (v !== null) setSelectedVisualPatch({ d3: v });
            }} disabled={selectedSegmentCount < 3} />
          </div>
          {selected.kind === 'tool' && (
            <div style={s.grid2}>
              <span style={s.label}>Tip Top/End</span>
              <input
                style={s.input}
                value={selected.visual.d1Top ?? selected.visual.d1}
                onChange={(e) => {
                  const v = parseNum(e.target.value);
                  if (v !== null) setSelectedVisualPatch({ d1Top: Math.max(0.2, v) });
                }}
              />
              <input
                style={s.input}
                value={selected.visual.d1Bottom ?? selected.visual.d1}
                onChange={(e) => {
                  const v = parseNum(e.target.value);
                  if (v !== null) setSelectedVisualPatch({ d1Bottom: Math.max(0.2, v) });
                }}
              />
            </div>
          )}

          <textarea
            style={s.note}
            value={selected.note}
            placeholder="Notes (vendor, holder type, extension chain...)"
            onChange={(e) => setSelectedPatch({ note: e.target.value })}
          />
        </>
      ) : (
        <div style={s.msg}>No tool item selected</div>
      )}

      <div style={s.divider} />
      <div style={s.sectionTitle}>ASSEMBLIES</div>

      <div style={s.topRow}>
        <select
          style={s.select}
          value={selectedAssemblyId}
          onChange={(e) => setSelectedAssemblyId(e.target.value)}
        >
          {assemblies.map((asm) => (
            <option key={asm.id} value={asm.id}>
              ASM - {asm.name}
            </option>
          ))}
        </select>
        <button style={s.btn} onClick={applyAssemblyToMachine}>LOAD</button>
      </div>

      <button style={s.btn} onClick={() => setShowAssemblyManager(true)}>
        OPEN ASM MANAGER
      </button>

      <ToolAssemblyManagerModal
        open={showAssemblyManager}
        assemblies={assemblies}
        selectedAssemblyId={selectedAssemblyId}
        selectedAssembly={selectedAssembly}
        tools={tools}
        holders={holders}
        extensions={extensions}
        stickInfo={selectedAssemblyStickInfo}
        onClose={() => setShowAssemblyManager(false)}
        onSelectAssembly={setSelectedAssemblyId}
        onLoad={applyAssemblyToMachine}
        onCreate={createAssembly}
        onDuplicate={duplicateAssembly}
        onDelete={deleteAssembly}
        onSaveAsTool={saveAssemblyAsToolItem}
        onPatch={setSelectedAssemblyPatch}
      />
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 6 },
  topRow: { display: 'grid', gridTemplateColumns: '1fr 64px', gap: 4 },
  btnRow: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 },
  grid: { display: 'grid', gridTemplateColumns: '74px 1fr', gap: 4, alignItems: 'center' },
  grid2: { display: 'grid', gridTemplateColumns: '74px 1fr 1fr', gap: 4, alignItems: 'center' },
  triple: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, alignItems: 'center' },
  sliderRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 42px',
    gap: 4,
    alignItems: 'center',
    minHeight: 24,
  },
  range: {
    width: '100%',
    accentColor: '#22c55e',
  },
  sliderVal: {
    fontSize: 10,
    color: '#9db4d8',
    textAlign: 'right',
  },
  colorInput: {
    width: '100%',
    height: 24,
    padding: 2,
    boxSizing: 'border-box',
    borderRadius: 3,
    border: '1px solid #fb923c',
    background: '#101926',
    cursor: 'pointer',
  },
  label: { color: '#8ca0c5', fontSize: 10 },
  sectionTitle: {
    color: '#93c5fd',
    fontSize: 10,
    letterSpacing: '0.08em',
    fontWeight: 700,
  },
  pendingWrap: {
    border: '1px solid #2f4a73',
    borderRadius: 4,
    padding: 6,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    background: '#0f1726',
  },
  divider: { height: 1, background: '#1f2b46', margin: '2px 0' },
  msg: { color: '#64748b', fontSize: 11 },
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
  note: {
    width: '100%',
    minHeight: 44,
    boxSizing: 'border-box',
    resize: 'vertical',
    background: '#101926',
    border: '1px solid #334155',
    borderRadius: 3,
    color: '#e2e8f0',
    padding: '6px',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  btn: {
    background: '#142238',
    border: '1px solid #2f4a73',
    borderRadius: 3,
    color: '#94a3b8',
    cursor: 'pointer',
    fontSize: 10,
    fontWeight: 700,
    padding: '4px 0',
    fontFamily: 'monospace',
  },
  btnDanger: {
    background: '#4c1d1d',
    border: '1px solid #7f1d1d',
    borderRadius: 3,
    color: '#fca5a5',
    cursor: 'pointer',
    fontSize: 10,
    fontWeight: 700,
    padding: '4px 0',
    fontFamily: 'monospace',
  },
  btnOn: {
    background: '#14532d',
    border: '1px solid #166534',
    color: '#86efac',
  },
};
