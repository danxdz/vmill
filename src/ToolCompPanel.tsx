import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { SidebarModuleProps } from './modules/moduleTypes';

const TOOL_LIBRARY_KEY = 'vmill_tool_library_v1';
const TOOL_ASSEMBLY_KEY = 'vmill_tool_assemblies_v1';
const TOOL_STATIONS_KEY = 'vmill_tool_stations_v1';
const TOOL_TABLE_KEY = 'vmill_tool_table_v1';
const TOOL_TABLE_CHANGED_EVENT = 'vmill:tool-table-changed';

interface AssignableItem {
  id: string;
  source: 'tool' | 'assembly';
  name: string;
  length: number;
  radius: number;
}

interface StationState {
  slotCount: number;
  activeSlot: number;
  slots: Array<string | null>;
}

interface TableOverride {
  h: number;
  d: number;
  assignedId?: string | null;
}

interface TableDraftRow {
  slot: number;
  assignedId: string | null;
  assignedLabel: string;
  h: string;
  d: string;
}

function parseNum(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const v = Number.parseFloat(raw.trim().replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

function clampSlots(v: number): number {
  if (!Number.isFinite(v)) return 12;
  return Math.max(1, Math.min(48, Math.floor(v)));
}

function loadStationState(): StationState {
  try {
    const raw = localStorage.getItem(TOOL_STATIONS_KEY);
    if (!raw) return { slotCount: 12, activeSlot: 0, slots: Array.from({ length: 12 }, () => null) };
    const parsed = JSON.parse(raw) as Partial<StationState>;
    const slotCount = clampSlots(Number(parsed.slotCount ?? 12));
    const slots = Array.from({ length: slotCount }, (_, i) => parsed.slots?.[i] ?? null);
    const activeSlot = Math.max(0, Math.min(slotCount - 1, Number(parsed.activeSlot ?? 0)));
    return { slotCount, activeSlot, slots };
  } catch {
    return { slotCount: 12, activeSlot: 0, slots: Array.from({ length: 12 }, () => null) };
  }
}

function loadAssignableMap(): Map<string, AssignableItem> {
  const map = new Map<string, AssignableItem>();
  try {
    const toolRaw = localStorage.getItem(TOOL_LIBRARY_KEY);
    if (toolRaw) {
      const tools = JSON.parse(toolRaw) as any[];
      for (const t of tools) {
        if (!t || t.kind !== 'tool' || typeof t.id !== 'string') continue;
        const length = Number(t.length);
        const radius = Number(t.radius);
        map.set(t.id, {
          id: t.id,
          source: 'tool',
          name: String(t.name ?? 'Tool'),
          length: Number.isFinite(length) ? length : 50,
          radius: Number.isFinite(radius) ? radius : 4,
        });
      }
    }
  } catch {
    // ignore
  }

  try {
    const asmRaw = localStorage.getItem(TOOL_ASSEMBLY_KEY);
    if (asmRaw) {
      const assemblies = JSON.parse(asmRaw) as any[];
      for (const a of assemblies) {
        if (!a || typeof a.id !== 'string' || !a.toolId) continue;
        const length = Number(a.length);
        const radius = Number(a.radius);
        map.set(a.id, {
          id: a.id,
          source: 'assembly',
          name: String(a.name ?? 'Assembly'),
          length: Number.isFinite(length) ? length : 50,
          radius: Number.isFinite(radius) ? radius : 4,
        });
      }
    }
  } catch {
    // ignore
  }

  return map;
}

function loadOverrides(): Record<number, TableOverride> {
  try {
    const raw = localStorage.getItem(TOOL_TABLE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Partial<TableOverride>>;
    const out: Record<number, TableOverride> = {};
    Object.entries(parsed).forEach(([k, v]) => {
      const slot = Number(k);
      const h = Number(v?.h);
      const d = Number(v?.d);
      const assignedId =
        typeof v?.assignedId === 'string' || v?.assignedId === null
          ? v.assignedId
          : undefined;
      if (!Number.isFinite(slot)) return;
      if (!Number.isFinite(h) || !Number.isFinite(d)) return;
      out[slot] = { h, d, assignedId };
    });
    return out;
  } catch {
    return {};
  }
}

function saveOverrides(next: Record<number, TableOverride>) {
  localStorage.setItem(TOOL_TABLE_KEY, JSON.stringify(next));
}

function buildRows(
  station: StationState,
  assignables: Map<string, AssignableItem>,
  overrides: Record<number, TableOverride>
): TableDraftRow[] {
  const rows: TableDraftRow[] = [];
  for (let slot = 1; slot <= station.slotCount; slot += 1) {
    const assignedId = station.slots[slot - 1] ?? null;
    const assigned = assignedId ? assignables.get(assignedId) : undefined;
    const ovRaw = overrides[slot];
    const overrideMatchesAssigned = !!ovRaw && ovRaw.assignedId === assignedId;
    const ov = overrideMatchesAssigned ? ovRaw : undefined;
    const h = ov?.h ?? assigned?.length ?? 0;
    const d = ov?.d ?? assigned?.radius ?? 0;
    const assignedLabel = assigned
      ? `${assigned.source === 'assembly' ? 'ASM' : 'TOOL'} ${assigned.name}`
      : '(empty)';
    rows.push({
      slot,
      assignedId,
      assignedLabel,
      h: h.toFixed(3),
      d: d.toFixed(3),
    });
  }
  return rows;
}

export default function ToolCompPanel({ runtime }: SidebarModuleProps) {
  const ch0 = useMemo(() => runtime.telemetry.channels[0], [runtime.telemetry.channels]);
  const [toolLength, setToolLength] = useState(() => (ch0?.tool_length ?? 0).toFixed(3));
  const [toolRadius, setToolRadius] = useState(() => (ch0?.tool_radius ?? 0).toFixed(3));
  const [rows, setRows] = useState<TableDraftRow[]>([]);
  const [stationActiveT, setStationActiveT] = useState(1);
  const [msg, setMsg] = useState('');

  const refreshTable = () => {
    const station = loadStationState();
    const assignables = loadAssignableMap();
    const overrides = loadOverrides();
    setRows(buildRows(station, assignables, overrides));
    setStationActiveT(station.activeSlot + 1);
  };

  useEffect(() => {
    refreshTable();
    const onChanged = () => refreshTable();
    window.addEventListener('vmill:tool-library-changed', onChanged);
    window.addEventListener('vmill:tool-assemblies-changed', onChanged);
    window.addEventListener('vmill:tool-stations-changed', onChanged);
    window.addEventListener(TOOL_TABLE_CHANGED_EVENT, onChanged);
    window.addEventListener('storage', onChanged);
    return () => {
      window.removeEventListener('vmill:tool-library-changed', onChanged);
      window.removeEventListener('vmill:tool-assemblies-changed', onChanged);
      window.removeEventListener('vmill:tool-stations-changed', onChanged);
      window.removeEventListener(TOOL_TABLE_CHANGED_EVENT, onChanged);
      window.removeEventListener('storage', onChanged);
    };
  }, []);

  useEffect(() => {
    setToolLength((ch0?.tool_length ?? 0).toFixed(3));
    setToolRadius((ch0?.tool_radius ?? 0).toFixed(3));
  }, [ch0?.tool_length, ch0?.tool_radius]);

  if (!ch0) return <div style={s.msg}>No channel available</div>;

  const activeT = Number(ch0.active_tool ?? 0);

  const setRow = (slot: number, patch: Partial<TableDraftRow>) => {
    setRows((prev) => prev.map((r) => (r.slot === slot ? { ...r, ...patch } : r)));
  };

  const applyRow = (row: TableDraftRow, silent = false): boolean => {
    const h = parseNum(row.h);
    const d = parseNum(row.d);
    if (h === null || d === null) {
      if (!silent) setMsg(`Invalid H/D for T${row.slot}`);
      return false;
    }
    const dAbs = Math.max(0, d);
    runtime.can.emit('command', {
      type: 'tool.set_table_entry',
      channelIndex: 0,
      slot: row.slot,
      length: h,
      radius: dAbs,
    });
    const overrides = loadOverrides();
    overrides[row.slot] = { h, d: dAbs, assignedId: row.assignedId };
    saveOverrides(overrides);
    if (activeT === row.slot) {
      setToolLength(h.toFixed(3));
      setToolRadius(dAbs.toFixed(3));
    }
    if (!silent) setMsg(`T${row.slot} set: H${h.toFixed(3)} D${dAbs.toFixed(3)}`);
    window.dispatchEvent(new CustomEvent(TOOL_TABLE_CHANGED_EVENT));
    return true;
  };

  const loadRow = (row: TableDraftRow) => {
    if (!applyRow(row, true)) return;
    runtime.can.emit('command', { type: 'tool.set_active_tool', channelIndex: 0, slot: row.slot });
    const h = parseNum(row.h);
    const d = parseNum(row.d);
    if (h !== null) setToolLength(h.toFixed(3));
    if (d !== null) setToolRadius(Math.max(0, d).toFixed(3));
    setMsg(`Loaded T${row.slot}`);
  };

  return (
    <div style={s.wrap}>
      <div style={s.infoRow}>
        <span style={s.label}>Channel</span>
        <span style={s.value}>CH{ch0.id}</span>
        <span style={s.label}>Active T</span>
        <span style={s.value}>T{activeT}</span>
        <span style={s.label}>Station T</span>
        <span style={s.value}>T{stationActiveT}</span>
      </div>

      <div style={s.row}>
        <span style={s.label}>H (Length)</span>
        <input
          style={s.input}
          value={toolLength}
          onChange={(e) => setToolLength(e.target.value)}
          onBlur={() => {
            const v = parseNum(toolLength);
            if (v !== null) runtime.can.emit('command', { type: 'tool.set_length', channelIndex: 0, value: v });
          }}
        />
        <button style={s.btn} onClick={() => runtime.can.emit('command', { type: 'tool.set_length_comp', channelIndex: 0, active: true })}>G43</button>
        <button
          style={{ ...s.btn, ...(ch0.length_comp_active ? s.btnOn : {}) }}
          onClick={() => runtime.can.emit('command', { type: 'tool.set_length_comp', channelIndex: 0, active: !ch0.length_comp_active })}
        >
          {ch0.length_comp_active ? 'ON' : 'OFF'}
        </button>
        <button style={s.btn} onClick={() => runtime.can.emit('command', { type: 'tool.set_length_comp', channelIndex: 0, active: false })}>G49</button>
      </div>

      <div style={s.row}>
        <span style={s.label}>D (Comp)</span>
        <input
          style={s.input}
          value={toolRadius}
          onChange={(e) => setToolRadius(e.target.value)}
          onBlur={() => {
            const v = parseNum(toolRadius);
            if (v !== null) runtime.can.emit('command', { type: 'tool.set_radius', channelIndex: 0, value: Math.max(0, v) });
          }}
        />
        <button style={s.btn} onClick={() => runtime.can.emit('command', { type: 'tool.set_cutter_comp', channelIndex: 0, mode: 40 })}>G40</button>
        <button style={{ ...s.btn, ...(ch0.cutter_comp === 41 ? s.btnOn : {}) }} onClick={() => runtime.can.emit('command', { type: 'tool.set_cutter_comp', channelIndex: 0, mode: 41 })}>G41</button>
        <button style={{ ...s.btn, ...(ch0.cutter_comp === 42 ? s.btnOn : {}) }} onClick={() => runtime.can.emit('command', { type: 'tool.set_cutter_comp', channelIndex: 0, mode: 42 })}>G42</button>
      </div>

      <div style={s.tableHead}>
        <span style={s.tableTitle}>TOOL TABLE (T/H/D)</span>
        <div style={s.tableHeadBtns}>
          <button
            style={s.btn}
            onClick={() => {
              let ok = 0;
              rows.forEach((r) => { if (applyRow(r, true)) ok += 1; });
              setMsg(`Synced ${ok} table slot${ok !== 1 ? 's' : ''}`);
            }}
          >
            SYNC ALL
          </button>
          <button
            style={s.btn}
            onClick={() => {
              const row = rows.find((r) => r.slot === stationActiveT);
              if (row) loadRow(row);
            }}
          >
            LOAD STATION
          </button>
        </div>
      </div>

      <div style={s.tableLegend}>
        <span>T</span>
        <span>Assigned</span>
        <span>H</span>
        <span>D</span>
        <span>SET</span>
        <span>LOAD</span>
      </div>

      <div style={s.tableList}>
        {rows.map((row) => (
          <div key={row.slot} style={{ ...s.tableRow, ...(activeT === row.slot ? s.tableRowActive : {}) }}>
            <span style={s.slotTag}>T{row.slot}</span>
            <span style={s.assigned} title={row.assignedLabel}>{row.assignedLabel}</span>
            <input style={s.input} value={row.h} onChange={(e) => setRow(row.slot, { h: e.target.value })} />
            <input style={s.input} value={row.d} onChange={(e) => setRow(row.slot, { d: e.target.value })} />
            <button style={s.btn} onClick={() => applyRow(row)}>SET</button>
            <button style={s.btn} onClick={() => loadRow(row)}>LOAD</button>
          </div>
        ))}
      </div>

      <div style={s.row}>
        <span style={s.label}>Ctrl Point</span>
        <span style={s.value}>{runtime.telemetry.toolControlPointVisible ? 'Visible' : 'Hidden'}</span>
        <button
          style={{ ...s.btn, ...(runtime.telemetry.toolControlPointVisible ? s.btnOn : {}), gridColumn: 'span 3' }}
          onClick={() => runtime.can.emit('command', { type: 'ui.set_tool_control_point', visible: !runtime.telemetry.toolControlPointVisible })}
        >
          {runtime.telemetry.toolControlPointVisible ? 'ON' : 'OFF'}
        </button>
      </div>

      <div style={s.row}>
        <span style={s.label}>Spindle Pt</span>
        <span style={s.value}>{runtime.telemetry.spindlePointVisible ? 'Visible' : 'Hidden'}</span>
        <button
          style={{ ...s.btn, ...(runtime.telemetry.spindlePointVisible ? s.btnOn : {}), gridColumn: 'span 3' }}
          onClick={() => runtime.can.emit('command', { type: 'ui.set_spindle_point', visible: !runtime.telemetry.spindlePointVisible })}
        >
          {runtime.telemetry.spindlePointVisible ? 'ON' : 'OFF'}
        </button>
      </div>

      <div style={s.note}>D uses cutter-comp value (radius) in this simulator.</div>
      {msg ? <div style={s.msg}>{msg}</div> : null}
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 6 },
  msg: { color: '#7dd3fc', fontSize: 10 },
  note: { color: '#64748b', fontSize: 10 },
  infoRow: {
    display: 'grid',
    gridTemplateColumns: '64px 1fr 64px 1fr 64px 1fr',
    gap: 4,
    alignItems: 'center',
  },
  row: { display: 'grid', gridTemplateColumns: '74px 1fr 44px 44px 44px', gap: 4, alignItems: 'center' },
  label: { color: '#8ca0c5', fontSize: 10 },
  value: { color: '#dbeafe', fontSize: 11 },
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
  btn: {
    background: '#142238',
    border: '1px solid #2f4a73',
    borderRadius: 3,
    color: '#94a3b8',
    cursor: 'pointer',
    fontSize: 10,
    padding: '4px 0',
    fontFamily: 'monospace',
  },
  btnOn: { background: '#14532d', border: '1px solid #166534', color: '#86efac' },
  tableHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  tableTitle: { color: '#93c5fd', fontSize: 10, letterSpacing: '0.08em', fontWeight: 700 },
  tableHeadBtns: { display: 'flex', gap: 4 },
  tableLegend: {
    display: 'grid',
    gridTemplateColumns: '34px 1fr 74px 74px 42px 46px',
    gap: 4,
    color: '#64748b',
    fontSize: 10,
    padding: '0 2px',
  },
  tableList: { display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 210, overflowY: 'auto' },
  tableRow: {
    display: 'grid',
    gridTemplateColumns: '34px 1fr 74px 74px 42px 46px',
    gap: 4,
    alignItems: 'center',
    border: '1px solid #22314e',
    borderRadius: 4,
    padding: 4,
    background: '#0b1320',
  },
  tableRowActive: {
    border: '1px solid #22c55e',
    background: '#0d1c1a',
  },
  slotTag: {
    color: '#dbeafe',
    fontSize: 10,
    fontWeight: 700,
    textAlign: 'center',
  },
  assigned: {
    color: '#9fb4d7',
    fontSize: 10,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
};
