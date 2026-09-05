/**
 * Preact mount point for a lazy-loaded Plotly exploratory pane (§6.2 ADR-007;
 * P3.42's convergence-study log-log plot is this component's first
 * consumer). Thin: all figure construction stays in `@ballista/viz`'s
 * `buildConvergenceFigure`/`buildWorkPrecisionFigure`/`buildPhasePlotFigure`
 * (pure, no DOM); this only owns the mount/update/dispose lifecycle around
 * `renderLazyPlotlyPane`/`disposeLazyPlotlyPane`, mirroring
 * `canvas-viewport.tsx`'s `useRef` + `useEffect` bootstrap/dispose pattern.
 */

import { disposeLazyPlotlyPane, renderLazyPlotlyPane, type PlotlyFigureSpec } from "@ballista/viz";
import { useLayoutEffect, useRef } from "preact/hooks";

export interface LazyPlotlyViewProps {
  readonly spec: PlotlyFigureSpec;
}

/**
 * Mounts `spec` into a Plotly pane, re-rendering in place whenever `spec`
 * changes and disposing on unmount. Uses `useLayoutEffect` (runs
 * synchronously after commit) rather than `useEffect` (deferred to
 * `requestAnimationFrame`, which jsdom doesn't implement) so this stays
 * testable without a real browser -- there's no visible-paint reason this
 * particular effect needs to wait for a frame anyway, since the whole point
 * is mounting Plotly as soon as the container exists.
 */
/**
 * Reports a pane lifecycle failure instead of letting it escape as an
 * unhandled rejection (P0.118).
 *
 * `void promise` was what this component did before, and it is wrong twice
 * over: a genuine Plotly failure vanished, and the rejection surfaced later
 * as an unattributed unhandled rejection — which is precisely how P0.118's
 * second manifestation reddens CI while every assertion passes. `console.error`
 * instead, which `app-routes.e2e.test.ts` already asserts is empty, so a real
 * failure now fails a test that names the route it happened on.
 */
function reportPaneFailure(stage: string, error: unknown): void {
  console.error(`LazyPlotlyView: ${stage} failed`, error);
}

export function LazyPlotlyView({ spec }: LazyPlotlyViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    renderLazyPlotlyPane(container, spec).catch((error: unknown) => {
      reportPaneFailure("render", error);
    });
    return () => {
      disposeLazyPlotlyPane(container).catch((error: unknown) => {
        reportPaneFailure("dispose", error);
      });
    };
  }, [spec]);

  return <div class="lazy-plotly-view" data-testid="lazy-plotly-view" ref={containerRef} />;
}
