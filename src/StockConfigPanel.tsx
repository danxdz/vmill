import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';

interface StockConfig {
  shape: 'box';
  size: { x: number; y: number; z: number };
  position: { x: number; y: number; z: number };
}

interface StockConfigPanelProps {
  value: StockConfig;
  onClose: () => void;
  onApply: (next: StockConfig) => void;
}

export default function StockConfigPanel({ value, onClose, onApply }: StockConfigPanelProps) {
  const [draft, setDraft] = useState<StockConfig>(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const setNum = (path: 'size.x' | 'size.y' | 'size.z' | 'position.x' | 'position.y' | 'position.z', raw: string) => {
    const v = Number.parseFloat(raw.replace(',', '.'));
    if (Number.isNaN(v)) return;
    setDraft((prev) => {
      const next = { ...prev, size: { ...prev.size }, position: { ...prev.position } };
      const [group, key] = path.split('.') as ['size' | 'position', 'x' | 'y' | 'z'];
      next[group][key] = v;
      return next;
    });
  };

  return (
    <div style={s.backdrop} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.head}>
          <span>STOCK CONFIG</span>
          <button style={s.closeBtn} onClick={onClose}>×</button>
        </div>

        <div style={s.section}>
          <div style={s.label}>Shape</div>
          <div style={s.readonly}>Box</div>
        </div>

        <div style={s.section}>
          <div style={s.label}>Size (mm, X/Y/Z machine axes)</div>
          <div style={s.grid3}>
            <Input label="X" value={draft.size.x} onChange={(v) => setNum('size.x', v)} />
            <Input label="Y" value={draft.size.y} onChange={(v) => setNum('size.y', v)} />
            <Input label="Z" value={draft.size.z} onChange={(v) => setNum('size.z', v)} />
          </div>
        </div>

        <div style={s.section}>
          <div style={s.label}>Position (mm, stock center in X/Y/Z machine axes)</div>
          <div style={s.grid3}>
            <Input label="X" value={draft.position.x} onChange={(v) => setNum('position.x', v)} />
            <Input label="Y" value={draft.position.y} onChange={(v) => setNum('position.y', v)} />
            <Input label="Z" value={draft.position.z} onChange={(v) => setNum('position.z', v)} />
          </div>
        </div>

        <div style={s.actions}>
          <button style={s.cancelBtn} onClick={onClose}>CANCEL</button>
          <button style={s.applyBtn} onClick={() => onApply(draft)}>APPLY</button>
        </div>
      </div>
    </div>
  );
}

function Input({ label, value, onChange }: { label: string; value: number; onChange: (v: string) => void }) {
  return (
    <label style={s.inputWrap}>
      <span style={s.inputLabel}>{label}</span>
      <input
        style={s.input}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

const s: Record<string, CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 120,
    fontFamily: 'monospace',
  },
  modal: {
    width: 520,
    maxWidth: '94vw',
    background: '#0b111d',
    border: '1px solid #23314d',
    borderRadius: 10,
    boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
    color: '#dbeafe',
    padding: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  head: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: '0.07em',
    color: '#9fb0cf',
  },
  closeBtn: {
    width: 24,
    height: 24,
    borderRadius: 4,
    border: '1px solid #2a395a',
    background: '#10192a',
    color: '#8ba0c2',
    cursor: 'pointer',
    fontSize: 14,
    lineHeight: '22px',
    padding: 0,
  },
  section: {
    background: '#0f1729',
    border: '1px solid #22304f',
    borderRadius: 6,
    padding: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  label: { fontSize: 11, color: '#7f94b8', letterSpacing: '0.07em' },
  readonly: {
    background: '#121f36',
    border: '1px solid #2a395a',
    borderRadius: 4,
    padding: '6px 10px',
    fontSize: 12,
    color: '#dbeafe',
  },
  grid3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 },
  inputWrap: { display: 'flex', flexDirection: 'column', gap: 4 },
  inputLabel: { fontSize: 10, color: '#7f94b8', letterSpacing: '0.05em' },
  input: {
    background: '#1a2332',
    border: '1px solid #334155',
    borderRadius: 4,
    color: '#e2e8f0',
    padding: '6px 8px',
    fontSize: 12,
    fontFamily: 'monospace',
    width: '100%',
    boxSizing: 'border-box',
    outline: 'none',
  },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 8 },
  cancelBtn: {
    background: '#131f36',
    border: '1px solid #2f4a73',
    color: '#9db4d8',
    borderRadius: 4,
    padding: '8px 12px',
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  applyBtn: {
    background: '#14532d',
    border: '1px solid #166534',
    color: '#86efac',
    borderRadius: 4,
    padding: '8px 12px',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 700,
    fontFamily: 'monospace',
  },
};
