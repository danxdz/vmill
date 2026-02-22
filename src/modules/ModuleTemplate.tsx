import type { CSSProperties, ReactNode } from 'react';

interface ModuleTemplateProps {
  title: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onClose: () => void;
  children: ReactNode;
}

export default function ModuleTemplate({
  title,
  collapsed,
  onToggleCollapsed,
  onClose,
  children,
}: ModuleTemplateProps) {
  return (
    <section style={s.module}>
      <div
        style={s.header}
        onClick={onToggleCollapsed}
        title={collapsed ? 'Expand module' : 'Collapse module'}
      >
        <div style={s.titleWrap}>
          <div style={s.moduleTitle}>{title}</div>
          <div style={s.stateTag}>{collapsed ? 'OPEN' : 'HIDE'}</div>
        </div>
        <div style={s.actions}>
          <button
            style={s.actionBtn}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            title="Close module"
          >
            x
          </button>
        </div>
      </div>
      {!collapsed && children}
    </section>
  );
}

const s: Record<string, CSSProperties> = {
  module: {
    background: '#090f1b',
    border: '1px solid #1f2b46',
    borderRadius: 8,
    padding: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    cursor: 'pointer',
    userSelect: 'none',
  },
  titleWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  moduleTitle: {
    fontSize: 10,
    color: '#7b8cad',
    letterSpacing: '0.14em',
    fontWeight: 700,
  },
  stateTag: {
    fontSize: 9,
    color: '#8aa0c6',
    border: '1px solid #2a395a',
    borderRadius: 3,
    padding: '0 4px',
    lineHeight: '14px',
  },
  actions: {
    display: 'flex',
    gap: 4,
  },
  actionBtn: {
    width: 18,
    height: 18,
    borderRadius: 3,
    border: '1px solid #2a395a',
    background: '#111a2b',
    color: '#7b8cad',
    cursor: 'pointer',
    fontSize: 10,
    lineHeight: '10px',
    padding: 0,
  },
};
