import { applyTheme } from './core.js';
import { boot } from './actions.js';

applyTheme();
window.addEventListener('vmill:theme:changed', applyTheme);
boot();
