import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import init, { AxisType, MachineBrain } from '../machine-core/pkg/';
import { useMachineConfig } from './useMachineConfig';
import type { UseMachineConfig } from './useMachineConfig';

const UI_PUSH_INTERVAL_MOVING_MS = 33;
const UI_PUSH_INTERVAL_IDLE_MS = 280;
const FPS_SAMPLE_MS = 300;
const AXIS_SETTLE_EPS = 1e-3;
// Visual simulation time scale (1.0 = real-time kernel speed).
// Keep machine speeds realistic while slowing rendered motion for smoothness.
const SIM_TIME_SCALE = 0.12;
const MIN_SIM_RATE = 0.05;
const MAX_SIM_RATE = 2.0;

export interface MachineContextValue {
  state: any | null;
  brain: MachineBrain | null;
  machineConfig: UseMachineConfig;
  invertMap: Record<string, boolean>;
  configVersion: number;
  reboot: () => void;
  showConfig: boolean;
  setShowConfig: (v: boolean) => void;
  pickingAxisId: number | null;
  setPickingAxisId: (id: number | null) => void;
  pickedPosition: { axisId: number; value: number } | null;
  setPickedPosition: (p: { axisId: number; value: number } | null) => void;
  fps: number;
  setSimulationRate: (scale: number) => void;
}

const MachineContext = createContext<MachineContextValue | null>(null);

export function useMachine(): MachineContextValue {
  const ctx = useContext(MachineContext);
  if (!ctx) throw new Error('useMachine must be used inside <MachineProvider>');
  return ctx;
}

export function MachineProvider({ children }: { children: ReactNode }) {
  const brainRef = useRef<MachineBrain | null>(null);
  const rafRef = useRef<number>(0);
  const activeCsvRef = useRef<string>('');
  const simRateRef = useRef(1.0);

  const [brain, setBrain] = useState<MachineBrain | null>(null);
  const [state, setState] = useState<any | null>(null);
  const [fps, setFps] = useState(0);
  const [configVersion, setConfigVersion] = useState(0);
  const [showConfig, setShowConfig] = useState(false);
  const [pickingAxisId, setPickingAxisId] = useState<number | null>(null);
  const [pickedPosition, setPickedPosition] = useState<{ axisId: number; value: number } | null>(null);

  const machineConfig = useMachineConfig();
  activeCsvRef.current = machineConfig.activeCSV;

  const invertMap = useMemo(() => {
    const map: Record<string, boolean> = {};
    machineConfig.activeMachine?.axes.forEach((ax) => {
      map[ax.name] = !!ax.invert;
    });
    return map;
  }, [machineConfig.activeMachine]);

  useEffect(() => {
    let cancelled = false;

    async function setup() {
      await init();
      if (cancelled) return;

      const core = new MachineBrain();
      (core as any).clear_config?.();
      const maps: Record<number, any[]> = {};

      activeCsvRef.current.split('\n').forEach((row) => {
        if (!row.trim()) return;
        const [ch, label, linear, min, max, accel, invert, machineZero] = row.split(';');
        const axisId = core.add_axis(
          label,
          linear === '1' ? AxisType.Linear : AxisType.Rotary,
          +min,
          +max
        );
        core.set_axis_accel(axisId, +(accel ?? 2000));
        core.set_axis_invert(axisId, invert === '1');
        (core as any).set_axis_machine_zero?.(axisId, +(machineZero ?? 0));
        const channel = +ch;
        if (!maps[channel]) maps[channel] = [];
        maps[channel].push({ axis_id: axisId, display_label: label });
      });

      Object.entries(maps).forEach(([id, mapping]) => core.add_channel(+id, mapping));

      brainRef.current = core;
      setBrain(core);
      setState(core.get_full_state());

      let last = performance.now();
      let lastSample = last;
      let lastUiPush = last;
      let fpsFrames = 0;
      let fpsLast = last;
      let movingHint = false;
      let prevEstop = false;

      const isMotionActive = (st: any): boolean => {
        if (!st) return false;
        if (st.is_homing) return true;
        if (st.channels?.some((ch: any) => ch.is_running)) return true;
        if (st.axes?.some((ax: any) => Math.abs(Number(ax.position ?? 0) - Number(ax.target ?? 0)) > AXIS_SETTLE_EPS)) return true;
        return false;
      };

      const loop = (t: number) => {
        const dt = t - last;
        last = t;

        if (!cancelled && brainRef.current) {
          brainRef.current.tick(dt * SIM_TIME_SCALE * simRateRef.current);
          const sampleInterval = movingHint ? UI_PUSH_INTERVAL_MOVING_MS : UI_PUSH_INTERVAL_IDLE_MS;
          if ((t - lastSample) >= sampleInterval) {
            const snapshot = brainRef.current.get_full_state();
            movingHint = isMotionActive(snapshot);
            const estop = !!snapshot?.estop;
            const estopChanged = estop !== prevEstop;
            prevEstop = estop;

            const pushInterval = movingHint ? UI_PUSH_INTERVAL_MOVING_MS : UI_PUSH_INTERVAL_IDLE_MS;
            if (estopChanged || movingHint || (t - lastUiPush) >= pushInterval) {
              setState(snapshot);
              lastUiPush = t;
            }
            lastSample = t;
          }
        }

        fpsFrames += 1;
        if ((t - fpsLast) >= FPS_SAMPLE_MS) {
          setFps(Math.round((fpsFrames * 1000) / (t - fpsLast)));
          fpsFrames = 0;
          fpsLast = t;
        }

        rafRef.current = requestAnimationFrame(loop);
      };

      rafRef.current = requestAnimationFrame(loop);
    }

    setup();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      if (brainRef.current) {
        (brainRef.current as any).clear_config?.();
      }
      brainRef.current = null;
      setBrain(null);
      setState(null);
    };
  }, [configVersion]);

  const reboot = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (brainRef.current) {
      (brainRef.current as any).clear_config?.();
    }
    brainRef.current = null;
    setBrain(null);
    setState(null);
    setConfigVersion((v) => v + 1);
  }, []);

  const setSimulationRate = useCallback((scale: number) => {
    const n = Number(scale);
    if (!Number.isFinite(n)) return;
    simRateRef.current = Math.max(MIN_SIM_RATE, Math.min(MAX_SIM_RATE, n));
  }, []);

  return (
    <MachineContext.Provider
      value={{
        state,
        brain,
        machineConfig,
        invertMap,
        configVersion,
        reboot,
        showConfig,
        setShowConfig,
        pickingAxisId,
        setPickingAxisId,
        pickedPosition,
        setPickedPosition,
        fps,
        setSimulationRate,
      }}
    >
      {children}
    </MachineContext.Provider>
  );
}
