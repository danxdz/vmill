import JogPanel from '../JogPanel';
import OffsetPanel from '../OffsetPanel';
import ToolCompPanel from '../ToolCompPanel';
import ViewPanel from '../ViewPanel';
import ToolVisualPanel from '../ToolVisualPanel';
import ToolManagerPanel from '../ToolManagerPanel';
import ToolStationsPanel from '../ToolStationsPanel';
import type { SidebarModuleDefinition } from './moduleTypes';

export const sidebarModules: SidebarModuleDefinition[] = [
  {
    id: 'jog',
    title: 'JOG',
    order: 10,
    Component: JogPanel,
  },
  {
    id: 'offsets',
    title: 'WORK OFFSETS',
    order: 20,
    Component: OffsetPanel,
  },
  {
    id: 'tool-comp',
    title: 'TOOL COMP',
    order: 30,
    Component: ToolCompPanel,
  },
  {
    id: 'view',
    title: 'VIEW',
    order: 31,
    Component: ViewPanel,
  },
  {
    id: 'tool-visual',
    title: 'TOOL SHAPE',
    order: 35,
    Component: ToolVisualPanel,
  },
  {
    id: 'tool-manager',
    title: 'TOOL MANAGER',
    order: 40,
    Component: ToolManagerPanel,
  },
  {
    id: 'tool-stations',
    title: 'TOOL STATIONS',
    order: 45,
    Component: ToolStationsPanel,
  },
];
