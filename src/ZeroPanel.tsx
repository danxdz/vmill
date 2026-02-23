import { useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import ModuleHost from './modules/ModuleHost';
import { CanBus } from './modules/moduleBus';
import { sidebarModules } from './modules/sidebarModules';
import type { AxisSnapshot, ReferenceVisualMode, SceneSetupConfig, SidebarBusEvents, SidebarModuleRuntime, ToolVisualProfile, WorkOffsetSnapshot } from './modules/moduleTypes';

interface ZeroPanelProps {
  state: any;
  brain: any;
  uiScale?: number;
  panelWidth?: number | string;
  bottomInset?: number;
  showScene3d: boolean;
  showMachineModel: boolean;
  showToolModel: boolean;
  sceneConfig: SceneSetupConfig;
  toolVisualProfile: ToolVisualProfile;
  wcsReferenceVisual: ReferenceVisualMode;
  mcsReferenceVisual: ReferenceVisualMode;
  spindlePointVisible: boolean;
  toolControlPointVisible: boolean;
  onWcsReferenceVisualChange: (mode: ReferenceVisualMode) => void;
  onMcsReferenceVisualChange: (mode: ReferenceVisualMode) => void;
  onShowScene3dChange: (visible: boolean) => void;
  onShowMachineModelChange: (visible: boolean) => void;
  onShowToolModelChange: (visible: boolean) => void;
  onSceneConfigPatch: (patch: Partial<SceneSetupConfig>) => void;
  onToolVisualProfileChange: (profile: ToolVisualProfile) => void;
  onSpindlePointVisibleChange: (visible: boolean) => void;
  onToolControlPointVisibleChange: (visible: boolean) => void;
  onAxisPickStart?: (axisId: number) => void;
  onAxisPickEnd?: () => void;
  pickedPosition?: { axisId: number; value: number } | null;
}

const FALLBACK_WCS = ['G54', 'G55', 'G56', 'G57', 'G58', 'G59', 'G153'];

export default function ZeroPanel({
  state,
  brain,
  uiScale = 1,
  panelWidth = 380,
  bottomInset = 74,
  showScene3d,
  showMachineModel,
  showToolModel,
  sceneConfig,
  toolVisualProfile,
  wcsReferenceVisual,
  mcsReferenceVisual,
  spindlePointVisible,
  toolControlPointVisible,
  onWcsReferenceVisualChange,
  onMcsReferenceVisualChange,
  onShowScene3dChange,
  onShowMachineModelChange,
  onShowToolModelChange,
  onSceneConfigPatch,
  onToolVisualProfileChange,
  onSpindlePointVisibleChange,
  onToolControlPointVisibleChange,
  onAxisPickStart,
  onAxisPickEnd,
  pickedPosition,
}: ZeroPanelProps) {
  const canRef = useRef(new CanBus<SidebarBusEvents>());

  const telemetry = useMemo(() => {
    const axes: AxisSnapshot[] = (state?.axes ?? []).map((ax: any) => ({
      id: ax.id,
      physical_name: ax.physical_name,
      position: ax.position,
      target: ax.target,
      homed: !!ax.homed,
    }));

    const workOffsets: WorkOffsetSnapshot[] = state?.work_offsets?.length
      ? state.work_offsets
      : FALLBACK_WCS.map((label: string) => ({
          label,
          offsets: axes.map((ax) => ({ axis_id: ax.id, value: 0 })),
        }));

    const activeWcs = Math.max(0, Math.min(state?.active_wcs ?? 0, workOffsets.length - 1));

    return {
      axes,
      workOffsets,
      activeWcs,
      isHoming: !!state?.is_homing,
      wcsReferenceVisual,
      mcsReferenceVisual,
      showScene3d,
      showMachineModel,
      showToolModel,
      toolControlPointVisible,
      spindlePointVisible,
      showMachineZero: mcsReferenceVisual === 'dot',
      showActiveWcsZero: wcsReferenceVisual === 'dot',
      showAtcPoint: false,
      sceneConfig,
      toolVisualProfile,
      channels: (state?.channels ?? []).map((ch: any) => ({
        id: ch.id,
        axis_ids: (ch.axis_map ?? []).map((m: any) => Number(m.axis_id)),
        current_motion: ch.current_motion ?? 0,
        cutter_comp: ch.cutter_comp ?? 40,
        tool_radius: ch.tool_radius ?? 0,
        length_comp_active: !!ch.length_comp_active,
        tool_length: ch.tool_length ?? 0,
        active_tool: Number(ch.active_tool ?? 0),
      })),
    };
  }, [state, toolVisualProfile, wcsReferenceVisual, mcsReferenceVisual, showScene3d, showMachineModel, showToolModel, toolControlPointVisible, spindlePointVisible, sceneConfig]);

  useEffect(() => {
    const can = canRef.current;
    return can.on('command', (cmd) => {
      switch (cmd.type) {
        case 'machine.home_all':
          brain?.home_all();
          break;
        case 'machine.home_all_ordered':
          (brain as any)?.home_all_ordered?.(cmd.primaryAxisId, cmd.rapid, cmd.feed);
          break;
        case 'machine.home_axis':
          if (typeof (brain as any)?.home_axis_ordered === 'function') {
            (brain as any).home_axis_ordered(
              cmd.axisId,
              !!cmd.rapid,
              Number.isFinite(cmd.feed) ? Number(cmd.feed) : 300.0
            );
          } else {
            brain?.home_axis(cmd.axisId);
          }
          break;
        case 'machine.jog':
          brain?.jog_axis(cmd.axisId, cmd.delta);
          break;
        case 'machine.jog_feed':
          brain?.jog_axis_feed?.(cmd.axisId, cmd.delta, cmd.feed);
          break;
        case 'machine.jog_rapid':
          brain?.jog_axis_rapid?.(cmd.axisId, cmd.delta);
          break;
        case 'wcs.set_active':
          brain?.set_active_wcs(cmd.wcsIndex);
          break;
        case 'wcs.set_offset_value':
          brain?.set_work_zero(cmd.axisId, telemetry.activeWcs, cmd.offset);
          break;
        case 'wcs.set_work_coordinate': {
          const ax = telemetry.axes.find((a) => a.id === cmd.axisId);
          if (!ax) break;
          const axisLabel = String(ax.physical_name ?? '').toUpperCase();
          const owningChannel = telemetry.channels.find((ch: any) => ch.axis_ids.includes(cmd.axisId));
          const toolLengthComp = owningChannel?.length_comp_active && axisLabel === 'Z'
            ? Number(owningChannel.tool_length ?? 0)
            : 0;
          // Use TCP for Z when G43 is active: subtract tool length from spindle position.
          const tcpPosition = ax.position - toolLengthComp;
          const offset = tcpPosition - cmd.desiredWork;
          brain?.set_work_zero(cmd.axisId, telemetry.activeWcs, offset);
          break;
        }
        case 'wcs.clear_offsets':
          cmd.axisIds.forEach((axisId) => brain?.set_work_zero(axisId, cmd.wcsIndex, 0));
          break;
        case 'tool.set_length':
          brain?.set_tool_length(cmd.channelIndex, cmd.value);
          break;
        case 'tool.set_length_comp':
          brain?.set_tool_length_comp(cmd.channelIndex, cmd.active);
          break;
        case 'tool.set_radius':
          brain?.set_tool_radius(cmd.channelIndex, cmd.value);
          break;
        case 'tool.set_cutter_comp':
          brain?.set_cutter_comp(cmd.channelIndex, cmd.mode);
          break;
        case 'tool.set_table_entry':
          (brain as any)?.set_tool_table_entry?.(cmd.channelIndex, cmd.slot, cmd.length, cmd.radius);
          break;
        case 'tool.set_active_tool':
          (brain as any)?.set_active_tool?.(cmd.channelIndex, cmd.slot);
          break;
        case 'ui.set_wcs_reference_visual':
          onWcsReferenceVisualChange(cmd.mode);
          break;
        case 'ui.set_mcs_reference_visual':
          onMcsReferenceVisualChange(cmd.mode);
          break;
        case 'ui.set_show_scene_3d':
          onShowScene3dChange(cmd.visible);
          break;
        case 'ui.set_show_machine_model':
          onShowMachineModelChange(cmd.visible);
          break;
        case 'ui.set_show_tool_model':
          onShowToolModelChange(cmd.visible);
          break;
        case 'ui.set_tool_visual_profile':
          onToolVisualProfileChange(cmd.profile);
          break;
        case 'ui.patch_scene_config':
          onSceneConfigPatch(cmd.patch);
          break;
        case 'ui.set_tool_control_point':
          onToolControlPointVisibleChange(cmd.visible);
          break;
        case 'ui.set_spindle_point':
          onSpindlePointVisibleChange(cmd.visible);
          break;
      }
    });
  }, [
    brain,
    telemetry,
    onWcsReferenceVisualChange,
    onMcsReferenceVisualChange,
    onShowScene3dChange,
    onShowMachineModelChange,
    onShowToolModelChange,
    onSceneConfigPatch,
    onToolVisualProfileChange,
    onToolControlPointVisibleChange,
    onSpindlePointVisibleChange,
  ]);

  if (!state) return null;

  const runtime: SidebarModuleRuntime = {
    telemetry,
    can: canRef.current,
    onAxisPickStart,
    onAxisPickEnd,
    pickedPosition,
  };

  return (
    <aside style={{ ...s.panel, width: panelWidth, bottom: bottomInset }}>
      <div style={{ ...s.content, zoom: uiScale }}>
        <ModuleHost modules={sidebarModules} runtime={runtime} />
      </div>
    </aside>
  );
}

const s: Record<string, CSSProperties> = {
  panel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: 380,
    background: 'rgba(8, 10, 16, 0.94)',
    backdropFilter: 'blur(10px)',
    borderLeft: '1px solid #1f2b46',
    color: '#cbd5e1',
    zIndex: 20,
    overflow: 'hidden',
    fontFamily: 'monospace',
  },
  content: {
    height: '100%',
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
};
