import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  DEFAULT_SPINDLE_DIAMETER,
  DEFAULT_SPINDLE_LENGTH,
  DEFAULT_SPINDLE_NOSE_DIAMETER,
  DEFAULT_SPINDLE_NOSE_LENGTH,
  DEFAULT_SPINDLE_CAP_DIAMETER,
  DEFAULT_SPINDLE_CAP_LENGTH,
} from './machineTemplates';

// ─── CNC → Three.js Coordinate Convention ────────────────────────────────────
// Machine X (left/right)   → Three.js +X
// Machine Y (front/back)   → Three.js -Z
// Machine Z (up/down)      → Three.js +Y
// invert flag on any axis  → negates the position before applying
// ─────────────────────────────────────────────────────────────────────────────

const TOOL_PATH_MAX = 6000;
const LIVE_PREVIEW_MAX_POINTS = 3000;
const LIVE_PREVIEW_MIN_DIST = 0.25;
const SPINDLE_GAUGE_Y = 0;
const DEFAULT_TOOL_LENGTH = 28;
const STOCK_BOOLEAN_MIN_SEG_LEN = 0.12;
const STOCK_BOOLEAN_INTERVAL_MS = 12;
const STOCK_COLLISION_INTERVAL_MS = 36;
const STOCK_BOOLEAN_CUTTER_SIDES_DEFAULT = 6;
const DEFAULT_TOOL_VISUAL = {
  l1: 12,
  d1: 8,
  d1Top: 8,
  d1Bottom: 8,
  g1Type: 'cylinder' as const,
  g1Cut: true,
  g1Color: '#ef4444',
  l2: 8,
  d2: 10,
  d2Top: 10,
  d2Bottom: 10,
  g2Type: 'cylinder' as const,
  g2Cut: false,
  g2Color: '#94a3b8',
  l3: 16,
  d3: 12,
  d3Top: 12,
  d3Bottom: 12,
  g3Type: 'cylinder' as const,
  g3Cut: false,
  g3Color: '#64748b',
  useHolder: false,
  holderLength: 18,
  holderDiameter: 14,
  holderColor: '#94a3b8',
  holderDiameterTop: 14,
  holderDiameterBottom: 14,
  holderTaperAngleDeg: 0,
  toolOpacity: 1,
  holderOpacity: 1,
  stickout: 36,
};

interface ToolVisualProfile {
  l1: number;
  d1: number;
  d1Top?: number;
  d1Bottom?: number;
  g1Type?: 'cylinder' | 'cone' | 'sphere';
  g1Cut?: boolean;
  g1Color?: string;
  l2: number;
  d2: number;
  d2Top?: number;
  d2Bottom?: number;
  g2Type?: 'cylinder' | 'cone' | 'sphere';
  g2Cut?: boolean;
  g2Color?: string;
  l3: number;
  d3: number;
  d3Top?: number;
  d3Bottom?: number;
  g3Type?: 'cylinder' | 'cone' | 'sphere';
  g3Cut?: boolean;
  g3Color?: string;
  useHolder?: boolean;
  holderLength?: number;
  holderDiameter?: number;
  holderColor?: string;
  holderDiameterTop?: number;
  holderDiameterBottom?: number;
  holderTaperAngleDeg?: number;
  toolOpacity?: number;
  holderOpacity?: number;
  stickout?: number;
}

interface StockConfig {
  shape: 'box';
  size: { x: number; y: number; z: number };
  position: { x: number; y: number; z: number };
  mount?: 'table' | 'spindle';
  color: string;
  opacity: number;
}

interface PreviewPathData {
  program: Array<{ x: number; y: number; z: number }>;
  programRapid: Array<{ x: number; y: number; z: number }>;
  tcp: Array<{ x: number; y: number; z: number }>;
  tcpRapid: Array<{ x: number; y: number; z: number }>;
  spindle: Array<{ x: number; y: number; z: number }>;
  spindleRapid: Array<{ x: number; y: number; z: number }>;
  leadInTcp: Array<{ x: number; y: number; z: number }>;
  leadOutTcp: Array<{ x: number; y: number; z: number }>;
}

interface SceneSetupConfig {
  backgroundColor: string;
  ambientIntensity: number;
  keyIntensity: number;
  fillIntensity: number;
  floorIntensity: number;
  antiAliasing: boolean;
  shadowsEnabled: boolean;
  reflectionsEnabled: boolean;
  stockBooleanEngine: 'none' | 'manifold';
  stockCollisionDetection: boolean;
  showStockGhost: boolean;
  stockGhostOpacity: number;
  showStockCutterDebug: boolean;
  stockCutterDebugOpacity: number;
  stockCutterSides: number;
  gridSize: number;
  gridDivisions: number;
  gridOpacity: number;
  showSceneAxes: boolean;
  gridMajorColor: string;
  gridMinorColor: string;
  wcsDotColor: string;
  mcsDotColor: string;
  toolPointRapidColor: string;
  toolPointFeedColor: string;
  spindlePointColor: string;
  gizmoScale: number;
  uiScale: number;
}

interface StepPreviewMeshPayload {
  positions: Float32Array | number[];
  indices: Uint32Array | number[] | null;
}

type StepFace = '+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z';

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

const DEFAULT_SCENE_CONFIG: SceneSetupConfig = {
  backgroundColor: '#1e1f24',
  ambientIntensity: 4,
  keyIntensity: 3,
  fillIntensity: 1.5,
  floorIntensity: 1.5,
  antiAliasing: true,
  shadowsEnabled: false,
  reflectionsEnabled: false,
  stockBooleanEngine: 'manifold',
  stockCollisionDetection: true,
  showStockGhost: true,
  stockGhostOpacity: 0.5,
  showStockCutterDebug: false,
  stockCutterDebugOpacity: 0.35,
  stockCutterSides: STOCK_BOOLEAN_CUTTER_SIDES_DEFAULT,
  gridSize: 1000,
  gridDivisions: 50,
  gridOpacity: 0.1,
  showSceneAxes: false,
  gridMajorColor: '#1a2a3a',
  gridMinorColor: '#111820',
  wcsDotColor: '#22d3ee',
  mcsDotColor: '#ffffff',
  toolPointRapidColor: '#fbbf24',
  toolPointFeedColor: '#22c55e',
  spindlePointColor: '#60a5fa',
  gizmoScale: 0.5,
  uiScale: 1,
};

function markPickIgnore(obj: THREE.Object3D) {
  obj.traverse((o: any) => {
    o.userData = o.userData ?? {};
    o.userData.pickIgnore = true;
  });
}

function parseHexColor(raw: string | undefined, fallback: string): THREE.Color {
  const c = new THREE.Color();
  try {
    c.set(raw && /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : fallback);
  } catch {
    c.set(fallback);
  }
  return c;
}

function applyDotMarkerColor(mesh: THREE.Mesh | null | undefined, hex: string, fallback: string, emissiveScale = 0.2) {
  if (!mesh) return;
  const mat = mesh.material as THREE.MeshStandardMaterial | null | undefined;
  if (!mat) return;
  const color = parseHexColor(hex, fallback);
  mat.color.copy(color);
  mat.emissive.copy(color).multiplyScalar(emissiveScale);
}

function stdMat(color: THREE.ColorRepresentation, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, metalness: 0.6, roughness: 0.4, ...opts });
}

function applyReflectionProfile(scene: THREE.Scene, enabled: boolean) {
  scene.traverse((obj: THREE.Object3D) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh?.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const mat = m as THREE.MeshStandardMaterial;
      if (!mat || typeof (mat as any).metalness !== 'number' || typeof (mat as any).roughness !== 'number') continue;
      mat.metalness = enabled ? Math.max(0.45, mat.metalness || 0) : 0.0;
      mat.roughness = enabled ? Math.min(0.6, mat.roughness || 0.4) : 1.0;
      mat.needsUpdate = true;
    }
  });
}

function applyShadowProfile(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  keyLight: THREE.DirectionalLight,
  enabled: boolean
) {
  renderer.shadowMap.enabled = !!enabled;
  keyLight.castShadow = !!enabled;
  scene.traverse((obj: THREE.Object3D) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh || !(mesh as any).isMesh) return;
    mesh.castShadow = !!enabled;
    mesh.receiveShadow = !!enabled;
  });
}

function buildFrame(parent: THREE.Object3D, axes: any[]) {
  const xAx = axes.find(a => a.physical_name === 'X');
  const yAx = axes.find(a => a.physical_name === 'Y');
  const zAx = axes.find(a => a.physical_name === 'Z');

  const xTravel = xAx ? Math.abs(xAx.max_range - xAx.min_range) : 300;
  const yTravel = yAx ? Math.abs(yAx.max_range - yAx.min_range) : 200;
  const zTravel = zAx ? Math.abs(zAx.max_range - zAx.min_range) : 150;

  const frameW = xTravel + 120;
  const frameD = yTravel + 120;
  const frameH = zTravel + 70;

  const base = new THREE.Mesh(new THREE.BoxGeometry(frameW, 14, frameD), stdMat(0x141b2a));
  base.position.set(0, -9, 0);
  parent.add(base);

  const tableW = Math.min(Math.max(xTravel * 0.72, 180), 320);
  const tableD = Math.min(Math.max(yTravel * 0.72, 160), 300);
  const table = new THREE.Mesh(new THREE.BoxGeometry(tableW, 10, tableD), stdMat(0x243748));
  table.position.set(0, 5, 0);
  parent.add(table);

  return { frameW, frameD, frameH, tableW, tableD };
}

function buildSpindle(
  spindleDiameter: number,
  spindleLength: number,
  spindleNoseDiameter: number,
  spindleNoseLength: number,
  spindleCapDiameter: number,
  spindleCapLength: number
): {
  group: THREE.Group;
  bodyGroup: THREE.Group;
  toolingGroup: THREE.Group;
  holder: THREE.Mesh;
  toolSegments: [THREE.Mesh, THREE.Mesh, THREE.Mesh];
  tipLight: THREE.PointLight;
} {
  const s1Dia = THREE.MathUtils.clamp(Number(spindleDiameter) || DEFAULT_SPINDLE_DIAMETER, 4, 300);
  const s1Len = THREE.MathUtils.clamp(Number(spindleLength) || DEFAULT_SPINDLE_LENGTH, 2, 600);
  const s2Dia = THREE.MathUtils.clamp(Number(spindleNoseDiameter) || DEFAULT_SPINDLE_NOSE_DIAMETER, 2, 300);
  const s2Len = THREE.MathUtils.clamp(Number(spindleNoseLength) || DEFAULT_SPINDLE_NOSE_LENGTH, 1, 600);
  const s3Dia = THREE.MathUtils.clamp(Number(spindleCapDiameter) || DEFAULT_SPINDLE_CAP_DIAMETER, 2, 300);
  const s3Len = THREE.MathUtils.clamp(Number(spindleCapLength) || DEFAULT_SPINDLE_CAP_LENGTH, 1, 600);

  const g = new THREE.Group();
  const bodyGroup = new THREE.Group();
  const toolingGroup = new THREE.Group();
  g.add(bodyGroup);
  g.add(toolingGroup);
  const seg1 = new THREE.Mesh(
    new THREE.CylinderGeometry(s1Dia * 0.5, s1Dia * 0.5, s1Len, 24),
    stdMat(0x1e3a5f, { metalness: 0.8 })
  );
  seg1.position.y = s1Len * 0.5;
  bodyGroup.add(seg1);

  const seg2 = new THREE.Mesh(
    new THREE.CylinderGeometry(s2Dia * 0.5, s2Dia * 0.5, s2Len, 24),
    stdMat(0x334155, { metalness: 0.76, roughness: 0.3 })
  );
  seg2.position.y = s1Len + s2Len * 0.5;
  bodyGroup.add(seg2);

  const seg3 = new THREE.Mesh(
    new THREE.CylinderGeometry(s3Dia * 0.5, s3Dia * 0.5, s3Len, 24),
    stdMat(0x0f172a, { metalness: 0.85, roughness: 0.25 })
  );
  seg3.position.y = s1Len + s2Len + s3Len * 0.5;
  bodyGroup.add(seg3);

  const totalLen = s1Len + s2Len + s3Len;

  const holder = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 1, 16),
    stdMat(0x94a3b8, { metalness: 0.9, roughness: 0.1 })
  );
  holder.position.y = -8;
  toolingGroup.add(holder);

  const makeSegment = (color: number, emissive = 0x220000) =>
    new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
      stdMat(color, { metalness: 0.72, roughness: 0.25, emissive: new THREE.Color(emissive) })
    );
  const segCut = makeSegment(0xef4444, 0x330000);   // L1/D1
  const segNeck = makeSegment(0x94a3b8, 0x111111);  // L2/D2
  const segBody = makeSegment(0x64748b, 0x111111);  // L3/D3
  toolingGroup.add(segCut, segNeck, segBody);

  const tipLight = new THREE.PointLight(0xff4444, 0.8, 50);
  tipLight.position.y = -Math.max(24, totalLen * 0.25);
  toolingGroup.add(tipLight);

  return { group: g, bodyGroup, toolingGroup, holder, toolSegments: [segCut, segNeck, segBody], tipLight };
}

function setToolVisualSegments(
  holderMesh: THREE.Mesh | null | undefined,
  toolSegments: [THREE.Mesh, THREE.Mesh, THREE.Mesh],
  tipLight: THREE.PointLight | null | undefined,
  profile: ToolVisualProfile
) {
  const l1 = THREE.MathUtils.clamp(Number(profile.l1 ?? DEFAULT_TOOL_VISUAL.l1), 0, 500);
  const d1 = THREE.MathUtils.clamp(Number(profile.d1 || DEFAULT_TOOL_VISUAL.d1), 0.5, 120);
  const l2 = THREE.MathUtils.clamp(Number(profile.l2 ?? DEFAULT_TOOL_VISUAL.l2), 0, 500);
  const d2 = THREE.MathUtils.clamp(Number(profile.d2 || DEFAULT_TOOL_VISUAL.d2), 0.5, 120);
  const l3 = THREE.MathUtils.clamp(Number(profile.l3 ?? DEFAULT_TOOL_VISUAL.l3), 0, 500);
  const d3 = THREE.MathUtils.clamp(Number(profile.d3 || DEFAULT_TOOL_VISUAL.d3), 0.5, 120);
  const g1Type = profile.g1Type ?? DEFAULT_TOOL_VISUAL.g1Type;
  const g2Type = profile.g2Type ?? DEFAULT_TOOL_VISUAL.g2Type;
  const g3Type = profile.g3Type ?? DEFAULT_TOOL_VISUAL.g3Type;
  const g1Cut = profile.g1Cut ?? DEFAULT_TOOL_VISUAL.g1Cut;
  const g2Cut = profile.g2Cut ?? DEFAULT_TOOL_VISUAL.g2Cut;
  const g3Cut = profile.g3Cut ?? DEFAULT_TOOL_VISUAL.g3Cut;
  const d1Top = g1Type === 'cone'
    ? THREE.MathUtils.clamp(Number(profile.d1Top ?? d1), 0.2, 120)
    : d1;
  const d1Bottom = g1Type === 'cone'
    ? THREE.MathUtils.clamp(Number(profile.d1Bottom ?? d1), 0.2, 120)
    : d1;
  const d2Top = g2Type === 'cone'
    ? THREE.MathUtils.clamp(Number(profile.d2Top ?? d2), 0.2, 120)
    : d2;
  const d2Bottom = g2Type === 'cone'
    ? THREE.MathUtils.clamp(Number(profile.d2Bottom ?? d2), 0.2, 120)
    : d2;
  const d3Top = g3Type === 'cone'
    ? THREE.MathUtils.clamp(Number(profile.d3Top ?? d3), 0.2, 120)
    : d3;
  const d3Bottom = g3Type === 'cone'
    ? THREE.MathUtils.clamp(Number(profile.d3Bottom ?? d3), 0.2, 120)
    : d3;
  const useHolder = !!profile.useHolder;
  const holderLength = THREE.MathUtils.clamp(
    Number(profile.holderLength ?? DEFAULT_TOOL_VISUAL.holderLength),
    1,
    500
  );
  const holderDiameter = THREE.MathUtils.clamp(
    Number(profile.holderDiameter ?? DEFAULT_TOOL_VISUAL.holderDiameter),
    1,
    200
  );
  const holderDiameterTop = THREE.MathUtils.clamp(
    Number(profile.holderDiameterTop ?? holderDiameter),
    1,
    200
  );
  const holderDiameterBottom = THREE.MathUtils.clamp(
    Number(profile.holderDiameterBottom ?? holderDiameter),
    1,
    200
  );
  const rawStickout = Number(profile.stickout ?? l1 + l2 + l3);
  const toolOpacity = THREE.MathUtils.clamp(Number(profile.toolOpacity ?? 1), 0.05, 1);
  const holderOpacity = THREE.MathUtils.clamp(Number(profile.holderOpacity ?? 1), 0.05, 1);
  const holderColorHex = profile.holderColor ?? '#94a3b8';
  const sl1 = l1;
  const sl2 = l2;
  const sl3 = l3;
  const toolTotal = Math.max(0.001, sl1 + sl2 + sl3);
  const stickout = THREE.MathUtils.clamp(rawStickout, 0.1, toolTotal);
  const insertionDepth = Math.max(0, toolTotal - stickout);
  const topY = SPINDLE_GAUGE_Y;

  if (holderMesh) {
    holderMesh.visible = useHolder;
    if (useHolder) {
      const topRadius = Math.max(0.1, holderDiameterTop * 0.5);
      const bottomRadius = Math.max(0.1, holderDiameterBottom * 0.5);
      const prev = holderMesh.userData.holderShape as
        | { topRadius: number; bottomRadius: number; length: number }
        | undefined;
      if (
        !prev
        || Math.abs(prev.topRadius - topRadius) > 1e-6
        || Math.abs(prev.bottomRadius - bottomRadius) > 1e-6
        || Math.abs(prev.length - holderLength) > 1e-6
      ) {
        holderMesh.geometry.dispose();
        holderMesh.geometry = new THREE.CylinderGeometry(topRadius, bottomRadius, holderLength, 24);
        holderMesh.userData.holderShape = { topRadius, bottomRadius, length: holderLength };
      }
      holderMesh.scale.set(1, 1, 1);
      holderMesh.position.y = topY - holderLength * 0.5;
      const mat = holderMesh.material as THREE.MeshStandardMaterial | null | undefined;
      if (mat) {
        const holderColor = parseHexColor(holderColorHex, '#94a3b8');
        mat.color.copy(holderColor);
        mat.emissive.copy(holderColor).multiplyScalar(0.05);
        mat.transparent = holderOpacity < 0.999;
        mat.opacity = holderOpacity;
        mat.depthWrite = holderOpacity >= 0.999;
        mat.needsUpdate = true;
        (mat.userData as any).vmillBaseOpacity = holderOpacity;
      }
    }
  }

  const toolTopY = topY - (useHolder ? holderLength : 0) + insertionDepth;
  const [segCut, segNeck, segBody] = toolSegments;
  const setSegmentShape = (
    mesh: THREE.Mesh,
    topDia: number,
    bottomDia: number,
    length: number,
    centerY: number,
    segType: 'cylinder' | 'cone' | 'sphere'
  ) => {
    if (length <= 0.001) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    const prev = mesh.userData.segShape as any;
    if (segType === 'sphere') {
      const dia = Math.max(0.2, topDia);
      if (!prev || prev.type !== 'sphere') {
        mesh.geometry.dispose();
        mesh.geometry = new THREE.SphereGeometry(0.5, 18, 14);
      }
      mesh.userData.segShape = { type: 'sphere', dia, length };
      mesh.scale.set(dia, Math.max(0.1, length), dia);
      mesh.position.y = centerY;
      return;
    }

    const topRadius = Math.max(0.1, topDia * 0.5);
    const bottomRadius = Math.max(0.1, bottomDia * 0.5);
    if (
      !prev
      || prev.type !== 'cyl'
      || Math.abs(prev.topRadius - topRadius) > 1e-6
      || Math.abs(prev.bottomRadius - bottomRadius) > 1e-6
      || Math.abs(prev.length - length) > 1e-6
    ) {
      mesh.geometry.dispose();
      mesh.geometry = new THREE.CylinderGeometry(topRadius, bottomRadius, length, 20);
      mesh.userData.segShape = { type: 'cyl', topRadius, bottomRadius, length };
    }
    mesh.scale.set(1, 1, 1);
    mesh.position.y = centerY;
  };

  const resolveColor = (raw: string | undefined, fallback: string) => {
    const c = new THREE.Color();
    try {
      c.set(raw && /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : fallback);
      return c;
    } catch {
      c.set(fallback);
      return c;
    }
  };

  const applySegmentLook = (mesh: THREE.Mesh, cut: boolean, colorHex: string, fallback: string) => {
    const mat = mesh.material as THREE.MeshStandardMaterial | null | undefined;
    if (!mat) return;
    const color = resolveColor(colorHex, fallback);
    mat.color.copy(color);
    mat.emissive.copy(color).multiplyScalar(cut ? 0.2 : 0.05);
    mat.transparent = toolOpacity < 0.999;
    mat.opacity = toolOpacity;
    mat.depthWrite = toolOpacity >= 0.999;
    mat.needsUpdate = true;
    (mat.userData as any).vmillBaseOpacity = toolOpacity;
  };

  setSegmentShape(segBody, d3Top, d3Bottom, sl3, toolTopY - (sl3 * 0.5), g3Type);
  setSegmentShape(segNeck, d2Top, d2Bottom, sl2, toolTopY - sl3 - (sl2 * 0.5), g2Type);
  setSegmentShape(segCut, d1Top, d1Bottom, sl1, toolTopY - sl3 - sl2 - (sl1 * 0.5), g1Type);
  applySegmentLook(segCut, !!g1Cut, profile.g1Color ?? DEFAULT_TOOL_VISUAL.g1Color, '#ef4444');
  applySegmentLook(segNeck, !!g2Cut, profile.g2Color ?? DEFAULT_TOOL_VISUAL.g2Color, '#94a3b8');
  applySegmentLook(segBody, !!g3Cut, profile.g3Color ?? DEFAULT_TOOL_VISUAL.g3Color, '#64748b');

  const tipY = toolTopY - (sl1 + sl2 + sl3);
  if (tipLight) tipLight.position.y = tipY;
}

function buildWorkpiece(stockConfig: StockConfig): THREE.Group {
  const g = new THREE.Group();
  const stockColor = stockConfig.color ?? '#3b82f6';
  const stockOpacity = THREE.MathUtils.clamp(Number(stockConfig.opacity ?? 0.92), 0.05, 1);

  // Stock config uses machine axes:
  // X -> scene X, Y -> scene -Z, Z -> scene +Y.
  const wp = new THREE.Mesh(
    new THREE.BoxGeometry(
      Math.max(1, stockConfig.size.x),
      Math.max(1, stockConfig.size.z),
      Math.max(1, stockConfig.size.y)
    ),
    stdMat(stockColor, { transparent: true, opacity: stockOpacity, roughness: 0.6 })
  );
  wp.userData.pickPriority = 100;
  wp.position.set(stockConfig.position.x, stockConfig.position.z, -stockConfig.position.y);
  g.add(wp);

  return g;
}

function spindleAxisMachineToScene(axis: '+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z'): THREE.Vector3 {
  switch (axis) {
    case '+X': return new THREE.Vector3(1, 0, 0);
    case '-X': return new THREE.Vector3(-1, 0, 0);
    case '+Y': return new THREE.Vector3(0, 0, -1);
    case '-Y': return new THREE.Vector3(0, 0, 1);
    case '+Z': return new THREE.Vector3(0, 1, 0);
    case '-Z': return new THREE.Vector3(0, -1, 0);
    default: return new THREE.Vector3(0, -1, 0);
  }
}

type ManifoldApi = {
  setup: () => void;
  Manifold: any;
  Mesh: any;
};

let manifoldApiPromise: Promise<ManifoldApi | null> | null = null;
let manifoldCylinderAxis: THREE.Vector3 | null = null;

async function getManifoldApi(): Promise<ManifoldApi | null> {
  if (!manifoldApiPromise) {
    manifoldApiPromise = (async () => {
      try {
        const [{ default: ManifoldFactory }, { default: wasmUrl }] = await Promise.all([
          import('manifold-3d'),
          import('manifold-3d/manifold.wasm?url'),
        ]);
        const api = await (ManifoldFactory as any)({
          locateFile: () => String(wasmUrl),
        });
        api.setup?.();
        return api as ManifoldApi;
      } catch (err) {
        console.warn('Manifold stock engine unavailable, fallback to static stock.', err);
        return null;
      }
    })();
  }
  return manifoldApiPromise;
}

function getManifoldCylinderAxis(api: ManifoldApi): THREE.Vector3 {
  if (manifoldCylinderAxis) return manifoldCylinderAxis.clone();
  try {
    const probe = api.Manifold.cylinder(20, 1, 1, 12, true);
    const mesh = probe.getMesh?.();
    const vertProps = mesh?.vertProperties as Float32Array | undefined;
    const numProp = Math.max(3, Number(mesh?.numProp ?? 3));
    if (vertProps && vertProps.length >= numProp * 2) {
      let minX = Number.POSITIVE_INFINITY, maxX = Number.NEGATIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY, maxY = Number.NEGATIVE_INFINITY;
      let minZ = Number.POSITIVE_INFINITY, maxZ = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < vertProps.length; i += numProp) {
        const x = vertProps[i];
        const y = vertProps[i + 1];
        const z = vertProps[i + 2];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
      const ex = maxX - minX;
      const ey = maxY - minY;
      const ez = maxZ - minZ;
      if (ex >= ey && ex >= ez) manifoldCylinderAxis = new THREE.Vector3(1, 0, 0);
      else if (ey >= ex && ey >= ez) manifoldCylinderAxis = new THREE.Vector3(0, 1, 0);
      else manifoldCylinderAxis = new THREE.Vector3(0, 0, 1);
    } else {
      manifoldCylinderAxis = new THREE.Vector3(0, 1, 0);
    }
    probe.delete?.();
  } catch {
    manifoldCylinderAxis = new THREE.Vector3(0, 1, 0);
  }
  return manifoldCylinderAxis.clone();
}

function manifoldToThreeGeometry(manifold: any): THREE.BufferGeometry {
  const mesh = manifold.getMesh();
  const vertProps = mesh.vertProperties as Float32Array;
  const triVerts = mesh.triVerts as Uint32Array;
  const numProp = Number(mesh.numProp ?? 3);
  const numVert = Math.max(0, Math.floor(vertProps.length / Math.max(3, numProp)));
  const pos = new Float32Array(numVert * 3);
  for (let i = 0; i < numVert; i += 1) {
    const src = i * numProp;
    const dst = i * 3;
    pos[dst] = vertProps[src];
    pos[dst + 1] = vertProps[src + 1];
    pos[dst + 2] = vertProps[src + 2];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(triVerts), 1));
  geo.computeVertexNormals();
  return geo;
}

function buildStockManifold(api: ManifoldApi, stockConfig: StockConfig): any {
  // Stock config machine->scene:
  // size: x, z, y and pos: x, z, -y
  const sx = Math.max(1, Number(stockConfig.size.x ?? 1));
  const sy = Math.max(1, Number(stockConfig.size.z ?? 1));
  const sz = Math.max(1, Number(stockConfig.size.y ?? 1));
  const px = Number(stockConfig.position.x ?? 0);
  const py = Number(stockConfig.position.z ?? 0);
  const pz = -Number(stockConfig.position.y ?? 0);
  return api.Manifold.cube([sx, sy, sz], true).translate(px, py, pz);
}

function clearGroupMeshes(group: THREE.Group | null | undefined) {
  if (!group) return;
  while (group.children.length > 0) {
    const child = group.children.pop() as THREE.Object3D | undefined;
    if (!child) break;
    group.remove(child);
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose?.();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((m: any) => m?.dispose?.());
  }
}

function buildAxisCylinderManifold(
  api: ManifoldApi,
  center: THREE.Vector3,
  axisDir: THREE.Vector3,
  length: number,
  radius: number,
  sides: number
): any | null {
  const len = Number(length ?? 0);
  if (!Number.isFinite(len) || len < STOCK_BOOLEAN_MIN_SEG_LEN) return null;
  const dir = axisDir.clone();
  if (dir.lengthSq() < 1e-10) return null;
  dir.normalize();
  const r = Math.max(0.1, Number(radius || 0.1));
  const sideCount = Math.max(3, Math.min(64, Math.round(Number(sides) || STOCK_BOOLEAN_CUTTER_SIDES_DEFAULT)));
  const cyl = api.Manifold.cylinder(len, r, r, sideCount, true);
  const baseAxis = getManifoldCylinderAxis(api);
  const q = new THREE.Quaternion().setFromUnitVectors(baseAxis, dir);
  const m = new THREE.Matrix4().compose(center, q, new THREE.Vector3(1, 1, 1));
  return cyl.transform(
    m.elements as unknown as [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number]
  );
}

function buildSegmentCutterManifold(
  api: ManifoldApi,
  a: THREE.Vector3,
  b: THREE.Vector3,
  toolAxis: THREE.Vector3,
  sides: number,
  fallbackRadius: number,
  profile?: ToolVisualProfile,
  cutLenOverride?: number,
  cutRadiusOverride?: number,
  cutBandMinOverride?: number,
  cutBandMaxOverride?: number
): any | null {
  const axis = toolAxis.clone().normalize();
  const fallbackR = Math.max(0.2, Number((cutRadiusOverride ?? fallbackRadius) || 0.2));

  // Conservative cut envelope from tool profile:
  // - radius = max radius of any CUT segment (stable, no weird bulges)
  // - length = sum of CUT segment lengths
  const segs = [
    {
      len: Number(profile?.l1 ?? 0),
      rTop: Math.max(0.2, Number(profile?.d1Top ?? profile?.d1 ?? fallbackR * 2) * 0.5),
      rBottom: Math.max(0.2, Number(profile?.d1Bottom ?? profile?.d1 ?? fallbackR * 2) * 0.5),
      cut: profile?.g1Cut ?? true,
    },
    {
      len: Number(profile?.l2 ?? 0),
      rTop: Math.max(0.2, Number(profile?.d2Top ?? profile?.d2 ?? fallbackR * 2) * 0.5),
      rBottom: Math.max(0.2, Number(profile?.d2Bottom ?? profile?.d2 ?? fallbackR * 2) * 0.5),
      cut: profile?.g2Cut ?? false,
    },
    {
      len: Number(profile?.l3 ?? 0),
      rTop: Math.max(0.2, Number(profile?.d3Top ?? profile?.d3 ?? fallbackR * 2) * 0.5),
      rBottom: Math.max(0.2, Number(profile?.d3Bottom ?? profile?.d3 ?? fallbackR * 2) * 0.5),
      cut: profile?.g3Cut ?? false,
    },
  ];

  let cutLen = 0;
  let cutRadius = fallbackR;
  for (const s of segs) {
    if (!s.cut) continue;
    const l = Math.max(0, Number(s.len || 0));
    if (l <= 1e-6) continue;
    cutLen += l;
    cutRadius = Math.max(cutRadius, s.rTop, s.rBottom);
  }
  if (cutLen <= 1e-6) {
    cutLen = Math.max(0, Number(profile?.l1 ?? 0));
  }
  if (Number.isFinite(Number(cutLenOverride)) && Number(cutLenOverride) > 1e-6) {
    cutLen = Math.max(cutLen, Number(cutLenOverride));
  }
  cutRadius = Math.max(0.2, cutRadius);
  if (Number.isFinite(Number(cutRadiusOverride)) && Number(cutRadiusOverride) > 1e-6) {
    cutRadius = Math.max(cutRadius, Number(cutRadiusOverride));
  }
  let cutBandMin = -cutLen;
  let cutBandMax = 0;
  if (
    Number.isFinite(Number(cutBandMinOverride))
    && Number.isFinite(Number(cutBandMaxOverride))
  ) {
    const b0 = Number(cutBandMinOverride);
    const b1 = Number(cutBandMaxOverride);
    if (Math.abs(b1 - b0) > 1e-6) {
      cutBandMin = Math.min(b0, b1);
      cutBandMax = Math.max(b0, b1);
    }
  }
  const cutterLen = Math.max(STOCK_BOOLEAN_MIN_SEG_LEN, cutBandMax - cutBandMin);
  const cutterCenterOffset = (cutBandMin + cutBandMax) * 0.5;

  const move = new THREE.Vector3().subVectors(b, a);
  const moveLen = move.length();
  if (!Number.isFinite(moveLen) || moveLen < STOCK_BOOLEAN_MIN_SEG_LEN) return null;
  const moveDir = move.clone().normalize();
  const parallel = Math.abs(moveDir.dot(axis)) > 0.95;

  // If plunge/retract (motion parallel to tool axis), use one clean cylinder
  // across full axis span of [tip..tip-cutLen] over the move.
  if (parallel) {
    const a0 = a.clone().addScaledVector(axis, cutBandMin);
    const a1 = a.clone().addScaledVector(axis, cutBandMax);
    const b0 = b.clone().addScaledVector(axis, cutBandMin);
    const b1 = b.clone().addScaledVector(axis, cutBandMax);
    const vals = [a0, a1, b0, b1].map((p) => p.dot(axis));
    const tMin = Math.min(...vals);
    const tMax = Math.max(...vals);
    const length = Math.max(STOCK_BOOLEAN_MIN_SEG_LEN, tMax - tMin);
    const ortho = a.clone().sub(axis.clone().multiplyScalar(a.dot(axis)));
    const center = ortho.add(axis.clone().multiplyScalar((tMin + tMax) * 0.5));
    return buildAxisCylinderManifold(api, center, axis, length, cutRadius, sides);
  }

  // General linear move:
  // Sweep axis-aligned cutting cylinders along the segment (stable and robust).
  const minStep = Math.max(0.12, cutRadius * 0.2);
  const steps = Math.max(1, Math.min(40, Math.ceil(moveLen / minStep)));
  let out: any | null = null;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const p = a.clone().lerp(b, t);
    const c = p.clone().addScaledVector(axis, cutterCenterOffset);
    const seg = buildAxisCylinderManifold(api, c, axis, cutterLen, cutRadius, sides);
    if (!seg) continue;
    if (!out) {
      out = seg;
      continue;
    }
    const next = out.add(seg);
    out.delete?.();
    seg.delete?.();
    out = next;
  }
  return out;
}

function mkPath(
  scene: THREE.Scene,
  color: number,
  opts: { dashed?: boolean; opacity?: number; dashSize?: number; gapSize?: number } = {}
) {
  const positions = new Float32Array(TOOL_PATH_MAX * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setDrawRange(0, 0);
  const material = opts.dashed
    ? new THREE.LineDashedMaterial({
        color,
        transparent: true,
        opacity: opts.opacity ?? 0.62,
        dashSize: opts.dashSize ?? 4,
        gapSize: opts.gapSize ?? 3,
      })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity: opts.opacity ?? 0.65 });
  const line = new THREE.Line(geo, material);
  line.userData.pickIgnore = true;
  // Dynamic line bounds can become stale with drawRange updates; keep always renderable.
  line.frustumCulled = false;
  if (opts.dashed) line.computeLineDistances();
  scene.add(line);
  return { geo, positions, line, count: 0, last: null as THREE.Vector3 | null };
}

function recordPath(path: ReturnType<typeof mkPath>, pos: THREE.Vector3, force = false) {
  if (!force && path.last && pos.distanceTo(path.last) < 0.4) return;
  const idx = (path.count % TOOL_PATH_MAX) * 3;
  path.positions[idx]     = pos.x;
  path.positions[idx + 1] = pos.y;
  path.positions[idx + 2] = pos.z;
  path.count++;
  path.geo.setDrawRange(0, Math.min(path.count, TOOL_PATH_MAX));
  (path.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  if (path.line.material instanceof THREE.LineDashedMaterial) {
    path.line.computeLineDistances();
  }
  path.last = pos.clone();
}

function setStaticPath(line: THREE.Line, pts: Array<{ x: number; y: number; z: number }>) {
  if (!Array.isArray(pts) || pts.length === 0) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    geo.setDrawRange(0, 0);
    if (line.geometry) line.geometry.dispose();
    (line as any).geometry = geo;
    if (line.material instanceof THREE.LineDashedMaterial) line.computeLineDistances();
    return;
  }

  const sampled: Array<{ x: number; y: number; z: number }> = [];
  const stride = Math.max(1, Math.ceil(pts.length / LIVE_PREVIEW_MAX_POINTS));
  const minDist2 = LIVE_PREVIEW_MIN_DIST * LIVE_PREVIEW_MIN_DIST;
  let last: { x: number; y: number; z: number } | null = null;
  for (let i = 0; i < pts.length; i += stride) {
    const p = pts[i];
    if (!last) {
      sampled.push(p);
      last = p;
      continue;
    }
    const dx = p.x - last.x;
    const dy = p.y - last.y;
    const dz = p.z - last.z;
    if ((dx * dx + dy * dy + dz * dz) >= minDist2) {
      sampled.push(p);
      last = p;
    }
  }
  const tail = pts[pts.length - 1];
  if (!last || tail.x !== last.x || tail.y !== last.y || tail.z !== last.z) {
    sampled.push(tail);
  }

  const used = sampled.length;
  const pos = new Float32Array(Math.max(used, 2) * 3);
  for (let i = 0; i < used; i++) {
    const p = sampled[i];
    pos[i * 3] = p.x;
    pos[i * 3 + 1] = p.y;
    pos[i * 3 + 2] = p.z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setDrawRange(0, used);
  if (line.geometry) {
    line.geometry.dispose();
  }
  (line as any).geometry = geo;
  if (line.material instanceof THREE.LineDashedMaterial) {
    line.computeLineDistances();
  }
}

function axisInvertFromState(axes: any[], axisName: string): number {
  const ax = axes.find((a) => a?.physical_name === axisName);
  return ax?.invert ? -1 : 1;
}

function stepFaceVector(face: StepFace, axes: any[]): THREE.Vector3 {
  // Machine axis convention:
  // +X -> scene +X, +Y -> scene -Z, +Z -> scene +Y
  // with optional axis invert from machine config.
  const invX = axisInvertFromState(axes, 'X');
  const invY = axisInvertFromState(axes, 'Y');
  const invZ = axisInvertFromState(axes, 'Z');
  switch (face) {
    case '+X': return new THREE.Vector3(invX, 0, 0);
    case '-X': return new THREE.Vector3(-invX, 0, 0);
    case '+Y': return new THREE.Vector3(0, 0, -invY);
    case '-Y': return new THREE.Vector3(0, 0, invY);
    case '+Z': return new THREE.Vector3(0, invZ, 0);
    case '-Z': return new THREE.Vector3(0, -invZ, 0);
    default: return new THREE.Vector3(0, invZ, 0);
  }
}

function normalToStepFace(normal: THREE.Vector3, axes: any[]): StepFace {
  // Convert scene-normal back to machine-axis components.
  const n = normal.clone().normalize();
  const invX = axisInvertFromState(axes, 'X');
  const invY = axisInvertFromState(axes, 'Y');
  const invZ = axisInvertFromState(axes, 'Z');
  const mX = n.x * invX;
  const mY = -n.z * invY;
  const mZ = n.y * invZ;
  const ax = Math.abs(mX);
  const ay = Math.abs(mY);
  const az = Math.abs(mZ);
  if (ax >= ay && ax >= az) return mX >= 0 ? '+X' : '-X';
  if (ay >= ax && ay >= az) return mY >= 0 ? '+Y' : '-Y';
  return mZ >= 0 ? '+Z' : '-Z';
}

function updateToolControlPointMarker(
  marker: THREE.Mesh,
  motion: number,
  toolRadius: number,
  rapidHex: string,
  feedHex: string
) {
  const mat = marker.material as THREE.MeshStandardMaterial;
  const rapid = parseHexColor(rapidHex, '#fbbf24');
  const feed = parseHexColor(feedHex, '#22c55e');
  const useFeed = motion !== 0;
  const c = useFeed ? feed : rapid;
  mat.color.copy(c);
  mat.emissive.copy(c).multiplyScalar(useFeed ? 0.2 : 0.3);
  mat.emissiveIntensity = useFeed ? 0.55 : 0.65;
  const s = THREE.MathUtils.clamp(0.9 + toolRadius * 0.12, 0.9, 2.4);
  marker.scale.setScalar(s);
}

// ─── Gizmo (Transform Control) ────────────────────────────────────────────────
interface Gizmo {
  group: THREE.Group;
  arrowX: THREE.Group;
  arrowY: THREE.Group;
  arrowZ: THREE.Group;
  draggedAxis: 'X' | 'Y' | 'Z' | null;
}

function gizmoScreenScale(camera: THREE.PerspectiveCamera, worldPos: THREE.Vector3): number {
  const dist = camera.position.distanceTo(worldPos);
  return THREE.MathUtils.clamp(dist / 260, 0.35, 4.5);
}

// ─── Small gizmo for offset editing (minimal version) ─────────────────────────
function buildSmallGizmo(position: THREE.Vector3): Gizmo {
  const group = new THREE.Group();
  group.position.copy(position);

  // Create tiny arrow for offset editor
  const createSmallArrow = (threeDir: THREE.Vector3, color: number) => {
    const arrowGroup = new THREE.Group();
    const length = 15; // Much smaller than full gizmo
    
    // Thin line 
    const lineMat = new THREE.LineBasicMaterial({ color });
    const endPos = new THREE.Vector3().copy(threeDir).multiplyScalar(length);
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      endPos
    ]);
    const line = new THREE.Line(lineGeo, lineMat);
    arrowGroup.add(line);
    
    // Small cone
    const coneMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3 });
    const coneGeo = new THREE.ConeGeometry(2, 6, 6);
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.copy(endPos);
    
    const coneUp = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3().copy(threeDir).normalize();
    const axis = new THREE.Vector3().crossVectors(coneUp, dir).normalize();
    const angle = Math.acos(coneUp.dot(dir));
    if (axis.length() > 0.001) {
      cone.quaternion.setFromAxisAngle(axis, angle);
    }
    
    arrowGroup.add(cone);
    return arrowGroup;
  };

  const arrowX = createSmallArrow(new THREE.Vector3(1, 0, 0), 0xff4444);
  const arrowY = createSmallArrow(new THREE.Vector3(0, 0, -1), 0x44ff44);
  const arrowZ = createSmallArrow(new THREE.Vector3(0, 1, 0), 0x4444ff);

  // Also add a small center sphere to show exact work offset point
  const sphereGeo = new THREE.SphereGeometry(2, 8, 8);
  const sphereMat = new THREE.MeshStandardMaterial({ color: 0xffff88, emissive: 0xffff88, emissiveIntensity: 0.5 });
  const sphere = new THREE.Mesh(sphereGeo, sphereMat);
  group.add(sphere);

  group.add(arrowX);
  group.add(arrowY);
  group.add(arrowZ);

  return { group, arrowX, arrowY, arrowZ, draggedAxis: null };
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface MachineViewProps {
  state: any;
  configVersion?: number;
  configAxes?: any[]; // Machine config axes with invert flags
  spindleDiameter?: number;
  spindleLength?: number;
  spindleNoseDiameter?: number;
  spindleNoseLength?: number;
  spindleCapDiameter?: number;
  spindleCapLength?: number;
  spindleUp?: boolean;
  spindleAxis?: '+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z';
  spindleOffsetX?: number;
  spindleOffsetY?: number;
  spindleOffsetZ?: number;
  spindleRotX?: number;
  spindleRotY?: number;
  spindleRotZ?: number;
  stockConfig?: StockConfig;
  showScene3d?: boolean;
  showMachineModel?: boolean;
  showToolModel?: boolean;
  showStockModel?: boolean;
  toolVisualProfile?: ToolVisualProfile;
  wcsReferenceVisual?: 'off' | 'dot' | 'gizmo';
  mcsReferenceVisual?: 'off' | 'dot' | 'gizmo';
  showToolControlPoint?: boolean;
  showSpindlePoint?: boolean;
  showProgramPath?: boolean;
  showToolPath?: boolean;
  showSpindlePath?: boolean;
  sceneConfig?: SceneSetupConfig;
  onPickPosition?: (position: THREE.Vector3, axisId: number) => void;
  pickingAxisId?: number | null;
  pickedValue?: number;
  pathResetNonce?: number;
  stockResetNonce?: number;
  livePreviewEnabled?: boolean;
  previewPath?: PreviewPathData | null;
  channelCode?: string;
  onPerfUpdate?: (perf: { renderFps: number; motionActive: boolean; idleIntervalMs: number }) => void;
  onCollisionAlarm?: (message: string) => void;
}

// Helper to dispose all geometries and materials in a scene
function disposeScene(scene: THREE.Scene) {
  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    }


  
    if (obj instanceof THREE.Line) {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    }
  });
}

export default function MachineView({
  state,
  configVersion = 0,
  configAxes,
  spindleDiameter = DEFAULT_SPINDLE_DIAMETER,
  spindleLength = DEFAULT_SPINDLE_LENGTH,
  spindleNoseDiameter = DEFAULT_SPINDLE_NOSE_DIAMETER,
  spindleNoseLength = DEFAULT_SPINDLE_NOSE_LENGTH,
  spindleCapDiameter = DEFAULT_SPINDLE_CAP_DIAMETER,
  spindleCapLength = DEFAULT_SPINDLE_CAP_LENGTH,
  spindleUp = true,
  spindleAxis,
  spindleOffsetX = 0,
  spindleOffsetY = 0,
  spindleOffsetZ = 0,
  spindleRotX = 0,
  spindleRotY = 0,
  spindleRotZ = 0,
  stockConfig = { shape: 'box', size: { x: 40, y: 40, z: 40 }, position: { x: 0, y: 0, z: 20 }, mount: 'table', color: '#3b82f6', opacity: 0.92 },
  showScene3d = true,
  showMachineModel = true,
  showToolModel = true,
  showStockModel = true,
  toolVisualProfile = DEFAULT_TOOL_VISUAL,
  wcsReferenceVisual = 'gizmo',
  mcsReferenceVisual = 'off',
  showToolControlPoint = false,
  showSpindlePoint = false,
  showProgramPath = true,
  showToolPath = true,
  showSpindlePath = false,
  sceneConfig = DEFAULT_SCENE_CONFIG,
  onPickPosition,
  pickingAxisId,
  pickedValue,
  pathResetNonce = 0,
  stockResetNonce = 0,
  livePreviewEnabled = false,
  previewPath = null,
  channelCode = '',
  onPerfUpdate,
  onCollisionAlarm,
}: MachineViewProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<any>(null);
  const onPickPositionRef = useRef(onPickPosition);
  const onPerfUpdateRef = useRef(onPerfUpdate);
  const onCollisionAlarmRef = useRef(onCollisionAlarm);
  const stepPreviewEventRef = useRef<StepPreviewEventDetail>({ enabled: false });
  const gridVisualSigRef = useRef('');
  const gridGeomSigRef = useRef('');
  const sceneVisualSigRef = useRef('');
  const stateUpdateSigRef = useRef('');
  const sceneConfigRef = useRef(sceneConfig);
  const lastToolVisualProfileRef = useRef<ToolVisualProfile | null>(null);
  const lastToolVisualRuntimeRef = useRef<{ toolRadius: number; toolLength: number }>({
    toolRadius: Number.NaN,
    toolLength: Number.NaN,
  });
  const [stepFacePickEnabled, setStepFacePickEnabled] = useState(false);
  const codeLinesUpper = useMemo(
    () => channelCode.split('\n').map((l) => l.trim().toUpperCase()),
    [channelCode]
  );
  const motionByLine = useMemo(() => {
    const out: number[] = [];
    let modalMotion = 0; // 0=rapid, 1=feed/arc
    for (let i = 0; i < codeLinesUpper.length; i += 1) {
      const line = codeLinesUpper[i] ?? '';
      if (/\bG0\b|\bG00\b/.test(line)) modalMotion = 0;
      if (/\bG1\b|\bG01\b|\bG2\b|\bG02\b|\bG3\b|\bG03\b/.test(line)) modalMotion = 1;
      out[i] = modalMotion;
    }
    return out;
  }, [codeLinesUpper]);

  const getConfigAxis = (axisName: string): any | undefined => {
    const key = String(axisName || '').toUpperCase();
    return configAxes?.find((ca: any) =>
      String(ca?.physical_name ?? ca?.name ?? '').toUpperCase() === key
    );
  };

  useEffect(() => {
    sceneConfigRef.current = sceneConfig;
  }, [sceneConfig]);

  // Keep callback refs in sync
  useEffect(() => {
    onPickPositionRef.current = onPickPosition;
  }, [onPickPosition]);

  useEffect(() => {
    onPerfUpdateRef.current = onPerfUpdate;
  }, [onPerfUpdate]);

  useEffect(() => {
    onCollisionAlarmRef.current = onCollisionAlarm;
  }, [onCollisionAlarm]);

  useEffect(() => {
    const onStepPreview = (ev: Event) => {
      const detail = (ev as CustomEvent<StepPreviewEventDetail>).detail;
      stepPreviewEventRef.current = detail ?? { enabled: false };
      const r = sceneRef.current;
      r?.setStepPreview?.(stepPreviewEventRef.current);
    };
    window.addEventListener('vmill:step-preview', onStepPreview as EventListener);
    return () => {
      window.removeEventListener('vmill:step-preview', onStepPreview as EventListener);
    };
  }, []);

  useEffect(() => {
    const onStepFacePickMode = (ev: Event) => {
      const detail = (ev as CustomEvent<{ enabled?: boolean }>).detail;
      setStepFacePickEnabled(!!detail?.enabled);
    };
    window.addEventListener('vmill:step-face-pick', onStepFacePickMode as EventListener);
    return () => {
      window.removeEventListener('vmill:step-face-pick', onStepFacePickMode as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!mountRef.current || !state?.axes?.length) return;
    const mount = mountRef.current;
    const axes: any[] = state.axes;

    // Teardown previous scene completely before creating a new one
    if (sceneRef.current) {
      const old = sceneRef.current;
      cancelAnimationFrame(old.rafId);
      old.ro.disconnect();
      old.controls.dispose();
      disposeScene(old.scene);
      
      // Remove canvas from DOM first
      if (mount.contains(old.renderer.domElement)) {
        mount.removeChild(old.renderer.domElement);
      }
      
      // Then dispose renderer (releases WebGL context)
      old.renderer.dispose();
      sceneRef.current = null;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(sceneConfig.backgroundColor);

    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / mount.clientHeight, 0.1, 3000);
    camera.position.set(300, 250, 350);

    const renderer = new THREE.WebGLRenderer({
      antialias: !!sceneConfig.antiAliasing,
      powerPreference: 'high-performance',
    });
    // Render scale tuned for smooth interaction on heavy scenes.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 0.75));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = !!sceneConfig.shadowsEnabled;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    mount.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, sceneConfig.ambientIntensity);
    scene.add(ambientLight);
    const keyLight = new THREE.DirectionalLight(0xffffff, sceneConfig.keyIntensity);
    keyLight.position.set(200, 400, 200);
    keyLight.castShadow = !!sceneConfig.shadowsEnabled;
    keyLight.shadow.mapSize.set(2048, 2048);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xffd0aa, sceneConfig.fillIntensity);
    fillLight.position.set(-200, 100, -100);
    scene.add(fillLight);
    const floorLight = new THREE.PointLight(0x4488ff, sceneConfig.floorIntensity, 600);
    floorLight.position.set(0, -30, 0);
    scene.add(floorLight);

    const machineStaticGroup = new THREE.Group();
    scene.add(machineStaticGroup);
    const machineMotionGroup = new THREE.Group();
    scene.add(machineMotionGroup);

    const grid = new THREE.GridHelper(
      Math.max(100, Number(sceneConfig.gridSize ?? 1000)),
      Math.max(2, Math.round(Number(sceneConfig.gridDivisions ?? 50))),
      sceneConfig.gridMajorColor,
      sceneConfig.gridMinorColor
    );
    const gridMats = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const gm of gridMats) {
      gm.transparent = true;
      gm.opacity = THREE.MathUtils.clamp(Number(sceneConfig.gridOpacity ?? 0.1), 0, 1);
      gm.needsUpdate = true;
    }
    grid.userData.pickIgnore = true;
    grid.position.y = -0.5;
    machineStaticGroup.add(grid);
    const axisHelper = new THREE.AxesHelper(70);
    axisHelper.userData.pickIgnore = true;
    axisHelper.position.set(-250, 0, -200);
    axisHelper.visible = !!sceneConfig.showSceneAxes;
    machineStaticGroup.add(axisHelper);

    const { frameH } = buildFrame(machineStaticGroup, axes);

    // Channel 1: X → Y → Z → spindle
    const ch1X = new THREE.Group();
    const ch1Y = new THREE.Group();
    const ch1Z = new THREE.Group();
    const spindleBuild = buildSpindle(
      spindleDiameter,
      spindleLength,
      spindleNoseDiameter,
      spindleNoseLength,
      spindleCapDiameter,
      spindleCapLength
    );
    const spindle = spindleBuild.group;
    // Spindle offset/rotation inputs are in MACHINE coordinates:
    // X -> scene X, Y -> scene -Z, Z -> scene +Y.
    const invX = axisInvertFromState(axes, 'X');
    const invY = axisInvertFromState(axes, 'Y');
    const invZ = axisInvertFromState(axes, 'Z');
    const mx = (Number(spindleOffsetX) || 0) * invX;
    const my = (Number(spindleOffsetY) || 0) * invY;
    const mz = (Number(spindleOffsetZ) || 0) * invZ;
    spindle.position.set(mx, mz, -my);

    const rx = THREE.MathUtils.degToRad(Number(spindleRotX) || 0); // machine X -> scene X
    const ry = THREE.MathUtils.degToRad(Number(spindleRotY) || 0); // machine Y -> scene -Z
    const rz = THREE.MathUtils.degToRad(Number(spindleRotZ) || 0); // machine Z -> scene Y
    const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), rx);
    const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, -1), ry);
    const qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rz);
    const axisMode = (spindleAxis ?? (spindleUp ? '-Z' : '+Z'));
    const axisTargetScene = spindleAxisMachineToScene(axisMode);
    const qAxis = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), axisTargetScene.normalize());
    spindle.quaternion.identity();
    spindle.quaternion.multiply(qx).multiply(qy).multiply(qz).multiply(qAxis);
    ch1Z.add(spindle);
    ch1Y.add(ch1Z);
    ch1X.add(ch1Y);
    // Anchor spindle so the spindle gauge point (local Y = SPINDLE_GAUGE_Y)
    // matches scene machine coordinates directly after axis transform.
    const spindleBaseY = -SPINDLE_GAUGE_Y;
    ch1X.position.set(0, spindleBaseY, 0);
    scene.add(ch1X);

    const stepPreviewGroup = new THREE.Group();
    stepPreviewGroup.userData.pickIgnore = true;
    stepPreviewGroup.visible = false;
    spindle.add(stepPreviewGroup);
    let stepPreviewState: Required<
      Pick<
        StepPreviewEventDetail,
        'enabled' | 'showStep' | 'showParametric' | 'parametricMask' | 'parametricOpacity' | 'anchorToGauge' | 'mountFace' | 'mountOffset'
      >
    > & {
      rotationDeg: { x: number; y: number; z: number };
      offset: { x: number; y: number; z: number };
    } = {
      enabled: false,
      showStep: true,
      showParametric: true,
      parametricMask: 'all',
      parametricOpacity: 1,
      rotationDeg: { x: 0, y: 0, z: 0 },
      offset: { x: 0, y: 0, z: 0 },
      anchorToGauge: true,
      mountFace: '+Z',
      mountOffset: 0,
    };

    const clearStepPreviewGroup = () => {
      stepPreviewGroup.traverse((obj: THREE.Object3D) => {
        const anyObj = obj as any;
        if (anyObj.geometry) {
          anyObj.geometry.dispose?.();
        }
        if (anyObj.material) {
          if (Array.isArray(anyObj.material)) {
            anyObj.material.forEach((m: any) => m?.dispose?.());
          } else {
            anyObj.material.dispose?.();
          }
        }
      });
      while (stepPreviewGroup.children.length > 0) {
        stepPreviewGroup.remove(stepPreviewGroup.children[0]);
      }
      stepPreviewGroup.visible = false;
    };

    const applyStepPreviewVisualState = () => {
      const active = !!stepPreviewState.enabled;
      const showStep = !!stepPreviewState.showStep;
      const showParam = !!stepPreviewState.showParametric;
      const op = THREE.MathUtils.clamp(Number(stepPreviewState.parametricOpacity ?? 1), 0.05, 1);
      const mask = stepPreviewState.parametricMask ?? 'all';
      const showParamTool = showParam && (mask === 'all' || mask === 'tool-only');
      const showParamHolder = showParam && (mask === 'all' || mask === 'holder-only');

      stepPreviewGroup.visible = active && showStep && stepPreviewGroup.children.length > 0;

      const applyMesh = (mesh: THREE.Mesh | null | undefined, paramVisible: boolean) => {
        if (!mesh) return;
        const mat = mesh.material as THREE.MeshStandardMaterial | null | undefined;
        mesh.visible = !active || paramVisible;
        if (!mat) return;
        const baseOpacity = THREE.MathUtils.clamp(Number((mat.userData as any)?.vmillBaseOpacity ?? 1), 0, 1);
        const targetOpacity = active ? THREE.MathUtils.clamp(baseOpacity * op, 0.02, 1) : baseOpacity;
        mat.transparent = targetOpacity < 0.999;
        mat.opacity = targetOpacity;
        mat.depthWrite = targetOpacity >= 0.999;
        mat.needsUpdate = true;
      };
      applyMesh(spindleBuild.holder, showParamHolder);
      for (const seg of spindleBuild.toolSegments) applyMesh(seg, showParamTool);
    };

    const setStepPreview = (detail: StepPreviewEventDetail) => {
      const nextEnabled = !!detail?.enabled;
      stepPreviewState = {
        enabled: nextEnabled,
        showStep: detail?.showStep ?? true,
        showParametric: detail?.showParametric ?? true,
        parametricMask: detail?.parametricMask ?? 'all',
        parametricOpacity: detail?.parametricOpacity ?? 1,
        rotationDeg: {
          x: Number(detail?.rotationDeg?.x ?? 0),
          y: Number(detail?.rotationDeg?.y ?? 0),
          z: Number(detail?.rotationDeg?.z ?? 0),
        },
        offset: {
          x: Number(detail?.offset?.x ?? 0),
          y: Number(detail?.offset?.y ?? 0),
          z: Number(detail?.offset?.z ?? 0),
        },
        anchorToGauge: detail?.anchorToGauge ?? true,
        mountFace: (detail?.mountFace ?? '+Z') as StepFace,
        mountOffset: Number(detail?.mountOffset ?? 0),
      };
      if (!nextEnabled) {
        clearStepPreviewGroup();
        applyStepPreviewVisualState();
        return;
      }
      const meshes = detail?.meshes ?? null;
      if (meshes) {
        clearStepPreviewGroup();
        const raw = new THREE.Group();
        raw.userData.pickIgnore = true;
        for (const mesh of meshes) {
          const p = mesh?.positions;
          if (!p || typeof (p as any).length !== 'number') continue;
          const pos = p instanceof Float32Array ? p : Float32Array.from(p as number[]);
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
          const idx = mesh.indices;
          if (idx && typeof (idx as any).length === 'number') {
            const indexArr = idx instanceof Uint32Array ? idx : Uint32Array.from(idx as number[]);
            geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indexArr), 1));
          }
          geo.computeVertexNormals();
          const solid = new THREE.Mesh(
            geo,
            new THREE.MeshStandardMaterial({
              color: 0x38bdf8,
              emissive: new THREE.Color(0x083344),
              emissiveIntensity: 0.25,
              metalness: 0.25,
              roughness: 0.7,
              transparent: false,
              opacity: 1,
            })
          );
          solid.userData.pickIgnore = false;
          solid.userData.stepPreviewSolid = true;
          solid.userData.pickPriority = 15;
          raw.add(solid);
          const wire = new THREE.LineSegments(
            new THREE.EdgesGeometry(geo, 24),
            new THREE.LineBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.75 })
          );
          wire.userData.pickIgnore = true;
          raw.add(wire);
        }
        if (raw.children.length > 0) {
          const useMountFace = !!stepPreviewState.mountFace;
          if (useMountFace) {
            const from = stepFaceVector(stepPreviewState.mountFace, axes);
            const to = new THREE.Vector3(0, 1, 0);
            const faceAlign = new THREE.Quaternion().setFromUnitVectors(from, to);
            raw.quaternion.multiply(faceAlign);
          } else {
            const pre = new THREE.Box3().setFromObject(raw);
            const preSize = new THREE.Vector3();
            pre.getSize(preSize);
            if (preSize.x >= preSize.y && preSize.x >= preSize.z) {
              raw.rotation.z = -Math.PI * 0.5;
            } else if (preSize.z >= preSize.x && preSize.z >= preSize.y) {
              raw.rotation.x = Math.PI * 0.5;
            }
          }

          raw.rotation.x += THREE.MathUtils.degToRad(stepPreviewState.rotationDeg.x || 0);
          raw.rotation.y += THREE.MathUtils.degToRad(stepPreviewState.rotationDeg.y || 0);
          raw.rotation.z += THREE.MathUtils.degToRad(stepPreviewState.rotationDeg.z || 0);

          const box = new THREE.Box3().setFromObject(raw);
          const center = box.getCenter(new THREE.Vector3());
          const off = stepPreviewState.offset;
          const anchorY = stepPreviewState.anchorToGauge
            ? (SPINDLE_GAUGE_Y + Number(stepPreviewState.mountOffset || 0) - box.max.y)
            : 0;
          raw.position.set(
            -center.x + (off.x || 0),
            anchorY + (off.y || 0),
            -center.z + (off.z || 0)
          );
          stepPreviewGroup.add(raw);
        }
      }
      applyStepPreviewVisualState();
    };

    // Optional marker for tool control point (tool tip reference)
    const toolControlPointMaterial = new THREE.MeshStandardMaterial({
      color: parseHexColor(sceneConfig.toolPointRapidColor, '#fbbf24'),
      emissive: parseHexColor(sceneConfig.toolPointRapidColor, '#fbbf24').multiplyScalar(0.3),
      emissiveIntensity: 0.65,
      depthTest: false,
      depthWrite: false,
    });
    const toolControlPointMarker = new THREE.Mesh(
      new THREE.SphereGeometry(3.0, 12, 12),
      toolControlPointMaterial
    );
    toolControlPointMarker.userData.pickIgnore = true;
    toolControlPointMarker.renderOrder = 1000;
    toolControlPointMarker.visible = !!showToolControlPoint;
    scene.add(toolControlPointMarker);

    const spindlePointMaterial = new THREE.MeshStandardMaterial({
      color: parseHexColor(sceneConfig.spindlePointColor, '#60a5fa'),
      emissive: parseHexColor(sceneConfig.spindlePointColor, '#60a5fa').multiplyScalar(0.25),
      emissiveIntensity: 0.5,
      depthTest: false,
      depthWrite: false,
    });
    const spindlePointMarker = new THREE.Mesh(
      new THREE.SphereGeometry(2.8, 12, 12),
      spindlePointMaterial
    );
    spindlePointMarker.userData.pickIgnore = true;
    spindlePointMarker.renderOrder = 1000;
    spindlePointMarker.visible = !!showSpindlePoint;
    scene.add(spindlePointMarker);

    const machineZeroMarker = new THREE.Mesh(
      new THREE.SphereGeometry(2.2, 10, 10),
      new THREE.MeshStandardMaterial({
        color: parseHexColor(sceneConfig.mcsDotColor, '#ffffff'),
        emissive: parseHexColor(sceneConfig.mcsDotColor, '#ffffff').multiplyScalar(0.22),
        emissiveIntensity: 0.45,
      })
    );
    machineZeroMarker.userData.pickIgnore = true;
    machineZeroMarker.visible = mcsReferenceVisual === 'dot';
    scene.add(machineZeroMarker);

    const activeWcsMarker = new THREE.Mesh(
      new THREE.SphereGeometry(2.6, 10, 10),
      new THREE.MeshStandardMaterial({
        color: parseHexColor(sceneConfig.wcsDotColor, '#22d3ee'),
        emissive: parseHexColor(sceneConfig.wcsDotColor, '#22d3ee').multiplyScalar(0.22),
        emissiveIntensity: 0.55,
      })
    );
    activeWcsMarker.userData.pickIgnore = true;
    activeWcsMarker.visible = wcsReferenceVisual === 'dot';
    scene.add(activeWcsMarker);

    const machineZeroGizmo = buildSmallGizmo(new THREE.Vector3());
    markPickIgnore(machineZeroGizmo.group);
    machineZeroGizmo.group.visible = mcsReferenceVisual === 'gizmo';
    scene.add(machineZeroGizmo.group);

    const activeWcsGizmo = buildSmallGizmo(new THREE.Vector3());
    markPickIgnore(activeWcsGizmo.group);
    activeWcsGizmo.group.visible = wcsReferenceVisual === 'gizmo';
    scene.add(activeWcsGizmo.group);

    // Channel 2: Z3 -> rotary -> workpiece
    const ch2X = new THREE.Group();
    const ch2Z = new THREE.Group();
    const ch2Z3 = new THREE.Group();
    const ch2Rot = new THREE.Group();
    const workpiece = buildWorkpiece(stockConfig);
    const stockMesh =
      workpiece.children.find((c) => (c as any)?.isMesh) as THREE.Mesh | undefined;
    const stockCutterDebugGroup = new THREE.Group();
    stockCutterDebugGroup.userData.pickIgnore = true;
    stockCutterDebugGroup.renderOrder = 1200;
    const stockCollisionDebugGroup = new THREE.Group();
    stockCollisionDebugGroup.userData.pickIgnore = true;
    stockCollisionDebugGroup.renderOrder = 1210;
    const stockMountMode = stockConfig.mount === 'spindle' ? 'spindle' : 'table';
    const stockMountParent = stockMountMode === 'spindle' ? spindle : ch2Rot;
    stockMountParent.add(workpiece);
    stockMountParent.add(stockCutterDebugGroup);
    stockMountParent.add(stockCollisionDebugGroup);
    ch2Z3.add(ch2Rot);
    ch2Z3.position.set(0, 8, 0);
    ch2Z.add(ch2Z3);
    ch2X.add(ch2Z);
    machineMotionGroup.add(ch2X);

    applyReflectionProfile(scene, !!sceneConfig.reflectionsEnabled);
    applyShadowProfile(renderer, scene, keyLight, !!sceneConfig.shadowsEnabled);

    const machineModelVisible = !!showScene3d && !!showMachineModel;
    const toolModelVisible = !!showScene3d && !!showToolModel;
    const stockModelVisible = !!showScene3d && !!showStockModel;
    const stockMountedToSpindle = stockConfig.mount === 'spindle';
    machineStaticGroup.visible = machineModelVisible;
    machineMotionGroup.visible = machineModelVisible || stockModelVisible;
    if (stockMesh) stockMesh.visible = stockModelVisible;
    ch1X.visible = toolModelVisible || stockMountedToSpindle;

    const path1 = mkPath(scene, 0x22d3ee, { opacity: 0.68 }); // tool control point feed
    const path1Rapid = mkPath(scene, 0x67e8f9, { dashed: true, opacity: 0.52 }); // tool control point rapid
    const path2 = mkPath(scene, 0x60a5fa, { opacity: 0.68 }); // spindle feed
    const path2Rapid = mkPath(scene, 0x93c5fd, { dashed: true, opacity: 0.52 }); // spindle rapid
    const pathProgram = mkPath(scene, 0xf59e0b, { opacity: 0.72 }); // programmed contour feed
    const pathProgramRapid = mkPath(scene, 0xfcd34d, { dashed: true, opacity: 0.58 }); // programmed contour rapid
    const pathLeadIn = mkPath(scene, 0x22c55e, { opacity: 0.8 }); // lead-in blocks (G41/G42)
    const pathLeadOut = mkPath(scene, 0xec4899, { opacity: 0.82 }); // lead-out blocks (G40)
    path1.line.visible = !!showToolPath;
    path1Rapid.line.visible = !!showToolPath;
    path2.line.visible = !!showSpindlePath;
    path2Rapid.line.visible = !!showSpindlePath;
    pathProgram.line.visible = !!showProgramPath;
    pathProgramRapid.line.visible = !!showProgramPath;
    pathLeadIn.line.visible = !!showToolPath;
    pathLeadOut.line.visible = !!showToolPath;

    const previewProgram = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.25 })
    );
    const previewProgramRapid = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({ color: 0xfcd34d, transparent: true, opacity: 0.36, dashSize: 3.5, gapSize: 2.5 })
    );
    const previewTcp = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.22 })
    );
    const previewTcpRapid = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.34, dashSize: 3.5, gapSize: 2.5 })
    );
    const previewSpindle = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.22 })
    );
    const previewSpindleRapid = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({ color: 0x93c5fd, transparent: true, opacity: 0.34, dashSize: 3.5, gapSize: 2.5 })
    );
    const previewLeadIn = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.4 })
    );
    const previewLeadOut = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xec4899, transparent: true, opacity: 0.45 })
    );
    [previewProgram, previewProgramRapid, previewTcp, previewTcpRapid, previewSpindle, previewSpindleRapid, previewLeadIn, previewLeadOut].forEach((l) => {
      l.userData.pickIgnore = true;
      l.frustumCulled = false;
      scene.add(l);
    });

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.dampingFactor = 0;
    controls.enableRotate = true;
    controls.enableZoom = true;
    controls.enablePan = true;
    controls.target.set(0, 80, 0);
    controls.minDistance = 60;
    controls.maxDistance = 1400;
    // Keep orbit fully free around the target (both horizontal and vertical).
    controls.minAzimuthAngle = -Infinity;
    controls.maxAzimuthAngle = Infinity;
    controls.minPolarAngle = 0.001;
    controls.maxPolarAngle = Math.PI - 0.001;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };

    // ── Click picking for offsets ──────────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    
    // Track mouse position for click detection (to distinguish from drag)
    let mouseDownPos = { x: 0, y: 0 };
    const ro = new ResizeObserver(() => {
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      if (sceneRef.current) sceneRef.current.needsRender = true;
    });
    ro.observe(mount);

    let rafId = 0;
    let lastRenderAt = 0;
    let fpsFrames = 0;
    let fpsLast = performance.now();
    let lastMotionActive = false;
    const IDLE_RENDER_INTERVAL_MS = 16;
    const gizmoTmp = new THREE.Vector3();
    const updateGizmoScale = (g: Gizmo | null | undefined) => {
      if (!g) return;
      g.group.getWorldPosition(gizmoTmp);
      const s = gizmoScreenScale(camera, gizmoTmp) * THREE.MathUtils.clamp(sceneConfigRef.current.gizmoScale || 1, 0.25, 4);
      g.group.scale.setScalar(s);
    };
    const markRenderNeeded = () => {
      if (sceneRef.current) sceneRef.current.needsRender = true;
    };
    controls.addEventListener('start', markRenderNeeded);
    controls.addEventListener('change', markRenderNeeded);
    controls.addEventListener('end', markRenderNeeded);

    const animate = (t = 0) => {
      rafId = requestAnimationFrame(animate);
      const controlsChanged = (controls.enableDamping || controls.autoRotate)
        ? !!(controls as any).update?.()
        : false;
      const r = sceneRef.current;
      if (!r) return;
      if (controlsChanged) r.needsRender = true;

      const st = r.state;
      const hasAxisDelta = !!st?.axes?.some((ax: any) => (
        Math.abs(Number(ax.position ?? 0) - Number(ax.target ?? 0)) > 1e-4
      ));
      const motionActive =
        !!st?.is_homing
        || !!st?.channels?.some((ch: any) => ch.is_running)
        || hasAxisDelta;
      lastMotionActive = motionActive;
      const minInterval = motionActive ? 0 : IDLE_RENDER_INTERVAL_MS;
      if (!r.needsRender && (t - lastRenderAt) < minInterval) return;

      updateGizmoScale(machineZeroGizmo);
      updateGizmoScale(activeWcsGizmo);
      updateGizmoScale(r.gizmo);
      renderer.render(scene, camera);
      fpsFrames += 1;
      if ((t - fpsLast) >= 500) {
        const renderFps = Math.round((fpsFrames * 1000) / Math.max(1, t - fpsLast));
        onPerfUpdateRef.current?.({
          renderFps,
          motionActive: lastMotionActive,
          idleIntervalMs: IDLE_RENDER_INTERVAL_MS,
        });
        fpsFrames = 0;
        fpsLast = t;
      }
      r.needsRender = false;
      lastRenderAt = t;
    };
    animate();

    sceneRef.current = {
      renderer, scene, camera, controls, ro, rafId,
      ambientLight, keyLight, fillLight, floorLight, grid, axisHelper,
      machineStaticGroup, machineMotionGroup,
      ch1X, ch1Y, ch1Z, spindle, spindleBodyGroup: spindleBuild.bodyGroup, spindleToolingGroup: spindleBuild.toolingGroup, spindleHolder: spindleBuild.holder, spindleToolSegments: spindleBuild.toolSegments, spindleTipLight: spindleBuild.tipLight,
      toolControlPointMarker, spindlePointMarker, machineZeroMarker, activeWcsMarker, machineZeroGizmo, activeWcsGizmo,
      ch2X, ch2Z, ch2Z3, ch2Rot,
      path1, path1Rapid, path2, path2Rapid, pathProgram, pathProgramRapid, pathLeadIn, pathLeadOut, frameH,
      previewProgram, previewProgramRapid, previewTcp, previewTcpRapid, previewSpindle, previewSpindleRapid, previewLeadIn, previewLeadOut,
      stepPreviewGroup, setStepPreview, applyStepPreviewVisualState,
      spindleBaseY,
      mount, raycaster, mouse,
      mouseDownPos,
      needsRender: true,
      lastActivePc: Number(state?.channels?.[0]?.active_pc ?? -1),
      leadInActivePrev: false,
      leadOutActivePrev: false,
      state,
      stockMesh: stockMesh ?? null as THREE.Mesh | null,
      stockGhostMesh: null as THREE.Mesh | null,
      stockCutterDebugGroup: stockCutterDebugGroup ?? null as THREE.Group | null,
      stockCollisionDebugGroup: stockCollisionDebugGroup ?? null as THREE.Group | null,
      stockBoolean: {
        enabled: sceneConfig.stockBooleanEngine === 'manifold',
        api: null as ManifoldApi | null,
        solid: null as any,
        busy: false,
        lastApplyAt: 0,
        lastCollisionAt: 0,
        lastPoint: null as THREE.Vector3 | null,
        lastCollisionPoint: null as THREE.Vector3 | null,
        lastCutKey: '',
        collisionLatched: false,
        initToken: `${Date.now()}_${Math.random()}`,
      },
      wcsFollowLocal: null as THREE.Vector3 | null,
      wcsFollowOffsetSig: '',
    };
    sceneRef.current.setStepPreview?.(stepPreviewEventRef.current);
    if (sceneRef.current.stockBoolean?.enabled && sceneRef.current.stockMesh) {
      const token = sceneRef.current.stockBoolean.initToken;
      void (async () => {
        const api = await getManifoldApi();
        const r = sceneRef.current;
        if (!r || !r.stockBoolean || r.stockBoolean.initToken !== token || !api) return;
        try {
          r.stockBoolean.api = api;
          r.stockBoolean.solid = buildStockManifold(api, stockConfig);
          r.stockBoolean.lastPoint = null;
          r.stockBoolean.lastCollisionPoint = null;
          r.stockBoolean.lastCutKey = '';
          r.stockBoolean.collisionLatched = false;
          clearGroupMeshes(r.stockCollisionDebugGroup);
          // Manifold solid is authored in world coordinates.
          // Keep mesh transform identity to avoid double-offset against stockConfig position.
          if (r.stockMesh) {
            const initGeo = manifoldToThreeGeometry(r.stockBoolean.solid);
            r.stockMesh.geometry?.dispose?.();
            r.stockMesh.geometry = initGeo;
            r.stockMesh.position.set(0, 0, 0);
            r.stockMesh.rotation.set(0, 0, 0);
            r.stockMesh.scale.set(1, 1, 1);
            r.needsRender = true;
          }
        } catch (err) {
          console.warn('Failed to init Manifold stock engine.', err);
          r.stockBoolean.enabled = false;
        }
      })();
    }

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      controls.removeEventListener('start', markRenderNeeded);
      controls.removeEventListener('change', markRenderNeeded);
      controls.removeEventListener('end', markRenderNeeded);
      controls.dispose();
      disposeScene(scene);
      
      // Remove canvas from DOM first
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
      
      // Then dispose renderer
      renderer.dispose();
      sceneRef.current = null;
    };
  }, [
    configVersion,
    state?.axes?.length,
    stockConfig,
    sceneConfig.antiAliasing,
    sceneConfig.stockBooleanEngine,
    spindleDiameter,
    spindleLength,
    spindleNoseDiameter,
    spindleNoseLength,
    spindleCapDiameter,
    spindleCapLength,
    spindleUp,
    spindleAxis,
    spindleOffsetX,
    spindleOffsetY,
    spindleOffsetZ,
    spindleRotX,
    spindleRotY,
    spindleRotZ,
  ]);

  // ── Dynamically attach/detach picking listeners based on pickingAxisId ─────
  useEffect(() => {
    if (!sceneRef.current) return;
    const r = sceneRef.current;
    
    const onMouseDown = (event: MouseEvent) => {
      r.mouseDownPos.x = event.clientX;
      r.mouseDownPos.y = event.clientY;
    };

    const onMouseUp = (event: MouseEvent) => {
      // Check if mouse has moved significantly (a drag)
      const dx = event.clientX - r.mouseDownPos.x;
      const dy = event.clientY - r.mouseDownPos.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      // If within threshold, treat as a click for picking
      if (distance < 5) { // CLICK_THRESHOLD from earlier
        if ((pickingAxisId === null || pickingAxisId === undefined) && !stepFacePickEnabled) return;
        if (!(r.mount.contains(event.target as Node))) return;

        const rect = r.renderer.domElement.getBoundingClientRect();
        r.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        r.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        r.raycaster.setFromCamera(r.mouse, r.camera);
        const allIntersects = r.raycaster.intersectObjects(r.scene.children, true);

        if (stepFacePickEnabled) {
          const stepHit = allIntersects
            .filter((hit: any) => hit.object?.userData?.stepPreviewSolid)
            .sort((a: any, b: any) => a.distance - b.distance)[0];
          const localNormal = stepHit?.face?.normal as THREE.Vector3 | undefined;
          const hitObject = stepHit?.object as THREE.Object3D | undefined;
          if (localNormal && hitObject) {
            const worldNormal = localNormal
              .clone()
              .applyMatrix3(new THREE.Matrix3().getNormalMatrix(hitObject.matrixWorld))
              .normalize();
            const face = normalToStepFace(worldNormal, r.state?.axes ?? []);
            window.dispatchEvent(new CustomEvent('vmill:step-face-picked', { detail: { face } }));
            return;
          }
        }

        if (pickingAxisId === null || pickingAxisId === undefined) return;

        const intersects = allIntersects.filter(
          (hit: any) => !hit.object?.userData?.pickIgnore && !hit.object?.userData?.stepPreviewSolid
        );

        if (intersects.length > 0) {
          const sorted = intersects.sort((a: any, b: any) => {
            const pa = Number(a.object?.userData?.pickPriority ?? 0);
            const pb = Number(b.object?.userData?.pickPriority ?? 0);
            if (pb !== pa) return pb - pa;
            return a.distance - b.distance;
          });
          const point = sorted[0].point;
          const ax = r.state.axes.find((a: any) => a.id === pickingAxisId);
          
          if (ax) {
            const configAx = getConfigAxis(ax.physical_name);
            const invertSign = configAx?.invert ? -1 : 1;
            const currentMachine = ax.position ?? 0;
            let pickedMachineValue = currentMachine;

            // PICK should capture raw machine-axis value from spindle reference
            // (no G43/H compensation). W0 applies TCP/G43 logic separately.
            const toolTip = new THREE.Vector3();
            r.spindle.getWorldPosition(toolTip);
            toolTip.y += SPINDLE_GAUGE_Y;

            if (ax.physical_name === 'X') {
              const deltaWorld = point.x - toolTip.x;
              pickedMachineValue = currentMachine + deltaWorld * invertSign;
            } else if (ax.physical_name === 'Y') {
              const deltaWorld = point.z - toolTip.z;
              pickedMachineValue = currentMachine + deltaWorld * -invertSign;
            } else if (ax.physical_name === 'Z') {
              const deltaWorld = point.y - toolTip.y;
              pickedMachineValue = currentMachine + deltaWorld * invertSign;
            } else if (ax.physical_name === 'Z3') {
              const tablePos = new THREE.Vector3();
              r.ch2Z3.getWorldPosition(tablePos);
              const deltaWorld = point.z - tablePos.z;
              pickedMachineValue = currentMachine + deltaWorld * -invertSign;
            }

            onPickPositionRef.current?.({} as THREE.Vector3, Number(pickedMachineValue.toFixed(3)));
          }
        }
      }
    };

    // Only add listeners while any interactive pick mode is active.
    if ((pickingAxisId !== null && pickingAxisId !== undefined) || stepFacePickEnabled) {
      r.renderer.domElement.addEventListener('mousedown', onMouseDown);
      r.renderer.domElement.addEventListener('mouseup', onMouseUp);
    }

    return () => {
      r.renderer.domElement.removeEventListener('mousedown', onMouseDown);
      r.renderer.domElement.removeEventListener('mouseup', onMouseUp);
    };
  }, [pickingAxisId, configAxes, stepFacePickEnabled]);

  // ── State → scene update ──────────────────────────────────────────────────
  useEffect(() => {
    if (!state || !sceneRef.current) return;
    const r = sceneRef.current;
    r.state = state;
    const ch0 = state?.channels?.[0];

    // Skip expensive scene sync when nothing relevant changed.
    const axesSig = (state.axes ?? [])
      .map((ax: any) =>
        `${ax.id}:${Number(ax.position ?? 0).toFixed(4)}:${Number(ax.target ?? 0).toFixed(4)}:${ax.homed ? 1 : 0}`
      )
      .join('|');
    const activeWcsOffsets = (state.work_offsets?.[state.active_wcs ?? 0]?.offsets ?? [])
      .map((o: any) => `${Number(o.axis_id ?? 0)}:${Number(o.value ?? 0).toFixed(4)}`)
      .join('|');
    const stateSig = [
      axesSig,
      activeWcsOffsets,
      Number(state.active_wcs ?? 0),
      Number(ch0?.current_motion ?? 0),
      Number(ch0?.active_pc ?? -1),
      Number(ch0?.tool_length ?? 0).toFixed(4),
      Number(ch0?.tool_radius ?? 0).toFixed(4),
      ch0?.length_comp_active ? 1 : 0,
      Number(ch0?.cutter_comp ?? 40),
      showScene3d ? 1 : 0,
      showMachineModel ? 1 : 0,
      showToolModel ? 1 : 0,
      showStockModel ? 1 : 0,
      sceneConfig.showStockGhost ? 1 : 0,
      Number(sceneConfig.stockGhostOpacity ?? 0).toFixed(3),
      showToolPath ? 1 : 0,
      showProgramPath ? 1 : 0,
      showSpindlePath ? 1 : 0,
      livePreviewEnabled ? 1 : 0,
      showToolControlPoint ? 1 : 0,
      showSpindlePoint ? 1 : 0,
      wcsReferenceVisual,
      mcsReferenceVisual,
      sceneConfig.backgroundColor,
      sceneConfig.gridMajorColor,
      sceneConfig.gridMinorColor,
      sceneConfig.showSceneAxes ? 1 : 0,
      sceneConfig.toolPointRapidColor,
      sceneConfig.toolPointFeedColor,
      sceneConfig.spindlePointColor,
      Number(sceneConfig.gridOpacity ?? 0).toFixed(3),
      Number(sceneConfig.gridSize ?? 0),
      Number(sceneConfig.gridDivisions ?? 0),
      Number(sceneConfig.gizmoScale ?? 1).toFixed(3),
      sceneConfig.shadowsEnabled ? 1 : 0,
      sceneConfig.reflectionsEnabled ? 1 : 0,
      sceneConfig.showStockCutterDebug ? 1 : 0,
      Number(sceneConfig.stockCutterDebugOpacity ?? 0).toFixed(3),
    ].join('||');
    const axesMoving = !!state.axes?.some((ax: any) =>
      Math.abs(Number(ax.position ?? 0) - Number(ax.target ?? 0)) > 1e-4
    );
    const channelsRunning = !!state.channels?.some((ch: any) => !!ch.is_running);
    const motionActive = !!state.is_homing || channelsRunning || axesMoving;
    // Only dedupe while idle. During motion we must process every snapshot
    // to keep trail/path recording continuous.
    if (!motionActive && stateUpdateSigRef.current === stateSig) return;
    stateUpdateSigRef.current = stateSig;

    const toSceneLinear = (axisName: string, value: number): number => {
      const configAx = getConfigAxis(axisName);
      const stateAx = state.axes.find((a: any) => a.physical_name === axisName);
      const machineZero = stateAx?.machine_zero ?? configAx?.machineZero ?? 0;
      const sceneValue = value + machineZero;
      return configAx?.invert ? -sceneValue : sceneValue;
    };

    // Motion/rendering coordinates should follow machine positions directly.
    // Machine-zero anchors machine coordinates in scene space; apply it here too.
    const toSceneMotion = (axisName: string, value: number): number => {
      const configAx = getConfigAxis(axisName);
      const stateAx = state.axes.find((a: any) => a.physical_name === axisName);
      const machineZero = stateAx?.machine_zero ?? configAx?.machineZero ?? 0;
      const sceneValue = value + machineZero;
      return configAx?.invert ? -sceneValue : sceneValue;
    };

    // Raw machine axis value from core state.
    const getAxisMachine = (name: string): number => {
      const ax = state.axes.find((a: any) => a.physical_name === name);
      if (!ax) return 0;
      return Number(ax.position ?? 0);
    };

    // Rotary display value keeps direct axis units (deg), optional invert from config.
    const getRotaryDisplay = (name: string): number => {
      const raw = getAxisMachine(name);
      const configAx = getConfigAxis(name);
      return configAx?.invert ? -raw : raw;
    };

    // Resolve rotary motion by logical kinematic link (A/B/C), so custom
    // rotary axis names can still drive table rotations.
    const getLinkedRotaryDisplay = (logical: 'A' | 'B' | 'C'): number => {
      const linked = (configAxes ?? []).find((ca: any) => {
        const kind = String(ca?.kind ?? '').toLowerCase();
        const side = String(ca?.side ?? '').toLowerCase();
        const name = String(ca?.physical_name ?? ca?.name ?? '').toUpperCase();
        const link = String(ca?.linkAxis ?? '').toUpperCase();
        return kind === 'rotary' && side === 'table' && (name === logical || link === logical);
      });
      if (!linked) return getRotaryDisplay(logical);
      const axisName = String(linked?.physical_name ?? linked?.name ?? logical);
      return getRotaryDisplay(axisName);
    };

    const getOffsetByName = (axisName: string): number => {
      const ax = state.axes.find((a: any) => a.physical_name === axisName);
      if (!ax) return 0;
      const wcs = state.work_offsets?.[state.active_wcs ?? 0];
      return wcs?.offsets?.find((o: any) => o.axis_id === ax.id)?.value ?? 0;
    };

    const getProgrammedWorkByName = (axisName: string): number | null => {
      const ax = state.axes.find((a: any) => a.physical_name === axisName);
      if (!ax) return null;
      const p = ch0?.programmed_work?.find((o: any) => o.axis_id === ax.id);
      return typeof p?.value === 'number' ? p.value : null;
    };

    // Channel 1 — tool (with work offsets applied)
    // X: left/right → Three.js X
    // Y: front/back → Three.js -Z (negated in mapping)
    // Z: up/down    → Three.js Y (invert flag handles - or + up)
    // Work offsets are read from activeWcs and subtracted from position for offset visualization    
    const getAxisSide = (axisName: string): 'tool' | 'table' => {
      const cfg = getConfigAxis(axisName);
      const side = String(cfg?.side ?? '').toLowerCase();
      if (side === 'table' || side === 'tool') return side;
      if (axisName === 'A' || axisName === 'B' || axisName === 'C' || axisName === 'Z3') return 'table';
      return 'tool';
    };

    r.ch1X.position.x = 0;
    r.ch1Y.position.z = 0;
    r.ch1Z.position.y = 0;
    if (r.ch2X) r.ch2X.position.x = 0;
    if (r.ch2Z) r.ch2Z.position.y = 0;
    if (r.ch2Z3) {
      r.ch2Z3.position.y = 8;
      r.ch2Z3.position.z = 0;
    }
    if (r.ch2Rot) {
      r.ch2Rot.rotation.x = 0;
      r.ch2Rot.rotation.y = 0;
      r.ch2Rot.rotation.z = 0;
    }

    const xScene = toSceneMotion('X', getAxisMachine('X'));
    const yScene = toSceneMotion('Y', getAxisMachine('Y'));
    const zScene = toSceneMotion('Z', getAxisMachine('Z'));
    if (getAxisSide('X') === 'tool') r.ch1X.position.x = xScene;
    else if (r.ch2X) r.ch2X.position.x = -xScene;
    if (getAxisSide('Y') === 'tool') r.ch1Y.position.z = -yScene;
    else if (r.ch2Z3) r.ch2Z3.position.z = yScene;
    if (getAxisSide('Z') === 'tool') r.ch1Z.position.y = zScene;
    else if (r.ch2Z) r.ch2Z.position.y = -zScene;
    // Channel 2 table transforms must be applied before stock boolean math.
    if (getAxisSide('Z3') === 'table' && r.ch2Z3) {
      r.ch2Z3.position.z += -toSceneMotion('Z3', getAxisMachine('Z3'));
    }
    if (r.ch2Rot) {
      r.ch2Rot.rotation.x = THREE.MathUtils.degToRad(getLinkedRotaryDisplay('A'));
      r.ch2Rot.rotation.y = THREE.MathUtils.degToRad(getLinkedRotaryDisplay('B'));
      r.ch2Rot.rotation.z = THREE.MathUtils.degToRad(getLinkedRotaryDisplay('C'));
    }

    const machineModelVisible = !!showScene3d && !!showMachineModel;
    const toolModelVisible = !!showScene3d && !!showToolModel;
    const stockModelVisible = !!showScene3d && !!showStockModel;
    const stockMountedToSpindle = stockConfig.mount === 'spindle';
    const stockCutterDebugVisible = stockModelVisible && !!sceneConfig.showStockCutterDebug;
    if (r.machineStaticGroup) r.machineStaticGroup.visible = machineModelVisible;
    if (r.machineMotionGroup) r.machineMotionGroup.visible = machineModelVisible || stockModelVisible;
    if (r.stockMesh) {
      r.stockMesh.visible = stockModelVisible;
      const usingManifold = !!r.stockBoolean?.enabled;
      if (usingManifold) {
        r.stockMesh.position.set(0, 0, 0);
      } else {
        r.stockMesh.position.set(
          Number(stockConfig.position.x ?? 0),
          Number(stockConfig.position.z ?? 0),
          -Number(stockConfig.position.y ?? 0)
        );
      }
    }
    if (r.stockCutterDebugGroup) {
      r.stockCutterDebugGroup.visible = stockCutterDebugVisible;
      if (!stockCutterDebugVisible) {
        clearGroupMeshes(r.stockCutterDebugGroup);
      }
    }
    if (r.stockCollisionDebugGroup) {
      r.stockCollisionDebugGroup.visible = stockModelVisible;
      if (!stockModelVisible) {
        clearGroupMeshes(r.stockCollisionDebugGroup);
      }
    }
    const hasLoadedTool = Math.max(0, Number(ch0?.active_tool ?? 0)) > 0;
    r.ch1X.visible = !!showScene3d && (machineModelVisible || toolModelVisible || (stockModelVisible && stockMountedToSpindle));
    if (r.spindleBodyGroup) r.spindleBodyGroup.visible = machineModelVisible;
    if (r.spindleToolingGroup) r.spindleToolingGroup.visible = toolModelVisible && hasLoadedTool;
    if (r.path1?.line) r.path1.line.visible = !!livePreviewEnabled;
    if (r.path1Rapid?.line) r.path1Rapid.line.visible = !!livePreviewEnabled;
    if (r.path2?.line) r.path2.line.visible = !!showSpindlePath && !!livePreviewEnabled;
    if (r.path2Rapid?.line) r.path2Rapid.line.visible = !!showSpindlePath && !!livePreviewEnabled;
    if (r.pathProgram?.line) r.pathProgram.line.visible = !!showProgramPath && !!livePreviewEnabled;
    if (r.pathProgramRapid?.line) r.pathProgramRapid.line.visible = !!showProgramPath && !!livePreviewEnabled;
    if (r.pathLeadIn?.line) r.pathLeadIn.line.visible = !!livePreviewEnabled;
    if (r.pathLeadOut?.line) r.pathLeadOut.line.visible = !!livePreviewEnabled;
    if (r.previewTcp) r.previewTcp.visible = !!showToolPath;
    if (r.previewSpindle) r.previewSpindle.visible = !!showSpindlePath;
    if (r.previewProgram) r.previewProgram.visible = !!showProgramPath;
    if (r.previewLeadIn) r.previewLeadIn.visible = !!showToolPath;
    if (r.previewLeadOut) r.previewLeadOut.visible = !!showToolPath;

    const lengthActive = !!ch0?.length_comp_active;
    const toolLengthRegister = Math.max(0, Number(ch0?.tool_length ?? 0));
    // Control point follows G43/G49 modal state.
    const controlLength = lengthActive ? toolLengthRegister : 0;
    // Physical tool length is still used for mesh scaling below.
    const toolRadius = Math.max(0, Number(ch0?.tool_radius ?? 0));
    const motion = Number(ch0?.current_motion ?? 0);
    const tip = new THREE.Vector3();
    r.spindle.getWorldPosition(tip);
    const spindlePoint = tip.clone();
    spindlePoint.y += SPINDLE_GAUGE_Y;
    const controlPoint = spindlePoint.clone();
    const spindleQuat = new THREE.Quaternion();
    r.spindle.getWorldQuaternion(spindleQuat);
    const toolAxisWorld = new THREE.Vector3(0, -1, 0).applyQuaternion(spindleQuat).normalize();
    controlPoint.addScaledVector(toolAxisWorld, controlLength);
    const physicalToolTipPoint = new THREE.Vector3();
    if (r.spindleTipLight) {
      r.spindleTipLight.getWorldPosition(physicalToolTipPoint);
    } else {
      physicalToolTipPoint.copy(controlPoint);
    }
    const activePc = Number(ch0?.active_pc ?? -1);
    const pcChanged = activePc !== Number(r.lastActivePc ?? -1);
    const activeLine = activePc >= 0 && activePc < codeLinesUpper.length ? codeLinesUpper[activePc] : '';
    const inferredFeedMotion = activePc >= 0 && activePc < motionByLine.length ? motionByLine[activePc] === 1 : false;
    const isLeadIn = /\bG4[12]\b/.test(activeLine);
    const isLeadOut = /\bG40\b/.test(activeLine);
    const isFeedMotion = motion !== 0 || inferredFeedMotion;
    if (isLeadIn && !r.leadInActivePrev && r.pathLeadIn) {
      r.pathLeadIn.count = 0;
      r.pathLeadIn.last = null;
      r.pathLeadIn.geo.setDrawRange(0, 0);
      (r.pathLeadIn.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
    if (isLeadOut && !r.leadOutActivePrev && r.pathLeadOut) {
      r.pathLeadOut.count = 0;
      r.pathLeadOut.last = null;
      r.pathLeadOut.geo.setDrawRange(0, 0);
      (r.pathLeadOut.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
    const isRapidMotion = !isFeedMotion && !isLeadIn && !isLeadOut;
    if (livePreviewEnabled) {
      if (showSpindlePath) {
        if (isRapidMotion) recordPath(r.path2Rapid, spindlePoint, pcChanged);
        else recordPath(r.path2, spindlePoint, pcChanged);
      }
      // TCP live trace records cutting and comp transitions; pure rapid kept separate.
      if (isFeedMotion && !isLeadIn && !isLeadOut) {
        recordPath(r.path1, controlPoint, pcChanged);
      } else if (isRapidMotion) {
        recordPath(r.path1Rapid, controlPoint, pcChanged);
      }
      if (isLeadIn) {
        recordPath(r.pathLeadIn, controlPoint, pcChanged);
      }
      if (isLeadOut) {
        recordPath(r.pathLeadOut, controlPoint, pcChanged);
      }
    }

    // Optional stock-only manifold booleans (experimental, throttled).
    const sb = r.stockBoolean;
    if (sb?.enabled && r.stockMesh) {
      if (sb.api && !sb.solid) {
        try {
          sb.solid = buildStockManifold(sb.api, stockConfig);
          sb.lastPoint = null;
          sb.lastCollisionPoint = null;
          sb.lastCutKey = '';
        } catch {
          // keep running; next tick can retry
        }
      }
      if (!sb.solid) {
        r.needsRender = true;
        return;
      }
      // Stock removal must follow the rendered physical cutter, not logical TCP mode.
      // This keeps subtraction exactly aligned with visible tool geometry.
      const cutPoint = physicalToolTipPoint.clone();
      const stockParent = r.stockMesh.parent as THREE.Object3D | null;
      stockParent?.updateWorldMatrix?.(true, false);
      const toStockLocal = (p: THREE.Vector3) => {
        if (!stockParent) return p.clone();
        return stockParent.worldToLocal(p.clone());
      };
      const cutPointLocal = toStockLocal(cutPoint);
      const axisProbeA = cutPoint.clone();
      const axisProbeB = cutPoint.clone().add(toolAxisWorld);
      const axisLocal = toStockLocal(axisProbeB).sub(toStockLocal(axisProbeA)).normalize();
      if (!Number.isFinite(axisLocal.lengthSq()) || axisLocal.lengthSq() < 1e-10) {
        axisLocal.copy(toolAxisWorld);
      }
      const cutKey = `PHYS:${Math.round(Number(toolRadius || 0) * 1000)}:${Math.round(toolLengthRegister * 1000)}`;
      if (sb.lastCutKey !== cutKey) {
        sb.lastPoint = cutPointLocal.clone();
        sb.lastCollisionPoint = cutPointLocal.clone();
        sb.lastCutKey = cutKey;
      }
      if (!sb.lastPoint) sb.lastPoint = cutPointLocal.clone();
      if (!sb.lastCollisionPoint) sb.lastCollisionPoint = cutPointLocal.clone();
      if (!state?.estop && sb.collisionLatched) {
        sb.collisionLatched = false;
        clearGroupMeshes(r.stockCollisionDebugGroup);
      }
      const canCutNow =
        !isLeadIn
        && !isLeadOut
        && (isFeedMotion || (!!axesMoving && !channelsRunning));
      if (!sceneConfig.stockCollisionDetection) {
        sb.collisionLatched = false;
        clearGroupMeshes(r.stockCollisionDebugGroup);
      }
      if (!canCutNow) {
        // Re-anchor segment start while not cutting to avoid long jump cuts.
        sb.lastPoint = cutPointLocal.clone();
        sb.lastCollisionPoint = cutPointLocal.clone();
      }
      if (canCutNow) {
        const now = performance.now();
        if (sb.api && sb.solid && !sb.busy && (now - Number(sb.lastApplyAt ?? 0)) >= STOCK_BOOLEAN_INTERVAL_MS) {
          const start = sb.lastPoint.clone();
          const end = cutPointLocal.clone();
          const visualTipDia = Math.max(0, Number(toolVisualProfile?.d1 ?? 0));
          const visualTipRadius = visualTipDia > 0 ? (visualTipDia * 0.5) : 0;
          let visualCutLen = 0;
          let visualCutRadius = visualTipRadius;
          let visualBandMin = 0;
          let visualBandMax = 0;
          let hasVisualBand = false;
          let nonCutLen = 0;
          let nonCutRadius = 0;
          let nonCutBandMin = 0;
          let nonCutBandMax = 0;
          let hasNonCutBand = false;
          let hasNonCutSegment = false;
          const segMeshes: THREE.Mesh[] | undefined = Array.isArray(r.spindleToolSegments) ? r.spindleToolSegments : undefined;
          if (segMeshes && segMeshes.length >= 3) {
            const cutFlags = [
              toolVisualProfile?.g1Cut ?? true,
              toolVisualProfile?.g2Cut ?? false,
              toolVisualProfile?.g3Cut ?? false,
            ];
            for (let i = 0; i < 3; i += 1) {
              const m = segMeshes[i];
              if (!m?.visible) continue;
              const sh = (m.userData as any)?.segShape;
              if (!sh) continue;
              const centerWorld = new THREE.Vector3();
              m.getWorldPosition(centerWorld);
              const centerLocal = toStockLocal(centerWorld);
              const centerT = centerLocal.sub(cutPointLocal).dot(axisLocal);
              const isCutSeg = !!cutFlags[i];
              if (sh.type === 'sphere') {
                const l = Math.max(0, Number(sh.length ?? 0));
                const rSeg = Math.max(0, Number(sh.dia ?? 0) * 0.5);
                const half = Math.max(l * 0.5, rSeg);
                const t0 = centerT - half;
                const t1 = centerT + half;
                if (isCutSeg) {
                  visualCutLen += l;
                  visualCutRadius = Math.max(visualCutRadius, rSeg);
                  if (!hasVisualBand) {
                    visualBandMin = Math.min(t0, t1);
                    visualBandMax = Math.max(t0, t1);
                    hasVisualBand = true;
                  } else {
                    visualBandMin = Math.min(visualBandMin, t0, t1);
                    visualBandMax = Math.max(visualBandMax, t0, t1);
                  }
                } else {
                  hasNonCutSegment = true;
                  nonCutLen += l;
                  nonCutRadius = Math.max(nonCutRadius, rSeg);
                  if (!hasNonCutBand) {
                    nonCutBandMin = Math.min(t0, t1);
                    nonCutBandMax = Math.max(t0, t1);
                    hasNonCutBand = true;
                  } else {
                    nonCutBandMin = Math.min(nonCutBandMin, t0, t1);
                    nonCutBandMax = Math.max(nonCutBandMax, t0, t1);
                  }
                }
              } else {
                const l = Math.max(0, Number(sh.length ?? 0));
                const rTop = Math.max(0, Number(sh.topRadius ?? 0));
                const rBottom = Math.max(0, Number(sh.bottomRadius ?? 0));
                const half = l * 0.5;
                const t0 = centerT - half;
                const t1 = centerT + half;
                if (isCutSeg) {
                  visualCutLen += l;
                  visualCutRadius = Math.max(visualCutRadius, rTop, rBottom);
                  if (!hasVisualBand) {
                    visualBandMin = Math.min(t0, t1);
                    visualBandMax = Math.max(t0, t1);
                    hasVisualBand = true;
                  } else {
                    visualBandMin = Math.min(visualBandMin, t0, t1);
                    visualBandMax = Math.max(visualBandMax, t0, t1);
                  }
                } else {
                  hasNonCutSegment = true;
                  nonCutLen += l;
                  nonCutRadius = Math.max(nonCutRadius, rTop, rBottom);
                  if (!hasNonCutBand) {
                    nonCutBandMin = Math.min(t0, t1);
                    nonCutBandMax = Math.max(t0, t1);
                    hasNonCutBand = true;
                  } else {
                    nonCutBandMin = Math.min(nonCutBandMin, t0, t1);
                    nonCutBandMax = Math.max(nonCutBandMax, t0, t1);
                  }
                }
              }
            }
          }
          let collisionTripped = false;
          const stockCutterSides = THREE.MathUtils.clamp(
            Math.round(Number(sceneConfig.stockCutterSides ?? STOCK_BOOLEAN_CUTTER_SIDES_DEFAULT)),
            3,
            64
          );
          if (
            sb.api
            && sb.solid
            && !!sceneConfig.stockCollisionDetection
            && !sb.collisionLatched
            && (now - Number(sb.lastCollisionAt ?? 0)) >= STOCK_COLLISION_INTERVAL_MS
          ) {
            sb.lastCollisionAt = now;
            const colStart = sb.lastCollisionPoint?.clone?.() ?? start.clone();
            const colEnd = end.clone();
            const nonCutBandMinOverride =
              hasNonCutBand && (nonCutBandMax - nonCutBandMin) > 1e-6
                ? nonCutBandMin
                : (nonCutLen > 1e-6 ? -nonCutLen : undefined);
            const nonCutBandMaxOverride =
              hasNonCutBand && (nonCutBandMax - nonCutBandMin) > 1e-6
                ? nonCutBandMax
                : (nonCutLen > 1e-6 ? 0 : undefined);
            if (hasNonCutSegment && nonCutRadius > 0.1) {
              const nonCutCollider = buildSegmentCutterManifold(
                sb.api,
                colStart,
                colEnd,
                axisLocal,
                stockCutterSides,
                Math.max(0.2, nonCutRadius),
                toolVisualProfile,
                nonCutLen > 0 ? nonCutLen : undefined,
                nonCutRadius > 0 ? nonCutRadius : undefined,
                nonCutBandMinOverride,
                nonCutBandMaxOverride
              );
              if (nonCutCollider) {
                let hit: any = null;
                try {
                  hit = sb.solid.intersect(nonCutCollider);
                  const hitMesh = hit?.getMesh?.();
                  const triCount = Math.floor(Number(hitMesh?.triVerts?.length ?? 0) / 3);
                  if (triCount > 0) {
                    sb.collisionLatched = true;
                    collisionTripped = true;
                    if (r.stockCollisionDebugGroup) {
                      const hitGeo = manifoldToThreeGeometry(hit);
                      clearGroupMeshes(r.stockCollisionDebugGroup);
                      const hitMat = new THREE.MeshStandardMaterial({
                        color: 0xff2d55,
                        emissive: new THREE.Color(0x7f1d1d),
                        emissiveIntensity: 0.6,
                        transparent: true,
                        opacity: 0.72,
                        depthWrite: false,
                      });
                      const hitMesh3d = new THREE.Mesh(hitGeo, hitMat);
                      hitMesh3d.userData.pickIgnore = true;
                      hitMesh3d.renderOrder = 1210;
                      r.stockCollisionDebugGroup.add(hitMesh3d);
                    }
                    const lineNo = Math.max(1, Number(activePc) + 1);
                    onCollisionAlarmRef.current?.(`COLLISION: non-cut tool body contacted stock (line ${lineNo}).`);
                  }
                } catch (err) {
                  console.warn('Stock collision probe failed.', err);
                } finally {
                  hit?.delete?.();
                  nonCutCollider.delete?.();
                }
              }
            }
            sb.lastCollisionPoint = colEnd.clone();
          }
          if (collisionTripped) {
            sb.lastPoint = end.clone();
            r.needsRender = true;
            return;
          }
          // Removal radius must follow controller tool radius (D register) first.
          // Visual profile fallback is bounded to avoid giant/spherical-looking cuts
          // from mismatched imported STEP/profile dimensions.
          const controllerRadius = Math.max(0, Number(toolRadius || 0));
          const fallbackVisualRadius = Math.min(10, Math.max(visualTipRadius, visualCutRadius));
          const cutRadius = Math.max(0.2, controllerRadius > 0 ? controllerRadius : fallbackVisualRadius);
          const bandMinOverride =
            hasVisualBand && (visualBandMax - visualBandMin) > 1e-6
              ? visualBandMin
              : (visualCutLen > 1e-6 ? -visualCutLen : undefined);
          const bandMaxOverride =
            hasVisualBand && (visualBandMax - visualBandMin) > 1e-6
              ? visualBandMax
              : (visualCutLen > 1e-6 ? 0 : undefined);
          const cutter = buildSegmentCutterManifold(
            sb.api,
            start,
            end,
            axisLocal,
            stockCutterSides,
            cutRadius,
            toolVisualProfile,
            visualCutLen > 0 ? visualCutLen : undefined,
            visualCutRadius > 0 ? visualCutRadius : undefined,
            bandMinOverride,
            bandMaxOverride
          );
          if (cutter) {
            // Advance only when a valid cutter segment was created.
            // This accumulates tiny per-frame moves into real cut segments.
            sb.lastPoint = end.clone();
            sb.busy = true;
            sb.lastApplyAt = now;
            setTimeout(() => {
              const rr = sceneRef.current;
              if (!rr?.stockBoolean?.enabled || !rr.stockMesh) return;
              try {
                const stockBool = rr.stockBoolean;
                if (rr.stockCutterDebugGroup && sceneConfig.showStockCutterDebug) {
                  const dbgGeo = manifoldToThreeGeometry(cutter);
                  clearGroupMeshes(rr.stockCutterDebugGroup);
                  const dbgMat = new THREE.MeshStandardMaterial({
                    color: 0x00ff66,
                    emissive: new THREE.Color(0x052e16),
                    transparent: true,
                    opacity: THREE.MathUtils.clamp(Number(sceneConfig.stockCutterDebugOpacity ?? 0.35), 0, 1),
                    depthWrite: false,
                    wireframe: true,
                  });
                  const dbgMesh = new THREE.Mesh(dbgGeo, dbgMat);
                  dbgMesh.userData.pickIgnore = true;
                  dbgMesh.renderOrder = 1200;
                  rr.stockCutterDebugGroup.add(dbgMesh);
                }
                const nextSolid = stockBool.solid.subtract(cutter);
                stockBool.solid?.delete?.();
                cutter.delete?.();
                stockBool.solid = nextSolid;
                const nextGeo = manifoldToThreeGeometry(nextSolid);
                rr.stockMesh.geometry?.dispose?.();
                rr.stockMesh.geometry = nextGeo;
                rr.needsRender = true;
              } catch (err) {
                console.warn('Manifold stock cut failed, keeping engine active.', err);
                if (rr.stockBoolean) {
                  rr.stockBoolean.lastPoint = null;
                }
              } finally {
                if (rr?.stockBoolean) rr.stockBoolean.busy = false;
              }
            }, 0);
          }
        }
      } else {
        sb.lastPoint = cutPoint.clone();
      }
    }
    r.leadInActivePrev = isLeadIn;
    r.leadOutActivePrev = isLeadOut;

    const pwX = getProgrammedWorkByName('X');
    const pwY = getProgrammedWorkByName('Y');
    const pwZ = getProgrammedWorkByName('Z');
    if (pwX !== null && pwY !== null && pwZ !== null) {
      const pmX = pwX + getOffsetByName('X');
      const pmY = pwY + getOffsetByName('Y');
      const pmZ = pwZ + getOffsetByName('Z');
      const programPoint = new THREE.Vector3(
        toSceneMotion('X', pmX),
        toSceneMotion('Z', pmZ),
        -toSceneMotion('Y', pmY)
      );
      if (livePreviewEnabled) {
        if (isFeedMotion && !isLeadIn && !isLeadOut) {
          recordPath(r.pathProgram, programPoint, pcChanged);
        } else if (isRapidMotion) {
          recordPath(r.pathProgramRapid, programPoint, pcChanged);
        }
      }
    }
    r.lastActivePc = activePc;
    if (r.toolControlPointMarker) {
      r.toolControlPointMarker.position.copy(controlPoint);
      updateToolControlPointMarker(
        r.toolControlPointMarker,
        motion,
        toolRadius,
        sceneConfig.toolPointRapidColor,
        sceneConfig.toolPointFeedColor
      );
      r.toolControlPointMarker.visible = !!showToolControlPoint;
    }
    if (r.spindlePointMarker) {
      r.spindlePointMarker.position.copy(spindlePoint);
      r.spindlePointMarker.visible = !!showSpindlePoint;
    }
    if (r.machineZeroMarker) {
      const mx = toSceneLinear('X', 0);
      const my = toSceneLinear('Y', 0);
      const mz = toSceneLinear('Z', 0);
      r.machineZeroMarker.position.set(mx, mz, -my);
      r.machineZeroMarker.visible = mcsReferenceVisual === 'dot';
      if (r.machineZeroGizmo?.group) {
        r.machineZeroGizmo.group.position.set(mx, mz, -my);
        r.machineZeroGizmo.group.visible = mcsReferenceVisual === 'gizmo';
      }
    }
    if (r.activeWcsMarker) {
      const wx = toSceneLinear('X', getOffsetByName('X'));
      const wy = toSceneLinear('Y', getOffsetByName('Y'));
      const wz = toSceneLinear('Z', getOffsetByName('Z'));
      const wcsWorld = new THREE.Vector3(wx, wz, -wy);
      const stockFollowParent: THREE.Object3D | null =
        stockConfig.mount === 'spindle'
          ? (r.spindle ?? null)
          : (r.ch2Rot ?? null);
      const wcsSig = [
        String(stockConfig.mount ?? 'table'),
        Number(wx).toFixed(6),
        Number(wy).toFixed(6),
        Number(wz).toFixed(6),
        Number(state.active_wcs ?? 0),
      ].join('|');
      if (stockFollowParent) {
        if (!r.wcsFollowLocal || r.wcsFollowOffsetSig !== wcsSig) {
          r.wcsFollowLocal = stockFollowParent.worldToLocal(wcsWorld.clone());
          r.wcsFollowOffsetSig = wcsSig;
        }
        wcsWorld.copy(stockFollowParent.localToWorld(r.wcsFollowLocal.clone()));
      } else {
        r.wcsFollowLocal = null;
        r.wcsFollowOffsetSig = '';
      }

      r.activeWcsMarker.position.copy(wcsWorld);
      r.activeWcsMarker.visible = wcsReferenceVisual === 'dot';
      if (r.activeWcsGizmo?.group) {
        r.activeWcsGizmo.group.position.copy(wcsWorld);
        r.activeWcsGizmo.group.visible = wcsReferenceVisual === 'gizmo';
      }
    }

    // Reflect tool visual profile (L1/L2/L3 and D1/D2/D3) in rendered tool geometry.
    const rawToolRadius = Number(ch0?.tool_radius ?? 0);
    const rawToolLength = Number(ch0?.tool_length ?? 0);
    const needsToolVisualUpdate =
      lastToolVisualProfileRef.current !== toolVisualProfile
      || lastToolVisualRuntimeRef.current.toolRadius !== rawToolRadius
      || lastToolVisualRuntimeRef.current.toolLength !== rawToolLength;
    if (r.spindleToolSegments && needsToolVisualUpdate) {
      const visualTotal = (toolVisualProfile?.l1 ?? 0) + (toolVisualProfile?.l2 ?? 0) + (toolVisualProfile?.l3 ?? 0);
      const profile = {
        l1: toolVisualProfile?.l1 ?? DEFAULT_TOOL_VISUAL.l1,
        d1: toolVisualProfile?.d1 ?? Math.max(1, (rawToolRadius > 0 ? rawToolRadius * 2 : DEFAULT_TOOL_VISUAL.d1)),
        d1Top: toolVisualProfile?.d1Top ?? toolVisualProfile?.d1 ?? DEFAULT_TOOL_VISUAL.d1Top,
        d1Bottom: toolVisualProfile?.d1Bottom ?? toolVisualProfile?.d1 ?? DEFAULT_TOOL_VISUAL.d1Bottom,
        g1Type: toolVisualProfile?.g1Type ?? DEFAULT_TOOL_VISUAL.g1Type,
        g1Cut: toolVisualProfile?.g1Cut ?? DEFAULT_TOOL_VISUAL.g1Cut,
        g1Color: toolVisualProfile?.g1Color ?? DEFAULT_TOOL_VISUAL.g1Color,
        l2: toolVisualProfile?.l2 ?? DEFAULT_TOOL_VISUAL.l2,
        d2: toolVisualProfile?.d2 ?? DEFAULT_TOOL_VISUAL.d2,
        d2Top: toolVisualProfile?.d2Top ?? toolVisualProfile?.d2 ?? DEFAULT_TOOL_VISUAL.d2Top,
        d2Bottom: toolVisualProfile?.d2Bottom ?? toolVisualProfile?.d2 ?? DEFAULT_TOOL_VISUAL.d2Bottom,
        g2Type: toolVisualProfile?.g2Type ?? DEFAULT_TOOL_VISUAL.g2Type,
        g2Cut: toolVisualProfile?.g2Cut ?? DEFAULT_TOOL_VISUAL.g2Cut,
        g2Color: toolVisualProfile?.g2Color ?? DEFAULT_TOOL_VISUAL.g2Color,
        l3: toolVisualProfile?.l3 ?? Math.max(8, (Number(ch0?.tool_length ?? 0) || DEFAULT_TOOL_LENGTH) * 0.5),
        d3: toolVisualProfile?.d3 ?? DEFAULT_TOOL_VISUAL.d3,
        d3Top: toolVisualProfile?.d3Top ?? toolVisualProfile?.d3 ?? DEFAULT_TOOL_VISUAL.d3Top,
        d3Bottom: toolVisualProfile?.d3Bottom ?? toolVisualProfile?.d3 ?? DEFAULT_TOOL_VISUAL.d3Bottom,
        g3Type: toolVisualProfile?.g3Type ?? DEFAULT_TOOL_VISUAL.g3Type,
        g3Cut: toolVisualProfile?.g3Cut ?? DEFAULT_TOOL_VISUAL.g3Cut,
        g3Color: toolVisualProfile?.g3Color ?? DEFAULT_TOOL_VISUAL.g3Color,
        useHolder: !!toolVisualProfile?.useHolder,
        holderLength: toolVisualProfile?.holderLength ?? DEFAULT_TOOL_VISUAL.holderLength,
        holderDiameter: toolVisualProfile?.holderDiameter ?? DEFAULT_TOOL_VISUAL.holderDiameter,
        holderDiameterTop: toolVisualProfile?.holderDiameterTop ?? toolVisualProfile?.holderDiameter ?? DEFAULT_TOOL_VISUAL.holderDiameterTop,
        holderDiameterBottom: toolVisualProfile?.holderDiameterBottom ?? toolVisualProfile?.holderDiameter ?? DEFAULT_TOOL_VISUAL.holderDiameterBottom,
        holderTaperAngleDeg: toolVisualProfile?.holderTaperAngleDeg ?? DEFAULT_TOOL_VISUAL.holderTaperAngleDeg,
        stickout:
          toolVisualProfile?.stickout ??
          (visualTotal > 0
            ? visualTotal
            : Math.max(6, rawToolLength || DEFAULT_TOOL_LENGTH)),
      };
      setToolVisualSegments(r.spindleHolder, r.spindleToolSegments, r.spindleTipLight, profile);
      r.applyStepPreviewVisualState?.();
      lastToolVisualProfileRef.current = toolVisualProfile;
      lastToolVisualRuntimeRef.current = { toolRadius: rawToolRadius, toolLength: rawToolLength };
    }

    const sceneSig = [
      state.estop ? '1' : '0',
      sceneConfig.backgroundColor,
      sceneConfig.ambientIntensity,
      sceneConfig.keyIntensity,
      sceneConfig.fillIntensity,
      sceneConfig.floorIntensity,
      sceneConfig.shadowsEnabled ? '1' : '0',
      sceneConfig.reflectionsEnabled ? '1' : '0',
      sceneConfig.wcsDotColor,
      sceneConfig.mcsDotColor,
      sceneConfig.toolPointRapidColor,
      sceneConfig.toolPointFeedColor,
      sceneConfig.spindlePointColor,
    ].join('|');
    if (sceneVisualSigRef.current !== sceneSig) {
      if (r.ambientLight) r.ambientLight.intensity = sceneConfig.ambientIntensity;
      if (r.keyLight) r.keyLight.intensity = sceneConfig.keyIntensity;
      if (r.fillLight) r.fillLight.intensity = sceneConfig.fillIntensity;
      if (r.floorLight) r.floorLight.intensity = sceneConfig.floorIntensity;
      applyShadowProfile(r.renderer, r.scene, r.keyLight, !!sceneConfig.shadowsEnabled);
      applyReflectionProfile(r.scene, !!sceneConfig.reflectionsEnabled);
      applyDotMarkerColor(r.machineZeroMarker, sceneConfig.mcsDotColor, '#ffffff', 0.22);
      applyDotMarkerColor(r.activeWcsMarker, sceneConfig.wcsDotColor, '#22d3ee', 0.22);
      applyDotMarkerColor(r.spindlePointMarker, sceneConfig.spindlePointColor, '#60a5fa', 0.25);
      const targetBg = state.estop ? '#3a0808' : sceneConfig.backgroundColor;
      if (r.scene.background instanceof THREE.Color) r.scene.background.set(targetBg);
      else r.scene.background = new THREE.Color(targetBg);
      sceneVisualSigRef.current = sceneSig;
    }

    const gridSig = [
      sceneConfig.gridMajorColor,
      sceneConfig.gridMinorColor,
      sceneConfig.gridOpacity,
    ].join('|');
    const gridGeomSig = [
      sceneConfig.gridSize,
      sceneConfig.gridDivisions,
    ].join('|');
    if (r.scene && gridGeomSigRef.current !== gridGeomSig) {
      const newGrid = new THREE.GridHelper(
        Math.max(100, Number(sceneConfig.gridSize ?? 1000)),
        Math.max(2, Math.round(Number(sceneConfig.gridDivisions ?? 50))),
        sceneConfig.gridMajorColor,
        sceneConfig.gridMinorColor
      );
      newGrid.userData.pickIgnore = true;
      const mats = Array.isArray(newGrid.material) ? newGrid.material : [newGrid.material];
      const op = THREE.MathUtils.clamp(Number(sceneConfig.gridOpacity ?? 0.1), 0, 1);
      for (const m of mats) {
        m.transparent = true;
        m.opacity = op;
        m.needsUpdate = true;
      }
      if (r.grid?.parent) r.grid.parent.add(newGrid);
      if (r.grid?.parent) r.grid.parent.remove(r.grid);
      if (r.grid) {
        r.grid.geometry?.dispose();
        const oldMats = Array.isArray(r.grid.material) ? r.grid.material : [r.grid.material];
        oldMats.forEach((m: THREE.Material) => m.dispose());
      }
      r.grid = newGrid;
      gridGeomSigRef.current = gridGeomSig;
      gridVisualSigRef.current = '';
    }
    if (r.grid && gridVisualSigRef.current !== gridSig) {
      const mats = Array.isArray(r.grid.material) ? r.grid.material : [r.grid.material];
      if (mats[0]?.color) mats[0].color.set(sceneConfig.gridMajorColor);
      if (mats[1]?.color) mats[1].color.set(sceneConfig.gridMinorColor);
      const op = THREE.MathUtils.clamp(Number(sceneConfig.gridOpacity ?? 0.1), 0, 1);
      for (const m of mats) {
        m.transparent = true;
        m.opacity = op;
        m.needsUpdate = true;
      }
      gridVisualSigRef.current = gridSig;
    }
    if (r.axisHelper) {
      r.axisHelper.visible = !!sceneConfig.showSceneAxes;
    }

    r.needsRender = true;

  }, [
    state,
    configAxes,
    showScene3d,
    showMachineModel,
    showToolModel,
    showStockModel,
    toolVisualProfile,
    showToolControlPoint,
    showSpindlePoint,
    wcsReferenceVisual,
    mcsReferenceVisual,
    showProgramPath,
    showToolPath,
    showSpindlePath,
    livePreviewEnabled,
    codeLinesUpper,
    motionByLine,
    sceneConfig,
  ]);

  useEffect(() => {
    const r = sceneRef.current;
    if (!r) return;
    const reset = (p: any) => {
      p.count = 0;
      p.last = null;
      p.geo.setDrawRange(0, 0);
      (p.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      if (p.line?.material instanceof THREE.LineDashedMaterial) {
        p.line.computeLineDistances();
      }
    };
    reset(r.path1);
    reset(r.path1Rapid);
    reset(r.path2);
    reset(r.path2Rapid);
    reset(r.pathProgram);
    reset(r.pathProgramRapid);
    reset(r.pathLeadIn);
    reset(r.pathLeadOut);
    r.lastActivePc = Number(r.state?.channels?.[0]?.active_pc ?? -1);
    r.leadInActivePrev = false;
    r.leadOutActivePrev = false;
    r.needsRender = true;
  }, [pathResetNonce]);

  useEffect(() => {
    const r = sceneRef.current;
    if (!r) return;
    const sb = r.stockBoolean;
    if (!sb?.enabled || !r.stockMesh || !sb.api) return;
    try {
      sb.solid?.delete?.();
      sb.solid = buildStockManifold(sb.api, stockConfig);
      const freshGeo = manifoldToThreeGeometry(sb.solid);
      r.stockMesh.geometry?.dispose?.();
      r.stockMesh.geometry = freshGeo;
      sb.lastPoint = null;
      sb.lastCollisionPoint = null;
      sb.lastCutKey = '';
      sb.collisionLatched = false;
      sb.busy = false;
      clearGroupMeshes(r.stockCutterDebugGroup);
      clearGroupMeshes(r.stockCollisionDebugGroup);
      r.needsRender = true;
    } catch (err) {
      console.warn('Stock reset failed.', err);
    }
  }, [stockResetNonce, stockConfig]);

  useEffect(() => {
    const r = sceneRef.current;
    if (!r) return;
    const empty: Array<{ x: number; y: number; z: number }> = [];
    setStaticPath(r.previewProgram, previewPath?.program ?? empty);
    setStaticPath(r.previewProgramRapid, previewPath?.programRapid ?? empty);
    setStaticPath(r.previewTcp, previewPath?.tcp ?? empty);
    setStaticPath(r.previewTcpRapid, previewPath?.tcpRapid ?? empty);
    if (showSpindlePath) {
      setStaticPath(r.previewSpindle, previewPath?.spindle ?? empty);
      setStaticPath(r.previewSpindleRapid, previewPath?.spindleRapid ?? empty);
    } else {
      setStaticPath(r.previewSpindle, empty);
      setStaticPath(r.previewSpindleRapid, empty);
    }
    setStaticPath(r.previewLeadIn, previewPath?.leadInTcp ?? empty);
    setStaticPath(r.previewLeadOut, previewPath?.leadOutTcp ?? empty);
    r.previewProgram.visible = !!showProgramPath;
    r.previewProgramRapid.visible = !!showProgramPath;
    r.previewTcp.visible = !!showToolPath;
    r.previewTcpRapid.visible = !!showToolPath;
    r.previewSpindle.visible = !!showSpindlePath;
    r.previewSpindleRapid.visible = !!showSpindlePath;
    r.previewLeadIn.visible = !!showToolPath;
    r.previewLeadOut.visible = !!showToolPath;
    r.needsRender = true;
  }, [previewPath, showProgramPath, showToolPath, showSpindlePath]);

  // ── Gizmo display and interaction ─────────────────────────────────────────
  useEffect(() => {
    if (!sceneRef.current) return;
    const r = sceneRef.current;

    if (r.gizmo) {
      r.scene.remove(r.gizmo.group);
      r.gizmo.group.clear();
      r.gizmo = null;
    }

    if (pickingAxisId === null || pickingAxisId === undefined) return;

    const ax = r.state.axes.find((a: any) => a.id === pickingAxisId);
    if (!ax) return;

    const toSceneLinear = (axisName: string, value: number): number => {
      const configAx = getConfigAxis(axisName);
      const axis = r.state.axes.find((a: any) => a.physical_name === axisName);
      const machineZero = axis?.machine_zero ?? configAx?.machineZero ?? 0;
      const sceneValue = value + machineZero;
      return configAx?.invert ? -sceneValue : sceneValue;
    };

    const getOffsetByName = (axisName: string): number => {
      const axis = r.state.axes.find((a: any) => a.physical_name === axisName);
      if (!axis) return 0;
      const wcs = r.state.work_offsets?.[r.state.active_wcs ?? 0];
      return wcs?.offsets?.find((o: any) => o.axis_id === axis.id)?.value ?? 0;
    };

    let gizmoPos = new THREE.Vector3();
    if (['X', 'Y', 'Z'].includes(ax.physical_name)) {
      const baseX = getOffsetByName('X');
      const baseY = getOffsetByName('Y');
      const baseZ = getOffsetByName('Z');
      const wX = ax.physical_name === 'X' && pickedValue !== undefined ? pickedValue : baseX;
      const wY = ax.physical_name === 'Y' && pickedValue !== undefined ? pickedValue : baseY;
      const wZ = ax.physical_name === 'Z' && pickedValue !== undefined ? pickedValue : baseZ;
      gizmoPos.set(
        toSceneLinear('X', wX),
        toSceneLinear('Z', wZ),
        -toSceneLinear('Y', wY)
      );
    } else {
      const raw = pickedValue ?? getOffsetByName(ax.physical_name);
      const pos = toSceneLinear(ax.physical_name, raw);
      if (ax.physical_name === 'Z3') gizmoPos.set(0, 0, -pos);
      else gizmoPos.set(pos, 0, 0);
    }

    const gizmo = buildSmallGizmo(gizmoPos);
    markPickIgnore(gizmo.group);
    r.scene.add(gizmo.group);
    r.gizmo = gizmo;

    return () => {
      if (!r.gizmo) return;
      r.scene.remove(r.gizmo.group);
      r.gizmo.group.clear();
      r.gizmo = null;
    };
  }, [pickingAxisId, pickedValue, configAxes, state?.active_wcs, state?.work_offsets, state?.axes]);

  return <div ref={mountRef} style={{ width: '100%', height: '100%' }} />;
}
