import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { SidebarModuleProps, ToolVisualProfile } from './modules/moduleTypes';

type StationMode = 'magazine' | 'turret';

interface ToolItem {
  id: string;
  kind: 'tool' | 'holder' | 'extension';
  name: string;
  length: number;
  radius: number;
  visual?: ToolVisualProfile;
}

interface ToolAssembly {
  id: string;
  name: string;
  length: number;
  radius: number;
  visual?: ToolVisualProfile;
  toolId?: string;
}

interface AssignableItem {
  id: string;
  source: 'tool' | 'assembly';
  name: string;
  length: number;
  radius: number;
  visual?: ToolVisualProfile;
}

interface StationState {
  mode: StationMode;
  slotCount: number;
  activeSlot: number; // 0-based
  slots: Array<string | null>;
}

const TOOL_LIBRARY_KEY = 'vmill_tool_library_v1';
const TOOL_ASSEMBLY_KEY = 'vmill_tool_assemblies_v1';
const STATION_KEY = 'vmill_tool_stations_v1';
const DEFAULT_SLOTS = 12;
const TOOL_TABLE_CHANGED_EVENT = 'vmill:tool-table-changed';
const HIDDEN_TOOL_VISUAL_PROFILE: ToolVisualProfile = {
  l1: 0,
  d1: 1,
  l2: 0,
  d2: 1,
  l3: 0,
  d3: 1,
  useHolder: false,
  stickout: 0.5,
};

function fromTool(length: number, radius: number): ToolVisualProfile {
  const total = Math.max(12, length || 28);
  const l1 = Math.max(2, total * 0.35);
  const l2 = Math.max(2, total * 0.25);
  const l3 = Math.max(2, total - l1 - l2);
  const d1 = Math.max(1, radius > 0 ? radius * 2 : 8);
  const d2 = Math.max(1, d1 * 1.4);
  const d3 = Math.max(1, d1 * 1.9);
  return {
    l1,
    d1,
    l2,
    d2,
    l3,
    d3,
    useHolder: false,
    holderLength: 18,
    holderDiameter: Math.max(12, d3 * 1.2),
    stickout: total,
  };
}

function clampSlotCount(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_SLOTS;
  return Math.max(1, Math.min(48, Math.floor(v)));
}

function normalizeStation(raw: Partial<StationState> | null): StationState {
  const slotCount = clampSlotCount(Number(raw?.slotCount ?? DEFAULT_SLOTS));
  const slots = Array.from({ length: slotCount }, (_, i) => raw?.slots?.[i] ?? null);
  const activeSlotRaw = Number(raw?.activeSlot ?? 0);
  const activeSlot = Math.max(0, Math.min(slotCount - 1, Number.isFinite(activeSlotRaw) ? activeSlotRaw : 0));
  const mode: StationMode = raw?.mode === 'turret' ? 'turret' : 'magazine';
  return { mode, slotCount, activeSlot, slots };
}

function loadStationState(): StationState {
  try {
    const raw = localStorage.getItem(STATION_KEY);
    if (!raw) return normalizeStation(null);
    return normalizeStation(JSON.parse(raw) as Partial<StationState>);
  } catch {
    return normalizeStation(null);
  }
}

function loadAssignableItems(): AssignableItem[] {
  try {
    const rawTools = localStorage.getItem(TOOL_LIBRARY_KEY);
    const rawAssemblies = localStorage.getItem(TOOL_ASSEMBLY_KEY);
    const tools: AssignableItem[] = rawTools
      ? (JSON.parse(rawTools) as ToolItem[])
      .filter((t) => t && t.kind === 'tool' && typeof t.id === 'string')
      .map((t) => {
        const length = Number(t.length);
        const radius = Number(t.radius);
        return {
          id: t.id,
          source: 'tool' as const,
          name: t.name,
          length: Number.isFinite(length) ? length : 50,
          radius: Number.isFinite(radius) ? radius : 4,
          visual: t.visual,
        };
      })
      : [];
    const assemblies: AssignableItem[] = rawAssemblies
      ? (JSON.parse(rawAssemblies) as ToolAssembly[])
          .filter(
            (a) =>
              a
              && typeof a.id === 'string'
              && typeof a.toolId === 'string'
              && a.toolId.trim().length > 0
          )
          .map((a) => ({
            id: a.id,
            source: 'assembly' as const,
            name: a.name || 'Assembly',
            length: Number.isFinite(Number(a.length)) ? Number(a.length) : 50,
            radius: Number.isFinite(Number(a.radius)) ? Number(a.radius) : 4,
            visual: a.visual,
          }))
      : [];
    return [...assemblies, ...tools];
  } catch {
    return [];
  }
}

export default function ToolStationsPanel({ runtime }: SidebarModuleProps) {
  const [station, setStation] = useState<StationState>(() => loadStationState());
  const [assignables, setAssignables] = useState<AssignableItem[]>(() => loadAssignableItems());
  const ch0 = runtime.telemetry.channels[0];

  useEffect(() => {
    localStorage.setItem(STATION_KEY, JSON.stringify(station));
    window.dispatchEvent(new CustomEvent('vmill:tool-stations-changed'));
  }, [station]);

  useEffect(() => {
    const onLibraryChanged = () => setAssignables(loadAssignableItems());
    onLibraryChanged();
    window.addEventListener('vmill:tool-library-changed', onLibraryChanged);
    window.addEventListener('vmill:tool-assemblies-changed', onLibraryChanged);
    return () => {
      window.removeEventListener('vmill:tool-library-changed', onLibraryChanged);
      window.removeEventListener('vmill:tool-assemblies-changed', onLibraryChanged);
    };
  }, []);

  const activeToolNumber = useMemo(() => {
    if (!ch0) return 0;
    return Number(ch0.active_tool ?? 0);
  }, [ch0]);

  const setSlotTool = (slotIndex: number, toolId: string | null) => {
    setStation((prev) => {
      const nextSlots = prev.slots.slice();
      nextSlots[slotIndex] = toolId;
      return { ...prev, slots: nextSlots };
    });
  };

  const syncSlotToCore = (slotIndex: number) => {
    const itemId = station.slots[slotIndex];
    if (!itemId) return;
    const item = assignables.find((t) => t.id === itemId);
    if (!item) return;
    const toolNumber = slotIndex + 1;
    runtime.can.emit('command', {
      type: 'tool.set_table_entry',
      channelIndex: 0,
      slot: toolNumber,
      length: item.length,
      radius: item.radius,
    });
    window.dispatchEvent(new CustomEvent(TOOL_TABLE_CHANGED_EVENT));
  };

  const loadSlot = (slotIndex: number) => {
    const itemId = station.slots[slotIndex];
    if (!itemId) {
      setStation((prev) => ({ ...prev, activeSlot: slotIndex }));
      return;
    }
    const item = assignables.find((t) => t.id === itemId);
    if (!item) {
      setStation((prev) => ({ ...prev, activeSlot: slotIndex }));
      return;
    }

    const toolNumber = slotIndex + 1;
    runtime.can.emit('command', {
      type: 'tool.set_table_entry',
      channelIndex: 0,
      slot: toolNumber,
      length: item.length,
      radius: item.radius,
    });
    runtime.can.emit('command', { type: 'tool.set_active_tool', channelIndex: 0, slot: toolNumber });
    runtime.can.emit('command', { type: 'tool.set_length', channelIndex: 0, value: item.length });
    runtime.can.emit('command', { type: 'tool.set_radius', channelIndex: 0, value: item.radius });
    runtime.can.emit('command', { type: 'ui.set_tool_visual_profile', profile: item.visual ?? fromTool(item.length, item.radius) });
    window.dispatchEvent(new CustomEvent(TOOL_TABLE_CHANGED_EVENT));
    setStation((prev) => ({ ...prev, activeSlot: slotIndex }));
  };

  const syncAll = () => {
    for (let i = 0; i < station.slotCount; i += 1) syncSlotToCore(i);
  };

  const unloadTool = () => {
    // T0 concept: spindle/toolchain empty.
    runtime.can.emit('command', {
      type: 'tool.set_table_entry',
      channelIndex: 0,
      slot: 0,
      length: 0,
      radius: 0,
    });
    runtime.can.emit('command', { type: 'tool.set_active_tool', channelIndex: 0, slot: 0 });
    runtime.can.emit('command', { type: 'tool.set_length_comp', channelIndex: 0, active: false });
    runtime.can.emit('command', { type: 'tool.set_cutter_comp', channelIndex: 0, mode: 40 });
    runtime.can.emit('command', { type: 'tool.set_length', channelIndex: 0, value: 0 });
    runtime.can.emit('command', { type: 'tool.set_radius', channelIndex: 0, value: 0 });
    runtime.can.emit('command', { type: 'ui.set_tool_visual_profile', profile: HIDDEN_TOOL_VISUAL_PROFILE });
    window.dispatchEvent(new CustomEvent(TOOL_TABLE_CHANGED_EVENT));
  };

  const toggleSlotLoad = (slotIndex: number) => {
    const toolNumber = slotIndex + 1;
    setStation((prev) => ({ ...prev, activeSlot: slotIndex }));
    if (Math.max(0, activeToolNumber) === toolNumber) {
      unloadTool();
      return;
    }
    loadSlot(slotIndex);
  };

  return (
    <div style={s.wrap}>
      <div style={s.modeRow}>
        <button
          style={{ ...s.btn, ...(station.mode === 'magazine' ? s.btnOn : {}) }}
          onClick={() => setStation((prev) => ({ ...prev, mode: 'magazine' }))}
        >
          MAGAZINE
        </button>
        <button
          style={{ ...s.btn, ...(station.mode === 'turret' ? s.btnOn : {}) }}
          onClick={() => setStation((prev) => ({ ...prev, mode: 'turret' }))}
        >
          TURRET
        </button>
      </div>

      <div style={s.grid}>
        <span style={s.label}>Slots</span>
        <input
          style={s.input}
          value={station.slotCount}
          onChange={(e) => {
            const nextCount = clampSlotCount(Number(e.target.value));
            setStation((prev) => {
              const slots = Array.from({ length: nextCount }, (_, i) => prev.slots[i] ?? null);
              const activeSlot = Math.min(prev.activeSlot, nextCount - 1);
              return { ...prev, slotCount: nextCount, slots, activeSlot };
            });
          }}
        />
        <button style={s.btn} onClick={syncAll}>SYNC TABLE</button>
        <button
          style={{ ...s.btn, ...s.btnDanger }}
          onClick={unloadTool}
          title="Unload current tool (T0) and clear active H/D compensation"
        >
          UNLOAD
        </button>
      </div>

      <div style={s.infoRow}>
        <span style={s.kv}>ACTIVE SLOT: T{station.activeSlot + 1}</span>
        <span style={s.kv}>
          {Math.max(0, activeToolNumber) > 0
            ? `LOADED TOOL: T${Math.max(0, activeToolNumber)}`
            : 'LOADED TOOL: T0 (EMPTY)'}
        </span>
      </div>

      <div style={s.slotList}>
        {Array.from({ length: station.slotCount }, (_, i) => {
          const toolId = station.slots[i];
          const isActive = i === station.activeSlot;
          const isLoaded = Math.max(0, activeToolNumber) === i + 1;
          const hasTool = !!toolId;
          return (
            <div key={i} style={{ ...s.slotRow, ...(isActive ? s.slotRowActive : {}) }}>
              <button
                style={{
                  ...s.slotNum,
                  ...(isActive ? s.slotNumActive : {}),
                  ...(isLoaded ? s.slotNumLoaded : {}),
                  ...(!hasTool ? s.slotNumDisabled : {}),
                }}
                onClick={() => toggleSlotLoad(i)}
                title={isLoaded ? `Unload T${i + 1}` : `Load T${i + 1}`}
                disabled={!hasTool}
              >
                {isLoaded ? `T${i + 1} ON` : `T${i + 1}`}
              </button>
              <select
                style={s.select}
                value={toolId ?? ''}
                onChange={(e) => setSlotTool(i, e.target.value || null)}
              >
                <option value="">(empty)</option>
                {assignables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.source === 'assembly' ? `ASM - ${t.name}` : `TOOL - ${t.name}`}
                  </option>
                ))}
              </select>
              <button style={s.btn} onClick={() => setSlotTool(i, null)}>CLR</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 6 },
  modeRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 },
  grid: {
    display: 'grid',
    gridTemplateColumns: '56px 1fr 1fr 1fr',
    gap: 4,
    alignItems: 'center',
  },
  infoRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 4,
    alignItems: 'center',
    background: '#0f172a',
    border: '1px solid #22314e',
    borderRadius: 4,
    padding: '4px 6px',
  },
  kv: { color: '#9db4d8', fontSize: 10 },
  slotList: {
    maxHeight: 210,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    paddingRight: 2,
  },
  slotRow: {
    display: 'grid',
    gridTemplateColumns: '72px 1fr 42px',
    gap: 4,
    alignItems: 'center',
    border: '1px solid #22314e',
    borderRadius: 4,
    padding: 4,
    background: '#0b1320',
  },
  slotRowActive: {
    border: '1px solid #22c55e',
    background: '#0d1c1a',
  },
  slotNum: {
    background: '#13243c',
    border: '1px solid #2f4a73',
    borderRadius: 3,
    color: '#9db4d8',
    cursor: 'pointer',
    fontSize: 10,
    fontWeight: 700,
    fontFamily: 'monospace',
    padding: '5px 0',
  },
  slotNumActive: {
    background: '#14532d',
    border: '1px solid #166534',
    color: '#86efac',
  },
  slotNumLoaded: {
    background: '#166534',
    border: '1px solid #22c55e',
    color: '#dcfce7',
  },
  slotNumDisabled: {
    opacity: 0.45,
    cursor: 'not-allowed',
  },
  label: { color: '#8ca0c5', fontSize: 10 },
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
  btnOn: {
    background: '#14532d',
    border: '1px solid #166534',
    color: '#86efac',
  },
  btnDanger: {
    background: '#3a1212',
    border: '1px solid #7f1d1d',
    color: '#fecaca',
  },
};
