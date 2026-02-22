import type { CSSProperties } from 'react';

interface ToolVisualLike {
  stickout?: number;
}

interface ToolAssemblyLike {
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
  visual: ToolVisualLike;
}

interface ToolItemLike {
  id: string;
  name: string;
  length?: number;
  radius?: number;
  stickout?: number;
  toolStickInMax?: number;
  note?: string;
}

interface ToolAssemblyManagerModalProps {
  open: boolean;
  assemblies: ToolAssemblyLike[];
  selectedAssemblyId: string;
  selectedAssembly: ToolAssemblyLike | null;
  tools: ToolItemLike[];
  holders: ToolItemLike[];
  extensions: ToolItemLike[];
  stickInfo: { maxStickIn: number; usedStickIn: number };
  onClose: () => void;
  onSelectAssembly: (id: string) => void;
  onLoad: () => void;
  onCreate: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onSaveAsTool: () => void;
  onPatch: (patch: Partial<Pick<ToolAssemblyLike, 'name' | 'toolId' | 'holderId' | 'extensionId' | 'note' | 'toolOut' | 'toolColor' | 'holderColor' | 'extensionColor'>>) => void;
}

export default function ToolAssemblyManagerModal({
  open,
  assemblies,
  selectedAssemblyId,
  selectedAssembly,
  tools,
  holders,
  extensions,
  stickInfo,
  onClose,
  onSelectAssembly,
  onLoad,
  onCreate,
  onDuplicate,
  onDelete,
  onSaveAsTool,
  onPatch,
}: ToolAssemblyManagerModalProps) {
  if (!open) return null;
  const tool = selectedAssembly ? (tools.find((t) => t.id === selectedAssembly.toolId) ?? null) : null;
  const holder = selectedAssembly ? (holders.find((h) => h.id === selectedAssembly.holderId) ?? null) : null;
  const extension = selectedAssembly ? (extensions.find((x) => x.id === selectedAssembly.extensionId) ?? null) : null;
  const rawToolOut = Number(selectedAssembly?.toolOut ?? selectedAssembly?.visual?.stickout ?? 0);
  const toolLength = Math.max(0, Number(tool?.length ?? 0), rawToolOut + Number(stickInfo.usedStickIn ?? 0));
  const stickInMaxRaw = Math.max(0, Number(stickInfo.maxStickIn ?? 0));
  const stickInUsedRaw = Math.max(0, Number(stickInfo.usedStickIn ?? Math.max(0, toolLength - rawToolOut)));
  const stickInUsed = Math.max(0, Math.min(stickInMaxRaw, stickInUsedRaw));
  const toolOut = Math.max(0, toolLength - stickInUsed);
  const globalStack = Math.max(0, Number(selectedAssembly?.length ?? 0) - toolOut);

  return (
    <div style={s.backdrop} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.head}>
          <div style={s.titleWrap}>
            <div style={s.title}>Tool Assemblies</div>
            <div style={s.sub}>Manage tool + holder + extension stacks</div>
          </div>
          <button style={s.closeBtn} onClick={onClose}>x</button>
        </div>

        <div style={s.toolbar}>
          <select
            style={s.select}
            value={selectedAssemblyId}
            onChange={(e) => onSelectAssembly(e.target.value)}
          >
            {assemblies.map((asm) => (
              <option key={asm.id} value={asm.id}>
                ASM - {asm.name}
              </option>
            ))}
          </select>
          <button style={s.btnGreen} onClick={onLoad}>LOAD TO SPINDLE</button>
        </div>

        <div style={s.actionsRow}>
          <button style={s.btn} onClick={onCreate}>+ ASM</button>
          <button style={s.btn} onClick={onDuplicate}>DUPLICATE</button>
          <button style={s.btnDanger} onClick={onDelete}>DELETE</button>
          <button style={s.btn} onClick={onSaveAsTool} disabled={!selectedAssembly || !selectedAssembly.toolId}>
            SAVE AS TOOL
          </button>
        </div>

        {selectedAssembly ? (
          <>
            <div style={s.grid}>
              <span style={s.label}>Name</span>
              <input
                style={s.input}
                value={selectedAssembly.name}
                onChange={(e) => onPatch({ name: e.target.value })}
              />

              <span style={s.label}>Tool</span>
              <div style={s.componentRow}>
                <input
                  type="color"
                  style={s.colorInput}
                  value={selectedAssembly.toolColor ?? '#ef4444'}
                  onChange={(e) => onPatch({ toolColor: e.target.value })}
                />
                <div style={s.componentBlock}>
                  <select
                    style={s.select}
                    value={selectedAssembly.toolId}
                    onChange={(e) => onPatch({ toolId: e.target.value, toolColor: undefined })}
                  >
                    <option value="">(select tool)</option>
                    {tools.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  <div style={s.componentInfo}>H {Number(tool?.length ?? 0).toFixed(3)} | R {Number(tool?.radius ?? 0).toFixed(3)}</div>
                </div>
              </div>

              <span style={s.label}>Holder</span>
              <div style={s.componentRow}>
                <input
                  type="color"
                  style={s.colorInput}
                  value={selectedAssembly.holderColor ?? '#94a3b8'}
                  onChange={(e) => onPatch({ holderColor: e.target.value })}
                />
                <div style={s.componentBlock}>
                  <select
                    style={s.select}
                    value={selectedAssembly.holderId ?? ''}
                    onChange={(e) => onPatch({ holderId: e.target.value || null, holderColor: undefined })}
                  >
                    <option value="">(none)</option>
                    {holders.map((h) => (
                      <option key={h.id} value={h.id}>{h.name}</option>
                    ))}
                  </select>
                  <div style={s.componentInfo}>H {Number(holder?.length ?? 0).toFixed(3)} | R {Number(holder?.radius ?? 0).toFixed(3)}</div>
                </div>
              </div>

              <span style={s.label}>Extension</span>
              <div style={s.componentRow}>
                <input
                  type="color"
                  style={s.colorInput}
                  value={selectedAssembly.extensionColor ?? '#94a3b8'}
                  onChange={(e) => onPatch({ extensionColor: e.target.value })}
                />
                <div style={s.componentBlock}>
                  <select
                    style={s.select}
                    value={selectedAssembly.extensionId ?? ''}
                    onChange={(e) => onPatch({ extensionId: e.target.value || null, extensionColor: undefined })}
                  >
                    <option value="">(none)</option>
                    {extensions.map((x) => (
                      <option key={x.id} value={x.id}>{x.name}</option>
                    ))}
                  </select>
                  <div style={s.componentInfo}>H {Number(extension?.length ?? 0).toFixed(3)} | R {Number(extension?.radius ?? 0).toFixed(3)}</div>
                </div>
              </div>

              <span style={s.label}>Tool Out</span>
              <div style={s.sliderWrap}>
                <input
                  type="range"
                  style={s.slider}
                  min={0}
                  max={stickInMaxRaw}
                  step={0.1}
                  value={stickInUsed}
                  onChange={(e) => {
                    const nextStickIn = Number(e.target.value);
                    const clampedStickIn = Math.max(0, Math.min(stickInMaxRaw, Number.isFinite(nextStickIn) ? nextStickIn : 0));
                    const nextToolOut = Math.max(0, toolLength - clampedStickIn);
                    onPatch({ toolOut: nextToolOut });
                  }}
                  disabled={!tool}
                />
                <span style={s.sliderVal}>{toolOut.toFixed(3)}</span>
              </div>
            </div>
            <div style={s.globalCard}>
              <div style={s.globalTitle}>GLOBAL</div>
              <div style={s.globalLine}>Total H {selectedAssembly.length.toFixed(3)} | Out {toolOut.toFixed(3)}</div>
              <div style={s.globalLine}>R Tool {selectedAssembly.radius.toFixed(3)} | Stack {globalStack.toFixed(3)}</div>
              <div style={s.globalLine}>Stick-In {stickInUsed.toFixed(3)} / {stickInMaxRaw.toFixed(3)}</div>
            </div>

            <textarea
              style={s.note}
              value={selectedAssembly.note}
              placeholder="Assembly notes (spindle gauge, holder family, vendor...)"
              onChange={(e) => onPatch({ note: e.target.value })}
            />
          </>
        ) : (
          <div style={s.msg}>No assembly selected</div>
        )}
      </div>
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 140,
    background: 'rgba(2, 6, 16, 0.72)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    boxSizing: 'border-box',
    fontFamily: 'monospace',
  },
  modal: {
    width: 'min(1080px, calc(100vw - 48px))',
    maxHeight: 'calc(100vh - 48px)',
    overflow: 'auto',
    background: '#081022',
    border: '1px solid #223453',
    borderRadius: 10,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    color: '#dbeafe',
  },
  head: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  titleWrap: { display: 'flex', flexDirection: 'column', gap: 2 },
  title: { fontSize: 14, fontWeight: 700, letterSpacing: '0.06em', color: '#93c5fd' },
  sub: { fontSize: 10, color: '#7f94b8' },
  closeBtn: {
    width: 28,
    height: 24,
    borderRadius: 4,
    border: '1px solid #2a395a',
    background: '#10192a',
    color: '#8ba0c2',
    cursor: 'pointer',
    fontSize: 13,
    padding: 0,
  },
  toolbar: { display: 'grid', gridTemplateColumns: '1fr 180px', gap: 6 },
  actionsRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 },
  grid: { display: 'grid', gridTemplateColumns: '120px 1fr', gap: 6, alignItems: 'center' },
  componentRow: { display: 'grid', gridTemplateColumns: '30px 1fr', gap: 6, alignItems: 'center' },
  componentBlock: { display: 'flex', flexDirection: 'column', gap: 4 },
  componentInfo: { color: '#93c5fd', fontSize: 11, fontFamily: 'monospace' },
  label: { color: '#8ca0c5', fontSize: 11 },
  colorInput: {
    width: 26,
    height: 26,
    padding: 2,
    borderRadius: 4,
    border: '1px solid #fb923c',
    background: '#111827',
    cursor: 'pointer',
    boxSizing: 'border-box',
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    background: '#1a2332',
    border: '1px solid #334155',
    borderRadius: 4,
    color: '#e2e8f0',
    padding: '7px 8px',
    fontSize: 12,
    fontFamily: 'monospace',
    outline: 'none',
  },
  sliderWrap: {
    width: '100%',
    display: 'grid',
    gridTemplateColumns: '1fr 64px',
    gap: 6,
    alignItems: 'center',
  },
  slider: {
    width: '100%',
    accentColor: '#22c55e',
  },
  sliderVal: {
    textAlign: 'right',
    color: '#dbeafe',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  globalCard: {
    border: '1px solid #2a395a',
    borderRadius: 6,
    background: '#0c1628',
    padding: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  globalTitle: {
    color: '#93c5fd',
    fontSize: 10,
    letterSpacing: '0.06em',
    fontWeight: 700,
  },
  globalLine: {
    color: '#b8c8e5',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  select: {
    width: '100%',
    boxSizing: 'border-box',
    background: '#1a2332',
    border: '1px solid #334155',
    borderRadius: 4,
    color: '#e2e8f0',
    padding: '7px 8px',
    fontSize: 12,
    fontFamily: 'monospace',
    outline: 'none',
  },
  note: {
    width: '100%',
    minHeight: 72,
    boxSizing: 'border-box',
    resize: 'vertical',
    background: '#101926',
    border: '1px solid #334155',
    borderRadius: 4,
    color: '#e2e8f0',
    padding: 8,
    fontSize: 12,
    fontFamily: 'monospace',
    outline: 'none',
  },
  btn: {
    background: '#142238',
    border: '1px solid #2f4a73',
    borderRadius: 4,
    color: '#94a3b8',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 700,
    padding: '8px 0',
    fontFamily: 'monospace',
  },
  btnGreen: {
    background: '#14532d',
    border: '1px solid #166534',
    borderRadius: 4,
    color: '#86efac',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 700,
    padding: '8px 0',
    fontFamily: 'monospace',
  },
  btnDanger: {
    background: '#4c1d1d',
    border: '1px solid #7f1d1d',
    borderRadius: 4,
    color: '#fca5a5',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 700,
    padding: '8px 0',
    fontFamily: 'monospace',
  },
  msg: { color: '#64748b', fontSize: 12 },
};
