import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useMachine } from './MachineContext';

// ─── GCode Panel ──────────────────────────────────────────────────────────────
// Standalone module — reads brain + state from context, no props needed.
// To add a new channel panel variant, just fork this file.

export default function GCodePanel() {
  const { state, brain } = useMachine();

  const [codes, setCodes] = useState([
    "G1 Z150 F5000\nG1 Z50\nG1 X55 Y50\nG1 Z0\nG1 X0\nG1 Y50\nG1 X50\nG1 Y0\nG1 X55\nG1 Z50",
    "G1 Z3-15 B-45 F800\nG1 Z3 0 B0",
  ]);

  if (!state) return null;

  return (
    <div style={s.container}>
      {state.channels.map((ch: any, i: number) => (
        <div key={ch.id} style={s.pane}>
          {/* Header */}
          <div style={s.head}>
            <span>PATH {ch.id}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => brain?.load_program(ch.id, codes[i] ?? '')}
                style={s.runBtn}
              >
                ▶
              </button>
              <button onClick={() => brain?.reset_program(ch.id)} style={s.resetBtn}>
                RESET
              </button>
            </div>
          </div>

          {/* Editor with line highlight */}
          <div style={s.edit}>
            <textarea
              style={s.area}
              spellCheck={false}
              value={codes[i] ?? ''}
              onChange={e => {
                const n = [...codes];
                n[i] = e.target.value;
                setCodes(n);
              }}
            />
            <div style={s.highlight}>
              {(codes[i] ?? '').split('\n').map((l, li) => (
                <div key={li} style={{
                  ...s.line,
                  background: ch.active_pc === li ? 'rgba(34,197,94,0.35)' : 'transparent',
                  borderLeft: ch.active_pc === li ? '3px solid #22c55e' : '3px solid transparent',
                }}>
                  {l}
                </div>
              ))}
            </div>
          </div>

          {/* Axis position readout */}
          <div style={s.coords}>
            {ch.axis_map.map((m: any) => {
              const ax = state.axes.find((a: any) => a.id === m.axis_id);
              return (
                <div key={m.axis_id} style={s.chip}>
                  <span style={s.label}>{m.display_label}</span>
                  <span style={s.val}>{ax?.position.toFixed(3) ?? '—'}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  container: {
    display: 'flex',
    gap: 20,
    pointerEvents: 'none',
  },
  pane: {
    width: 350,
    display: 'flex',
    flexDirection: 'column',
    background: 'rgba(10,10,12,0.85)',
    backdropFilter: 'blur(8px)',
    border: '1px solid #333',
    borderRadius: 8,
    pointerEvents: 'auto',
    overflow: 'hidden',
  },
  head: {
    padding: '10px 12px',
    background: 'rgba(40,40,45,0.9)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 12,
    fontWeight: 'bold',
    color: '#fff',
  },
  edit: {
    flex: 1,
    position: 'relative',
    minHeight: 200,
  },
  area: {
    position: 'absolute',
    inset: 0,
    background: 'transparent',
    color: '#fff',
    border: 'none',
    padding: 10,
    outline: 'none',
    resize: 'none',
    fontSize: 14,
    lineHeight: '24px',
    zIndex: 2,
    fontFamily: 'monospace',
  },
  highlight: {
    position: 'absolute',
    inset: 0,
    padding: '10px 0',
    zIndex: 1,
    pointerEvents: 'none',
  },
  line: {
    padding: '0 10px',
    height: 24,
    color: 'transparent',
    whiteSpace: 'pre',
    fontSize: 14,
    lineHeight: '24px',
    fontFamily: 'monospace',
  },
  coords: {
    padding: 10,
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 5,
    background: 'rgba(0,0,0,0.3)',
  },
  chip: {
    background: '#111',
    padding: 5,
    border: '1px solid #333',
    borderRadius: 4,
  },
  label: {
    color: '#3b82f6',
    fontSize: 10,
    display: 'block',
    fontFamily: 'monospace',
  },
  val: {
    fontSize: 15,
    color: '#fff',
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  runBtn: {
    background: '#166534',
    color: '#fff',
    border: 'none',
    padding: '2px 10px',
    borderRadius: 3,
    cursor: 'pointer',
    fontFamily: 'monospace',
  },
  resetBtn: {
    background: '#444',
    color: '#fff',
    border: 'none',
    padding: '2px 8px',
    borderRadius: 3,
    cursor: 'pointer',
    fontFamily: 'monospace',
  },
};
