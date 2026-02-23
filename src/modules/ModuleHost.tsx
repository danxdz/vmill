import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import ModuleTemplate from './ModuleTemplate';
import type { SidebarModuleDefinition, SidebarModuleRuntime } from './moduleTypes';

interface ModuleHostProps {
  modules: SidebarModuleDefinition[];
  runtime: SidebarModuleRuntime;
}

const LAYOUT_KEY = 'vmill_sidebar_layout_v1';
const PINNED_LAST_ID = 'view';

interface ModuleLayoutPrefs {
  order: string[];
  visible: Record<string, boolean>;
}

function parseLayoutPrefs(raw: string | null): ModuleLayoutPrefs | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ModuleLayoutPrefs>;
    return {
      order: Array.isArray(parsed.order) ? parsed.order.map((v) => String(v)) : [],
      visible: typeof parsed.visible === 'object' && parsed.visible
        ? Object.fromEntries(Object.entries(parsed.visible).map(([k, v]) => [String(k), !!v]))
        : {},
    };
  } catch {
    return null;
  }
}

function normalizeOrder(order: string[], validIds: string[]): string[] {
  const valid = new Set(validIds);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of order) {
    if (!valid.has(id) || seen.has(id) || id === PINNED_LAST_ID) continue;
    seen.add(id);
    result.push(id);
  }
  for (const id of validIds) {
    if (id === PINNED_LAST_ID || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  if (valid.has(PINNED_LAST_ID)) {
    result.push(PINNED_LAST_ID);
  }
  return result;
}

export default function ModuleHost({ modules, runtime }: ModuleHostProps) {
  const enabledModules = useMemo(
    () => [...modules].filter((m) => m.enabled !== false).sort((a, b) => a.order - b.order),
    [modules]
  );
  const moduleIds = useMemo(() => enabledModules.map((m) => m.id), [enabledModules]);

  const initialPrefs = useMemo(() => parseLayoutPrefs(localStorage.getItem(LAYOUT_KEY)), []);
  const [menuOpen, setMenuOpen] = useState(false);
  const [visible, setVisible] = useState<Record<string, boolean>>(() => {
    const base = Object.fromEntries(moduleIds.map((id) => [id, true]));
    const fromPrefs = initialPrefs?.visible ?? {};
    for (const id of moduleIds) {
      if (Object.prototype.hasOwnProperty.call(fromPrefs, id)) {
        base[id] = !!fromPrefs[id];
      }
    }
    return base;
  });
  const [order, setOrder] = useState<string[]>(() => normalizeOrder(initialPrefs?.order ?? moduleIds, moduleIds));
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setVisible((prev) => {
      const next: Record<string, boolean> = {};
      for (const id of moduleIds) {
        next[id] = prev[id] ?? true;
      }
      return next;
    });
    setOrder((prev) => normalizeOrder(prev, moduleIds));
    setCollapsed((prev) =>
      Object.fromEntries(
        Object.entries(prev).filter(([id]) => moduleIds.includes(id))
      )
    );
  }, [moduleIds]);

  const sortedModules = useMemo(() => {
    const byId = new Map(enabledModules.map((m) => [m.id, m]));
    return normalizeOrder(order, moduleIds)
      .map((id) => byId.get(id))
      .filter(Boolean) as SidebarModuleDefinition[];
  }, [enabledModules, order, moduleIds]);

  useEffect(() => {
    const persisted: ModuleLayoutPrefs = {
      order: normalizeOrder(order, moduleIds),
      visible: Object.fromEntries(moduleIds.map((id) => [id, visible[id] ?? true])),
    };
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(persisted));
  }, [order, visible, moduleIds]);

  const setAllCollapsed = (value: boolean) => {
    setCollapsed(Object.fromEntries(sortedModules.map((m) => [m.id, value])));
  };
  const setAllVisible = (value: boolean) => {
    setVisible(Object.fromEntries(sortedModules.map((m) => [m.id, value])));
  };
  const moveModule = (moduleId: string, direction: -1 | 1) => {
    if (moduleId === PINNED_LAST_ID) return;
    setOrder((prev) => {
      const normalized = normalizeOrder(prev, moduleIds);
      const movable = normalized.filter((id) => id !== PINNED_LAST_ID);
      const idx = movable.indexOf(moduleId);
      if (idx < 0) return normalized;
      const nextIdx = idx + direction;
      if (nextIdx < 0 || nextIdx >= movable.length) return normalized;
      const next = [...movable];
      const tmp = next[idx];
      next[idx] = next[nextIdx];
      next[nextIdx] = tmp;
      return moduleIds.includes(PINNED_LAST_ID) ? [...next, PINNED_LAST_ID] : next;
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
        <div style={{ display: 'flex', gap: 6, flex: 1 }}>
          <button style={topBtn} onClick={() => setAllCollapsed(false)} title="Expand all modules">
            Max All
          </button>
          <button style={topBtn} onClick={() => setAllCollapsed(true)} title="Collapse all modules">
            Min All
          </button>
        </div>
        <button
          style={hamburgerBtn}
          title="Modules menu"
          onClick={() => setMenuOpen((v) => !v)}
        >
          {'\u2261'}
        </button>
        {menuOpen && (
          <div
            style={{
              position: 'absolute',
              top: 26,
              right: 0,
              zIndex: 30,
              width: 240,
              background: '#0b1322',
              border: '1px solid #22304f',
              borderRadius: 6,
              padding: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={menuBtn} onClick={() => setAllVisible(true)}>
                Show All
              </button>
              <button style={menuBtn} onClick={() => setAllVisible(false)}>
                Hide All
              </button>
            </div>
            {sortedModules.map((mod, idx) => (
              <div key={mod.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#9fb0cf' }}>
                  <input
                    type="checkbox"
                    checked={visible[mod.id] ?? true}
                    onChange={(e) => setVisible((prev) => ({ ...prev, [mod.id]: e.target.checked }))}
                  />
                  {mod.title}
                  {mod.id === PINNED_LAST_ID ? <span style={lockTag}>LAST</span> : null}
                </label>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    style={miniBtn}
                    disabled={mod.id === PINNED_LAST_ID || idx === 0}
                    onClick={() => moveModule(mod.id, -1)}
                    title="Move up"
                  >
                    {'\u2191'}
                  </button>
                  <button
                    style={miniBtn}
                    disabled={
                      mod.id === PINNED_LAST_ID
                      || idx >= sortedModules.length - 1
                      || sortedModules[idx + 1]?.id === PINNED_LAST_ID
                    }
                    onClick={() => moveModule(mod.id, 1)}
                    title="Move down"
                  >
                    {'\u2193'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {sortedModules
        .filter((mod) => visible[mod.id] ?? true)
        .map((mod) => (
          <ModuleTemplate
            key={mod.id}
            title={mod.title}
            collapsed={collapsed[mod.id] ?? false}
            onToggleCollapsed={() => setCollapsed((prev) => ({ ...prev, [mod.id]: !(prev[mod.id] ?? false) }))}
            onClose={() => setVisible((prev) => ({ ...prev, [mod.id]: false }))}
          >
            <mod.Component runtime={runtime} />
          </ModuleTemplate>
        ))}
    </div>
  );
}

const menuBtn: CSSProperties = {
  flex: 1,
  border: '1px solid #2a395a',
  background: '#13203a',
  color: '#9fb0cf',
  borderRadius: 4,
  fontSize: 10,
  cursor: 'pointer',
  padding: '3px 4px',
};

const topBtn: CSSProperties = {
  flex: 1,
  border: '1px solid #2a395a',
  background: '#13203a',
  color: '#9fb0cf',
  borderRadius: 4,
  fontSize: 10,
  cursor: 'pointer',
  padding: '4px 6px',
  fontWeight: 700,
};

const hamburgerBtn: CSSProperties = {
  width: 26,
  height: 22,
  borderRadius: 4,
  border: '1px solid #2a395a',
  background: '#10192a',
  color: '#7b8cad',
  cursor: 'pointer',
  fontSize: 13,
  padding: 0,
};

const miniBtn: CSSProperties = {
  width: 20,
  height: 18,
  border: '1px solid #2a395a',
  background: '#13203a',
  color: '#9fb0cf',
  borderRadius: 3,
  fontSize: 10,
  cursor: 'pointer',
  lineHeight: '10px',
  padding: 0,
};

const lockTag: CSSProperties = {
  fontSize: 9,
  color: '#86efac',
  border: '1px solid #166534',
  background: '#0f2d1f',
  borderRadius: 3,
  padding: '0 3px',
  lineHeight: '12px',
};
