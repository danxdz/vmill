import { useState, useEffect, useRef } from 'react';
import type { ReactNode, CSSProperties, MouseEventHandler } from 'react';
import * as THREE from 'three';
import type { UseMachineConfig } from './useMachineConfig';
import type { AxisConfig, AxisKind, AxisSide, MachineTemplate, SpindleAxis } from './machineTemplates';

interface StockConfig {
  shape: 'box';
  size: { x: number; y: number; z: number };
  position: { x: number; y: number; z: number };
  mount?: 'table' | 'spindle';
  color: string;
  opacity: number;
}

interface SessionImportResult {
  ok: boolean;
  message: string;
}

interface SessionBackupSelection {
  machines: boolean;
  tooling: boolean;
  programs: boolean;
  view: boolean;
  runtime: boolean;
}

const DEFAULT_BACKUP_SELECTION: SessionBackupSelection = {
  machines: true,
  tooling: true,
  programs: true,
  view: true,
  runtime: true,
};

// ─── Axis Orientation Preview (Three.js canvas) ───────────────────────────────
function AxisPreview({ axes }: { axes: any[] }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mountRef.current) return;
    const mount = mountRef.current;
    const w = mount.clientWidth, h = mount.clientHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(window.devicePixelRatio);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 500);
    camera.position.set(120, 90, 120);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const dl = new THREE.DirectionalLight(0xffffff, 1);
    dl.position.set(100, 150, 100);
    scene.add(dl);

    // Grid
    const grid = new THREE.GridHelper(160, 8, 0x334155, 0x1e293b);
    scene.add(grid);

    // Build axis arrows from machine config
    const axisColors: Record<string, number> = {
      X: 0xef4444, Y: 0x22c55e, Z: 0x3b82f6,
      A: 0xf97316, B: 0xa855f7, C: 0xec4899,
      Z3: 0x06b6d4, W: 0x84cc16,
    };

    const makeArrow = (dir: THREE.Vector3, color: number, label: string, len: number) => {
      const arrow = new THREE.ArrowHelper(dir.normalize(), new THREE.Vector3(0, 0, 0), len, color, len * 0.18, len * 0.1);
      scene.add(arrow);

      // Label sprite
      const canvas = document.createElement('canvas');
      canvas.width = 64; canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
      ctx.font = 'bold 36px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 32, 32);
      const tex = new THREE.CanvasTexture(canvas);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
      sprite.position.copy(dir.clone().multiplyScalar(len + 12));
      sprite.scale.set(14, 14, 1);
      scene.add(sprite);
    };

    // Draw axes based on machine config
    const linearAxes = axes.filter(a => a.kind === 'Linear');
    const rotaryAxes = axes.filter(a => a.kind === 'Rotary');

    // Standard CNC mapping: X→+X, Y→-Z, Z→+Y
    for (const ax of linearAxes) {
      const n = ax.name.toUpperCase();
      const color = axisColors[n] ?? 0x94a3b8;
      const travel = Math.abs(ax.max - ax.min);
      const len = Math.min(55, 20 + travel * 0.08);

      if (n === 'X' || n.startsWith('X'))      makeArrow(new THREE.Vector3(1, 0, 0), color, n, len);
      else if (n === 'Y')                        makeArrow(new THREE.Vector3(0, 0, -1), color, n, len);
      else if (n === 'Z' || n === 'Z3')         makeArrow(new THREE.Vector3(0, 1, 0), color, n, len);
      else if (n === 'W')                        makeArrow(new THREE.Vector3(0, 1, 0), color, n, len * 0.7);
    }

    // Rotary arcs
    for (const ax of rotaryAxes) {
      const n = ax.name.toUpperCase();
      const color = axisColors[n] ?? 0x94a3b8;
      const curve = new THREE.EllipseCurve(0, 0, 30, 30, 0, Math.PI * 1.5, false, 0);
      const pts = curve.getPoints(40).map(p => {
        if (n === 'B') return new THREE.Vector3(p.x, 0, p.y);
        if (n === 'A') return new THREE.Vector3(0, p.y, p.x);
        return new THREE.Vector3(p.x, p.y, 0);
      });
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({ color, linewidth: 2 });
      const arc = new THREE.Line(geo, mat);
      scene.add(arc);

      // Arrow at arc end
      const last = pts[pts.length - 1];
      const secondLast = pts[pts.length - 2];
      const arrowDir = new THREE.Vector3().subVectors(last, secondLast).normalize();
      const arrowH = new THREE.ArrowHelper(arrowDir, last, 8, color, 8, 5);
      scene.add(arrowH);
    }

    // Origin sphere
    const origin = new THREE.Mesh(
      new THREE.SphereGeometry(3, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: new THREE.Color(0x444444) })
    );
    scene.add(origin);

    // Slow auto-rotate
    let rafId: number;
    let angle = 0;
    const animate = () => {
      rafId = requestAnimationFrame(animate);
      angle += 0.005;
      camera.position.set(
        Math.sin(angle) * 150,
        90,
        Math.cos(angle) * 150
      );
      camera.lookAt(0, 20, 0);
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(rafId);
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, [axes]);

  return <div ref={mountRef} style={{ width: '100%', height: '100%', borderRadius: 6 }} />;
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function Badge({ children, color = '#3b82f6' }: { children: ReactNode; color?: string }) {
  return (
    <span style={{
      fontSize: 10, padding: '2px 7px', borderRadius: 3,
      background: `${color}18`, border: `1px solid ${color}44`,
      color, fontWeight: 600, letterSpacing: '0.04em',
    }}>
      {children}
    </span>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: '#64748b',
      letterSpacing: '0.06em', textTransform: 'uppercase' as const,
      marginBottom: 8, marginTop: 4,
    }}>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle: CSSProperties = {
  background: '#1e2433', border: '1px solid #2d3748',
  borderRadius: 6, color: '#f1f5f9', padding: '7px 10px',
  fontSize: 12, outline: 'none', width: '100%',
  fontFamily: 'inherit', boxSizing: 'border-box',
  transition: 'border-color 0.15s',
};

function Input({ label, value, onChange, type = 'text', min, max, step }: {
  label: string; value: string | number; type?: string;
  onChange: (v: any) => void; min?: number; max?: number; step?: number;
}) {
  return (
    <Field label={label}>
      <input
        type={type} style={inputStyle} value={value}
        min={min} max={max} step={step}
        onChange={e => onChange(type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value)}
      />
    </Field>
  );
}

function Select<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <Field label={label}>
      <select style={{ ...inputStyle, cursor: 'pointer' }}
        value={value} onChange={e => onChange(e.target.value as T)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

// ─── Template Card ────────────────────────────────────────────────────────────
function TemplateCard({ tpl, onSelect }: { tpl: MachineTemplate; onSelect: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: hover ? '#1a2035' : '#141927',
        border: `1px solid ${hover ? '#3b82f6' : '#1e293b'}`,
        borderRadius: 10, padding: 16, textAlign: 'left',
        cursor: 'pointer', transition: 'all 0.15s',
        fontFamily: 'inherit', width: '100%',
      }}
    >
      <div style={{ fontSize: 22, marginBottom: 8 }}>{tpl.icon}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>{tpl.name}</div>
      <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.5, marginBottom: 10 }}>{tpl.description}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {tpl.tags.map(t => <Badge key={t}>{t}</Badge>)}
        <Badge color="#22c55e">{tpl.axes.length} axes</Badge>
      </div>
    </button>
  );
}

// ─── Axis Editor Row ──────────────────────────────────────────────────────────
function AxisRow({ ax, machineId, cfg, isFirst, isLast, open, onToggle }: {
  ax: AxisConfig; machineId: string; cfg: UseMachineConfig;
  isFirst: boolean; isLast: boolean;
  open: boolean; onToggle: () => void;
}) {
  const up = (patch: Partial<AxisConfig>) => cfg.updateAxis(machineId, ax.id, patch);

  const sideColor  = ax.side === 'tool' ? '#3b82f6' : '#f59e0b';
  const kindColor  = ax.kind === 'Linear' ? '#22c55e' : '#a855f7';

  return (
    <div style={{
      border: `1px solid ${open ? '#3b82f644' : '#1e293b'}`,
      borderRadius: 8, overflow: 'hidden',
      background: open ? '#111827' : '#0f1623',
      transition: 'all 0.15s',
    }}>
      {/* Summary row */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px', cursor: 'pointer',
      }} onClick={onToggle}>
        <div style={{
          width: 28, height: 28, borderRadius: 6,
          background: `${sideColor}18`, border: `1px solid ${sideColor}44`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 800, color: sideColor, flexShrink: 0,
        }}>
          {ax.name}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>{ax.name} Axis</span>
            <Badge color={kindColor}>{ax.kind}</Badge>
            <Badge color={sideColor}>{ax.side}</Badge>
            <Badge color="#64748b">CH{ax.channel}</Badge>
          </div>
          <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
            {ax.min} → {ax.max} mm &nbsp;·&nbsp; {ax.accel} acc &nbsp;·&nbsp; MCS0 {ax.machineZero ?? 0}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <Btn disabled={isFirst} onClick={e => { e.stopPropagation(); cfg.moveAxis(machineId, ax.id, 'up'); }}>↑</Btn>
          <Btn disabled={isLast}  onClick={e => { e.stopPropagation(); cfg.moveAxis(machineId, ax.id, 'down'); }}>↓</Btn>
          <Btn danger onClick={e => { e.stopPropagation(); cfg.deleteAxis(machineId, ax.id); }}>✕</Btn>
        </div>

        <div style={{ color: '#475569', fontSize: 12, flexShrink: 0 }}>{open ? '▾' : '▸'}</div>
      </div>

      {/* Expanded form */}
      {open && (
        <div style={{ padding: '14px 14px 16px', borderTop: '1px solid #1e293b' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 12 }}>
            <Input label="Axis Name" value={ax.name} onChange={v => up({ name: v, label: v })} />
            <Select label="Type" value={ax.kind} onChange={v => up({ kind: v as AxisKind })}
              options={[{ value: 'Linear', label: 'Linear' }, { value: 'Rotary', label: 'Rotary' }]} />
            <Select label="Side" value={ax.side} onChange={v => up({ side: v as AxisSide })}
              options={[{ value: 'tool', label: 'Tool side' }, { value: 'table', label: 'Table side' }]} />
            <Input label="Channel" value={ax.channel} type="number" min={1} max={99} onChange={v => up({ channel: v })} />
            <Input label="Min (mm/°)" value={ax.min} type="number" onChange={v => up({ min: v })} />
            <Input label="Max (mm/°)" value={ax.max} type="number" onChange={v => up({ max: v })} />
            <Input label="Accel" value={ax.accel} type="number" step={100} min={0} onChange={v => up({ accel: v })} />
            <Input label="Machine Zero" value={ax.machineZero ?? 0} type="number" step={0.001} onChange={v => up({ machineZero: v })} />
            <Select label="Home Dir" value={String(ax.homeDir) as any}
              onChange={v => up({ homeDir: parseInt(v) as -1 | 1 })}
              options={[{ value: '-1', label: '− Negative' }, { value: '1', label: '+ Positive' }]} />
            {ax.kind === 'Rotary' && (
              <Select
                label="Link Rotary To"
                value={(
                  ax.linkAxis
                  ?? (ax.name.toUpperCase() === 'A'
                    ? 'A'
                    : ax.name.toUpperCase() === 'B'
                      ? 'B'
                      : 'C')
                ) as any}
                onChange={v => up({ linkAxis: v as 'A' | 'B' | 'C' })}
                options={[
                  { value: 'A', label: 'A axis' },
                  { value: 'B', label: 'B axis' },
                  { value: 'C', label: 'C axis' },
                ]}
              />
            )}
            {/* Invert direction toggle */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>Invert Direction</label>
              <button
                onClick={() => up({ invert: !ax.invert })}
                style={{
                  padding: '7px 10px', borderRadius: 6, cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
                  border: `1px solid ${ax.invert ? '#f59e0b' : '#2d3748'}`,
                  background: ax.invert ? 'rgba(245,158,11,0.15)' : '#1e2433',
                  color: ax.invert ? '#f59e0b' : '#64748b',
                  textAlign: 'left',
                  transition: 'all 0.15s',
                }}
              >
                {ax.invert ? '⟵ Inverted' : '⟶ Normal'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Small button helper
function Btn({ children, onClick, disabled, danger }: {
  children: ReactNode; onClick?: MouseEventHandler;
  disabled?: boolean; danger?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 26, height: 26, borderRadius: 5, border: 'none',
        background: danger ? '#7f1d1d22' : '#1e293b',
        color: disabled ? '#334155' : danger ? '#ef4444' : '#94a3b8',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.1s', fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  );
}

// ─── Add Axis Form ────────────────────────────────────────────────────────────
function AddAxisForm({ machineId, cfg, onDone }: {
  machineId: string; cfg: UseMachineConfig; onDone: () => void;
}) {
  const [form, setForm] = useState<Omit<AxisConfig, 'id'>>({
    name: '', label: '', kind: 'Linear', side: 'tool',
    channel: 1, min: -100, max: 100, accel: 2000, homeDir: -1, machineZero: 0, invert: false, linkAxis: 'B',
  });
  const set = (p: Partial<typeof form>) => setForm(prev => ({ ...prev, ...p }));

  return (
    <div style={{
      background: '#0d1421', border: '1px solid #3b82f644',
      borderRadius: 10, padding: 16,
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#3b82f6', marginBottom: 14 }}>
        Add New Axis
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 12 }}>
        <Input label="Name" value={form.name} onChange={v => set({ name: v, label: v })} />
        <Select label="Type" value={form.kind} onChange={v => set({ kind: v as AxisKind })}
          options={[{ value: 'Linear', label: 'Linear' }, { value: 'Rotary', label: 'Rotary' }]} />
        <Select label="Side" value={form.side} onChange={v => set({ side: v as AxisSide })}
          options={[{ value: 'tool', label: 'Tool side' }, { value: 'table', label: 'Table side' }]} />
        <Input label="Channel" value={form.channel} type="number" min={1} onChange={v => set({ channel: v })} />
        <Input label="Min" value={form.min} type="number" onChange={v => set({ min: v })} />
        <Input label="Max" value={form.max} type="number" onChange={v => set({ max: v })} />
        <Input label="Accel" value={form.accel} type="number" step={100} onChange={v => set({ accel: v })} />
        <Input label="Machine Zero" value={form.machineZero ?? 0} type="number" step={0.001} onChange={v => set({ machineZero: v })} />
        {form.kind === 'Rotary' && (
          <Select
            label="Link Rotary To"
            value={(form.linkAxis ?? 'B') as any}
            onChange={v => set({ linkAxis: v as 'A' | 'B' | 'C' })}
            options={[
              { value: 'A', label: 'A axis' },
              { value: 'B', label: 'B axis' },
              { value: 'C', label: 'C axis' },
            ]}
          />
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button style={btnPrimary} onClick={() => {
          if (!form.name.trim()) return;
          cfg.addAxis(machineId, { ...form, label: form.name });
          onDone();
        }}>Add Axis</button>
        <button style={btnSecondary} onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

// ─── CSV Preview ──────────────────────────────────────────────────────────────
function CSVPreview({ csv, onCopy, onDownload }: {
  csv: string; onCopy: () => void; onDownload: () => void;
}) {
  return (
    <div style={{ background: '#0a0e1a', borderRadius: 10, overflow: 'hidden', border: '1px solid #1e293b' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 14px', borderBottom: '1px solid #1e293b',
        background: '#0f1623',
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#475569', letterSpacing: '0.05em' }}>
          MACHINE CSV OUTPUT
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={btnSecondary} onClick={onCopy}>Copy</button>
          <button style={btnSecondary} onClick={onDownload}>↓ Export</button>
        </div>
      </div>
      <pre style={{
        margin: 0, padding: '14px 16px', fontSize: 12, color: '#38bdf8',
        lineHeight: 1.8, overflowX: 'auto', minHeight: 80,
        fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      }}>
        {csv || '— no axes configured —'}
      </pre>
      <div style={{ padding: '6px 16px 10px', fontSize: 10, color: '#1e293b' }}>
        channel · name · type · min · max · accel
      </div>
    </div>
  );
}

// ─── Shared button styles ─────────────────────────────────────────────────────
const btnPrimary: CSSProperties = {
  background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
  border: 'none', borderRadius: 7, color: '#fff',
  padding: '8px 18px', fontSize: 12, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit',
  boxShadow: '0 2px 8px rgba(37,99,235,0.4)',
};
const btnSecondary: CSSProperties = {
  background: '#1e293b', border: '1px solid #2d3748',
  borderRadius: 7, color: '#94a3b8',
  padding: '7px 14px', fontSize: 11, fontWeight: 500,
  cursor: 'pointer', fontFamily: 'inherit',
};
const btnSuccess: CSSProperties = {
  background: 'linear-gradient(135deg, #16a34a, #15803d)',
  border: 'none', borderRadius: 7, color: '#fff',
  padding: '9px 22px', fontSize: 12, fontWeight: 700,
  cursor: 'pointer', fontFamily: 'inherit',
  boxShadow: '0 2px 8px rgba(22,163,74,0.4)',
};

// ─── Main Panel ────────────────────────────────────────────────────────────────
type Tab = 'machines' | 'templates' | 'editor' | 'stock' | 'backup';
type EditorAccordion = 'spindle' | 'axes';

export default function MachineConfigPanel({
  cfg, onClose, onApply, stockConfig, onApplyStock, onExportSession, onImportSessionFile,
}: {
  cfg: UseMachineConfig;
  onClose: () => void;
  onApply: (csv: string) => void;
  stockConfig?: StockConfig;
  onApplyStock?: (next: StockConfig) => void;
  onExportSession?: (selection?: SessionBackupSelection) => void;
  onImportSessionFile?: (file: File, selection?: SessionBackupSelection) => Promise<SessionImportResult>;
}) {
  const [tab, setTab] = useState<Tab>('machines');
  const [addingAxis, setAddingAxis] = useState(false);
  const [editorOpen, setEditorOpen] = useState<EditorAccordion>('axes');
  const [openAxisId, setOpenAxisId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const defaultStock: StockConfig = { shape: 'box', size: { x: 40, y: 40, z: 40 }, position: { x: 0, y: 0, z: 20 }, mount: 'table', color: '#3b82f6', opacity: 0.92 };
  const [stockDraft, setStockDraft] = useState<StockConfig>(
    { ...defaultStock, ...(stockConfig ?? {}) }
  );
  const [backupMsg, setBackupMsg] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupExportSel, setBackupExportSel] = useState<SessionBackupSelection>(DEFAULT_BACKUP_SELECTION);
  const [backupImportSel, setBackupImportSel] = useState<SessionBackupSelection>(DEFAULT_BACKUP_SELECTION);
  const backupFileRef = useRef<HTMLInputElement | null>(null);

  const machine = cfg.activeMachine;
  useEffect(() => {
    if (tab !== 'editor') return;
    setEditorOpen('axes');
  }, [tab]);
  useEffect(() => {
    if (!machine) {
      setOpenAxisId(null);
      return;
    }
    if (openAxisId && !machine.axes.some((ax) => ax.id === openAxisId)) {
      setOpenAxisId(null);
    }
  }, [machine, openAxisId]);
  useEffect(() => {
    if (stockConfig) setStockDraft({ ...defaultStock, ...stockConfig });
  }, [stockConfig]);

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'machines',  label: 'Machines',  icon: 'M' },
    { id: 'templates', label: 'Templates', icon: 'T' },
    { id: 'editor',    label: 'Axis Editor', icon: 'A' },
    { id: 'stock',     label: 'Stock', icon: 'S' },
    { id: 'backup',    label: 'Backup', icon: 'B' },
  ];
  const setStockNum = (path: 'size.x' | 'size.y' | 'size.z' | 'position.x' | 'position.y' | 'position.z' | 'opacity', raw: string) => {
    const v = Number.parseFloat(raw.replace(',', '.'));
    if (Number.isNaN(v)) return;
    if (path === 'opacity') {
      setStockDraft((prev) => ({ ...prev, opacity: Math.max(0.05, Math.min(1, v)) }));
      return;
    }
    setStockDraft((prev) => {
      const next = { ...prev, size: { ...prev.size }, position: { ...prev.position } };
      const [group, key] = path.split('.') as ['size' | 'position', 'x' | 'y' | 'z'];
      next[group][key] = v;
      return next;
    });
  };
  const backupSectionDefs: Array<{ key: keyof SessionBackupSelection; label: string; hint: string }> = [
    { key: 'machines', label: 'Machines', hint: 'Machine list, active machine, spindle defaults.' },
    { key: 'tooling', label: 'Tooling', hint: 'Tools, assemblies, stations, H/D table.' },
    { key: 'programs', label: 'Programs', hint: 'G-code editor channel programs.' },
    { key: 'view', label: 'View/UI', hint: 'Panels, stock, scene and UI preferences.' },
    { key: 'runtime', label: 'Runtime', hint: 'Current offsets, active tool and modal runtime state.' },
  ];

  const formatSelectionLabel = (sel: SessionBackupSelection): string => {
    const labels = backupSectionDefs.filter((d) => sel[d.key]).map((d) => d.label);
    return labels.length ? labels.join(', ') : 'none';
  };

  const setAllBackupSections = (target: 'export' | 'import', value: boolean) => {
    const next: SessionBackupSelection = {
      machines: value,
      tooling: value,
      programs: value,
      view: value,
      runtime: value,
    };
    if (target === 'export') setBackupExportSel(next);
    else setBackupImportSel(next);
  };

  const hasAnyBackupSection = (sel: SessionBackupSelection): boolean =>
    Object.values(sel).some(Boolean);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.6)',
      backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: '"Inter", "Segoe UI", system-ui, sans-serif',
    }}>
      <div style={{
        width: 'min(96vw, 1080px)', height: 'min(90vh, 760px)',
        background: '#0d1117', borderRadius: 14,
        border: '1px solid #1e293b',
        boxShadow: '0 32px 100px rgba(0,0,0,0.7)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>

        {/* ── Header ───────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 24px', borderBottom: '1px solid #1e293b',
          background: '#090d14', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 9,
              background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16,
            }}>⚙</div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>Machine Configuration</div>
              {machine && (
                <div style={{ fontSize: 11, color: '#475569', marginTop: 1 }}>
                  Active: <span style={{ color: '#38bdf8' }}>{machine.name}</span>
                  &nbsp;·&nbsp; {machine.axes.length} axes
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {tab === 'stock' ? (
              <button style={btnSuccess} onClick={() => { onApplyStock?.(stockDraft); onClose(); }}>
                APPLY STOCK
              </button>
            ) : tab === 'backup' ? (
              <div style={{ fontSize: 11, color: '#475569' }}>Session JSON export/import</div>
            ) : (
              <button style={btnSuccess} onClick={() => { if (cfg.activeCSV) { onApply(cfg.activeCSV); onClose(); } }}>
                APPLY & BOOT
              </button>
            )}
            <button
              onClick={onClose}
              style={{
                width: 34, height: 34, borderRadius: 7, border: '1px solid #1e293b',
                background: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: 16,
              }}
            >✕</button>
          </div>
        </div>

        {/* ── Tabs ─────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', gap: 2, padding: '10px 24px 0',
          borderBottom: '1px solid #1e293b', background: '#090d14', flexShrink: 0,
        }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '8px 16px', borderRadius: '7px 7px 0 0',
              border: 'none', cursor: 'pointer',
              background: tab === t.id ? '#0d1117' : 'transparent',
              color: tab === t.id ? '#38bdf8' : '#475569',
              fontSize: 12, fontWeight: tab === t.id ? 600 : 400,
              fontFamily: 'inherit',
              borderBottom: tab === t.id ? '2px solid #38bdf8' : '2px solid transparent',
              transition: 'all 0.15s',
            }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* ── Content ──────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>

          {/* MACHINES */}
          {tab === 'machines' && (
            <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', width: '100%', overflow: 'hidden' }}>
              {/* Left: machine list */}
              <div style={{
                borderRight: '1px solid #1e293b', padding: '16px',
                overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8,
              }}>
                <SectionLabel>Saved Machines</SectionLabel>
                {cfg.machines.map(m => {
                  const active = m.id === machine?.id;
                  return (
                    <div key={m.id} style={{
                      borderRadius: 8, border: `1px solid ${active ? '#3b82f6' : '#1e293b'}`,
                      background: active ? '#0a1628' : '#0f1623',
                      overflow: 'hidden', transition: 'all 0.15s',
                    }}>
                      <button
                        onClick={() => { cfg.setActiveMachine(m.id); setTab('editor'); }}
                        style={{
                          width: '100%', background: 'transparent', border: 'none',
                          padding: '10px 12px', textAlign: 'left', cursor: 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>{m.name}</div>
                        <div style={{ fontSize: 10, color: '#475569', marginTop: 3 }}>
                          {m.axes.length} axes · {m.templateId ?? 'custom'}
                        </div>
                      </button>
                      <div style={{ display: 'flex', borderTop: '1px solid #1e293b' }}>
                        <button
                          onClick={() => cfg.duplicateMachine(m.id)}
                          style={{ flex: 1, background: 'transparent', border: 'none', color: '#475569', padding: '6px', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}
                        >Duplicate</button>
                        <button
                          onClick={() => cfg.machines.length > 1 && cfg.deleteMachine(m.id)}
                          style={{ flex: 1, background: 'transparent', border: 'none', color: '#7f1d1d', padding: '6px', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}
                        >Delete</button>
                      </div>
                    </div>
                  );
                })}

                {/* Create blank */}
                <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                  <input
                    style={{ ...inputStyle, flex: 1, fontSize: 12 }}
                    placeholder="New machine name…"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && newName.trim()) {
                        cfg.createBlank(newName.trim()); setNewName(''); setTab('editor');
                      }
                    }}
                  />
                  <button style={btnPrimary} onClick={() => {
                    if (newName.trim()) { cfg.createBlank(newName.trim()); setNewName(''); setTab('editor'); }
                  }}>+</button>
                </div>
              </div>

              {/* Right: axis preview + CSV */}
              <div style={{ padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
                {machine && (
                  <>
                    <SectionLabel>Axis Orientation Preview</SectionLabel>
                    <div style={{ height: 260, borderRadius: 10, overflow: 'hidden', border: '1px solid #1e293b', background: '#060a10' }}>
                      <AxisPreview axes={machine.axes} />
                    </div>
                    <CSVPreview
                      csv={cfg.activeCSV}
                      onCopy={() => navigator.clipboard.writeText(cfg.activeCSV)}
                      onDownload={() => cfg.downloadCSV(machine.id)}
                    />
                  </>
                )}
              </div>
            </div>
          )}

          {/* TEMPLATES */}
          {tab === 'templates' && (
            <div style={{ padding: 20, overflowY: 'auto', width: '100%' }}>
              <SectionLabel>Machine Templates</SectionLabel>
              <p style={{ fontSize: 12, color: '#475569', marginBottom: 16, marginTop: 0 }}>
                Start from a template and customise axes, ranges, and acceleration in the editor.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
                {cfg.templates.map(tpl => (
                  <TemplateCard key={tpl.id} tpl={tpl} onSelect={() => {
                    cfg.createFromTemplate(tpl); setTab('editor');
                  }} />
                ))}
              </div>
            </div>
          )}

          {/* EDITOR */}
          {tab === 'editor' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', width: '100%', overflow: 'hidden' }}>
              {/* Left: axis list */}
              <div style={{ padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {machine ? (
                  <>
                    <button
                      onClick={() => {
                        setEditorOpen((prev) => (prev === 'spindle' ? 'axes' : 'spindle'));
                        setAddingAxis(false);
                      }}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                        background: editorOpen === 'spindle' ? '#0f1729' : '#0b1322',
                        border: '1px solid #22304f',
                        borderRadius: 8,
                        padding: '9px 12px',
                        color: '#93c5fd',
                        fontSize: 12,
                        fontWeight: 700,
                        letterSpacing: '0.04em',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ color: '#64748b' }}>≡</span> SPINDLE SETUP
                      </span>
                      <span style={{ color: '#64748b' }}>{editorOpen === 'spindle' ? 'HIDE' : 'OPEN'}</span>
                    </button>
                    {editorOpen === 'spindle' && (
                      <>
                    {/* Machine name/desc */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                      <Input label="Machine Name" value={machine.name}
                        onChange={v => cfg.updateMachine(machine.id, { name: v })} />
                      <Input label="Description" value={machine.description}
                        onChange={v => cfg.updateMachine(machine.id, { description: v })} />
                      <Input
                        label="Spindle S1 Dia (mm)"
                        value={machine.spindleDiameter}
                        type="number"
                        min={1}
                        step={0.1}
                        onChange={v => cfg.updateMachine(machine.id, { spindleDiameter: Math.max(1, Number(v) || 1) })}
                      />
                      <Input
                        label="Spindle S1 Len (mm)"
                        value={machine.spindleLength}
                        type="number"
                        min={1}
                        step={0.1}
                        onChange={v => cfg.updateMachine(machine.id, { spindleLength: Math.max(1, Number(v) || 1) })}
                      />
                      <Input
                        label="Spindle S2 Dia (mm)"
                        value={machine.spindleNoseDiameter}
                        type="number"
                        min={1}
                        step={0.1}
                        onChange={v => cfg.updateMachine(machine.id, { spindleNoseDiameter: Math.max(1, Number(v) || 1) })}
                      />
                      <Input
                        label="Spindle S2 Len (mm)"
                        value={machine.spindleNoseLength}
                        type="number"
                        min={1}
                        step={0.1}
                        onChange={v => cfg.updateMachine(machine.id, { spindleNoseLength: Math.max(1, Number(v) || 1) })}
                      />
                      <Input
                        label="Spindle S3 Dia (mm)"
                        value={machine.spindleCapDiameter}
                        type="number"
                        min={1}
                        step={0.1}
                        onChange={v => cfg.updateMachine(machine.id, { spindleCapDiameter: Math.max(1, Number(v) || 1) })}
                      />
                      <Input
                        label="Spindle S3 Len (mm)"
                        value={machine.spindleCapLength}
                        type="number"
                        min={1}
                        step={0.1}
                        onChange={v => cfg.updateMachine(machine.id, { spindleCapLength: Math.max(1, Number(v) || 1) })}
                      />
                      <Select
                        label="Spindle Axis (MCS)"
                        value={((machine as any).spindleAxis ?? (machine.spindleUp ? '-Z' : '+Z')) as SpindleAxis}
                        onChange={(v) => cfg.updateMachine(machine.id, { spindleAxis: v as SpindleAxis })}
                        options={[
                          { value: '+X', label: '+X' },
                          { value: '-X', label: '-X' },
                          { value: '+Y', label: '+Y' },
                          { value: '-Y', label: '-Y' },
                          { value: '+Z', label: '+Z' },
                          { value: '-Z', label: '-Z' },
                        ]}
                      />
                      <Input
                        label="Spindle Off X (mm)"
                        value={machine.spindleOffsetX}
                        type="number"
                        step={0.1}
                        onChange={v => cfg.updateMachine(machine.id, { spindleOffsetX: Number(v) || 0 })}
                      />
                      <Input
                        label="Spindle Off Y (mm)"
                        value={machine.spindleOffsetY}
                        type="number"
                        step={0.1}
                        onChange={v => cfg.updateMachine(machine.id, { spindleOffsetY: Number(v) || 0 })}
                      />
                      <Input
                        label="Spindle Off Z (mm)"
                        value={machine.spindleOffsetZ}
                        type="number"
                        step={0.1}
                        onChange={v => cfg.updateMachine(machine.id, { spindleOffsetZ: Number(v) || 0 })}
                      />
                      <Input
                        label="Spindle Rot X (deg)"
                        value={machine.spindleRotX}
                        type="number"
                        step={0.1}
                        onChange={v => cfg.updateMachine(machine.id, { spindleRotX: Number(v) || 0 })}
                      />
                      <Input
                        label="Spindle Rot Y (deg)"
                        value={machine.spindleRotY}
                        type="number"
                        step={0.1}
                        onChange={v => cfg.updateMachine(machine.id, { spindleRotY: Number(v) || 0 })}
                      />
                      <Input
                        label="Spindle Rot Z (deg)"
                        value={machine.spindleRotZ}
                        type="number"
                        step={0.1}
                        onChange={v => cfg.updateMachine(machine.id, { spindleRotZ: Number(v) || 0 })}
                      />
                    </div>
                    {machine.templateId && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <button
                          style={btnSuccess}
                          onClick={() => cfg.saveSpindleAsTemplateDefault(machine.id)}
                        >
                          Save Spindle as Template Default
                        </button>
                        <button
                          style={btnSecondary}
                          disabled={!cfg.hasTemplateSpindleDefault(machine.templateId)}
                          onClick={() => cfg.clearTemplateSpindleDefault(machine.templateId!)}
                        >
                          Reset Template Spindle
                        </button>
                      </div>
                    )}
                    {machine.templateId && (
                      <div style={{ fontSize: 11, color: '#64748b' }}>
                        Template {machine.templateId} spindle default:{' '}
                        <span style={{ color: cfg.hasTemplateSpindleDefault(machine.templateId) ? '#22c55e' : '#94a3b8' }}>
                          {cfg.hasTemplateSpindleDefault(machine.templateId) ? 'customized' : 'base'}
                        </span>
                      </div>
                    )}
                      </>
                    )}

                    <button
                      onClick={() => setEditorOpen((prev) => (prev === 'axes' ? 'spindle' : 'axes'))}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                        background: editorOpen === 'axes' ? '#0f1729' : '#0b1322',
                        border: '1px solid #22304f',
                        borderRadius: 8,
                        padding: '9px 12px',
                        color: '#93c5fd',
                        fontSize: 12,
                        fontWeight: 700,
                        letterSpacing: '0.04em',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ color: '#64748b' }}>≡</span> AXES SETUP
                      </span>
                      <span style={{ color: '#64748b' }}>{editorOpen === 'axes' ? 'HIDE' : 'OPEN'}</span>
                    </button>

                    {editorOpen === 'axes' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '58vh', overflowY: 'auto', paddingRight: 2 }}>
                    {/* Legend */}
                    <div style={{ display: 'flex', gap: 16, fontSize: 11, color: '#475569' }}>
                      <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#3b82f6', marginRight: 5 }} />Tool side</span>
                      <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#f59e0b', marginRight: 5 }} />Table side</span>
                    </div>

                    <SectionLabel>Axes — {machine.axes.length} configured</SectionLabel>

                    {machine.axes.map((ax, i) => (
                      <AxisRow
                        key={ax.id}
                        ax={ax}
                        machineId={machine.id}
                        cfg={cfg}
                        isFirst={i === 0}
                        isLast={i === machine.axes.length - 1}
                        open={openAxisId === ax.id}
                        onToggle={() => setOpenAxisId((prev) => (prev === ax.id ? null : ax.id))}
                      />
                    ))}

                    {addingAxis
                      ? <AddAxisForm machineId={machine.id} cfg={cfg} onDone={() => setAddingAxis(false)} />
                      : (
                        <button
                          onClick={() => setAddingAxis(true)}
                          style={{
                            background: 'transparent', border: '1px dashed #1e293b',
                            borderRadius: 8, padding: '10px', color: '#334155',
                            cursor: 'pointer', fontSize: 12, fontFamily: 'inherit',
                            width: '100%', transition: 'all 0.15s',
                          }}
                        >
                          + Add Axis
                        </button>
                      )
                    }
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#334155', fontSize: 13 }}>
                    Select or create a machine first
                  </div>
                )}
              </div>

              {/* Right: preview + CSV */}
              <div style={{ borderLeft: '1px solid #1e293b', padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
                {machine && (
                  <>
                    <SectionLabel>Axis Preview</SectionLabel>
                    <div style={{ height: 200, borderRadius: 10, overflow: 'hidden', border: '1px solid #1e293b', background: '#060a10' }}>
                      <AxisPreview axes={machine.axes} />
                    </div>

                    <CSVPreview
                      csv={cfg.exportCSV(machine.id)}
                      onCopy={() => navigator.clipboard.writeText(cfg.exportCSV(machine.id))}
                      onDownload={() => cfg.downloadCSV(machine.id)}
                    />

                    <div style={{ fontSize: 10, color: '#334155', display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Created</span><span>{new Date(machine.createdAt).toLocaleDateString()}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Updated</span><span>{new Date(machine.updatedAt).toLocaleString()}</span>
                      </div>
                      {machine.templateId && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Template</span><span style={{ color: '#475569' }}>{machine.templateId}</span>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
          {tab === 'stock' && (
            <div style={{ width: '100%', padding: 20, overflowY: 'auto' }}>
              <SectionLabel>Stock Setup</SectionLabel>
              <p style={{ fontSize: 12, color: '#64748b', marginTop: 0, marginBottom: 14 }}>
                Configure stock size and center position. Mount to table for milling or spindle/chuck for turning.
              </p>
              <div style={{
                background: '#0f1729',
                border: '1px solid #22304f',
                borderRadius: 8,
                padding: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                maxWidth: 640,
              }}>
                <div style={{ fontSize: 11, color: '#7f94b8', letterSpacing: '0.06em' }}>Shape</div>
                <div style={{
                  background: '#121f36',
                  border: '1px solid #2a395a',
                  borderRadius: 6,
                  color: '#dbeafe',
                  padding: '7px 10px',
                  fontSize: 12,
                }}>
                  Box
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <Field label="Stock Mount">
                    <select
                      style={inputStyle}
                      value={stockDraft.mount ?? 'table'}
                      onChange={(e) =>
                        setStockDraft((prev) => ({
                          ...prev,
                          mount: (e.target.value === 'spindle' ? 'spindle' : 'table'),
                        }))
                      }
                    >
                      <option value="table">Table (milling)</option>
                      <option value="spindle">Spindle/Chuck (turning)</option>
                    </select>
                  </Field>
                  <div style={{ fontSize: 11, color: '#64748b', alignSelf: 'end', paddingBottom: 6 }}>
                    Table mount follows table-side axes. Spindle mount follows spindle/tool head.
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <Field label="Stock Color">
                    <input
                      type="color"
                      style={inputStyle}
                      value={stockDraft.color}
                      onChange={(e) => setStockDraft((prev) => ({ ...prev, color: e.target.value }))}
                    />
                  </Field>
                  <Field label="Stock Opacity (0-1)">
                    <input
                      style={inputStyle}
                      value={stockDraft.opacity}
                      onChange={(e) => setStockNum('opacity', e.target.value)}
                    />
                  </Field>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                  <Field label="Size X (mm)">
                    <input style={inputStyle} value={stockDraft.size.x} onChange={(e) => setStockNum('size.x', e.target.value)} />
                  </Field>
                  <Field label="Size Y (mm)">
                    <input style={inputStyle} value={stockDraft.size.y} onChange={(e) => setStockNum('size.y', e.target.value)} />
                  </Field>
                  <Field label="Size Z (mm)">
                    <input style={inputStyle} value={stockDraft.size.z} onChange={(e) => setStockNum('size.z', e.target.value)} />
                  </Field>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                  <Field label="Pos X (mm)">
                    <input style={inputStyle} value={stockDraft.position.x} onChange={(e) => setStockNum('position.x', e.target.value)} />
                  </Field>
                  <Field label="Pos Y (mm)">
                    <input style={inputStyle} value={stockDraft.position.y} onChange={(e) => setStockNum('position.y', e.target.value)} />
                  </Field>
                  <Field label="Pos Z (mm)">
                    <input style={inputStyle} value={stockDraft.position.z} onChange={(e) => setStockNum('position.z', e.target.value)} />
                  </Field>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button style={btnSuccess} onClick={() => { onApplyStock?.(stockDraft); onClose(); }}>
                    APPLY STOCK
                  </button>
                </div>
              </div>
            </div>
          )}
          {tab === 'backup' && (
            <div style={{ width: '100%', padding: 20, overflowY: 'auto' }}>
              <SectionLabel>Session Backup</SectionLabel>
              <p style={{ fontSize: 12, color: '#64748b', marginTop: 0, marginBottom: 14 }}>
                Export or import only selected sections. Use this to keep full snapshots and also small machine-only override files.
              </p>
              <div style={{
                background: '#0f1729',
                border: '1px solid #22304f',
                borderRadius: 8,
                padding: 14,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                maxWidth: 760,
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={{ background: '#0b1426', border: '1px solid #2a3b5a', borderRadius: 6, padding: 10 }}>
                    <div style={{ fontSize: 11, color: '#93c5fd', marginBottom: 8, fontWeight: 700 }}>Export Sections</div>
                    <div style={{ display: 'grid', gap: 6 }}>
                      {backupSectionDefs.map((sec) => (
                        <label key={`export_${sec.key}`} style={{ display: 'grid', gridTemplateColumns: '14px 1fr', gap: 8, alignItems: 'start', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={backupExportSel[sec.key]}
                            onChange={(e) => setBackupExportSel((prev) => ({ ...prev, [sec.key]: e.target.checked }))}
                          />
                          <span style={{ fontSize: 11, color: '#b7c6e2', lineHeight: 1.35 }}>
                            <strong>{sec.label}</strong> - {sec.hint}
                          </span>
                        </label>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button style={btnSecondary} onClick={() => setAllBackupSections('export', true)}>ALL</button>
                      <button style={btnSecondary} onClick={() => setAllBackupSections('export', false)}>NONE</button>
                    </div>
                    <div style={{ fontSize: 10, color: '#7f94b8', marginTop: 8 }}>
                      Selected: {formatSelectionLabel(backupExportSel)}
                    </div>
                  </div>
                  <div style={{ background: '#0b1426', border: '1px solid #2a3b5a', borderRadius: 6, padding: 10 }}>
                    <div style={{ fontSize: 11, color: '#93c5fd', marginBottom: 8, fontWeight: 700 }}>Import Sections</div>
                    <div style={{ display: 'grid', gap: 6 }}>
                      {backupSectionDefs.map((sec) => (
                        <label key={`import_${sec.key}`} style={{ display: 'grid', gridTemplateColumns: '14px 1fr', gap: 8, alignItems: 'start', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={backupImportSel[sec.key]}
                            onChange={(e) => setBackupImportSel((prev) => ({ ...prev, [sec.key]: e.target.checked }))}
                          />
                          <span style={{ fontSize: 11, color: '#b7c6e2', lineHeight: 1.35 }}>
                            <strong>{sec.label}</strong> - {sec.hint}
                          </span>
                        </label>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button style={btnSecondary} onClick={() => setAllBackupSections('import', true)}>ALL</button>
                      <button style={btnSecondary} onClick={() => setAllBackupSections('import', false)}>NONE</button>
                    </div>
                    <div style={{ fontSize: 10, color: '#7f94b8', marginTop: 8 }}>
                      Selected: {formatSelectionLabel(backupImportSel)}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    style={btnPrimary}
                    disabled={!onExportSession || !hasAnyBackupSection(backupExportSel)}
                    onClick={() => {
                      onExportSession?.(backupExportSel);
                      setBackupMsg(`Exported sections: ${formatSelectionLabel(backupExportSel)}.`);
                    }}
                  >
                    EXPORT SESSION JSON
                  </button>
                  <button
                    style={btnSecondary}
                    disabled={!onImportSessionFile || backupBusy || !hasAnyBackupSection(backupImportSel)}
                    onClick={() => backupFileRef.current?.click()}
                  >
                    {backupBusy ? 'IMPORTING…' : 'IMPORT SESSION JSON'}
                  </button>
                  <input
                    ref={backupFileRef}
                    type="file"
                    accept=".json,application/json"
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.currentTarget.value = '';
                      if (!file || !onImportSessionFile) return;
                      setBackupBusy(true);
                      const result = await onImportSessionFile(file, backupImportSel);
                      setBackupBusy(false);
                      setBackupMsg(result.message);
                    }}
                  />
                </div>
                <div style={{ fontSize: 11, color: '#7f94b8', lineHeight: 1.5 }}>
                  Merge workflow: import full session first, then import a machine-only file with only <strong>Machines</strong> checked to swap machine config without touching tools/programs.
                </div>
                {backupMsg ? (
                  <div style={{
                    fontSize: 11,
                    color: '#93c5fd',
                    background: '#0b1426',
                    border: '1px solid #2a3b5a',
                    borderRadius: 6,
                    padding: '8px 10px',
                  }}>
                    {backupMsg}
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}





