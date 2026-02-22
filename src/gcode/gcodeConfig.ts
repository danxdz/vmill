export interface GcodeExample {
  label: string;
  code: string;
}

export const GCODE_EXAMPLES: GcodeExample[] = [
  {
    label: 'Arc G2/G3',
    code: `G17 G90 G54 G40 G49 G80
T1 M6
S2500 M3
M8
G43 H1
G0 Z150
G0 X0 Y0
G1 Z-2 F300
G2 X24 Y0 I12 J0 F800
G3 X0 Y0 I-12 J0
G0 Z150
M9
M5
G49 T0
M30`,
  },
  {
    label: 'Square Comp G41/G42/G40',
    code: `G17 G90 G54 G40 G49 G80
T1 M6
S2600 M3
M8
G43 H1
G0 Z150
G0 X-35 Y-35
G1 Z-2 F250
G1 G41 D1 X-20 F5000
G1 X-20 Y20
G1 X20 Y20
G1 X20 Y-20
G1 X-20 Y-20
G1 X-25 Y-20
G1 G40 X-35 Y-20
G0 Z150

G0 X-35 Y-35
G1 Z-2 F250
G1 G42 D1 X-20 F5000
G1 X20 Y-20
G1 X20 Y20
G1 X-20 Y20
G1 X-20 Y-20
G1 X-25 Y-20
G1 G40 X-35 Y-20
G0 Z150

G0 X-35 Y-35
G1 Z-2 F250
G1 X-20 Y-20 F5000
G1 X-20 Y20
G1 X20 Y20
G1 X20 Y-20
G1 X-20 Y-20
G0 Z150
M9
M5
G49 T0
M30`,
  },
  {
    label: 'Thread Mill 3-Axis',
    code: `G17 G90 G54 G40 G49 G80
T1 M6
S3200 M3
M8
G43 H1
G0 Z150
G0 X6 Y0 Z10
G1 Z1 F300
G3 X6 Y0 I-6 J0 Z0 F450
G3 X6 Y0 I-6 J0 Z-1
G3 X6 Y0 I-6 J0 Z-2
G3 X6 Y0 I-6 J0 Z-3
G3 X6 Y0 I-6 J0 Z-4
G3 X6 Y0 I-6 J0 Z-5
G0 Z150
M9
M5
G49 T0
M30`,
  },
  {
    label: 'Facing 3-Axis',
    code: `G17 G90 G54 G40 G49 G80
T1 M6
S2200 M3
M8
G43 H1
G0 Z150
G0 X-30 Y-30
G1 Z-0.8 F200
G1 X30 Y-30 F900
G1 Y-10
G1 X-30
G1 Y10
G1 X30
G1 Y30
G1 X-30
G0 Z150
M9
M5
G49 T0
M30`,
  },
];

export const DEFAULT_GCODE_BY_CHANNEL: string[] = [
  'G17 G90 G54 G40 G49 G80\nT1 M6\nS2600 M3\nM8\nG0 Z150\nG43 H1\nG0 Z50\nG0 X-55\nG0 Z5\nG1 Z-10 F2000\nG1 G41 D1 X-50\nG1 Y50\nG1 X0\nG1 Y0\nG1 X-55\nG1 X-60\nG1 G40 X-65\nG0 Z150\nM9\nM5\nG49 T0\nM30',
  'G1 Z3-15 B-45 F800\nG1 Z3 0 B0',
];

export const SIM_SPEED_MULTIPLIER = 10;

export function formatGcode(raw: string): string {
  return raw
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter((line, idx, arr) => !(line === '' && arr[idx - 1] === ''))
    .join('\n');
}
