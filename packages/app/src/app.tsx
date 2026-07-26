import { AppShell } from "./app-shell.js";
import { CanvasViewport } from "./canvas-viewport.js";

export function App() {
  return (
    <AppShell
      canvas={<CanvasViewport />}
      controlDock={
        <p>
          Control dock lands in P3.02+. <a href="#/solver-lab">Open Solver Lab &rarr;</a>{" "}
          <a href="#/convergence-study">Open Convergence Study &rarr;</a>{" "}
          <a href="#/stability-explorer">Open Stability Explorer &rarr;</a>{" "}
          <a href="#/energy-drift">Open Energy Drift &rarr;</a>
        </p>
      }
      analysisDrawer={<p>Analysis drawer lands in later Phase 3 tasks.</p>}
    />
  );
}
