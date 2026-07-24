/**
 * Minimal real consumer of {@link ./lazy-plotly-pane.js}'s dynamic import,
 * used only as a Rollup/Vite build entry point by
 * `lazy-plotly-pane.bundle.test.ts` to verify Plotly ends up in its own
 * dynamic-import chunk rather than the initial bundle (P3.30's validation
 * criterion). Stands in for a future UI component that opens an
 * exploratory pane from an event handler -- not part of this package's
 * public API, so it is deliberately not re-exported from `index.ts`.
 */
import {
  loadPlotlyModule,
  renderLazyPlotlyPane,
  type PlotlyFigureSpec,
} from "./lazy-plotly-pane.js";

export function openExploratoryPlotOnDemand(container: HTMLElement, spec: PlotlyFigureSpec) {
  return renderLazyPlotlyPane(container, spec);
}

export function preloadPlotly() {
  return loadPlotlyModule();
}
