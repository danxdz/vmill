// ─── Types ────────────────────────────────────────────────────────────────────

export type AxisKind = 'Linear' | 'Rotary';
export type AxisSide = 'tool' | 'table'; // kinematic chain assignment
export type SpindleAxis = '+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z';

export interface AxisConfig {
  id: string;           // unique within machine (uuid-ish)
  name: string;         // physical name: X, Y, Z, B, C, Z3…
  label: string;        // display label (same as name usually)
  kind: AxisKind;
  side: AxisSide;
  channel: number;      // channel id (1, 2, 4…)
  min: number;
  max: number;
  accel: number;        // mm/min²  (or deg/min² for rotary)
  homeDir: -1 | 1;      // direction to home (-1 = negative, +1 = positive)
  machineZero?: number; // machine coordinate used as home/zero reference
  invert?: boolean;     // visual invert (used by MachineView)
  linkAxis?: 'A' | 'B' | 'C'; // optional kinematic link target for custom rotary names
  color?: string;       // optional accent color for 3D view
}

export interface MachineConfig {
  id: string;
  name: string;
  description: string;
  templateId?: string;  // which template it was created from
  createdAt: number;
  updatedAt: number;
  spindleDiameter: number; // mm
  spindleLength: number;   // mm
  spindleNoseDiameter: number; // mm
  spindleNoseLength: number;   // mm
  spindleCapDiameter: number;  // mm
  spindleCapLength: number;    // mm
  spindleUp: boolean;          // true = grows upward from machine-zero anchor
  spindleAxis: SpindleAxis;    // spindle/tool axis in machine coordinates
  spindleOffsetX: number;      // mm (machine X)
  spindleOffsetY: number;      // mm (machine Y)
  spindleOffsetZ: number;      // mm (machine Z)
  spindleRotX: number;         // deg
  spindleRotY: number;         // deg
  spindleRotZ: number;         // deg
  axes: AxisConfig[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _counter = 0;
export function uid(): string {
  return `ax_${Date.now()}_${_counter++}`;
}

export const DEFAULT_SPINDLE_DIAMETER = 24;
export const DEFAULT_SPINDLE_LENGTH = 35;
export const DEFAULT_SPINDLE_NOSE_DIAMETER = 18;
export const DEFAULT_SPINDLE_NOSE_LENGTH = 14;
export const DEFAULT_SPINDLE_CAP_DIAMETER = 30;
export const DEFAULT_SPINDLE_CAP_LENGTH = 10;

export function configToCSV(cfg: MachineConfig): string {
  return cfg.axes
    .map(ax =>
      `${ax.channel};${ax.name};${ax.kind === 'Linear' ? 1 : 0};${ax.min};${ax.max};${ax.accel};${ax.invert ? 1 : 0};${ax.machineZero ?? 0}`
    )
    .join('\n');
}

// ─── Templates ────────────────────────────────────────────────────────────────

export interface MachineTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;         // emoji / short glyph
  tags: string[];
  spindleDiameter?: number;
  spindleLength?: number;
  spindleNoseDiameter?: number;
  spindleNoseLength?: number;
  spindleCapDiameter?: number;
  spindleCapLength?: number;
  spindleUp?: boolean;
  spindleAxis?: SpindleAxis;
  spindleOffsetX?: number;
  spindleOffsetY?: number;
  spindleOffsetZ?: number;
  spindleRotX?: number;
  spindleRotY?: number;
  spindleRotZ?: number;
  axes: Omit<AxisConfig, 'id'>[];
}

export const MACHINE_TEMPLATES: MachineTemplate[] = [
  // ── 1. VMC 3-Axis ──────────────────────────────────────────────────────────
  {
    id: 'vmc3',
    name: 'VMC 3-Axis',
    description: 'Standard vertical machining centre. X/Y table travel, Z spindle depth.',
    icon: '⬛',
    tags: ['milling', '3-axis', 'vertical'],
    spindleAxis: '-Z',
    axes: [
      { name: 'X', label: 'X', kind: 'Linear', side: 'tool', channel: 1, min: -400, max: 400, accel: 3000, homeDir: -1 },
      { name: 'Y', label: 'Y', kind: 'Linear', side: 'tool', channel: 1, min: -300, max: 300, accel: 3000, homeDir: -1 },
      { name: 'Z', label: 'Z', kind: 'Linear', side: 'tool', channel: 1, min: -400, max: 0,  accel: 1500, homeDir:  1, machineZero: 400 },
    ],
  },

  // ── 2. VMC 4-Axis (your machine) ───────────────────────────────────────────
  {
    id: 'vmc4',
    name: 'VMC 4-Axis Rotary',
    description: 'Vertical mill with 4th-axis rotary table on secondary channel. X/Y/Z tool + Z3 table travel + B rotation.',
    icon: '🔄',
    tags: ['milling', '4-axis', 'rotary', 'trunnion'],
    spindleAxis: '-Z',
    axes: [
      { name: 'X',  label: 'X',  kind: 'Linear', side: 'tool',  channel: 1, min: -100, max: 500, accel: 3000, homeDir: -1 },
      { name: 'Y',  label: 'Y',  kind: 'Linear', side: 'tool',  channel: 1, min: -100, max: 400, accel: 3000, homeDir: -1 },
      { name: 'Z',  label: 'Z',  kind: 'Linear', side: 'tool',  channel: 1, min:  -50, max: 250, accel: 1500, homeDir:  1 },
      { name: 'Z3', label: 'Z3', kind: 'Linear', side: 'table', channel: 4, min:  -50, max: 250, accel: 1500, homeDir:  1 },
      { name: 'B',  label: 'B',  kind: 'Rotary', side: 'table', channel: 4, min: -105, max:  15, accel:  800, homeDir: -1 },
    ],
  },

  // ── 3. VMC 5-Axis Trunnion ─────────────────────────────────────────────────
  {
    id: 'vmc5',
    name: 'VMC 5-Axis Trunnion',
    description: 'Full 5-axis with A/C trunnion table. Tool moves X/Y/Z, table tilts A and rotates C.',
    icon: '⚙️',
    tags: ['milling', '5-axis', 'trunnion', 'simultaneous'],
    spindleAxis: '-Z',
    axes: [
      { name: 'X', label: 'X', kind: 'Linear', side: 'tool',  channel: 1, min: -400, max: 400, accel: 4000, homeDir: -1 },
      { name: 'Y', label: 'Y', kind: 'Linear', side: 'tool',  channel: 1, min: -300, max: 300, accel: 4000, homeDir: -1 },
      { name: 'Z', label: 'Z', kind: 'Linear', side: 'tool',  channel: 1, min: -250, max:  50, accel: 2000, homeDir:  1 },
      { name: 'A', label: 'A', kind: 'Rotary', side: 'table', channel: 2, min: -110, max: 110, accel: 1000, homeDir: -1 },
      { name: 'C', label: 'C', kind: 'Rotary', side: 'table', channel: 2, min: -360, max: 360, accel: 1200, homeDir: -1 },
    ],
  },

  // ── 4. HMC 4-Axis ──────────────────────────────────────────────────────────
  {
    id: 'hmc4',
    name: 'HMC 4-Axis',
    description: 'Horizontal machining centre. Spindle horizontal, B rotary pallet.',
    icon: '↔️',
    tags: ['milling', '4-axis', 'horizontal', 'pallet'],
    spindleAxis: '-Z',
    axes: [
      { name: 'X', label: 'X', kind: 'Linear', side: 'tool',  channel: 1, min: -500, max: 500, accel: 3500, homeDir: -1 },
      { name: 'Y', label: 'Y', kind: 'Linear', side: 'tool',  channel: 1, min: -400, max: 400, accel: 3500, homeDir: -1 },
      { name: 'Z', label: 'Z', kind: 'Linear', side: 'tool',  channel: 1, min: -600, max:  50, accel: 2000, homeDir:  1 },
      { name: 'B', label: 'B', kind: 'Rotary', side: 'table', channel: 2, min: -360, max: 360, accel: 1500, homeDir: -1 },
    ],
  },

  // ── 5. CNC Lathe ───────────────────────────────────────────────────────────
  {
    id: 'lathe2',
    name: 'CNC Lathe 2-Axis',
    description: 'Turning centre. X cross-slide, Z carriage. Single channel.',
    icon: '🔩',
    tags: ['turning', '2-axis', 'lathe'],
    spindleAxis: '-Z',
    axes: [
      { name: 'X', label: 'X', kind: 'Linear', side: 'tool', channel: 1, min: -150, max: 150, accel: 2000, homeDir: -1 },
      { name: 'Z', label: 'Z', kind: 'Linear', side: 'tool', channel: 1, min: -600, max:  50, accel: 2500, homeDir:  1 },
    ],
  },

  // ── 6. Lathe with C / Y ────────────────────────────────────────────────────
  {
    id: 'lathe4',
    name: 'Turn-Mill 4-Axis',
    description: 'Turning centre with Y-axis and C spindle for milling operations.',
    icon: '🌀',
    tags: ['turn-mill', '4-axis', 'lathe', 'live-tooling'],
    spindleAxis: '-Z',
    axes: [
      { name: 'X', label: 'X', kind: 'Linear', side: 'tool',  channel: 1, min: -150, max: 150, accel: 2000, homeDir: -1 },
      { name: 'Y', label: 'Y', kind: 'Linear', side: 'tool',  channel: 1, min:  -60, max:  60, accel: 1500, homeDir: -1 },
      { name: 'Z', label: 'Z', kind: 'Linear', side: 'tool',  channel: 1, min: -600, max:  50, accel: 2500, homeDir:  1 },
      { name: 'C', label: 'C', kind: 'Rotary', side: 'table', channel: 2, min: -360, max: 360, accel: 2000, homeDir: -1 },
    ],
  },
];
