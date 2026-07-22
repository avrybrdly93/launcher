import { AppShell } from "./app-shell.js";

export function App() {
  return (
    <AppShell
      canvas={<p>Canvas viewport lands in P3.05+.</p>}
      controlDock={<p>Control dock lands in P3.02+.</p>}
      analysisDrawer={<p>Analysis drawer lands in later Phase 3 tasks.</p>}
    />
  );
}
