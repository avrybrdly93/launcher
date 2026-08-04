import { render } from "preact";
import { App } from "./app.js";
import { ConvergenceStudyRoute } from "./convergence-study-route.js";
import { EnergyDriftRoute } from "./energy-drift-route.js";
import { SolverLabRoute } from "./solver-lab-route.js";
import { NeglectedEffectsRoute } from "./neglected-effects-route.js";
import { DensityAltitudeRoute } from "./density-altitude-route.js";
import { ModelRegistryRoute } from "./model-registry-route.js";
import { StabilityExplorerRoute } from "./stability-explorer-route.js";
import { TerrainEditorRoute } from "./terrain-editor-route.js";

/**
 * Minimal hash-based routing (P3.41, extended P3.42): a handful of routes
 * beyond the default simulator, so a full router is unwarranted -- this
 * dispatches on `location.hash` and re-renders on `hashchange`, mirroring
 * the granularity of the rest of `main.tsx`'s bootstrap responsibility.
 */
function renderRoute(root: HTMLElement): void {
  switch (window.location.hash) {
    case "#/solver-lab":
      render(<SolverLabRoute />, root);
      return;
    case "#/convergence-study":
      render(<ConvergenceStudyRoute />, root);
      return;
    case "#/stability-explorer":
      render(<StabilityExplorerRoute />, root);
      return;
    case "#/energy-drift":
      render(<EnergyDriftRoute />, root);
      return;
    case "#/terrain-editor":
      render(<TerrainEditorRoute />, root);
      return;
    case "#/neglected-effects":
      render(<NeglectedEffectsRoute />, root);
      return;
    case "#/density-altitude":
      render(<DensityAltitudeRoute />, root);
      return;
    case "#/model-registry":
      render(<ModelRegistryRoute />, root);
      return;
    default:
      render(<App />, root);
  }
}

const root = document.getElementById("app");
if (root) {
  renderRoute(root);
  window.addEventListener("hashchange", () => renderRoute(root));
}
