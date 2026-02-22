import type { ComponentType } from 'react';
import type { CanBus } from './moduleBus';

export interface AxisSnapshot {
  id: number;
  physical_name: string;
  position: number;
  target: number;
  homed: boolean;
}

export interface AxisOffsetSnapshot {
  axis_id: number;
  value: number;
}

export interface WorkOffsetSnapshot {
  label: string;
  offsets: AxisOffsetSnapshot[];
}

export type ReferenceVisualMode = 'off' | 'dot' | 'gizmo';
export type StockBooleanEngine = 'none' | 'manifold';

export interface SceneSetupConfig {
  backgroundColor: string;
  ambientIntensity: number;
  keyIntensity: number;
  fillIntensity: number;
  floorIntensity: number;
  antiAliasing: boolean;
  shadowsEnabled: boolean;
  reflectionsEnabled: boolean;
  stockBooleanEngine: StockBooleanEngine;
  showStockGhost: boolean;
  stockGhostOpacity: number;
  showStockCutterDebug: boolean;
  stockCutterDebugOpacity: number;
  gridSize: number;
  gridDivisions: number;
  gridOpacity: number;
  showSceneAxes: boolean;
  gridMajorColor: string;
  gridMinorColor: string;
  wcsDotColor: string;
  mcsDotColor: string;
  toolPointRapidColor: string;
  toolPointFeedColor: string;
  spindlePointColor: string;
  gizmoScale: number;
  uiScale: number;
}

export interface ToolVisualProfile {
  l1: number;
  d1: number;
  lenParam1?: 'l1' | 'l2' | 'l3';
  diaParam1?: 'd1' | 'd2' | 'd3';
  d1Top?: number;
  d1Bottom?: number;
  g1Type?: 'cylinder' | 'cone' | 'sphere';
  g1Cut?: boolean;
  g1Color?: string;
  l2: number;
  d2: number;
  lenParam2?: 'l1' | 'l2' | 'l3';
  diaParam2?: 'd1' | 'd2' | 'd3';
  d2Top?: number;
  d2Bottom?: number;
  g2Type?: 'cylinder' | 'cone' | 'sphere';
  g2Cut?: boolean;
  g2Color?: string;
  l3: number;
  d3: number;
  lenParam3?: 'l1' | 'l2' | 'l3';
  diaParam3?: 'd1' | 'd2' | 'd3';
  d3Top?: number;
  d3Bottom?: number;
  g3Type?: 'cylinder' | 'cone' | 'sphere';
  g3Cut?: boolean;
  g3Color?: string;
  useHolder?: boolean;
  holderLength?: number;
  holderDiameter?: number;
  holderColor?: string;
  holderDiameterTop?: number;
  holderDiameterBottom?: number;
  holderTaperAngleDeg?: number;
  toolOpacity?: number;
  holderOpacity?: number;
  stickout?: number;
}

export interface ModuleTelemetry {
  axes: AxisSnapshot[];
  workOffsets: WorkOffsetSnapshot[];
  activeWcs: number;
  isHoming: boolean;
  wcsReferenceVisual: ReferenceVisualMode;
  mcsReferenceVisual: ReferenceVisualMode;
  showScene3d: boolean;
  showMachineModel: boolean;
  showToolModel: boolean;
  toolControlPointVisible: boolean;
  spindlePointVisible: boolean;
  showMachineZero: boolean;
  showActiveWcsZero: boolean;
  showAtcPoint: boolean;
  sceneConfig: SceneSetupConfig;
  toolVisualProfile: ToolVisualProfile;
  channels: {
    id: number;
    axis_ids: number[];
    current_motion: number;
    cutter_comp: number;
    tool_radius: number;
    length_comp_active: boolean;
    tool_length: number;
    active_tool: number;
  }[];
}

export type ModuleCommand =
  | { type: 'machine.home_all' }
  | { type: 'machine.home_all_ordered'; primaryAxisId: number; rapid: boolean; feed: number }
  | { type: 'machine.home_axis'; axisId: number }
  | { type: 'machine.jog'; axisId: number; delta: number }
  | { type: 'machine.jog_feed'; axisId: number; delta: number; feed: number }
  | { type: 'machine.jog_rapid'; axisId: number; delta: number }
  | { type: 'wcs.set_active'; wcsIndex: number }
  | { type: 'wcs.set_offset_value'; axisId: number; offset: number }
  | { type: 'wcs.set_work_coordinate'; axisId: number; desiredWork: number }
  | { type: 'wcs.clear_offsets'; axisIds: number[]; wcsIndex: number }
  | { type: 'tool.set_length'; channelIndex: number; value: number }
  | { type: 'tool.set_length_comp'; channelIndex: number; active: boolean }
  | { type: 'tool.set_radius'; channelIndex: number; value: number }
  | { type: 'tool.set_cutter_comp'; channelIndex: number; mode: 40 | 41 | 42 }
  | { type: 'tool.set_table_entry'; channelIndex: number; slot: number; length: number; radius: number }
  | { type: 'tool.set_active_tool'; channelIndex: number; slot: number }
  | { type: 'ui.set_wcs_reference_visual'; mode: ReferenceVisualMode }
  | { type: 'ui.set_mcs_reference_visual'; mode: ReferenceVisualMode }
  | { type: 'ui.set_show_scene_3d'; visible: boolean }
  | { type: 'ui.set_show_machine_model'; visible: boolean }
  | { type: 'ui.set_show_tool_model'; visible: boolean }
  | { type: 'ui.set_tool_control_point'; visible: boolean }
  | { type: 'ui.set_spindle_point'; visible: boolean }
  | { type: 'ui.set_tool_visual_profile'; profile: ToolVisualProfile }
  | { type: 'ui.set_show_machine_zero'; visible: boolean }
  | { type: 'ui.set_show_active_wcs_zero'; visible: boolean }
  | { type: 'ui.set_show_atc_point'; visible: boolean }
  | { type: 'ui.patch_scene_config'; patch: Partial<SceneSetupConfig> };

export interface SidebarBusEvents {
  command: ModuleCommand;
}

export interface SidebarModuleRuntime {
  telemetry: ModuleTelemetry;
  can: CanBus<SidebarBusEvents>;
  onAxisPickStart?: (axisId: number) => void;
  onAxisPickEnd?: () => void;
  pickedPosition?: { axisId: number; value: number } | null;
}

export interface SidebarModuleProps {
  runtime: SidebarModuleRuntime;
}

export interface SidebarModuleDefinition {
  id: string;
  title: string;
  order: number;
  Component: ComponentType<SidebarModuleProps>;
  enabled?: boolean;
}
