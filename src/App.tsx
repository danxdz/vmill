import { lazy, Suspense, useEffect, useMemo, useState, useRef } from 'react';
import { MachineBrain, AxisType } from '../machine-core/pkg/';
import MachineView from './MachineView';
import ZeroPanel from './ZeroPanel';
import BottomControlBar from './BottomControlBar';
import type { ReferenceVisualMode, ToolVisualProfile } from './modules/moduleTypes';
import { useMachine } from './MachineContext';
import {
  DEFAULT_GCODE_BY_CHANNEL,
  GCODE_EXAMPLES,
  SIM_SPEED_MULTIPLIER,
  formatGcode,
} from './gcode/gcodeConfig';

const MachineConfigPanel = lazy(() => import('./MachineConfigPanel'));

interface StockConfig {
  shape: 'box';
  size: { x: number; y: number; z: number };
  position: { x: number; y: number; z: number };
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

interface ViewPerfStats {
  renderFps: number;
  motionActive: boolean;
  idleIntervalMs: number;
}

interface PreviewPerfStats {
  ms: number;
  points: number;
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
  showStockGhost: boolean;
  stockGhostOpacity: number;
  showStockCutterDebug: boolean;
  stockCutterDebugOpacity: number;
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

interface PersistedAppState {
  showScene3d: boolean;
  showMachineModel: boolean;
  showToolModel: boolean;
  showStockModel: boolean;
  wcsReferenceVisual: ReferenceVisualMode;
  mcsReferenceVisual: ReferenceVisualMode;
  toolControlPointVisible: boolean;
  spindlePointVisible: boolean;
  showProgramPath: boolean;
  showToolPath: boolean;
  showSpindlePath: boolean;
  feedOverride: number;
  simulationSpeed: number;
  singleBlock: boolean;
  liveToolpath: boolean;
  toolVisualProfile: ToolVisualProfile;
  stockConfig: StockConfig;
  sceneConfig: SceneSetupConfig;
  codes: string[];
}

interface RuntimeOffsetSnapshot {
  axisName: string;
  value: number;
}

interface RuntimeWcsSnapshot {
  label: string;
  offsets: RuntimeOffsetSnapshot[];
}

interface RuntimeChannelSnapshot {
  activeTool: number;
  toolLength: number;
  toolRadius: number;
  lengthCompActive: boolean;
  cutterComp: number;
  feedOverrideRatio: number;
  singleBlock: boolean;
}

interface RuntimeRestoreSnapshot {
  activeWcs: number;
  workOffsets: RuntimeWcsSnapshot[];
  channel0: RuntimeChannelSnapshot | null;
}

export interface SessionBackupSelection {
  machines: boolean;
  tooling: boolean;
  programs: boolean;
  view: boolean;
  runtime: boolean;
}

interface SessionBackupFile {
  format: 'vmill-session-backup';
  version: 1;
  exportedAt: string;
  sections?: Partial<SessionBackupSelection>;
  appState?: Partial<PersistedAppState>;
  runtimeState?: RuntimeRestoreSnapshot | null;
  storage?: Record<string, string | null>;
  stepMeshes?: Record<string, Array<{ positions: number[]; indices: number[] | null }>>;
}

interface SessionImportResult {
  ok: boolean;
  message: string;
}

const DEFAULT_STOCK_CONFIG: StockConfig = {
  shape: 'box',
  // Machine-axis dimensions: X width, Y depth, Z height.
  size: { x: 40, y: 40, z: 40 },
  // Machine-axis position (stock center): X, Y, Z.
  position: { x: 0, y: 0, z: 20 },
  color: '#3b82f6',
  opacity: 0.92,
};
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
  showStockGhost: false,
  stockGhostOpacity: 0.5,
  showStockCutterDebug: false,
  stockCutterDebugOpacity: 0.35,
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
const MAX_SIM_STEP_MS = 12;
const BOTTOM_BAR_HEIGHT = 74;
const APP_STATE_KEY = 'vmill_app_state_v1';
const RUNTIME_RESTORE_KEY = 'vmill_runtime_restore_v1';
const SESSION_STORAGE_PREFIX = 'vmill_';
const SESSION_BACKUP_FORMAT = 'vmill-session-backup' as const;
const SESSION_BACKUP_VERSION = 1 as const;
const MACHINE_LIBRARY_KEY = 'vmill_machines';
const ACTIVE_MACHINE_KEY = 'vmill_active_machine';
const TEMPLATE_SPINDLE_KEY = 'vmill_template_spindle_defaults_v1';
const TOOL_LIBRARY_KEY = 'vmill_tool_library_v1';
const TOOL_ASSEMBLY_KEY = 'vmill_tool_assemblies_v1';
const TOOL_STATIONS_KEY = 'vmill_tool_stations_v1';
const TOOL_TABLE_KEY = 'vmill_tool_table_v1';
const STEP_MESH_DB = 'vmill_step_mesh_v1';
const STEP_MESH_STORE = 'meshes';
const DEFAULT_SESSION_BACKUP_SELECTION: SessionBackupSelection = {
  machines: true,
  tooling: true,
  programs: true,
  view: true,
  runtime: true,
};
const DEFAULT_TOOL_VISUAL_PROFILE: ToolVisualProfile = {
  l1: 12,
  d1: 8,
  g1Type: 'cylinder',
  g1Cut: true,
  g1Color: '#ef4444',
  l2: 8,
  d2: 10,
  g2Type: 'cylinder',
  g2Cut: false,
  g2Color: '#94a3b8',
  l3: 16,
  d3: 12,
  g3Type: 'cylinder',
  g3Cut: false,
  g3Color: '#64748b',
  useHolder: false,
  holderLength: 18,
  holderDiameter: 14,
  holderDiameterTop: 14,
  holderDiameterBottom: 14,
  holderTaperAngleDeg: 0,
  toolOpacity: 1,
  holderOpacity: 1,
  stickout: 36,
};

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function roundPreviewValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1000) / 1000;
}

function collectVmillStorageSnapshot(keys?: string[]): Record<string, string | null> {
  const keySet = keys ? new Set(keys) : null;
  const snapshot: Record<string, string | null> = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(SESSION_STORAGE_PREFIX)) continue;
    if (key === RUNTIME_RESTORE_KEY) continue;
    if (keySet && !keySet.has(key)) continue;
    snapshot[key] = localStorage.getItem(key);
  }
  return snapshot;
}

function replaceVmillStorageKeys(storage: Record<string, string | null>, keys: string[]) {
  const uniqueKeys = Array.from(new Set(keys.filter((k) => k.startsWith(SESSION_STORAGE_PREFIX))));
  uniqueKeys.forEach((k) => localStorage.removeItem(k));
  uniqueKeys.forEach((k) => {
    const value = storage[k];
    if (typeof value === 'string') localStorage.setItem(k, value);
  });
}

function openStepMeshDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(STEP_MESH_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STEP_MESH_STORE)) {
        db.createObjectStore(STEP_MESH_STORE, { keyPath: 'itemId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function collectStepMeshSnapshot(): Promise<Record<string, Array<{ positions: number[]; indices: number[] | null }>> | undefined> {
  const db = await openStepMeshDb();
  if (!db) return undefined;
  try {
    const records = await new Promise<any[]>((resolve) => {
      const tx = db.transaction(STEP_MESH_STORE, 'readonly');
      const req = tx.objectStore(STEP_MESH_STORE).getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => resolve([]);
    });
    const out: Record<string, Array<{ positions: number[]; indices: number[] | null }>> = {};
    for (const rec of records) {
      const itemId = String(rec?.itemId ?? '').trim();
      if (!itemId) continue;
      const meshes = Array.isArray(rec?.meshes) ? rec.meshes : [];
      out[itemId] = meshes.map((m: any) => {
        const pos = m?.positions;
        const idx = m?.indices;
        const positions = pos && typeof pos.length === 'number'
          ? Array.from(pos as ArrayLike<number>).map((v) => Number(v))
          : [];
        const indices = idx && typeof idx.length === 'number'
          ? Array.from(idx as ArrayLike<number>).map((v) => Number(v))
          : null;
        return { positions, indices };
      });
    }
    return Object.keys(out).length ? out : undefined;
  } finally {
    db.close();
  }
}

async function replaceStepMeshSnapshot(
  snapshot: Record<string, Array<{ positions: number[]; indices: number[] | null }>> | undefined
): Promise<void> {
  const db = await openStepMeshDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STEP_MESH_STORE, 'readwrite');
      const store = tx.objectStore(STEP_MESH_STORE);
      const clearReq = store.clear();
      clearReq.onsuccess = () => {
        const entries = Object.entries(snapshot ?? {});
        for (const [itemId, meshes] of entries) {
          store.put({
            itemId,
            meshes: (meshes ?? []).map((m) => ({
              positions: Float32Array.from((m?.positions ?? []).map((v) => Number(v))),
              indices: Array.isArray(m?.indices) ? Uint32Array.from((m.indices ?? []).map((v) => Number(v))) : null,
            })),
          });
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } finally {
    db.close();
  }
}

function storageKeysForSelection(selection: SessionBackupSelection): string[] {
  const keys: string[] = [];
  if (selection.machines) {
    keys.push(MACHINE_LIBRARY_KEY, ACTIVE_MACHINE_KEY, TEMPLATE_SPINDLE_KEY);
  }
  if (selection.tooling) {
    keys.push(TOOL_LIBRARY_KEY, TOOL_ASSEMBLY_KEY, TOOL_STATIONS_KEY, TOOL_TABLE_KEY);
  }
  return keys;
}

function buildAppStateSubset(
  appState: PersistedAppState,
  selection: SessionBackupSelection
): Partial<PersistedAppState> | undefined {
  const out: Partial<PersistedAppState> = {};
  if (selection.view) {
    out.showScene3d = appState.showScene3d;
    out.showMachineModel = appState.showMachineModel;
    out.showToolModel = appState.showToolModel;
    out.showStockModel = appState.showStockModel;
    out.wcsReferenceVisual = appState.wcsReferenceVisual;
    out.mcsReferenceVisual = appState.mcsReferenceVisual;
    out.toolControlPointVisible = appState.toolControlPointVisible;
    out.spindlePointVisible = appState.spindlePointVisible;
    out.showProgramPath = appState.showProgramPath;
    out.showToolPath = appState.showToolPath;
    out.showSpindlePath = appState.showSpindlePath;
    out.feedOverride = appState.feedOverride;
    out.simulationSpeed = appState.simulationSpeed;
    out.singleBlock = appState.singleBlock;
    out.liveToolpath = appState.liveToolpath;
    out.toolVisualProfile = appState.toolVisualProfile;
    out.stockConfig = appState.stockConfig;
    out.sceneConfig = appState.sceneConfig;
  }
  if (selection.programs) {
    out.codes = Array.isArray(appState.codes) ? [...appState.codes] : [];
  }
  return Object.keys(out).length ? out : undefined;
}

function mergeAppStateSubset(
  current: PersistedAppState,
  incoming: Partial<PersistedAppState> | undefined,
  selection: SessionBackupSelection
): PersistedAppState {
  if (!incoming) return current;
  const next: PersistedAppState = { ...current };
  if (selection.view) {
    if (typeof incoming.showScene3d === 'boolean') next.showScene3d = incoming.showScene3d;
    if (typeof incoming.showMachineModel === 'boolean') next.showMachineModel = incoming.showMachineModel;
    if (typeof incoming.showToolModel === 'boolean') next.showToolModel = incoming.showToolModel;
    if (typeof incoming.showStockModel === 'boolean') next.showStockModel = incoming.showStockModel;
    if (incoming.wcsReferenceVisual) next.wcsReferenceVisual = incoming.wcsReferenceVisual;
    if (incoming.mcsReferenceVisual) next.mcsReferenceVisual = incoming.mcsReferenceVisual;
    if (typeof incoming.toolControlPointVisible === 'boolean') next.toolControlPointVisible = incoming.toolControlPointVisible;
    if (typeof incoming.spindlePointVisible === 'boolean') next.spindlePointVisible = incoming.spindlePointVisible;
    if (typeof incoming.showProgramPath === 'boolean') next.showProgramPath = incoming.showProgramPath;
    if (typeof incoming.showToolPath === 'boolean') next.showToolPath = incoming.showToolPath;
    if (typeof incoming.showSpindlePath === 'boolean') next.showSpindlePath = incoming.showSpindlePath;
    if (typeof incoming.feedOverride === 'number') next.feedOverride = incoming.feedOverride;
    if (typeof incoming.simulationSpeed === 'number') next.simulationSpeed = incoming.simulationSpeed;
    if (typeof incoming.singleBlock === 'boolean') next.singleBlock = incoming.singleBlock;
    if (typeof incoming.liveToolpath === 'boolean') next.liveToolpath = incoming.liveToolpath;
    if (incoming.toolVisualProfile) next.toolVisualProfile = incoming.toolVisualProfile;
    if (incoming.stockConfig) next.stockConfig = incoming.stockConfig;
    if (incoming.sceneConfig) next.sceneConfig = { ...next.sceneConfig, ...incoming.sceneConfig };
  }
  if (selection.programs && Array.isArray(incoming.codes)) {
    next.codes = incoming.codes.map((c) => String(c));
  }
  return next;
}

function syncToolTableFromStorage(core: MachineBrain, channelIndex: number) {
  const setEntry = (slot: number, length: number, radius: number) => {
    if (!Number.isFinite(slot) || slot < 1) return;
    if (!Number.isFinite(length) || !Number.isFinite(radius)) return;
    (core as any)?.set_tool_table_entry?.(channelIndex, Math.floor(slot), length, Math.max(0, radius));
  };

  const explicit = new Set<number>();
  const overrides = parseJson<Record<string, { h?: number; d?: number }>>(localStorage.getItem(TOOL_TABLE_KEY));
  if (overrides) {
    Object.entries(overrides).forEach(([k, v]) => {
      const slot = Number(k);
      const h = Number(v?.h);
      const d = Number(v?.d);
      if (!Number.isFinite(slot) || !Number.isFinite(h) || !Number.isFinite(d)) return;
      explicit.add(Math.floor(slot));
      setEntry(slot, h, d);
    });
  }

  const assignables = new Map<string, { length: number; radius: number }>();
  const tools = parseJson<any[]>(localStorage.getItem(TOOL_LIBRARY_KEY)) ?? [];
  tools.forEach((t) => {
    if (!t || t.kind !== 'tool' || typeof t.id !== 'string') return;
    const length = Number(t.length);
    const radius = Number(t.radius);
    assignables.set(t.id, {
      length: Number.isFinite(length) ? length : 50,
      radius: Number.isFinite(radius) ? radius : 4,
    });
  });

  const assemblies = parseJson<any[]>(localStorage.getItem(TOOL_ASSEMBLY_KEY)) ?? [];
  assemblies.forEach((a) => {
    if (!a || typeof a.id !== 'string' || !a.toolId) return;
    const length = Number(a.length);
    const radius = Number(a.radius);
    assignables.set(a.id, {
      length: Number.isFinite(length) ? length : 50,
      radius: Number.isFinite(radius) ? radius : 4,
    });
  });

  const station = parseJson<{ slots?: Array<string | null> }>(localStorage.getItem(TOOL_STATIONS_KEY));
  const slots = Array.isArray(station?.slots) ? station!.slots : [];
  slots.forEach((id, idx) => {
    if (!id || explicit.has(idx + 1)) return;
    const item = assignables.get(id);
    if (!item) return;
    setEntry(idx + 1, item.length, item.radius);
  });
}

function applyRuntimeRestoreSnapshot(core: MachineBrain, snapshot: RuntimeRestoreSnapshot) {
  const st: any = core.get_full_state();
  const axisIdByName = new Map<string, number>();
  (st.axes ?? []).forEach((ax: any) => axisIdByName.set(String(ax.physical_name ?? '').toUpperCase(), Number(ax.id)));

  const wcsIndexByLabel = new Map<string, number>();
  (st.work_offsets ?? []).forEach((w: any, idx: number) => wcsIndexByLabel.set(String(w.label ?? '').toUpperCase(), idx));

  (snapshot.workOffsets ?? []).forEach((wcs, idx) => {
    const wcsIndex = wcsIndexByLabel.get(String(wcs.label ?? '').toUpperCase()) ?? idx;
    (wcs.offsets ?? []).forEach((o) => {
      const axisId = axisIdByName.get(String(o.axisName ?? '').toUpperCase());
      if (axisId === undefined) return;
      core.set_work_zero(axisId, wcsIndex, Number(o.value ?? 0));
    });
  });

  const targetWcs = Number(snapshot.activeWcs ?? 0);
  if (Number.isFinite(targetWcs)) {
    core.set_active_wcs(Math.max(0, Math.floor(targetWcs)));
  }

  const ch0 = snapshot.channel0;
  if (ch0) {
    (core as any)?.set_tool_length?.(0, Number(ch0.toolLength ?? 0));
    (core as any)?.set_tool_radius?.(0, Math.max(0, Number(ch0.toolRadius ?? 0)));
    (core as any)?.set_tool_length_comp?.(0, !!ch0.lengthCompActive);
    (core as any)?.set_cutter_comp?.(0, Number(ch0.cutterComp ?? 40));
    (core as any)?.set_feed_override?.(0, Number(ch0.feedOverrideRatio ?? 1));
    (core as any)?.set_single_block?.(0, !!ch0.singleBlock);
    (core as any)?.set_active_tool?.(0, Math.max(0, Math.floor(Number(ch0.activeTool ?? 0))));
  }
}

export default function App() {
  const {
    state,
    brain,
    machineConfig,
    configVersion,
    reboot,
    pickingAxisId,
    setPickingAxisId,
    pickedPosition,
    setPickedPosition,
    fps,
    setSimulationRate,
  } = useMachine();
  const persistedAppState = useMemo(
    () => parseJson<PersistedAppState>(localStorage.getItem(APP_STATE_KEY)),
    []
  );
  const persistedCodes = persistedAppState?.codes?.length
    ? persistedAppState.codes
    : DEFAULT_GCODE_BY_CHANNEL;
  const areaRefs = useRef<Array<HTMLTextAreaElement | null>>([]);
  const highRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [showSetup, setShowSetup] = useState(false);
  const [showScene3d, setShowScene3d] = useState(() => persistedAppState?.showScene3d ?? true);
  const [showMachineModel, setShowMachineModel] = useState(() => persistedAppState?.showMachineModel ?? true);
  const [showToolModel, setShowToolModel] = useState(() => persistedAppState?.showToolModel ?? true);
  const [showStockModel, setShowStockModel] = useState(() => persistedAppState?.showStockModel ?? true);
  const [wcsReferenceVisual, setWcsReferenceVisual] = useState<ReferenceVisualMode>(
    () => persistedAppState?.wcsReferenceVisual ?? 'gizmo'
  );
  const [mcsReferenceVisual, setMcsReferenceVisual] = useState<ReferenceVisualMode>(
    () => persistedAppState?.mcsReferenceVisual ?? 'off'
  );
  const [toolControlPointVisible, setToolControlPointVisible] = useState(
    () => persistedAppState?.toolControlPointVisible ?? false
  );
  const [spindlePointVisible, setSpindlePointVisible] = useState(
    () => persistedAppState?.spindlePointVisible ?? false
  );
  const [showProgramPath, setShowProgramPath] = useState(() => persistedAppState?.showProgramPath ?? true);
  const [showToolPath, setShowToolPath] = useState(() => persistedAppState?.showToolPath ?? true);
  const showSpindlePath = false;
  const [pathResetNonce, setPathResetNonce] = useState(0);
  const [stockResetNonce, setStockResetNonce] = useState(0);
  const [feedOverride, setFeedOverride] = useState(() => persistedAppState?.feedOverride ?? 100);
  const [simulationSpeed, setSimulationSpeed] = useState(() => persistedAppState?.simulationSpeed ?? 100);
  const [singleBlock, setSingleBlock] = useState(() => persistedAppState?.singleBlock ?? false);
  const [liveToolpath, setLiveToolpath] = useState(() => persistedAppState?.liveToolpath ?? true);
  const [bottomBarHeight, setBottomBarHeight] = useState(BOTTOM_BAR_HEIGHT);
  const [toolVisualProfile, setToolVisualProfile] = useState<ToolVisualProfile>(
    () => persistedAppState?.toolVisualProfile ?? DEFAULT_TOOL_VISUAL_PROFILE
  );
  const [stockConfig, setStockConfig] = useState<StockConfig>(
    () => persistedAppState?.stockConfig ?? DEFAULT_STOCK_CONFIG
  );
  const [sceneConfig, setSceneConfig] = useState<SceneSetupConfig>(() => ({
    ...DEFAULT_SCENE_CONFIG,
    ...(persistedAppState?.sceneConfig ?? {}),
  }));
  const [codes, setCodes] = useState<string[]>(() => [...persistedCodes]);
  const [previewPath, setPreviewPath] = useState<PreviewPathData | null>(null);
  const [viewPerf, setViewPerf] = useState<ViewPerfStats>({ renderFps: 0, motionActive: false, idleIntervalMs: 120 });
  const [previewPerf, setPreviewPerf] = useState<PreviewPerfStats>({ ms: 0, points: 0 });
  const [alarmMessage, setAlarmMessage] = useState<string>('');
  const previewJobRef = useRef(0);
  const previewSigRef = useRef<string>('');
  const postBootSyncVersionRef = useRef<number>(-1);

  const appStateSnapshot = useMemo<PersistedAppState>(() => ({
    showScene3d,
    showMachineModel,
    showToolModel,
    showStockModel,
    wcsReferenceVisual,
    mcsReferenceVisual,
    toolControlPointVisible,
    spindlePointVisible,
    showProgramPath,
    showToolPath,
    showSpindlePath,
    feedOverride,
    simulationSpeed,
    singleBlock,
    liveToolpath,
    toolVisualProfile,
    stockConfig,
    sceneConfig,
    codes,
  }), [
    showScene3d,
    showMachineModel,
    showToolModel,
    showStockModel,
    wcsReferenceVisual,
    mcsReferenceVisual,
    toolControlPointVisible,
    spindlePointVisible,
    showProgramPath,
    showToolPath,
    showSpindlePath,
    feedOverride,
    simulationSpeed,
    singleBlock,
    liveToolpath,
    toolVisualProfile,
    stockConfig,
    sceneConfig,
    codes,
  ]);

  useEffect(() => {
    localStorage.setItem(APP_STATE_KEY, JSON.stringify(appStateSnapshot));
  }, [appStateSnapshot]);

  useEffect(() => {
    setSimulationRate(simulationSpeed / 100);
  }, [setSimulationRate, simulationSpeed]);

  useEffect(() => {
    if (!state?.estop && alarmMessage) {
      setAlarmMessage('');
    }
  }, [state?.estop, alarmMessage]);

  const buildRuntimeSnapshot = useMemo<RuntimeRestoreSnapshot | null>(() => {
    if (!state) return null;
    const axisNameById = new Map<number, string>();
    (state.axes ?? []).forEach((ax: any) => axisNameById.set(Number(ax.id), String(ax.physical_name ?? '')));
    const workOffsets: RuntimeWcsSnapshot[] = (state.work_offsets ?? []).map((w: any) => ({
      label: String(w.label ?? ''),
      offsets: (w.offsets ?? [])
        .map((o: any) => {
          const axisName = axisNameById.get(Number(o.axis_id)) ?? '';
          if (!axisName) return null;
          return { axisName, value: Number(o.value ?? 0) };
        })
        .filter(Boolean) as RuntimeOffsetSnapshot[],
    }));
    const ch0 = state.channels?.[0];
    const channel0: RuntimeChannelSnapshot | null = ch0
      ? {
          activeTool: Math.max(0, Number(ch0.active_tool ?? 0)),
          toolLength: Number(ch0.tool_length ?? 0),
          toolRadius: Number(ch0.tool_radius ?? 0),
          lengthCompActive: !!ch0.length_comp_active,
          cutterComp: Number(ch0.cutter_comp ?? 40),
          feedOverrideRatio: Number(ch0.feed_override ?? (feedOverride / 100)),
          singleBlock: !!ch0.single_block || singleBlock,
        }
      : null;
    return {
      activeWcs: Math.max(0, Number(state.active_wcs ?? 0)),
      workOffsets,
      channel0,
    };
  }, [state, feedOverride, singleBlock]);

  const exportSessionBackup = useMemo(
    () => async (selection: SessionBackupSelection = DEFAULT_SESSION_BACKUP_SELECTION) => {
      const storageKeys = storageKeysForSelection(selection);
      const stepMeshes = selection.tooling ? await collectStepMeshSnapshot() : undefined;
      const backup: SessionBackupFile = {
        format: SESSION_BACKUP_FORMAT,
        version: SESSION_BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        sections: selection,
        appState: buildAppStateSubset(appStateSnapshot, selection),
        runtimeState: selection.runtime ? buildRuntimeSnapshot : undefined,
        storage: storageKeys.length > 0 ? collectVmillStorageSnapshot(storageKeys) : undefined,
        stepMeshes,
      };
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vmill-session-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [appStateSnapshot, buildRuntimeSnapshot]
  );

  const importSessionBackup = useMemo(
    () => async (
      file: File,
      selection: SessionBackupSelection = DEFAULT_SESSION_BACKUP_SELECTION
    ): Promise<SessionImportResult> => {
      try {
        const raw = await file.text();
        const parsed = JSON.parse(raw) as Partial<SessionBackupFile>;
        if (parsed.format !== SESSION_BACKUP_FORMAT) {
          return { ok: false, message: 'Invalid backup format.' };
        }
        if (parsed.version !== SESSION_BACKUP_VERSION) {
          return { ok: false, message: `Unsupported backup version: ${String(parsed.version)}.` };
        }
        const selectedStorageKeys = storageKeysForSelection(selection);
        const hasSelectedStorage = selectedStorageKeys.length > 0 && !!parsed.storage;
        const hasSelectedAppState = (selection.view || selection.programs) && !!parsed.appState;
        const hasSelectedRuntime = selection.runtime && typeof parsed.runtimeState !== 'undefined';
        if (!hasSelectedStorage && !hasSelectedAppState && !hasSelectedRuntime) {
          return { ok: false, message: 'Backup file has no data for selected sections.' };
        }

        if (hasSelectedStorage && parsed.storage) {
          replaceVmillStorageKeys(parsed.storage, selectedStorageKeys);
        }

        if (selection.tooling) {
          await replaceStepMeshSnapshot(parsed.stepMeshes);
        }

        if (hasSelectedAppState) {
          const currentAppState = parseJson<PersistedAppState>(localStorage.getItem(APP_STATE_KEY)) ?? appStateSnapshot;
          const merged = mergeAppStateSubset(currentAppState, parsed.appState, selection);
          localStorage.setItem(APP_STATE_KEY, JSON.stringify(merged));
        }

        if (selection.runtime && typeof parsed.runtimeState !== 'undefined') {
          if (parsed.runtimeState) {
            localStorage.setItem(RUNTIME_RESTORE_KEY, JSON.stringify(parsed.runtimeState));
          } else {
            localStorage.removeItem(RUNTIME_RESTORE_KEY);
          }
        }

        window.location.reload();
        return { ok: true, message: 'Session sections restored. Reloading...' };
      } catch {
        return { ok: false, message: 'Unable to parse session backup JSON.' };
      }
    },
    [appStateSnapshot]
  );

  useEffect(() => {
    if (!brain || !state) return;
    if (postBootSyncVersionRef.current === configVersion) return;

    syncToolTableFromStorage(brain, 0);
    const pendingRuntimeRestore = parseJson<RuntimeRestoreSnapshot>(localStorage.getItem(RUNTIME_RESTORE_KEY));

    const allOffsetsZero = (state.work_offsets ?? []).every((w: any) =>
      (w.offsets ?? []).every((o: any) => Math.abs(Number(o.value ?? 0)) < 1e-9)
    );

    if (pendingRuntimeRestore) {
      applyRuntimeRestoreSnapshot(brain, pendingRuntimeRestore);
      localStorage.removeItem(RUNTIME_RESTORE_KEY);
      postBootSyncVersionRef.current = configVersion;
      return;
    }

    if (!allOffsetsZero) {
      postBootSyncVersionRef.current = configVersion;
      return;
    }

    const cfgAxes = machineConfig.activeMachine?.axes ?? [];
    const sceneToLinear = (axisName: string, sceneValue: number): number => {
      const stAx = state.axes.find((a: any) => a.physical_name === axisName);
      const cfgAx = cfgAxes.find((a: any) => a.physical_name === axisName);
      const invert = !!cfgAx?.invert;
      const machineZero = Number(stAx?.machine_zero ?? cfgAx?.machineZero ?? 0);
      const linearScene = invert ? -sceneValue : sceneValue;
      return linearScene - machineZero;
    };

    const stockTopScene = {
      x: stockConfig.position.x,
      z: -stockConfig.position.y,
      y: 8 + stockConfig.position.z + stockConfig.size.z * 0.5,
    };
    const targetByAxis: Record<string, number> = {
      X: sceneToLinear('X', stockTopScene.x),
      Y: sceneToLinear('Y', -stockTopScene.z),
      Z: sceneToLinear('Z', stockTopScene.y),
    };
    const wcsIndex = Number(state.active_wcs ?? 0);
    state.axes.forEach((ax: any) => {
      const v = targetByAxis[ax.physical_name];
      if (v !== undefined) {
        brain.set_work_zero(ax.id, wcsIndex, v);
      }
    });
    postBootSyncVersionRef.current = configVersion;
  }, [brain, state, configVersion, machineConfig.activeMachine, stockConfig]);

  const previewInputsKey = useMemo(() => {
    if (!state || !codes[0]?.trim()) {
      return '';
    }
    const ch0 = state?.channels?.[0];
    const stableWorkOffsets = (state?.work_offsets ?? [])
      .map((w: any) => ({
        label: String(w.label ?? ''),
        offsets: (w.offsets ?? [])
          .map((o: any) => [
            Number(o.axis_id ?? 0),
            roundPreviewValue(Number(o.value ?? 0)),
          ] as const)
          .sort((a: readonly [number, number], b: readonly [number, number]) => a[0] - b[0]),
      }))
      .sort((a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label));
    return JSON.stringify({
      code: codes[0] ?? '',
      csv: machineConfig.activeCSV,
      activeWcs: state?.active_wcs ?? 0,
      workOffsets: stableWorkOffsets,
      tool: ch0
        ? {
            length: roundPreviewValue(Number(ch0.tool_length ?? 0)),
            radius: roundPreviewValue(Number(ch0.tool_radius ?? 0)),
            lengthActive: !!ch0.length_comp_active,
            cutterComp: Number(ch0.cutter_comp ?? 40),
          }
        : null,
      stock: {
        sx: roundPreviewValue(Number(stockConfig.size.x ?? 0)),
        sy: roundPreviewValue(Number(stockConfig.size.y ?? 0)),
        sz: roundPreviewValue(Number(stockConfig.size.z ?? 0)),
        px: roundPreviewValue(Number(stockConfig.position.x ?? 0)),
        py: roundPreviewValue(Number(stockConfig.position.y ?? 0)),
        pz: roundPreviewValue(Number(stockConfig.position.z ?? 0)),
      },
    });
  }, [codes, machineConfig.activeCSV, state, stockConfig]);

  useEffect(() => {
    if (!state || !codes[0]?.trim()) {
      previewSigRef.current = '';
      setPreviewPath(null);
      return;
    }
    if (previewInputsKey === previewSigRef.current) return;
    previewSigRef.current = previewInputsKey;

    const jobId = ++previewJobRef.current;
    const timer = window.setTimeout(() => {
      try {
        const t0 = performance.now();
        const sim = new MachineBrain();
        const maps: Record<number, any[]> = {};
        machineConfig.activeCSV.split('\n').forEach((r) => {
          if (!r.trim()) return;
          const [ch, lab, lin, min, max, acc, inv, zero] = r.split(';');
          const id = sim.add_axis(lab, lin === '1' ? AxisType.Linear : AxisType.Rotary, +min, +max);
          sim.set_axis_accel(id, +(acc ?? 2000));
          sim.set_axis_invert(id, inv === '1');
          (sim as any).set_axis_machine_zero?.(id, +(zero ?? 0));
          const cN = +ch;
          if (!maps[cN]) maps[cN] = [];
          maps[cN].push({ axis_id: id, display_label: lab });
        });
        Object.entries(maps).forEach(([id, m]) => sim.add_channel(+id, m));

        (state.work_offsets ?? []).forEach((w: any, wIdx: number) => {
          (w.offsets ?? []).forEach((o: any) => sim.set_work_zero(o.axis_id, wIdx, Number(o.value ?? 0)));
        });
        sim.set_active_wcs(Number(state.active_wcs ?? 0));

        const ch0 = state.channels?.[0];
        if (ch0) {
          sim.set_tool_length(0, Number(ch0.tool_length ?? 0));
          sim.set_tool_radius(0, Number(ch0.tool_radius ?? 0));
          sim.set_tool_length_comp(0, !!ch0.length_comp_active);
          sim.set_cutter_comp(0, Number(ch0.cutter_comp ?? 40));
        }

        const previewPcOffset = 1;
        sim.load_program(0, `G61\n${codes[0]}\nG64`);

        const program: Array<{ x: number; y: number; z: number }> = [];
        const programRapid: Array<{ x: number; y: number; z: number }> = [];
        const tcp: Array<{ x: number; y: number; z: number }> = [];
        const tcpRapid: Array<{ x: number; y: number; z: number }> = [];
        const leadInTcp: Array<{ x: number; y: number; z: number }> = [];
        const leadOutTcp: Array<{ x: number; y: number; z: number }> = [];
        const codeLines = codes[0].split('\n').map((l: string) => l.trim().toUpperCase());
        const motionByLine: number[] = [];
        let modalMotion = 0; // 0=rapid, 1=feed/arc
        for (let i = 0; i < codeLines.length; i += 1) {
          const line = codeLines[i] ?? '';
          if (/\bG0\b|\bG00\b/.test(line)) modalMotion = 0;
          if (/\bG1\b|\bG01\b|\bG2\b|\bG02\b|\bG3\b|\bG03\b/.test(line)) modalMotion = 1;
          motionByLine[i] = modalMotion;
        }
        const modeForPc = (pc: number): 'lead_in' | 'lead_out' | null => {
          const idx = pc - previewPcOffset;
          if (idx < 0 || idx >= codeLines.length) return null;
          const line = codeLines[idx] ?? '';
          if (/\bG4[12]\b/.test(line)) return 'lead_in';
          if (/\bG40\b/.test(line)) return 'lead_out';
          return null;
        };
        const inferredFeedForPc = (pc: number): boolean => {
          const idx = pc - previewPcOffset;
          if (idx < 0 || idx >= motionByLine.length) return false;
          return motionByLine[idx] === 1;
        };

        const pushPoint = (
          arr: Array<{ x: number; y: number; z: number }>,
          p: { x: number; y: number; z: number },
          force = false
        ) => {
          const last = arr[arr.length - 1];
          if (!last) {
            arr.push(p);
            return;
          }
          if (force) {
            arr.push(p);
            return;
          }
          const dx = p.x - last.x;
          const dy = p.y - last.y;
          const dz = p.z - last.z;
          if (dx * dx + dy * dy + dz * dz >= 0.02) {
            arr.push(p);
          }
        };

        const toScene = (st: any, axisName: string, value: number): number => {
          const stAx = st.axes.find((a: any) => a.physical_name === axisName);
          const cfgAx = machineConfig.activeMachine?.axes.find((a: any) => a.physical_name === axisName);
          const machineZero = Number(stAx?.machine_zero ?? cfgAx?.machineZero ?? 0);
          const invert = typeof stAx?.invert === 'boolean' ? !!stAx.invert : !!cfgAx?.invert;
          const sceneValue = value + machineZero;
          return invert ? -sceneValue : sceneValue;
        };

        const getProgrammedWorkByName = (st: any, ch: any, axisName: string): number | null => {
          const axis = st.axes.find((a: any) => a.physical_name === axisName);
          if (!axis) return null;
          const p = ch?.programmed_work?.find((o: any) => Number(o.axis_id) === Number(axis.id));
          return typeof p?.value === 'number' ? p.value : null;
        };

        const getOffsetByName = (st: any, axisName: string): number => {
          const axis = st.axes.find((a: any) => a.physical_name === axisName);
          if (!axis) return 0;
          const activeWcs = Number(st.active_wcs ?? 0);
          const wcs = st.work_offsets?.[activeWcs];
          const off = wcs?.offsets?.find((o: any) => Number(o.axis_id) === Number(axis.id));
          return Number(off?.value ?? 0);
        };

        let guard = 0;
        let prevPc = Number(state.channels?.[0]?.active_pc ?? -1);
        let prevMode: 'lead_in' | 'lead_out' | null = null;
        while (guard < 24000) {
          guard += 1;
          let remaining = 8 * SIM_SPEED_MULTIPLIER;
          while (remaining > 0) {
            const step = Math.min(MAX_SIM_STEP_MS, remaining);
            sim.tick(step);
            remaining -= step;
          }
          const st: any = sim.get_full_state();
          const ch = st.channels?.[0];
          if (!st?.axes?.length || !ch) break;
          const activePc = Number(ch.active_pc ?? -1);
          const pcChanged = activePc !== prevPc;
          prevPc = activePc;
          const isFeedMotion = Number(ch.current_motion ?? 0) !== 0 || inferredFeedForPc(activePc);
          const isArcMotion = Number(ch.current_motion ?? 0) === 2 || Number(ch.current_motion ?? 0) === 3;
          const lineMode = modeForPc(activePc);
          const isRapidMotion = !isFeedMotion && lineMode === null;

          const getAxisMachine = (name: string): number => {
            const a = st.axes.find((ax: any) => ax.physical_name === name);
            return Number(a?.position ?? 0);
          };

          const mx = getAxisMachine('X');
          const my = getAxisMachine('Y');
          const mz = getAxisMachine('Z');

          const sx = toScene(st, 'X', mx);
          const sy = toScene(st, 'Z', mz);
          const sz = -toScene(st, 'Y', my);
          const controlLen = ch.length_comp_active ? Number(ch.tool_length ?? 0) : 0;
          const tcpPoint = { x: sx, y: sy - controlLen, z: sz };
          if (isFeedMotion || lineMode === 'lead_in' || lineMode === 'lead_out') {
            pushPoint(tcp, tcpPoint, pcChanged);
          } else if (isRapidMotion) {
            pushPoint(tcpRapid, tcpPoint, pcChanged);
          }
          if (lineMode === 'lead_in' && prevMode !== 'lead_in') {
            leadInTcp.length = 0;
          }
          if (lineMode === 'lead_out' && prevMode !== 'lead_out') {
            leadOutTcp.length = 0;
          }
          if (lineMode === 'lead_in') {
            pushPoint(leadInTcp, tcpPoint, pcChanged);
          } else if (lineMode === 'lead_out') {
            pushPoint(leadOutTcp, tcpPoint, pcChanged);
          }
          prevMode = lineMode;

          const pwX = getProgrammedWorkByName(st, ch, 'X');
          const pwY = getProgrammedWorkByName(st, ch, 'Y');
          const pwZ = getProgrammedWorkByName(st, ch, 'Z');
          if (!isArcMotion && pwX !== null && pwY !== null && pwZ !== null) {
            const pmX = pwX + getOffsetByName(st, 'X');
            const pmY = pwY + getOffsetByName(st, 'Y');
            const pmZ = pwZ + getOffsetByName(st, 'Z');
            const programPoint = {
              x: toScene(st, 'X', pmX),
              y: toScene(st, 'Z', pmZ),
              z: -toScene(st, 'Y', pmY),
            };
            if (isFeedMotion || lineMode === 'lead_in' || lineMode === 'lead_out') {
              pushPoint(program, programPoint, pcChanged);
            } else if (isRapidMotion) {
              pushPoint(programRapid, programPoint, pcChanged);
            }
          }

          // Arc fallback: programmed_work can be endpoint-only on some snapshots,
          // so sample curve points from live tool control-point motion to keep
          // PROGRAM preview curved like G2/G3.
          if (isArcMotion) {
            pushPoint(program, tcpPoint, false);
          }

          const allSettled = st.axes.every((a: any) => Math.abs(Number(a.position ?? 0) - Number(a.target ?? 0)) < 1e-3);
          if (!ch.is_running && allSettled) break;
        }

        if (previewJobRef.current === jobId) {
          const ms = performance.now() - t0;
          const points =
            tcp.length + tcpRapid.length + leadInTcp.length + leadOutTcp.length;
          setPreviewPerf({ ms: Math.round(ms), points });
          setPreviewPath({ program, programRapid, tcp, tcpRapid, spindle: [], spindleRapid: [], leadInTcp, leadOutTcp });
        }
      } catch {
        if (previewJobRef.current === jobId) {
          setPreviewPerf({ ms: 0, points: 0 });
          setPreviewPath(null);
        }
      }
    }, 2000);

    return () => window.clearTimeout(timer);
  }, [previewInputsKey]);

  if (!state) return <div style={s.loading}>BOOTING V-MILL KERNEL...</div>;
  const channelCount = state.channels.length;
  const handleCollisionAlarm = (message: string) => {
    setAlarmMessage(message);
    if (!state?.estop) {
      brain?.set_estop(true);
    }
  };

  return (
    <div style={s.shell}>

      {/* BACKGROUND: FULLSCREEN 3D — single MachineView with configVersion */}
      <div style={s.fullscreenCanvas}>
        <MachineView 
          state={state} 
          configVersion={configVersion}
          configAxes={machineConfig.activeMachine?.axes}
          spindleDiameter={machineConfig.activeMachine?.spindleDiameter}
          spindleLength={machineConfig.activeMachine?.spindleLength}
          spindleNoseDiameter={machineConfig.activeMachine?.spindleNoseDiameter}
          spindleNoseLength={machineConfig.activeMachine?.spindleNoseLength}
          spindleCapDiameter={machineConfig.activeMachine?.spindleCapDiameter}
          spindleCapLength={machineConfig.activeMachine?.spindleCapLength}
          spindleUp={machineConfig.activeMachine?.spindleUp}
          spindleOffsetX={machineConfig.activeMachine?.spindleOffsetX}
          spindleOffsetY={machineConfig.activeMachine?.spindleOffsetY}
          spindleOffsetZ={machineConfig.activeMachine?.spindleOffsetZ}
          spindleRotX={machineConfig.activeMachine?.spindleRotX}
          spindleRotY={machineConfig.activeMachine?.spindleRotY}
          spindleRotZ={machineConfig.activeMachine?.spindleRotZ}
          stockConfig={stockConfig}
          showScene3d={showScene3d}
          showMachineModel={showMachineModel}
          showToolModel={showToolModel}
          showStockModel={showStockModel}
          toolVisualProfile={toolVisualProfile}
          wcsReferenceVisual={wcsReferenceVisual}
          mcsReferenceVisual={mcsReferenceVisual}
          showToolControlPoint={toolControlPointVisible}
          showSpindlePoint={spindlePointVisible}
          showProgramPath={showProgramPath}
          showToolPath={showToolPath}
          showSpindlePath={showSpindlePath}
          sceneConfig={sceneConfig}
          onPickPosition={(_pos, value) => setPickedPosition({ axisId: pickingAxisId ?? -1, value })}
          pickingAxisId={pickingAxisId}
          pickedValue={pickedPosition && pickedPosition.axisId === pickingAxisId ? pickedPosition.value : undefined}
          pathResetNonce={pathResetNonce}
          stockResetNonce={stockResetNonce}
          livePreviewEnabled={liveToolpath}
          previewPath={previewPath}
          channelCode={codes[0] ?? ''}
          onPerfUpdate={setViewPerf}
          onCollisionAlarm={handleCollisionAlarm}
        />
      </div>

      <div style={s.perfTopBar}>
        <span style={s.perfTag}>PERF</span>
        <span style={s.perfItem}>PATH 1</span>
        <span style={s.perfItem}>KERNEL FPS <b>{fps}</b></span>
        <span style={s.perfItem}>RENDER FPS <b>{viewPerf.renderFps}</b></span>
        <span style={s.perfItem}>SCENE <b>{viewPerf.motionActive ? 'MOVING' : 'IDLE'}</b></span>
        <span style={s.perfItem}>IDLE STEP <b>{viewPerf.idleIntervalMs} ms</b></span>
        <span style={s.perfItem}>LIVE CALC <b>{previewPerf.ms} ms</b></span>
        <span style={s.perfItem}>LIVE PTS <b>{previewPerf.points}</b></span>
        {!!alarmMessage && <span style={s.perfAlarm}>{alarmMessage}</span>}
      </div>

      {/* OVERLAY: G-CODE PANELS */}
      <div style={{ ...s.overlayContainer, zoom: sceneConfig.uiScale }}>
        {state.channels.map((ch: any, i: number) => (
          <div key={ch.id} style={s.floatingPane}>
            <div style={s.head}>
              <span>PATH {ch.id}</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => {
                    const n = [...codes];
                    n[i] = formatGcode(n[i]);
                    setCodes(n);
                  }}
                  style={s.resetBtn}
                  title="Format current G-code"
                >
                  FORMAT
                </button>
                <button
                  onClick={() => {
                    brain?.reset_program(i);
                    setPathResetNonce((n) => n + 1);
                    setStockResetNonce((n) => n + 1);
                  }}
                  style={s.resetBtn}
                >
                  RESET
                </button>
                <button onClick={() => setPathResetNonce((n) => n + 1)} style={s.resetBtn}>CLEAR PATH</button>
              </div>
            </div>
            <div style={s.exampleRow}>
              {GCODE_EXAMPLES.map((ex) => (
                <button
                  key={ex.label}
                  style={s.exampleBtn}
                  onClick={() => {
                    const n = [...codes];
                    n[i] = ex.code;
                    setCodes(n);
                  }}
                >
                  {ex.label}
                </button>
              ))}
            </div>
            {i === 0 && (
              <div style={s.pathToggleRow}>
                <button
                  style={{ ...s.pathToggleBtn, ...(showProgramPath ? s.pathToggleOn : {}) }}
                  onClick={() => setShowProgramPath((v: boolean) => !v)}
                  title="Show/hide programmed contour path"
                >
                  PROGRAM
                </button>
                <button
                  style={{ ...s.pathToggleBtn, ...(showToolPath ? s.pathToggleOn : {}) }}
                  onClick={() => setShowToolPath((v: boolean) => !v)}
                  title="Show/hide tool control point (TCP) path"
                >
                  TCP
                </button>
                <button
                  style={{ ...s.pathToggleBtn, ...(liveToolpath ? s.pathToggleOn : {}) }}
                  onClick={() => setLiveToolpath((v: boolean) => !v)}
                  title="Instantly generate toolpath from current code"
                >
                  LIVE {liveToolpath ? 'ON' : 'OFF'}
                </button>
                <button
                  style={s.pathToggleBtn}
                  onClick={() => setStockResetNonce((n) => n + 1)}
                  title="Reset stock to initial block"
                >
                  RST STOCK
                </button>
              </div>
            )}
            <div style={s.edit}>
              <textarea
                ref={(el) => { areaRefs.current[i] = el; }}
                style={s.area} spellCheck={false} value={codes[i]}
                onChange={e => { const n = [...codes]; n[i] = e.target.value; setCodes(n); }}
                onScroll={(e) => {
                  if (!highRefs.current[i]) return;
                  highRefs.current[i]!.scrollTop = e.currentTarget.scrollTop;
                  highRefs.current[i]!.scrollLeft = e.currentTarget.scrollLeft;
                }}
              />
              <div ref={(el) => { highRefs.current[i] = el; }} style={s.high}>
                {codes[i].split('\n').map((l: string, li: number) => (
                  <div key={li} style={{
                    ...s.line,
                    background: ch.active_pc === li ? 'rgba(34,197,94,0.4)' : 'transparent',
                  }}>{l}</div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* SIDEBAR: ZERO CONTROL */}
      <ZeroPanel 
        state={state} 
        brain={brain}
        uiScale={sceneConfig.uiScale}
        bottomInset={bottomBarHeight + 8}
        showScene3d={showScene3d}
        showMachineModel={showMachineModel}
        showToolModel={showToolModel}
        sceneConfig={sceneConfig}
        toolVisualProfile={toolVisualProfile}
        wcsReferenceVisual={wcsReferenceVisual}
        mcsReferenceVisual={mcsReferenceVisual}
        spindlePointVisible={spindlePointVisible}
        fps={fps}
        toolControlPointVisible={toolControlPointVisible}
        onWcsReferenceVisualChange={setWcsReferenceVisual}
        onMcsReferenceVisualChange={setMcsReferenceVisual}
        onShowScene3dChange={setShowScene3d}
        onShowMachineModelChange={setShowMachineModel}
        onShowToolModelChange={setShowToolModel}
        onSceneConfigPatch={(patch) => setSceneConfig((prev) => ({ ...prev, ...patch }))}
        onToolVisualProfileChange={setToolVisualProfile}
        onSpindlePointVisibleChange={setSpindlePointVisible}
        onToolControlPointVisibleChange={setToolControlPointVisible}
        onAxisPickStart={(axisId) => {
          setPickedPosition(null);
          setPickingAxisId(axisId);
        }}
        onAxisPickEnd={() => setPickingAxisId(null)}
        pickedPosition={pickedPosition}
      />

      <BottomControlBar
        state={state}
        brain={brain}
        uiScale={sceneConfig.uiScale}
        onHeightChange={setBottomBarHeight}
        channelCount={channelCount}
        codes={codes}
        showScene3d={showScene3d}
        onShowScene3dChange={setShowScene3d}
        showStockModel={showStockModel}
        onShowStockModelChange={setShowStockModel}
        feedOverride={feedOverride}
        onFeedOverrideChange={setFeedOverride}
        simulationSpeed={simulationSpeed}
        onSimulationSpeedChange={setSimulationSpeed}
        singleBlock={singleBlock}
        onSingleBlockChange={setSingleBlock}
        showMachineModel={showMachineModel}
        onShowMachineModelChange={setShowMachineModel}
        showToolModel={showToolModel}
        onShowToolModelChange={setShowToolModel}
        onOpenSetup={() => setShowSetup(true)}
        onRewind={() => {
          for (let i = 0; i < channelCount; i += 1) {
            brain?.reset_program?.(i);
          }
          setPathResetNonce((n) => n + 1);
          setStockResetNonce((n) => n + 1);
        }}
      />

      {/* SETUP MODAL */}
      {showSetup && (
        <Suspense fallback={null}>
          <MachineConfigPanel
            cfg={machineConfig}
            stockConfig={stockConfig}
            onApplyStock={(next) => setStockConfig(next)}
            onExportSession={exportSessionBackup}
            onImportSessionFile={importSessionBackup}
            onClose={() => setShowSetup(false)}
            onApply={() => {
              reboot();
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

const s: Record<string, any> = {
  loading: { color: '#fff', background: '#000', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', fontSize: 14 },
  shell: { position: 'relative', height: '100vh', width: '100vw', background: '#000', overflow: 'hidden', fontFamily: 'monospace' },
  fullscreenCanvas: { position: 'absolute', inset: 0, zIndex: 1 },
  perfTopBar: {
    position: 'absolute',
    top: 0,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 25,
    height: 24,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '0 10px',
    background: 'rgba(8,10,16,0.82)',
    border: '1px solid #24344f',
    borderTop: 'none',
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    width: 'fit-content',
    maxWidth: 'calc(100vw - 24px)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    color: '#cbd5e1',
    fontSize: 10,
    pointerEvents: 'none',
  },
  perfTag: {
    fontSize: 10,
    color: '#7dd3fc',
    letterSpacing: '0.08em',
    marginRight: 6,
  },
  perfItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    color: '#9fb0cf',
  },
  perfAlarm: {
    color: '#fecaca',
    background: 'rgba(127, 29, 29, 0.7)',
    border: '1px solid #ef4444',
    borderRadius: 5,
    padding: '2px 8px',
    marginLeft: 4,
    fontWeight: 700,
    letterSpacing: '0.02em',
  },
  overlayContainer: { position: 'absolute', top: 20, left: 20, bottom: 100, right: 340, display: 'flex', gap: '20px', zIndex: 10, pointerEvents: 'none' },
  floatingPane: { width: '350px', display: 'flex', flexDirection: 'column', background: 'rgba(10,10,12,0.85)', backdropFilter: 'blur(8px)', border: '1px solid #333', borderRadius: '8px', pointerEvents: 'auto', overflow: 'hidden' },
  head: { padding: '10px', background: 'rgba(40,40,45,0.9)', display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 'bold', color: '#fff' },
  exampleRow: { padding: '6px 10px', display: 'flex', gap: '6px', background: 'rgba(20,20,25,0.9)', borderBottom: '1px solid #2b2f3b' },
  exampleBtn: { background: '#1e293b', color: '#94a3b8', border: '1px solid #334155', borderRadius: '4px', fontSize: '10px', padding: '4px 8px', cursor: 'pointer', fontFamily: 'monospace' },
  pathToggleRow: { padding: '6px 10px', display: 'flex', gap: '6px', background: 'rgba(16,18,24,0.92)', borderBottom: '1px solid #2b2f3b' },
  pathToggleBtn: { background: '#111827', color: '#94a3b8', border: '1px solid #334155', borderRadius: 4, fontSize: 10, padding: '4px 8px', cursor: 'pointer', fontFamily: 'monospace' },
  pathToggleOn: { background: '#14532d', color: '#bbf7d0', border: '1px solid #166534' },
  edit: { flex: 1, position: 'relative', minHeight: '200px' },
  area: { position: 'absolute', inset: 0, background: 'transparent', color: '#fff', border: 'none', padding: '10px', outline: 'none', resize: 'none', fontSize: '14px', lineHeight: '24px', zIndex: 2 },
  high: { position: 'absolute', inset: 0, padding: '10px 0', zIndex: 1, overflow: 'hidden' },
  line: { padding: '0 10px', height: '24px', color: 'transparent', whiteSpace: 'pre', borderLeft: '4px solid transparent' },
  resetBtn: {
    background: '#142238',
    color: '#9db4d8',
    border: '1px solid #2f4a73',
    padding: '2px 8px',
    borderRadius: '3px',
    cursor: 'pointer',
    fontSize: 10,
  },
};
