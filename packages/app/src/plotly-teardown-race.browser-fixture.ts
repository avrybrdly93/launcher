/**
 * Browser entry point for `plotly-teardown-race.e2e.test.ts` (P0.118): puts
 * the two real pane entry points on the page's global object so the test can
 * drive them from `page.evaluate`.
 *
 * It exists because the defect P0.118 was filed on is only reachable through
 * *these* functions against *real* Plotly in a *real* browser. Re-implementing
 * their ordering inside the test would produce a test that passes no matter
 * what `lazy-plotly-pane.ts` does, which is the failure mode the task's own
 * notes spend several paragraphs on.
 *
 * Not part of the app's runtime graph: nothing imports this but the test's
 * Vite build, and the built bundle is injected into a blank page rather than
 * served.
 */

import { disposeLazyPlotlyPane, renderLazyPlotlyPane } from "@ballista/viz";

/** The shape the test reads off `window`. */
export interface PlotlyPaneTestHandle {
  readonly render: typeof renderLazyPlotlyPane;
  readonly dispose: typeof disposeLazyPlotlyPane;
}

/** Global name the test looks the handle up under. */
export const PLOTLY_PANE_TEST_HANDLE = "__ballistaPlotlyPane";

(globalThis as unknown as Record<string, PlotlyPaneTestHandle>)[PLOTLY_PANE_TEST_HANDLE] = {
  render: renderLazyPlotlyPane,
  dispose: disposeLazyPlotlyPane,
};
