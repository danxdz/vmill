import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

const FEED_OVERRIDE_STOPS = [0, 10, 20, 50, 75, 100, 200, 300, 500] as const;

function nearestFeedOverrideStep(value: number): number {
  let best = 0;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (let i = 0; i < FEED_OVERRIDE_STOPS.length; i += 1) {
    const diff = Math.abs(Number(value) - FEED_OVERRIDE_STOPS[i]);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return best;
}

interface BottomControlBarProps {
  state: any;
  brain: any;
  uiScale?: number;
  onHeightChange?: (height: number) => void;
  channelCount: number;
  codes: string[];
  showScene3d: boolean;
  onShowScene3dChange: (visible: boolean) => void;
  feedOverride: number;
  onFeedOverrideChange: (value: number) => void;
  simulationSpeed: number;
  onSimulationSpeedChange: (value: number) => void;
  singleBlock: boolean;
  onSingleBlockChange: (value: boolean) => void;
  showMachineModel: boolean;
  onShowMachineModelChange: (visible: boolean) => void;
  showToolModel: boolean;
  onShowToolModelChange: (visible: boolean) => void;
  showStockModel: boolean;
  onShowStockModelChange: (visible: boolean) => void;
  onOpenSetup: () => void;
  onRewind: () => void;
}

export default function BottomControlBar({
  state,
  brain,
  uiScale = 1,
  onHeightChange,
  channelCount,
  codes,
  showScene3d,
  onShowScene3dChange,
  feedOverride,
  onFeedOverrideChange,
  simulationSpeed,
  onSimulationSpeedChange,
  singleBlock,
  onSingleBlockChange,
  showMachineModel,
  onShowMachineModelChange,
  showToolModel,
  onShowToolModelChange,
  showStockModel,
  onShowStockModelChange,
  onOpenSetup,
  onRewind,
}: BottomControlBarProps) {
  const footerRef = useRef<HTMLElement | null>(null);
  const [feedHoldArmed, setFeedHoldArmed] = useState(false);
  const ch0 = state?.channels?.[0];
  const channels = state?.channels ?? [];
  const feedHoldActive = !!state?.feed_hold;
  const isFeedHeld = feedHoldActive || channels.some((ch: any) => ch.is_running && ch.paused);
  const hasRunning = channels.some((ch: any) => ch.is_running);
  const axesMoving = (state?.axes ?? []).some(
    (ax: any) => Math.abs(Number(ax?.position ?? 0) - Number(ax?.target ?? 0)) > 1e-3
  );
  const manualMotionActive = !!state?.is_homing || (!hasRunning && axesMoving);
  const motion = ch0?.current_motion;
  const cutterComp = ch0?.cutter_comp;
  const spindleMode = ch0?.spindle_mode ?? 5;
  const coolantOn = !!ch0?.coolant_on;
  const activeTool = Number(ch0?.active_tool ?? 0);
  const activeD = Number(ch0?.active_d ?? activeTool ?? 0);
  const activeH = Number(ch0?.active_h ?? activeTool ?? 0);
  const spindleRpm = Number(ch0?.spindle_rpm ?? 0);
  const feedRate = Number(ch0?.feed_rate ?? 0);
  const lengthCompActive = !!ch0?.length_comp_active;
  const toolRadius = Math.max(0, Number(ch0?.tool_radius ?? 0));
  const toolDiameter = toolRadius * 2;
  const toolLength = Math.max(0, Number(ch0?.tool_length ?? 0));
  const toolLengthEffective = lengthCompActive ? toolLength : 0;
  const exactStop = !!ch0?.exact_stop;
  const spindleModeLabel = spindleMode === 3 ? 'M03' : spindleMode === 4 ? 'M04' : 'M05';
  const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : '0.000');

  const jumpBlocks = (delta: number) => {
    for (let i = 0; i < channelCount; i++) {
      (brain as any)?.jump_blocks?.(i, delta);
    }
  };

  const motionLabel = motion === 2 ? 'G02' : motion === 3 ? 'G03' : motion === 1 ? 'G01' : 'G00';
  const cutterLabel = cutterComp === 41 ? 'G41' : cutterComp === 42 ? 'G42' : 'G40';
  const lengthLabel = lengthCompActive ? 'G43' : 'G49';
  const pathModeLabel = exactStop ? 'G61' : 'G64';
  const coolantLabel = coolantOn ? 'M08' : 'M09';
  const all3dOn = showScene3d && showMachineModel && showToolModel && showStockModel;
  const cycleRunning = hasRunning;
  const holdButtonActive = isFeedHeld || feedHoldArmed;
  const feedOverrideStep = nearestFeedOverrideStep(feedOverride);
  const modalStates = [
    { label: motionLabel, tone: motion === 0 ? '#eab308' : '#22c55e' },
    { label: cutterLabel, tone: cutterComp === 40 ? '#64748b' : '#06b6d4' },
    { label: lengthLabel, tone: lengthCompActive ? '#22c55e' : '#64748b' },
    { label: pathModeLabel, tone: exactStop ? '#f97316' : '#64748b' },
    { label: spindleModeLabel, tone: spindleMode === 5 ? '#ef4444' : '#22c55e' },
    { label: coolantLabel, tone: coolantOn ? '#06b6d4' : '#64748b' },
  ];

  useEffect(() => {
    if (!onHeightChange || !footerRef.current) return;
    const el = footerRef.current;
    const emitHeight = () => onHeightChange(Math.ceil(el.getBoundingClientRect().height));
    emitHeight();
    const ro = new ResizeObserver(() => emitHeight());
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeightChange, uiScale, feedOverride, simulationSpeed, singleBlock, showScene3d, showMachineModel, showToolModel, showStockModel]);

  useEffect(() => {
    if (!feedHoldArmed || !hasRunning || isFeedHeld) return;
    channels.forEach((ch: any, i: number) => {
      if (ch.is_running && !ch.paused) {
        brain?.toggle_pause(i);
      }
    });
    setFeedHoldArmed(false);
  }, [feedHoldArmed, hasRunning, isFeedHeld, channels, brain]);

  useEffect(() => {
    if (state.estop && feedHoldArmed) {
      setFeedHoldArmed(false);
    }
  }, [state.estop, feedHoldArmed]);

  const triggerEstop = () => {
    if (!state.estop) {
      for (let i = 0; i < channelCount; i += 1) {
        brain?.reset_program?.(i);
      }
      brain?.set_estop(true);
      return;
    }
    brain?.set_estop(false);
  };

  return (
    <footer ref={footerRef} style={{ ...s.foot, zoom: uiScale }}>
      <button
        style={{
          ...s.estopRound,
          ...(state.estop ? s.estopRoundReset : s.estopRoundTrip),
        }}
        onClick={triggerEstop}
        title={state.estop ? 'Reset emergency stop' : 'Emergency stop'}
      >
        {state.estop ? 'RESET' : 'ESTOP'}
      </button>

      <button
        style={{
          ...s.start,
          ...(cycleRunning ? s.startReset : {}),
          ...(state.estop ? s.holdDisabled : {}),
        }}
        disabled={!!state.estop}
        onClick={() => {
          if (state.estop) return;
          if (cycleRunning) {
            onRewind();
            return;
          }
          (brain as any)?.set_feed_hold?.(false);
          brain?.set_active_wcs(state.active_wcs ?? 0);
          codes.forEach((c, i) => brain?.load_program(i, c));
          for (let i = 0; i < channelCount; i++) {
            (brain as any)?.set_feed_override?.(i, feedOverride / 100);
            (brain as any)?.set_single_block?.(i, singleBlock);
          }
        }}
      >
        {cycleRunning ? 'RESET CYCLE' : 'CYCLE START'}
      </button>

      <button
        style={{
          ...s.hold,
          ...(holdButtonActive ? s.holdStart : s.holdStop),
          ...(state.estop ? s.holdDisabled : {}),
        }}
        onClick={() => {
          if (state.estop) return;
          if (hasRunning) {
            (brain as any)?.set_feed_hold?.(false);
            channels.forEach((ch: any, i: number) => {
              if (ch.is_running) brain?.toggle_pause(i);
            });
            setFeedHoldArmed(false);
          } else if (manualMotionActive || feedHoldActive) {
            (brain as any)?.set_feed_hold?.(!feedHoldActive);
            setFeedHoldArmed(false);
          } else {
            setFeedHoldArmed((v) => !v);
          }
        }}
        disabled={!!state.estop}
      >
        {feedHoldArmed ? 'HOLD ARMED' : (isFeedHeld ? 'START FEED' : 'STOP FEED')}
      </button>

      <button
        style={{ ...s.hold, ...(singleBlock ? s.holdOn : {}) }}
        onClick={() => {
          const next = !singleBlock;
          onSingleBlockChange(next);
          for (let i = 0; i < channelCount; i++) {
            (brain as any)?.set_single_block?.(i, next);
          }
        }}
      >
        SINGLE BLOCK
      </button>

      <button style={s.hold} onClick={() => jumpBlocks(-1)}>
        PREV
      </button>
      <button style={s.hold} onClick={onRewind} title="Reset to program start and clear traces">
        REW
      </button>

      <button style={s.hold} onClick={() => jumpBlocks(1)}>
        NEXT
      </button>

      <button style={s.hold} onClick={() => jumpBlocks(10)}>
        J+10
      </button>

      <div style={s.feedPot}>
        <span style={s.feedPotLabel}>F-OVR {feedOverride}%</span>
        <input
          type="range"
          min={0}
          max={FEED_OVERRIDE_STOPS.length - 1}
          step={1}
          value={feedOverrideStep}
          onChange={(e) => {
            const stepIdx = Number(e.target.value);
            const v = FEED_OVERRIDE_STOPS[Math.max(0, Math.min(FEED_OVERRIDE_STOPS.length - 1, stepIdx))];
            onFeedOverrideChange(v);
            for (let i = 0; i < channelCount; i++) {
              (brain as any)?.set_feed_override?.(i, v / 100);
            }
          }}
        />
      </div>

      <div style={s.feedPot}>
        <span style={s.feedPotLabel}>SIM {simulationSpeed}%</span>
        <input
          type="range"
          min={10}
          max={200}
          step={1}
          value={simulationSpeed}
          onChange={(e) => {
            const v = Number(e.target.value);
            onSimulationSpeedChange(v);
          }}
        />
      </div>

      <div style={s.toolInfo} title="Active tool registers and spindle/feed status">
        <div style={s.toolInfoRow}>
          <span style={s.toolInfoCell}><span style={s.toolInfoHead}>T</span><span style={s.toolInfoValue}>{Math.max(0, activeTool).toString().padStart(2, '0')}</span></span>
          <span style={s.toolInfoCell}><span style={s.toolInfoHead}>D</span><span style={s.toolInfoValue}>{Math.max(0, activeD).toString().padStart(2, '0')}</span></span>
          <span style={s.toolInfoCell}><span style={s.toolInfoHead}>H</span><span style={s.toolInfoValue}>{Math.max(0, activeH).toString().padStart(2, '0')}</span></span>
          <span style={s.toolInfoCell}><span style={s.toolInfoHead}>S</span><span style={s.toolInfoValue}>{Math.max(0, Math.round(spindleRpm))}</span></span>
          <span style={s.toolInfoCell}><span style={s.toolInfoHead}>F</span><span style={s.toolInfoValue}>{Math.max(0, Math.round(feedRate))}</span></span>
        </div>
        <div style={s.toolInfoRow2}>
          <span style={s.toolInfoCellWide}><span style={s.toolInfoHead}>R</span><span style={s.toolInfoValue}>{fmt(toolRadius)}</span></span>
          <span style={s.toolInfoCellWide}><span style={s.toolInfoHead}>Ø</span><span style={s.toolInfoValue}>{fmt(toolDiameter)}</span></span>
          <span style={s.toolInfoCellWide}><span style={s.toolInfoHead}>L</span><span style={s.toolInfoValue}>{fmt(toolLength)}</span></span>
          <span style={s.toolInfoCellWide}><span style={s.toolInfoHead}>L*</span><span style={s.toolInfoValue}>{fmt(toolLengthEffective)}</span></span>
        </div>
      </div>

      <div style={s.modalStrip} title="Active G/M modal states">
        {modalStates.map((m, idx) => (
          <div
            key={`${m.label}-${idx}`}
            style={{
              ...s.modalLedCompact,
              ...s.modalLedOn,
              border: `1px solid ${m.tone}`,
              color: m.tone,
              background: '#112038',
            }}
          >
            {m.label}
          </div>
        ))}
      </div>

      <div style={s.group3d}>
        <button
          style={{ ...s.group3dBtn, ...(all3dOn ? s.group3dBtnOn : {} ) }}
          onClick={() => {
            if (all3dOn) {
              onShowScene3dChange(false);
            } else {
              onShowScene3dChange(true);
              onShowMachineModelChange(true);
              onShowToolModelChange(true);
              onShowStockModelChange(true);
            }
          }}
          title="Toggle all 3D layers"
        >
          ALL
        </button>
        <button
          style={{ ...s.group3dBtn, ...(showMachineModel ? s.group3dBtnOn : {}), ...(!showScene3d ? s.holdDisabled : {}) }}
          onClick={() => onShowMachineModelChange(!showMachineModel)}
          disabled={!showScene3d}
          title="Machine model"
        >
          M
        </button>
        <button
          style={{ ...s.group3dBtn, ...(showToolModel ? s.group3dBtnOn : {}), ...(!showScene3d ? s.holdDisabled : {}) }}
          onClick={() => onShowToolModelChange(!showToolModel)}
          disabled={!showScene3d}
          title="Tool model"
        >
          T
        </button>
        <button
          style={{ ...s.group3dBtn, ...(showStockModel ? s.group3dBtnOn : {}), ...(!showScene3d ? s.holdDisabled : {}) }}
          onClick={() => onShowStockModelChange(!showStockModel)}
          disabled={!showScene3d}
          title="Stock model"
        >
          S
        </button>
      </div>

      <button style={s.configBtn} onClick={onOpenSetup} title="Open setup">
        SETUP
      </button>
    </footer>
  );
}

const s: Record<string, CSSProperties> = {
  foot: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    width: '100%',
    minHeight: '74px',
    background: 'rgba(8, 10, 16, 0.94)',
    backdropFilter: 'blur(10px)',
    borderTop: '1px solid #1f2b46',
    display: 'flex',
    alignItems: 'center',
    alignContent: 'center',
    flexWrap: 'wrap',
    padding: '8px 12px',
    gap: '8px',
    boxSizing: 'border-box',
    overflowX: 'hidden',
    overflowY: 'auto',
    zIndex: 100,
    fontFamily: 'monospace',
  },
  start: {
    background: '#14532d',
    color: '#86efac',
    border: '1px solid #166534',
    height: 36,
    padding: '0 14px',
    fontWeight: 700,
    cursor: 'pointer',
    borderRadius: '4px',
    fontSize: 11,
    letterSpacing: '0.05em',
    flexShrink: 0,
  },
  startReset: {
    background: '#1e3a8a',
    color: '#bfdbfe',
    border: '1px solid #3b82f6',
  },
  hold: {
    background: '#13243c',
    color: '#9db4d8',
    border: '1px solid #2f4a73',
    height: 36,
    padding: '0 12px',
    cursor: 'pointer',
    borderRadius: '4px',
    fontSize: 11,
    letterSpacing: '0.04em',
    flexShrink: 0,
  },
  holdOn: { background: '#14532d', border: '1px solid #166534', color: '#86efac' },
  holdStart: {
    background: '#14532d',
    border: '1px solid #22c55e',
    color: '#86efac',
  },
  holdStop: {
    background: '#4c1d1d',
    border: '1px solid #7f1d1d',
    color: '#fca5a5',
  },
  holdDisabled: {
    opacity: 0.45,
    cursor: 'not-allowed',
  },
  feedPot: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    minWidth: 180,
    minHeight: 36,
    color: '#94a3b8',
    fontSize: 11,
    background: '#0e1a2e',
    border: '1px solid #233a5e',
    borderRadius: 4,
    padding: '6px 8px',
    flexShrink: 0,
  },
  feedPotLabel: { fontSize: '10px', letterSpacing: '0.08em', color: '#7f94b8' },
  toolInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    minWidth: 320,
    minHeight: 36,
    padding: '6px 8px',
    background: '#0e1a2e',
    border: '1px solid #233a5e',
    borderRadius: 4,
    flexShrink: 0,
  },
  toolInfoRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
    alignItems: 'center',
    gap: 6,
  },
  toolInfoRow2: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    alignItems: 'center',
    gap: 6,
  },
  toolInfoCell: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    minWidth: 0,
  },
  toolInfoCellWide: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    minWidth: 0,
  },
  toolInfoHead: {
    fontSize: 10,
    color: '#7f94b8',
    letterSpacing: '0.06em',
  },
  toolInfoValue: {
    fontSize: 11,
    color: '#c8d8f2',
    fontWeight: 700,
    letterSpacing: '0.03em',
  },
  toolInfoState: {
    gridColumn: '1 / span 4',
    justifySelf: 'start',
    fontSize: 10,
    color: '#94a3b8',
    border: '1px solid #334155',
    borderRadius: 999,
    padding: '2px 6px',
  },
  toolInfoStateOn: {
    color: '#67e8f9',
    border: '1px solid #0891b2',
    background: '#0f2a3a',
  },
  modalStrip: {
    display: 'flex',
    flexWrap: 'nowrap',
    alignItems: 'center',
    gap: 6,
    minWidth: 240,
    maxWidth: 340,
    minHeight: 36,
    overflowX: 'auto',
    overflowY: 'hidden',
    padding: '6px 8px',
    background: '#0e1a2e',
    border: '1px solid #233a5e',
    borderRadius: 4,
    flex: '1 1 240px',
  },
  modalLedCompact: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.05em',
    borderRadius: 999,
    padding: '3px 10px',
    minWidth: 0,
    whiteSpace: 'nowrap',
    flexShrink: 0,
    lineHeight: 1,
  },
  modalLedOn: {
    background: '#112038',
    border: '1px solid #2f4a73',
  },
  modalLedOff: {
    background: '#0d1728',
    border: '1px solid #233a5e',
  },
  modalLed: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 10,
    color: '#7f94b8',
    border: '1px solid #233a5e',
    borderRadius: 999,
    padding: '2px 6px',
    whiteSpace: 'nowrap',
  },
  modalDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
  },
  modalGroup: {
    fontSize: 9,
    color: '#7f94b8',
    letterSpacing: '0.05em',
  },
  group3d: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    minHeight: 36,
    padding: '6px 6px',
    background: '#0e1a2e',
    border: '1px solid #233a5e',
    borderRadius: 4,
    flexShrink: 0,
  },
  group3dBtn: {
    background: '#142238',
    color: '#9db4d8',
    border: '1px solid #2f4a73',
    height: 24,
    padding: '0 8px',
    cursor: 'pointer',
    borderRadius: '4px',
    fontFamily: 'monospace',
    fontSize: '10px',
    letterSpacing: '0.04em',
    minWidth: 30,
  },
  group3dBtnOn: {
    background: '#14532d',
    color: '#86efac',
    border: '1px solid #166534',
  },
  estopRound: {
    width: 42,
    height: 42,
    minWidth: 42,
    borderRadius: 999,
    fontWeight: 800,
    cursor: 'pointer',
    fontSize: 9,
    letterSpacing: '0.06em',
    lineHeight: 1,
    padding: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'monospace',
    flexShrink: 0,
    boxShadow: '0 0 0 2px rgba(0,0,0,0.35) inset',
  },
  estopRoundTrip: {
    background: '#7f1d1d',
    color: '#fee2e2',
    border: '2px solid #ef4444',
  },
  estopRoundReset: {
    background: '#1f2937',
    color: '#bfdbfe',
    border: '2px solid #3b82f6',
  },
  configBtn: {
    background: '#142238',
    color: '#9db4d8',
    border: '1px solid #2f4a73',
    height: 36,
    padding: '0 12px',
    cursor: 'pointer',
    borderRadius: '4px',
    fontFamily: 'monospace',
    fontSize: '11px',
    letterSpacing: '0.05em',
    marginLeft: 0,
    flexShrink: 0,
  },
};
