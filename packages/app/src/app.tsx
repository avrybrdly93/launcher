import { AppShell } from "./app-shell.js";
import { CanvasViewport } from "./canvas-viewport.js";
import { SimulatorControls } from "./simulator-controls.js";

export function App() {
  return (
    <AppShell
      canvas={<CanvasViewport />}
      controlDock={
        <>
          <SimulatorControls />
          <p>
            <a href="#/solver-lab">Open Solver Lab &rarr;</a>{" "}
            <a href="#/convergence-study">Open Convergence Study &rarr;</a>{" "}
            <a href="#/stability-explorer">Open Stability Explorer &rarr;</a>{" "}
            <a href="#/energy-drift">Open Energy Drift &rarr;</a>
          </p>
        </>
      }
      analysisDrawer={<p>Analysis drawer lands in later Phase 3 tasks.</p>}
    />
  );
}
