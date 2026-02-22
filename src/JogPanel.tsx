import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { SidebarModuleProps } from './modules/moduleTypes';

const JOG_STEPS = [0.01, 0.1, 1, 10, 100];

export default function JogPanel({ runtime }: SidebarModuleProps) {
  const [step, setStep] = useState(1);
  const [deltaInput, setDeltaInput] = useState('1');
  const [feed, setFeed] = useState('2000');
  const [rapidMode, setRapidMode] = useState(false);
  const { telemetry, can } = runtime;
  const axes = telemetry.axes;
  const activeOffsets = telemetry.workOffsets[telemetry.activeWcs]?.offsets ?? [];
  const getOffset = (axisId: number) => activeOffsets.find((o) => o.axis_id === axisId)?.value ?? 0;
  const getPrimaryHomeAxisId = () => {
    const byName = new Map<string, number>(
      axes.map((ax) => [String(ax.physical_name ?? '').trim().toUpperCase(), Number(ax.id)])
    );
    try {
      const rawMachines = localStorage.getItem('vmill_machines');
      if (!rawMachines) throw new Error('no machines');
      const machines = JSON.parse(rawMachines) as Array<any>;
      if (!Array.isArray(machines) || machines.length === 0) throw new Error('invalid machines');
      const activeMachineId = localStorage.getItem('vmill_active_machine');
      const active = machines.find((m) => String(m?.id ?? '') === String(activeMachineId ?? '')) ?? machines[0];
      const cfgAxes = Array.isArray(active?.axes) ? active.axes : [];
      const toolLinear = cfgAxes.filter((ax: any) =>
        String(ax?.side ?? '').toLowerCase() === 'tool'
        && String(ax?.kind ?? 'linear').toLowerCase() === 'linear'
      );
      const preferred = toolLinear.find((ax: any) => String(ax?.name ?? '').trim().toUpperCase() === 'Z') ?? toolLinear[0];
      const preferredName = String(preferred?.name ?? '').trim().toUpperCase();
      if (preferredName && byName.has(preferredName)) return Number(byName.get(preferredName));
    } catch {
      // Fallback handled below.
    }
    const zFallback = axes.find((ax) => String(ax.physical_name ?? '').toUpperCase() === 'Z');
    return Number((zFallback ?? axes[0])?.id ?? -1);
  };
  const homeAll = () => {
    const feedVal = Math.max(1, Number.parseFloat(feed.replace(',', '.')) || 1200);
    can.emit('command', {
      type: 'machine.home_all_ordered',
      primaryAxisId: getPrimaryHomeAxisId(),
      rapid: rapidMode,
      feed: feedVal,
    });
  };

  return (
    <>
      <div style={s.homeGrid}>
        <button style={s.homeAllBtn} onClick={homeAll}>
          HOME ALL
        </button>
        {axes.map((ax) => (
          <button
            key={ax.id}
            style={s.homeAxisBtn}
            onClick={() => can.emit('command', { type: 'machine.home_axis', axisId: ax.id })}
          >
            {ax.physical_name}
          </button>
        ))}
      </div>

      {telemetry.isHoming && <div style={s.homingBadge}>HOMING IN PROGRESS</div>}

      <div style={s.stepRow}>
        <span style={s.stepLabel}>STEP (mm)</span>
        <div style={s.stepBtns}>
          {JOG_STEPS.map((v) => (
            <button
              key={v}
              style={{ ...s.stepBtn, ...(step === v ? s.stepBtnActive : {}) }}
              onClick={() => {
                setStep(v);
                setDeltaInput(String(v));
              }}
            >
              {v}
            </button>
          ))}
        </div>
        <div style={s.deltaRow}>
          <span style={s.stepLabel}>JOG INCR (mm)</span>
          <input
            style={s.deltaInput}
            value={deltaInput}
            onChange={(e) => {
              const raw = e.target.value;
              setDeltaInput(raw);
              const n = Number.parseFloat(raw.replace(',', '.'));
              if (Number.isFinite(n) && n > 0) {
                setStep(n);
              }
            }}
            onBlur={() => {
              const n = Number.parseFloat(deltaInput.replace(',', '.'));
              if (Number.isFinite(n) && n > 0) {
                setStep(n);
                setDeltaInput(String(n));
              } else {
                setDeltaInput(String(step));
              }
            }}
            title="Jog increment distance"
          />
        </div>
      </div>

      <div style={s.feedRow}>
        <span style={s.stepLabel}>TRAVEL MODE</span>
        <button
          style={{ ...s.modeBtn, ...(rapidMode ? s.modeBtnRapid : s.modeBtnWork) }}
          onClick={() => setRapidMode((v) => !v)}
        >
          {rapidMode ? 'RAPID' : 'WORK'}
        </button>
        <span style={s.stepLabel}>JOG FEED (mm/min)</span>
        <input
          style={{ ...s.feedInput, ...(rapidMode ? s.feedInputDisabled : {}) }}
          value={feed}
          disabled={rapidMode}
          onChange={(e) => setFeed(e.target.value)}
        />
      </div>

      <div style={s.axisRows}>
        {axes.map((ax) => {
          const owningChannel = telemetry.channels.find((ch) => ch.axis_ids.includes(ax.id));
          const toolLengthComp =
            owningChannel?.length_comp_active && ax.physical_name.toUpperCase() === 'Z'
              ? Number(owningChannel.tool_length ?? 0)
              : 0;
          // Display WORK as TCP-referenced coordinate on Z when G43 is active.
          const workPos = ax.position - toolLengthComp - getOffset(ax.id);
          const dtg = (ax.target ?? ax.position) - ax.position;
          const feedVal = Math.max(1, Number.parseFloat(feed.replace(',', '.')) || 1200);
          const jogCmd = (delta: number) => {
            if (rapidMode) {
              can.emit('command', { type: 'machine.jog_rapid', axisId: ax.id, delta });
            } else {
              can.emit('command', { type: 'machine.jog_feed', axisId: ax.id, delta, feed: feedVal });
            }
          };
          return (
            <div key={ax.id} style={s.axisRow}>
              <div style={s.axisName}>
                <span style={{ ...s.homedDot, background: ax.homed ? '#22c55e' : '#ef4444' }} />
                {ax.physical_name}
              </div>

              <div style={s.posBlock}>
                <span style={s.posLabel}>WORK</span>
                <span style={{ ...s.posVal, color: '#22d3ee' }}>{workPos.toFixed(3)}</span>
              </div>

              <div style={s.posBlock}>
                <span style={s.posLabel}>DTS</span>
                <span style={{ ...s.posVal, color: '#fbbf24' }}>{dtg.toFixed(3)}</span>
              </div>

              <div style={s.posBlock}>
                <span style={s.posLabel}>MACH</span>
                <span style={s.posVal}>{ax.position.toFixed(3)}</span>
              </div>

              <div style={s.jogBtns}>
                <button
                  style={s.jogBtn}
                  onClick={() => jogCmd(-step)}
                >
                  -
                </button>
                <button
                  style={s.jogBtn}
                  onClick={() => jogCmd(step)}
                >
                  +
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

const s: Record<string, CSSProperties> = {
  homeGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 },
  homeAllBtn: {
    gridColumn: '1 / -1',
    background: '#0f2f63',
    border: '1px solid #2563eb',
    color: '#bfdbfe',
    padding: '8px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 700,
    fontFamily: 'monospace',
  },
  homeAxisBtn: {
    background: '#0b162c',
    border: '1px solid #1f2b46',
    color: '#94a3b8',
    padding: '6px 4px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  homingBadge: {
    background: 'rgba(234,179,8,0.12)',
    border: '1px solid #854d0e',
    color: '#fbbf24',
    fontSize: 10,
    padding: '4px 8px',
    borderRadius: 4,
    textAlign: 'center',
    letterSpacing: '0.05em',
  },
  stepRow: { display: 'flex', flexDirection: 'column', gap: 4 },
  stepLabel: { fontSize: 9, color: '#6b7d9a', letterSpacing: '0.08em' },
  stepBtns: { display: 'flex', gap: 3 },
  stepBtn: {
    flex: 1,
    background: '#0b162c',
    border: '1px solid #1f2b46',
    color: '#7890b4',
    padding: '4px 2px',
    borderRadius: 3,
    cursor: 'pointer',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  stepBtnActive: {
    background: '#1e3a5f',
    border: '1px solid #60a5fa',
    color: '#dbeafe',
  },
  deltaRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 84px',
    gap: 4,
    alignItems: 'center',
    marginTop: 2,
  },
  deltaInput: {
    width: '100%',
    boxSizing: 'border-box',
    fontSize: 10,
    fontFamily: 'monospace',
    background: '#1a2332',
    border: '1px solid #334155',
    color: '#e2e8f0',
    padding: '4px 6px',
    borderRadius: 3,
    outline: 'none',
  },
  feedRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 84px 1fr 84px',
    gap: 4,
    alignItems: 'center',
  },
  modeBtn: {
    borderRadius: 3,
    cursor: 'pointer',
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: 700,
    padding: '4px 0',
  },
  modeBtnWork: {
    background: '#1e3a5f',
    border: '1px solid #60a5fa',
    color: '#dbeafe',
  },
  modeBtnRapid: {
    background: '#14532d',
    border: '1px solid #22c55e',
    color: '#86efac',
  },
  feedInput: {
    width: '100%',
    boxSizing: 'border-box',
    fontSize: 10,
    fontFamily: 'monospace',
    background: '#1a2332',
    border: '1px solid #334155',
    color: '#e2e8f0',
    padding: '4px 6px',
    borderRadius: 3,
    outline: 'none',
  },
  feedInputDisabled: {
    opacity: 0.55,
    cursor: 'not-allowed',
  },
  axisRows: { display: 'flex', flexDirection: 'column', gap: 4 },
  axisRow: {
    background: '#080d16',
    border: '1px solid #1f2b46',
    borderRadius: 4,
    padding: '6px',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  axisName: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 13,
    fontWeight: 700,
    color: '#e2e8f0',
    width: 38,
    flexShrink: 0,
  },
  homedDot: { width: 6, height: 6, borderRadius: '50%', flexShrink: 0 },
  posBlock: { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 },
  posLabel: { fontSize: 8, color: '#385070', letterSpacing: '0.05em' },
  posVal: { fontSize: 12, color: '#f1f5f9', fontVariantNumeric: 'tabular-nums' },
  jogBtns: { display: 'flex', gap: 3, flexShrink: 0 },
  jogBtn: {
    width: 30,
    height: 28,
    background: '#18263c',
    border: '1px solid #334155',
    color: '#cbd5e1',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 14,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'monospace',
  },
};
