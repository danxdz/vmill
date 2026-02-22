# Module Tutorial (VMill)

This project already has a modular sidebar architecture.

Core pieces:
- `src/modules/moduleTypes.ts`: shared module contract (`SidebarModuleProps`, telemetry, commands)
- `src/modules/moduleBus.ts`: CAN-like event bus
- `src/modules/ModuleHost.tsx`: load/order/show/hide modules
- `src/modules/sidebarModules.ts`: module registry
- `src/ZeroPanel.tsx`: command gateway (executes commands on `MachineBrain`)

## 1) Create a new module

Create a component in `src/` (or `src/modules/panels/` if you want to group them):

```tsx
import type { CSSProperties } from 'react';
import type { SidebarModuleProps } from './modules/moduleTypes';

export default function ProbePanel({ runtime }: SidebarModuleProps) {
  const { telemetry, can } = runtime;

  const zAxis = telemetry.axes.find((a) => a.physical_name === 'Z');

  return (
    <div style={s.wrap}>
      <button
        style={s.btn}
        onClick={() => can.emit('command', { type: 'machine.home_axis', axisId: zAxis?.id ?? 0 })}
      >
        HOME Z
      </button>
      <button
        style={s.btn}
        onClick={() => can.emit('command', { type: 'machine.jog_feed', axisId: zAxis?.id ?? 0, delta: -1, feed: 200 })}
      >
        PROBE STEP -1
      </button>
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 8 },
  btn: {
    background: '#13243c',
    color: '#9db4d8',
    border: '1px solid #2f4a73',
    borderRadius: 4,
    padding: '8px 10px',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: 11,
  },
};
```

## 2) Register it in the sidebar

Edit `src/modules/sidebarModules.ts`:

```ts
import ProbePanel from '../ProbePanel';

export const sidebarModules = [
  // ...
  {
    id: 'probe',
    title: 'PROBE',
    order: 40,
    Component: ProbePanel,
  },
];
```

## 3) If module needs a new action, add a command type

Edit `src/modules/moduleTypes.ts` and extend `ModuleCommand`.

Example:

```ts
| { type: 'probe.single_touch'; axisId: number; feed: number }
```

## 4) Handle that command in `ZeroPanel`

Add a case in the `switch(cmd.type)` in `src/ZeroPanel.tsx`.

Example:

```ts
case 'probe.single_touch':
  // map to core calls here
  break;
```

Rule: modules never call `brain` directly; they emit commands to the bus.

## 5) Optional: add telemetry fields

If your module needs new read data:
1. Add fields to `ModuleTelemetry` in `src/modules/moduleTypes.ts`
2. Fill them in `ZeroPanel` (`telemetry` object)
3. Read them in the module via `runtime.telemetry`

## 6) Module quality checklist

- Keep module independent: no cross-module direct imports
- Use command bus only for actions
- Use telemetry only for reads
- Keep panel self-contained (styles + logic)
- Register with stable `id` and deterministic `order`

## 7) Good next modules

- `ProbePanel`: Z touch-off, corner-finder workflows
- `ToolLibraryPanel`: tool presets, holder, stickout, wear columns
- `MDIPanel`: single-line command runner with history
- `WorkShiftPanel`: quick G54-G59 shift and rotate (future G68)
- `DiagnosticsPanel`: command log, parser warnings, modal state monitor
- `CyclePanel`: optional stop, block delete, dry run/simulation mode
