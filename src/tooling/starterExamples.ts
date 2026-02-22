import type { ToolVisualProfile } from '../modules/moduleTypes';

export interface StarterToolSeed {
  id: string;
  kind: 'tool' | 'holder' | 'extension';
  toolType:
    | 'endmill'
    | 'bullnose'
    | 'ballnose'
    | 'drill'
    | 'center-drill'
    | 'chamfer-drill'
    | 'reamer'
    | 'tap'
    | 'taper-endmill'
    | 'custom';
  tipAngleDeg: number;
  name: string;
  note: string;
  length: number;
  radius: number;
  stickout: number;
  toolStickInMax: number;
  visual: ToolVisualProfile;
}

export interface StarterAssemblySeed {
  id: string;
  name: string;
  note: string;
  toolId: string;
  holderId: string | null;
  extensionId: string | null;
}

export const STARTER_TOOL_ITEMS: StarterToolSeed[] = [
  {
    id: 'seed_tool_em12',
    kind: 'tool',
    toolType: 'endmill',
    tipAngleDeg: 118,
    name: 'EM 12 Z3 (T1)',
    note: 'Starter tool: 12mm end mill',
    length: 83,
    radius: 6,
    stickout: 83,
    toolStickInMax: 0,
    visual: {
      l1: 26,
      d1: 12,
      l2: 12,
      d2: 11,
      l3: 45,
      d3: 12,
      useHolder: false,
      holderLength: 18,
      holderDiameter: 14,
      stickout: 83,
    },
  },
  {
    id: 'seed_tool_em6',
    kind: 'tool',
    toolType: 'endmill',
    tipAngleDeg: 118,
    name: 'EM 6 Z4 (T2)',
    note: 'Starter tool: 6mm carbide end mill',
    length: 70,
    radius: 3,
    stickout: 60,
    toolStickInMax: 0,
    visual: {
      l1: 16,
      d1: 6,
      l2: 8,
      d2: 6,
      l3: 36,
      d3: 6,
      useHolder: false,
      holderLength: 18,
      holderDiameter: 12,
      stickout: 60,
    },
  },
  {
    id: 'seed_holder_bt40_er32',
    kind: 'holder',
    toolType: 'custom',
    tipAngleDeg: 0,
    name: 'BT40 ER32',
    note: 'Starter holder sample',
    length: 60,
    radius: 20,
    stickout: 0,
    toolStickInMax: 42,
    visual: {
      l1: 12,
      d1: 12,
      l2: 10,
      d2: 20,
      l3: 38,
      d3: 28,
      useHolder: true,
      holderLength: 60,
      holderDiameter: 40,
      holderDiameterTop: 40,
      holderDiameterBottom: 20,
      holderTaperAngleDeg: 9.462,
      stickout: 0,
    },
  },
  {
    id: 'seed_holder_hsk63f',
    kind: 'holder',
    toolType: 'custom',
    tipAngleDeg: 0,
    name: 'HSK63F ER25',
    note: 'Starter holder sample',
    length: 52,
    radius: 18,
    stickout: 0,
    toolStickInMax: 34,
    visual: {
      l1: 10,
      d1: 10,
      l2: 8,
      d2: 18,
      l3: 34,
      d3: 24,
      useHolder: true,
      holderLength: 52,
      holderDiameter: 36,
      holderDiameterTop: 36,
      holderDiameterBottom: 18,
      holderTaperAngleDeg: 9.826,
      stickout: 0,
    },
  },
  {
    id: 'seed_ext_80',
    kind: 'extension',
    toolType: 'custom',
    tipAngleDeg: 0,
    name: 'Extension 80',
    note: 'Starter extension sample',
    length: 80,
    radius: 12,
    stickout: 0,
    toolStickInMax: 60,
    visual: {
      l1: 12,
      d1: 12,
      l2: 12,
      d2: 12,
      l3: 56,
      d3: 18,
      useHolder: true,
      holderLength: 80,
      holderDiameter: 24,
      holderDiameterTop: 24,
      holderDiameterBottom: 24,
      holderTaperAngleDeg: 0,
      stickout: 0,
    },
  },
];

export const STARTER_ASSEMBLIES: StarterAssemblySeed[] = [
  {
    id: 'seed_asm_t1',
    name: 'T1 EM12 + BT40',
    note: 'Starter assembly',
    toolId: 'seed_tool_em12',
    holderId: 'seed_holder_bt40_er32',
    extensionId: null,
  },
  {
    id: 'seed_asm_t2',
    name: 'T2 EM6 + HSK + EXT80',
    note: 'Starter assembly',
    toolId: 'seed_tool_em6',
    holderId: 'seed_holder_hsk63f',
    extensionId: 'seed_ext_80',
  },
];

