import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  MACHINE_TEMPLATES,
  configToCSV,
  uid,
  DEFAULT_SPINDLE_DIAMETER,
  DEFAULT_SPINDLE_LENGTH,
  DEFAULT_SPINDLE_NOSE_DIAMETER,
  DEFAULT_SPINDLE_NOSE_LENGTH,
  DEFAULT_SPINDLE_CAP_DIAMETER,
  DEFAULT_SPINDLE_CAP_LENGTH,
} from './machineTemplates';
import type { MachineConfig, MachineTemplate, AxisConfig } from './machineTemplates';

const STORAGE_KEY = 'vmill_machines';
const ACTIVE_KEY  = 'vmill_active_machine';
const TEMPLATE_SPINDLE_KEY = 'vmill_template_spindle_defaults_v1';

type TemplateSpindleDefaults = Pick<
  MachineConfig,
  | 'spindleDiameter'
  | 'spindleLength'
  | 'spindleNoseDiameter'
  | 'spindleNoseLength'
  | 'spindleCapDiameter'
  | 'spindleCapLength'
  | 'spindleUp'
  | 'spindleOffsetX'
  | 'spindleOffsetY'
  | 'spindleOffsetZ'
  | 'spindleRotX'
  | 'spindleRotY'
  | 'spindleRotZ'
>;

function clampSpindleValue(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function toFinite(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeMachine(m: MachineConfig): MachineConfig {
  return {
    ...m,
    spindleDiameter: clampSpindleValue(m.spindleDiameter, DEFAULT_SPINDLE_DIAMETER),
    spindleLength: clampSpindleValue(m.spindleLength, DEFAULT_SPINDLE_LENGTH),
    spindleNoseDiameter: clampSpindleValue(m.spindleNoseDiameter, DEFAULT_SPINDLE_NOSE_DIAMETER),
    spindleNoseLength: clampSpindleValue(m.spindleNoseLength, DEFAULT_SPINDLE_NOSE_LENGTH),
    spindleCapDiameter: clampSpindleValue(m.spindleCapDiameter, DEFAULT_SPINDLE_CAP_DIAMETER),
    spindleCapLength: clampSpindleValue(m.spindleCapLength, DEFAULT_SPINDLE_CAP_LENGTH),
    spindleUp: typeof m.spindleUp === 'boolean' ? m.spindleUp : true,
    spindleOffsetX: toFinite(m.spindleOffsetX, 0),
    spindleOffsetY: toFinite(m.spindleOffsetY, 0),
    spindleOffsetZ: toFinite(m.spindleOffsetZ, 0),
    spindleRotX: toFinite(m.spindleRotX, 0),
    spindleRotY: toFinite(m.spindleRotY, 0),
    spindleRotZ: toFinite(m.spindleRotZ, 0),
  };
}

// ─── Persistence ──────────────────────────────────────────────────────────────

function loadAll(): MachineConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((m) => normalizeMachine(m as MachineConfig));
  } catch { return []; }
}

function saveAll(machines: MachineConfig[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(machines));
}

function loadTemplateSpindleDefaults(): Record<string, TemplateSpindleDefaults> {
  try {
    const raw = localStorage.getItem(TEMPLATE_SPINDLE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, TemplateSpindleDefaults>;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

function saveTemplateSpindleDefaults(map: Record<string, TemplateSpindleDefaults>) {
  localStorage.setItem(TEMPLATE_SPINDLE_KEY, JSON.stringify(map));
}

function resolveTemplateSpindle(
  template: MachineTemplate,
  defaultsByTemplateId: Record<string, TemplateSpindleDefaults>
): MachineTemplate {
  const defaults = defaultsByTemplateId[template.id];
  if (!defaults) return template;
  return { ...template, ...defaults };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseMachineConfig {
  machines: MachineConfig[];
  activeMachine: MachineConfig | null;
  activeCSV: string;

  // CRUD
  createFromTemplate: (template: MachineTemplate) => MachineConfig;
  createBlank: (name: string) => MachineConfig;
  updateMachine: (id: string, patch: Partial<MachineConfig>) => void;
  deleteMachine: (id: string) => void;
  duplicateMachine: (id: string) => MachineConfig;

  // Axis operations
  addAxis: (machineId: string, axis: Omit<AxisConfig, 'id'>) => void;
  updateAxis: (machineId: string, axisId: string, patch: Partial<AxisConfig>) => void;
  deleteAxis: (machineId: string, axisId: string) => void;
  moveAxis: (machineId: string, axisId: string, dir: 'up' | 'down') => void;

  // Activation
  setActiveMachine: (id: string) => void;

  // Export
  exportCSV: (machineId: string) => string;
  downloadCSV: (machineId: string) => void;
  saveSpindleAsTemplateDefault: (machineId: string) => void;
  clearTemplateSpindleDefault: (templateId: string) => void;
  hasTemplateSpindleDefault: (templateId: string) => boolean;

  templates: MachineTemplate[];
}

export function useMachineConfig(): UseMachineConfig {
  const [templateSpindleDefaults, setTemplateSpindleDefaults] = useState<Record<string, TemplateSpindleDefaults>>(
    () => loadTemplateSpindleDefaults()
  );

  const [machines, setMachines] = useState<MachineConfig[]>(() => {
    const stored = loadAll();
    // Seed with default VMC3 if nothing saved yet
    if (stored.length === 0) {
      const vmc3Base = MACHINE_TEMPLATES.find(t => t.id === 'vmc3') ?? MACHINE_TEMPLATES[0];
      const vmc3 = resolveTemplateSpindle(vmc3Base, templateSpindleDefaults);
      const defaultMachine: MachineConfig = {
        id: uid(),
        name: vmc3.name,
        description: vmc3.description,
        templateId: vmc3.id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        spindleDiameter: clampSpindleValue(vmc3.spindleDiameter, DEFAULT_SPINDLE_DIAMETER),
        spindleLength: clampSpindleValue(vmc3.spindleLength, DEFAULT_SPINDLE_LENGTH),
        spindleNoseDiameter: clampSpindleValue(vmc3.spindleNoseDiameter, DEFAULT_SPINDLE_NOSE_DIAMETER),
        spindleNoseLength: clampSpindleValue(vmc3.spindleNoseLength, DEFAULT_SPINDLE_NOSE_LENGTH),
        spindleCapDiameter: clampSpindleValue(vmc3.spindleCapDiameter, DEFAULT_SPINDLE_CAP_DIAMETER),
        spindleCapLength: clampSpindleValue(vmc3.spindleCapLength, DEFAULT_SPINDLE_CAP_LENGTH),
        spindleUp: vmc3.spindleUp ?? true,
        spindleOffsetX: toFinite(vmc3.spindleOffsetX, 0),
        spindleOffsetY: toFinite(vmc3.spindleOffsetY, 0),
        spindleOffsetZ: toFinite(vmc3.spindleOffsetZ, 0),
        spindleRotX: toFinite(vmc3.spindleRotX, 0),
        spindleRotY: toFinite(vmc3.spindleRotY, 0),
        spindleRotZ: toFinite(vmc3.spindleRotZ, 0),
        axes: vmc3.axes.map(a => ({ ...a, id: uid() })),
      };
      saveAll([defaultMachine]);
      return [defaultMachine];
    }
    return stored;
  });

  const [activeId, setActiveId] = useState<string>(() => {
    return localStorage.getItem(ACTIVE_KEY) || machines[0]?.id || '';
  });

  // Persist on every change
  useEffect(() => { saveAll(machines); }, [machines]);
  useEffect(() => { localStorage.setItem(ACTIVE_KEY, activeId); }, [activeId]);
  useEffect(() => { saveTemplateSpindleDefaults(templateSpindleDefaults); }, [templateSpindleDefaults]);

  const activeMachine = machines.find(m => m.id === activeId) ?? null;
  const activeCSV = activeMachine ? configToCSV(activeMachine) : '';
  const templates = useMemo(
    () => MACHINE_TEMPLATES.map((tpl) => resolveTemplateSpindle(tpl, templateSpindleDefaults)),
    [templateSpindleDefaults]
  );

  // ── CRUD ─────────────────────────────────────────────────────────────────

  const createFromTemplate = useCallback((template: MachineTemplate): MachineConfig => {
    const machine: MachineConfig = {
      id: uid(),
      name: `${template.name} (copy)`,
      description: template.description,
      templateId: template.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      spindleDiameter: clampSpindleValue(template.spindleDiameter, DEFAULT_SPINDLE_DIAMETER),
      spindleLength: clampSpindleValue(template.spindleLength, DEFAULT_SPINDLE_LENGTH),
      spindleNoseDiameter: clampSpindleValue(template.spindleNoseDiameter, DEFAULT_SPINDLE_NOSE_DIAMETER),
      spindleNoseLength: clampSpindleValue(template.spindleNoseLength, DEFAULT_SPINDLE_NOSE_LENGTH),
      spindleCapDiameter: clampSpindleValue(template.spindleCapDiameter, DEFAULT_SPINDLE_CAP_DIAMETER),
      spindleCapLength: clampSpindleValue(template.spindleCapLength, DEFAULT_SPINDLE_CAP_LENGTH),
      spindleUp: template.spindleUp ?? true,
      spindleOffsetX: toFinite(template.spindleOffsetX, 0),
      spindleOffsetY: toFinite(template.spindleOffsetY, 0),
      spindleOffsetZ: toFinite(template.spindleOffsetZ, 0),
      spindleRotX: toFinite(template.spindleRotX, 0),
      spindleRotY: toFinite(template.spindleRotY, 0),
      spindleRotZ: toFinite(template.spindleRotZ, 0),
      axes: template.axes.map(a => ({ ...a, id: uid() })),
    };
    setMachines(prev => [...prev, machine]);
    setActiveId(machine.id);
    return machine;
  }, []);

  const createBlank = useCallback((name: string): MachineConfig => {
    const machine: MachineConfig = {
      id: uid(),
      name,
      description: 'Custom machine configuration',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      spindleDiameter: DEFAULT_SPINDLE_DIAMETER,
      spindleLength: DEFAULT_SPINDLE_LENGTH,
      spindleNoseDiameter: DEFAULT_SPINDLE_NOSE_DIAMETER,
      spindleNoseLength: DEFAULT_SPINDLE_NOSE_LENGTH,
      spindleCapDiameter: DEFAULT_SPINDLE_CAP_DIAMETER,
      spindleCapLength: DEFAULT_SPINDLE_CAP_LENGTH,
      spindleUp: true,
      spindleOffsetX: 0,
      spindleOffsetY: 0,
      spindleOffsetZ: 0,
      spindleRotX: 0,
      spindleRotY: 0,
      spindleRotZ: 0,
      axes: [],
    };
    setMachines(prev => [...prev, machine]);
    setActiveId(machine.id);
    return machine;
  }, []);

  const updateMachine = useCallback((id: string, patch: Partial<MachineConfig>) => {
    setMachines(prev => prev.map(m =>
      m.id === id ? normalizeMachine({ ...m, ...patch, updatedAt: Date.now() }) : m
    ));
  }, []);

  const deleteMachine = useCallback((id: string) => {
    setMachines(prev => {
      const next = prev.filter(m => m.id !== id);
      if (activeId === id && next.length > 0) setActiveId(next[0].id);
      return next;
    });
  }, [activeId]);

  const duplicateMachine = useCallback((id: string): MachineConfig => {
    const src = machines.find(m => m.id === id)!;
    const copy: MachineConfig = {
      ...src,
      id: uid(),
      name: `${src.name} (copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      axes: src.axes.map(a => ({ ...a, id: uid() })),
    };
    setMachines(prev => [...prev, copy]);
    setActiveId(copy.id);
    return copy;
  }, [machines]);

  // ── Axis operations ───────────────────────────────────────────────────────

  const addAxis = useCallback((machineId: string, axis: Omit<AxisConfig, 'id'>) => {
    const newAxis: AxisConfig = { ...axis, id: uid() };
    setMachines(prev => prev.map(m =>
      m.id === machineId
        ? { ...m, axes: [...m.axes, newAxis], updatedAt: Date.now() }
        : m
    ));
  }, []);

  const updateAxis = useCallback((machineId: string, axisId: string, patch: Partial<AxisConfig>) => {
    setMachines(prev => prev.map(m =>
      m.id === machineId ? {
        ...m,
        updatedAt: Date.now(),
        axes: m.axes.map(a => a.id === axisId ? { ...a, ...patch } : a),
      } : m
    ));
  }, []);

  const deleteAxis = useCallback((machineId: string, axisId: string) => {
    setMachines(prev => prev.map(m =>
      m.id === machineId
        ? { ...m, axes: m.axes.filter(a => a.id !== axisId), updatedAt: Date.now() }
        : m
    ));
  }, []);

  const moveAxis = useCallback((machineId: string, axisId: string, dir: 'up' | 'down') => {
    setMachines(prev => prev.map(m => {
      if (m.id !== machineId) return m;
      const axes = [...m.axes];
      const idx = axes.findIndex(a => a.id === axisId);
      const swap = dir === 'up' ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= axes.length) return m;
      [axes[idx], axes[swap]] = [axes[swap], axes[idx]];
      return { ...m, axes, updatedAt: Date.now() };
    }));
  }, []);

  // ── Export ────────────────────────────────────────────────────────────────

  const exportCSV = useCallback((machineId: string): string => {
    const m = machines.find(x => x.id === machineId);
    return m ? configToCSV(m) : '';
  }, [machines]);

  const downloadCSV = useCallback((machineId: string) => {
    const m = machines.find(x => x.id === machineId);
    if (!m) return;
    const blob = new Blob([configToCSV(m)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${m.name.replace(/\s+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [machines]);

  const saveSpindleAsTemplateDefault = useCallback((machineId: string) => {
    const machine = machines.find((m) => m.id === machineId);
    if (!machine?.templateId) return;
    const templateId = machine.templateId;
    const nextDefaults: TemplateSpindleDefaults = {
      spindleDiameter: machine.spindleDiameter,
      spindleLength: machine.spindleLength,
      spindleNoseDiameter: machine.spindleNoseDiameter,
      spindleNoseLength: machine.spindleNoseLength,
      spindleCapDiameter: machine.spindleCapDiameter,
      spindleCapLength: machine.spindleCapLength,
      spindleUp: machine.spindleUp,
      spindleOffsetX: machine.spindleOffsetX,
      spindleOffsetY: machine.spindleOffsetY,
      spindleOffsetZ: machine.spindleOffsetZ,
      spindleRotX: machine.spindleRotX,
      spindleRotY: machine.spindleRotY,
      spindleRotZ: machine.spindleRotZ,
    };
    setTemplateSpindleDefaults((prev) => ({ ...prev, [templateId]: nextDefaults }));
  }, [machines]);

  const clearTemplateSpindleDefault = useCallback((templateId: string) => {
    setTemplateSpindleDefaults((prev) => {
      if (!prev[templateId]) return prev;
      const next = { ...prev };
      delete next[templateId];
      return next;
    });
  }, []);

  const hasTemplateSpindleDefault = useCallback(
    (templateId: string) => !!templateSpindleDefaults[templateId],
    [templateSpindleDefaults]
  );

  return {
    machines, activeMachine, activeCSV,
    createFromTemplate, createBlank,
    updateMachine, deleteMachine, duplicateMachine,
    addAxis, updateAxis, deleteAxis, moveAxis,
    setActiveMachine: setActiveId,
    exportCSV, downloadCSV,
    saveSpindleAsTemplateDefault,
    clearTemplateSpindleDefault,
    hasTemplateSpindleDefault,
    templates,
  };
}
