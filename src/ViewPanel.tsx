import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ReferenceVisualMode, SceneSetupConfig, SidebarModuleProps } from './modules/moduleTypes';

type SceneNumKey =
  | 'ambientIntensity'
  | 'keyIntensity'
  | 'fillIntensity'
  | 'floorIntensity'
  | 'stockCutterDebugOpacity'
  | 'gridOpacity'
  | 'gizmoScale'
  | 'uiScale';

function parseNum(raw: string): number | null {
  const v = Number.parseFloat(raw.replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

function clampValue(key: SceneNumKey, value: number): number {
  switch (key) {
    case 'stockCutterDebugOpacity': return Math.max(0, Math.min(1, value));
    case 'gridOpacity': return Math.max(0, Math.min(1, value));
    case 'gizmoScale': return Math.max(0.25, Math.min(4, value));
    case 'uiScale': return Math.max(0.5, Math.min(2, value));
    default: return value;
  }
}

function nextMode(mode: ReferenceVisualMode): ReferenceVisualMode {
  if (mode === 'off') return 'dot';
  if (mode === 'dot') return 'gizmo';
  return 'off';
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  displayValue,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  displayValue?: string;
}) {
  const shown = displayValue ?? String(Number.isFinite(value) ? value : 0);
  return (
    <label style={s.field}>
      <span style={s.label}>{label} ({shown})</span>
      <div style={s.sliderRow}>
        <input
          type="range"
          min={min}
          max={max}
          step={step ?? 1}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Number.parseFloat(e.target.value) || 0)}
          style={s.slider}
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step ?? 1}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => {
            const n = parseNum(e.target.value);
            if (n === null) return;
            onChange(n);
          }}
          style={s.input}
        />
      </div>
    </label>
  );
}

export default function ViewPanel({ runtime }: SidebarModuleProps) {
  const { telemetry, can } = runtime;
  const cfg = telemetry.sceneConfig;
  const [dotDraft, setDotDraft] = useState<{ wcs: string; mcs: string; toolRapid: string; toolFeed: string; spindle: string }>({
    wcs: cfg.wcsDotColor,
    mcs: cfg.mcsDotColor,
    toolRapid: cfg.toolPointRapidColor,
    toolFeed: cfg.toolPointFeedColor,
    spindle: cfg.spindlePointColor,
  });
  useEffect(() => {
    setDotDraft({
      wcs: cfg.wcsDotColor,
      mcs: cfg.mcsDotColor,
      toolRapid: cfg.toolPointRapidColor,
      toolFeed: cfg.toolPointFeedColor,
      spindle: cfg.spindlePointColor,
    });
  }, [cfg.wcsDotColor, cfg.mcsDotColor, cfg.toolPointRapidColor, cfg.toolPointFeedColor, cfg.spindlePointColor]);

  const patchScene = (patch: Partial<SceneSetupConfig>) => {
    can.emit('command', { type: 'ui.patch_scene_config', patch });
  };

  const setNum = (key: SceneNumKey, value: number) => {
    patchScene({ [key]: clampValue(key, value) } as Partial<SceneSetupConfig>);
  };

  return (
    <>
      <div style={s.grid2}>
        <button
          style={{ ...s.btn, ...(telemetry.wcsReferenceVisual !== 'off' ? s.btnOn : {}) }}
          onClick={() => can.emit('command', { type: 'ui.set_wcs_reference_visual', mode: nextMode(telemetry.wcsReferenceVisual) })}
          title="Cycle OFF -> DOT -> GIZMO"
        >
          WCS {telemetry.wcsReferenceVisual.toUpperCase()}
        </button>
        <button
          style={{ ...s.btn, ...(telemetry.mcsReferenceVisual !== 'off' ? s.btnOn : {}) }}
          onClick={() => can.emit('command', { type: 'ui.set_mcs_reference_visual', mode: nextMode(telemetry.mcsReferenceVisual) })}
          title="Cycle OFF -> DOT -> GIZMO"
        >
          MCS {telemetry.mcsReferenceVisual.toUpperCase()}
        </button>
      </div>

      <div style={s.grid2}>
        <button
          style={{ ...s.btn, ...(cfg.antiAliasing ? s.btnOn : {}) }}
          onClick={() => patchScene({ antiAliasing: !cfg.antiAliasing })}
          title="Toggle renderer anti-aliasing"
        >
          AA {cfg.antiAliasing ? 'ON' : 'OFF'}
        </button>
        <button
          style={{ ...s.btn, ...(cfg.showSceneAxes ? s.btnOn : {}) }}
          onClick={() => patchScene({ showSceneAxes: !cfg.showSceneAxes })}
          title="Show/hide scene axis helper"
        >
          AXES {cfg.showSceneAxes ? 'ON' : 'OFF'}
        </button>
      </div>
      <div style={s.grid2}>
        <button
          style={{ ...s.btn, ...(cfg.stockBooleanEngine === 'manifold' ? s.btnOn : {}) }}
          onClick={() => patchScene({ stockBooleanEngine: cfg.stockBooleanEngine === 'manifold' ? 'none' : 'manifold' })}
          title="Experimental stock booleans via Manifold (stock only)"
        >
          STOCK {cfg.stockBooleanEngine === 'manifold' ? 'MANIFOLD' : 'STATIC'}
        </button>
        <button
          style={{ ...s.btn, ...(cfg.stockCollisionDetection ? s.btnOn : {}) }}
          onClick={() => patchScene({ stockCollisionDetection: !cfg.stockCollisionDetection })}
          title="Toggle collision detection when non-cut tool body touches stock"
        >
          COLLISION {cfg.stockCollisionDetection ? 'ON' : 'OFF'}
        </button>
      </div>
      <div style={s.grid2}>
        <button
          style={{ ...s.btn, ...(cfg.showStockCutterDebug ? s.btnOn : {}) }}
          onClick={() => patchScene({ showStockCutterDebug: !cfg.showStockCutterDebug })}
          title="Show current manifold cutter volume for debugging"
        >
          CUT DEBUG {cfg.showStockCutterDebug ? 'ON' : 'OFF'}
        </button>
        <div />
      </div>

      <div style={s.grid2}>
        <button
          style={{ ...s.btn, ...(cfg.shadowsEnabled ? s.btnOn : {}) }}
          onClick={() => patchScene({ shadowsEnabled: !cfg.shadowsEnabled })}
          title="Toggle scene shadows"
        >
          SHADOWS {cfg.shadowsEnabled ? 'ON' : 'OFF'}
        </button>
        <button
          style={{ ...s.btn, ...(cfg.reflectionsEnabled ? s.btnOn : {}) }}
          onClick={() => patchScene({ reflectionsEnabled: !cfg.reflectionsEnabled })}
          title="Toggle reflective/specular materials"
        >
          REFLECT {cfg.reflectionsEnabled ? 'ON' : 'OFF'}
        </button>
      </div>

      <div style={s.grid2}>
        <label style={s.field}>
          <span style={s.label}>WCS Dot</span>
          <div style={s.colorRow}>
            <input
              type="color"
              style={s.colorInput}
              value={dotDraft.wcs}
              onChange={(e) => setDotDraft((p) => ({ ...p, wcs: e.target.value }))}
            />
            <button style={s.applyBtn} onClick={() => patchScene({ wcsDotColor: dotDraft.wcs })}>SET</button>
          </div>
        </label>
        <label style={s.field}>
          <span style={s.label}>MCS Dot</span>
          <div style={s.colorRow}>
            <input
              type="color"
              style={s.colorInput}
              value={dotDraft.mcs}
              onChange={(e) => setDotDraft((p) => ({ ...p, mcs: e.target.value }))}
            />
            <button style={s.applyBtn} onClick={() => patchScene({ mcsDotColor: dotDraft.mcs })}>SET</button>
          </div>
        </label>
      </div>
      <div style={s.grid2}>
        <label style={s.field}>
          <span style={s.label}>Tool Pt Rapid</span>
          <div style={s.colorRow}>
            <input
              type="color"
              style={s.colorInput}
              value={dotDraft.toolRapid}
              onChange={(e) => setDotDraft((p) => ({ ...p, toolRapid: e.target.value }))}
            />
            <button style={s.applyBtn} onClick={() => patchScene({ toolPointRapidColor: dotDraft.toolRapid })}>SET</button>
          </div>
        </label>
        <label style={s.field}>
          <span style={s.label}>Tool Pt Feed</span>
          <div style={s.colorRow}>
            <input
              type="color"
              style={s.colorInput}
              value={dotDraft.toolFeed}
              onChange={(e) => setDotDraft((p) => ({ ...p, toolFeed: e.target.value }))}
            />
            <button style={s.applyBtn} onClick={() => patchScene({ toolPointFeedColor: dotDraft.toolFeed })}>SET</button>
          </div>
        </label>
      </div>
      <div style={s.grid2}>
        <label style={s.field}>
          <span style={s.label}>Spindle Pt</span>
          <div style={s.colorRow}>
            <input
              type="color"
              style={s.colorInput}
              value={dotDraft.spindle}
              onChange={(e) => setDotDraft((p) => ({ ...p, spindle: e.target.value }))}
            />
            <button style={s.applyBtn} onClick={() => patchScene({ spindlePointColor: dotDraft.spindle })}>SET</button>
          </div>
        </label>
        <div />
      </div>

      <div style={s.grid2}>
        <label style={s.field}>
          <span style={s.label}>Background</span>
          <input type="color" style={s.colorInput} value={cfg.backgroundColor} onChange={(e) => patchScene({ backgroundColor: e.target.value })} />
        </label>
      </div>

      <div style={s.grid2}>
        <label style={s.field}>
          <span style={s.label}>Grid Major</span>
          <input type="color" style={s.colorInput} value={cfg.gridMajorColor} onChange={(e) => patchScene({ gridMajorColor: e.target.value })} />
        </label>
        <label style={s.field}>
          <span style={s.label}>Grid Minor</span>
          <input type="color" style={s.colorInput} value={cfg.gridMinorColor} onChange={(e) => patchScene({ gridMinorColor: e.target.value })} />
        </label>
      </div>

      <div style={s.grid2}>
        <SliderField
          label="Ambient"
          value={Number(cfg.ambientIntensity ?? 0)}
          min={0}
          max={8}
          step={0.1}
          onChange={(v) => setNum('ambientIntensity', v)}
        />
        <SliderField
          label="Key"
          value={Number(cfg.keyIntensity ?? 0)}
          min={0}
          max={8}
          step={0.1}
          onChange={(v) => setNum('keyIntensity', v)}
        />
        <SliderField
          label="Fill"
          value={Number(cfg.fillIntensity ?? 0)}
          min={0}
          max={8}
          step={0.1}
          onChange={(v) => setNum('fillIntensity', v)}
        />
        <SliderField
          label="Floor"
          value={Number(cfg.floorIntensity ?? 0)}
          min={0}
          max={8}
          step={0.1}
          onChange={(v) => setNum('floorIntensity', v)}
        />
        <SliderField
          label="Cut Debug Opacity"
          value={Math.round(Number(cfg.stockCutterDebugOpacity ?? 0.35) * 100)}
          min={0}
          max={100}
          step={1}
          displayValue={`${Math.round(Number(cfg.stockCutterDebugOpacity ?? 0.35) * 100)}%`}
          onChange={(v) => setNum('stockCutterDebugOpacity', v / 100)}
        />
        <SliderField
          label="Grid Opacity"
          value={Math.round(Number(cfg.gridOpacity ?? 0) * 100)}
          min={0}
          max={100}
          step={1}
          displayValue={`${Math.round(Number(cfg.gridOpacity ?? 0) * 100)}%`}
          onChange={(v) => setNum('gridOpacity', v / 100)}
        />
        <SliderField
          label="Gizmo"
          value={Number(cfg.gizmoScale ?? 0.5)}
          min={0.25}
          max={4}
          step={0.01}
          onChange={(v) => setNum('gizmoScale', v)}
        />
        <SliderField
          label="UI"
          value={Number(cfg.uiScale ?? 1)}
          min={0.5}
          max={2}
          step={0.01}
          onChange={(v) => setNum('uiScale', v)}
        />
      </div>
    </>
  );
}

const s: Record<string, CSSProperties> = {
  grid2: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 6,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  label: {
    color: '#7b8cad',
    fontSize: 10,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    background: '#111827',
    border: '1px solid #2b3f63',
    color: '#cbd5e1',
    borderRadius: 4,
    fontFamily: 'monospace',
    fontSize: 12,
    padding: '6px 8px',
    outline: 'none',
  },
  sliderRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 72px',
    gap: 6,
    alignItems: 'center',
  },
  slider: {
    width: '100%',
    accentColor: '#22c55e',
  },
  colorInput: {
    width: '100%',
    flex: 1,
    minWidth: 0,
    boxSizing: 'border-box',
    background: '#111827',
    border: '1px solid #2b3f63',
    borderRadius: 4,
    height: 28,
    padding: 2,
    cursor: 'pointer',
  },
  colorRow: {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
  },
  applyBtn: {
    width: 46,
    height: 28,
    borderRadius: 4,
    border: '1px solid #1f2b46',
    background: '#13203a',
    color: '#9fb0cf',
    cursor: 'pointer',
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: 700,
  },
  btn: {
    background: '#0b162c',
    border: '1px solid #1f2b46',
    color: '#7b8cad',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: 700,
    padding: '7px 0',
  },
  btnOn: {
    background: '#0e3120',
    border: '1px solid #22c55e',
    color: '#86efac',
  },
};
