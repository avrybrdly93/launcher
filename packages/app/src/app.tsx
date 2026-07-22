import { AppShell } from "./app-shell.js";
import { CanvasViewport } from "./canvas-viewport.js";

export function App() {
  return (
    <AppShell
      canvas={<CanvasViewport />}
      controlDock={<p>Control dock lands in P3.02+.</p>}
      analysisDrawer={<p>Analysis drawer lands in later Phase 3 tasks.</p>}
    />
  );
}
