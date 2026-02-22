# New Sidebar Module Template

Create a new file in `src/` (example: `MyCoolModule.tsx`) using this shape:

```tsx
import type { CSSProperties } from 'react';
import type { SidebarModuleProps } from './modules/moduleTypes';

export default function MyCoolModule({ runtime }: SidebarModuleProps) {
  const { telemetry, can } = runtime;

  return (
    <div style={s.wrap}>
      <button onClick={() => can.emit('command', { type: 'machine.home_all' })}>
        EXAMPLE COMMAND
      </button>
      <div>Axes online: {telemetry.axes.length}</div>
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 8 },
};
```

Register it in `src/modules/sidebarModules.ts`:

```ts
import MyCoolModule from '../MyCoolModule';

// ...
{
  id: 'my-cool-module',
  title: 'MY MODULE',
  order: 30,
  Component: MyCoolModule,
}
```

## CAN bus rules

- Modules do not call `brain` directly.
- Modules publish commands with `runtime.can.emit('command', payload)`.
- `ZeroPanel` is the command gateway that executes commands on the machine.
