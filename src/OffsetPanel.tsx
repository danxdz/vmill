import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { SidebarModuleProps } from './modules/moduleTypes';

export default function OffsetPanel({ runtime }: SidebarModuleProps) {
  const [offsetInput, setOffsetInput] = useState<Record<string, string>>({});
  const [pickingAxis, setPickingAxis] = useState<number | null>(null);
  const { telemetry, can, onAxisPickStart, onAxisPickEnd, pickedPosition } = runtime;
  const axes = telemetry.axes;
  const workOffsets = telemetry.workOffsets;
  const activeWcs = telemetry.activeWcs;
  const wcsLabels = useMemo(() => workOffsets.map((w) => w.label), [workOffsets]);
  const inputKey = (wcsIndex: number, axisId: number) => `${wcsIndex}:${axisId}`;
  const nextMode = (mode: 'off' | 'dot' | 'gizmo'): 'off' | 'dot' | 'gizmo' =>
    mode === 'off' ? 'dot' : mode === 'dot' ? 'gizmo' : 'off';

  const getOffset = (axisId: number) =>
    workOffsets[activeWcs]?.offsets.find((o) => o.axis_id === axisId)?.value ?? 0;

  const setOffsetValue = (axisId: number, offset: number) => {
    can.emit('command', { type: 'wcs.set_offset_value', axisId, offset });
  };

  const applyOffsetInput = (axisId: number) => {
    const key = inputKey(activeWcs, axisId);
    const raw = offsetInput[key];
    if (raw === undefined) return;
    const offset = Number.parseFloat(raw.replace(',', '.'));
    if (Number.isNaN(offset)) return;
    setOffsetValue(axisId, offset);
    setOffsetInput((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    if (pickingAxis === axisId) {
      setPickingAxis(null);
      onAxisPickEnd?.();
    }
  };

  useEffect(() => {
    if (pickedPosition && pickingAxis === pickedPosition.axisId) {
      const pickedOffset = Number(pickedPosition.value.toFixed(3));
      const key = inputKey(activeWcs, pickedPosition.axisId);
      setOffsetInput((prev) => ({ ...prev, [key]: pickedOffset.toFixed(3) }));
    }
  }, [pickedPosition, pickingAxis, activeWcs]);

  const lastWcsRef = useRef(activeWcs);
  useEffect(() => {
    if (lastWcsRef.current !== activeWcs && pickingAxis !== null) {
      setPickingAxis(null);
      onAxisPickEnd?.();
    }
    lastWcsRef.current = activeWcs;
  }, [activeWcs, pickingAxis, onAxisPickEnd]);

  return (
    <>
      <div style={s.viewToggles}>
        <button
          style={{ ...s.toggleBtnWide, ...(telemetry.wcsReferenceVisual !== 'off' ? s.toggleBtnOn : {}) }}
          onClick={() => can.emit('command', { type: 'ui.set_wcs_reference_visual', mode: nextMode(telemetry.wcsReferenceVisual) })}
          title="Cycle WCS visual mode: OFF → DOT → GIZMO"
        >
          WCS {telemetry.wcsReferenceVisual.toUpperCase()}
        </button>
        <button
          style={{ ...s.toggleBtnWide, ...(telemetry.mcsReferenceVisual !== 'off' ? s.toggleBtnOn : {}) }}
          onClick={() => can.emit('command', { type: 'ui.set_mcs_reference_visual', mode: nextMode(telemetry.mcsReferenceVisual) })}
          title="Cycle MCS visual mode: OFF → DOT → GIZMO"
        >
          MCS {telemetry.mcsReferenceVisual.toUpperCase()}
        </button>
      </div>

      <div style={s.wcsTabs}>
        {wcsLabels.map((label, i) => (
          <button
            key={label}
            style={{ ...s.wcsTab, ...(activeWcs === i ? s.wcsTabActive : {}) }}
            onClick={() => can.emit('command', { type: 'wcs.set_active', wcsIndex: i })}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={s.offsetGrid}>
        {axes.map((ax) => {
          const offset = getOffset(ax.id);
          const isPicking = pickingAxis === ax.id;
          const key = inputKey(activeWcs, ax.id);
          const inputValue = offsetInput[key] ?? offset.toFixed(3);

          return (
            <div key={ax.id} style={{ ...s.offsetRow, ...(isPicking ? s.offsetRowPicking : {}) }}>
              <div style={s.offsetActionRow}>
                <span style={s.offsetAxisName}>{ax.physical_name}</span>
                <input
                  type="text"
                  value={inputValue}
                  style={s.offsetInput}
                  onChange={(e) => setOffsetInput((prev) => ({ ...prev, [key]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') applyOffsetInput(ax.id);
                  }}
                  title="Offset value"
                />

                <button style={s.actionBtn} onClick={() => applyOffsetInput(ax.id)}>
                  SET
                </button>
                <button
                  style={s.zeroBtn}
                  onClick={() => {
                    can.emit('command', { type: 'wcs.set_work_coordinate', axisId: ax.id, desiredWork: 0 });
                    if (pickingAxis === ax.id) {
                      setPickingAxis(null);
                      onAxisPickEnd?.();
                    }
                  }}
                >
                  W0
                </button>
                <button
                  style={{ ...s.pickBtn, ...(isPicking ? s.pickBtnActive : {}) }}
                  onClick={() => {
                    if (isPicking) {
                      setPickingAxis(null);
                      onAxisPickEnd?.();
                    } else {
                      setPickingAxis(ax.id);
                      onAxisPickStart?.(ax.id);
                    }
                  }}
                  title={isPicking ? 'Click in 3D view' : 'Pick from 3D view'}
                >
                  {isPicking ? 'PICKING' : 'PICK'}
                </button>
              </div>
              {isPicking && (
                <div style={s.pickHint}>
                  <span>Click in 3D, then validate with SET</span>
                  <button
                    style={s.cancelPickBtn}
                    onClick={() => {
                      setPickingAxis(null);
                      onAxisPickEnd?.();
                    }}
                  >
                    CANCEL
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={s.bottomActions}>
        <button
          style={s.zeroAllBtn}
          onClick={() =>
            can.emit('command', {
              type: 'wcs.clear_offsets',
              axisIds: axes.map((ax) => ax.id),
              wcsIndex: activeWcs,
            })
          }
        >
          ZERO OFFSETS ({wcsLabels[activeWcs] ?? 'WCS'})
        </button>
        <button
          style={s.workZeroAllBtn}
          onClick={() => {
            axes.forEach((ax) =>
              can.emit('command', {
                type: 'wcs.set_work_coordinate',
                axisId: ax.id,
                desiredWork: 0,
              })
            );
            if (pickingAxis !== null) {
              setPickingAxis(null);
              onAxisPickEnd?.();
            }
          }}
        >
          W0 ALL (CURRENT POS)
        </button>
      </div>
    </>
  );
}

const s: Record<string, CSSProperties> = {
  viewToggles: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 4,
    alignItems: 'center',
  },
  toggleBtn: {
    background: '#0b162c',
    border: '1px solid #1f2b46',
    color: '#7b8cad',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: 700,
    padding: '6px 0',
  },
  toggleBtnWide: {
    background: '#0b162c',
    border: '1px solid #1f2b46',
    color: '#7b8cad',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: 700,
    padding: '6px 0',
  },
  toggleBtnOn: {
    background: '#0e3120',
    border: '1px solid #22c55e',
    color: '#86efac',
  },
  wcsTabs: { display: 'flex', gap: 4 },
  wcsTab: {
    flex: 1,
    padding: '6px',
    background: '#0b162c',
    border: '1px solid #1f2b46',
    color: '#7b8cad',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: 700,
  },
  wcsTabActive: {
    background: '#0e3120',
    border: '1px solid #22c55e',
    color: '#86efac',
  },
  offsetGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  offsetRow: {
    background: '#080d16',
    border: '1px solid #1f2b46',
    borderRadius: 4,
    padding: '4px',
  },
  offsetActionRow: {
    display: 'grid',
    gridTemplateColumns: '24px 1fr 42px 40px 60px',
    alignItems: 'center',
    gap: 4,
  },
  offsetRowPicking: {
    border: '1px solid #f59e0b',
    background: 'rgba(245,158,11,0.08)',
  },
  pickHint: {
    marginTop: 4,
    borderTop: '1px solid #2b3a55',
    paddingTop: 4,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 10,
    color: '#fbbf24',
  },
  cancelPickBtn: {
    background: '#1e293b',
    border: '1px solid #334155',
    color: '#94a3b8',
    borderRadius: 3,
    cursor: 'pointer',
    fontSize: 10,
    fontFamily: 'monospace',
    padding: '2px 6px',
  },
  offsetAxisName: {
    fontSize: 11,
    fontWeight: 700,
    color: '#cbd5e1',
    textAlign: 'center',
  },
  offsetInput: {
    width: '100%',
    fontSize: 11,
    fontFamily: 'monospace',
    background: '#1a2332',
    border: '1px solid #334155',
    color: '#e2e8f0',
    padding: '4px',
    borderRadius: 3,
    outline: 'none',
  },
  actionBtn: {
    background: '#1e3a5f',
    border: '1px solid #3b82f6',
    color: '#93c5fd',
    padding: '4px 0',
    borderRadius: 3,
    cursor: 'pointer',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  zeroBtn: {
    background: '#14532d',
    border: '1px solid #166534',
    color: '#4ade80',
    padding: '4px 0',
    borderRadius: 3,
    cursor: 'pointer',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  pickBtn: {
    background: '#1e293b',
    border: '1px solid #334155',
    color: '#94a3b8',
    padding: '4px 0',
    borderRadius: 3,
    cursor: 'pointer',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  pickBtnActive: {
    background: '#d97706',
    border: '1px solid #b45309',
    color: '#fff',
  },
  bottomActions: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    marginTop: 2,
  },
  zeroAllBtn: {
    background: '#14532d',
    border: '1px solid #166534',
    color: '#4ade80',
    padding: '8px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 10,
    fontWeight: 700,
    fontFamily: 'monospace',
    width: '100%',
  },
  workZeroAllBtn: {
    background: '#1e3a5f',
    border: '1px solid #3b82f6',
    color: '#93c5fd',
    padding: '6px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 10,
    fontWeight: 700,
    fontFamily: 'monospace',
    width: '100%',
  },
};
