import { applyGlobalTheme, setStatus, tt, state } from "./core.js";
import { applyTexts, render } from "./render.js";
import { wire, watch } from "./actions.js";

applyGlobalTheme();
window.addEventListener("vmill:theme:changed", applyGlobalTheme);

wire();
applyTexts();
watch();
render({ force: true });

window.addEventListener("vmill:lang:changed", () => {
  applyTexts();
  if (!state.formDirty) render({ force: true });
});

window.addEventListener("vmill:lang:catalog:changed", () => {
  applyTexts();
  if (!state.formDirty) render({ force: true });
});

window.CANBus?.emit("structure:ready", { module: "Structure Studio" }, "structure");
setStatus(tt("structure.status.ready", "Structure Studio ready."));
