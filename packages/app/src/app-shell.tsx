import type { ComponentChildren } from "preact";
import "./app-shell.css";

export interface AppShellProps {
  canvas: ComponentChildren;
  controlDock: ComponentChildren;
  analysisDrawer: ComponentChildren;
}

/** Canvas center, control dock right, analysis drawer bottom (§6.1, §6.3). */
export function AppShell({ canvas, controlDock, analysisDrawer }: AppShellProps) {
  return (
    <main class="app-shell">
      <div class="app-shell__canvas" data-testid="app-shell-canvas">
        {canvas}
      </div>
      <div class="app-shell__dock" data-testid="app-shell-dock">
        {controlDock}
      </div>
      <div class="app-shell__drawer" data-testid="app-shell-drawer">
        {analysisDrawer}
      </div>
    </main>
  );
}
