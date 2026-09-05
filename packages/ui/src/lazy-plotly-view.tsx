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
export function LazyPlotlyView({ spec }: LazyPlotlyViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Latched by the cleanup below and read by `renderLazyPlotlyPane` after its
    // dynamic import resolves. A route change during that import would
    // otherwise mount a `responsive: true` plot into a container this effect
    // has already given up, leaving Plotly handlers alive on a detached node
    // with no cleanup left to run (P0.118).
    let cancelled = false;
    void renderLazyPlotlyPane(container, spec, { shouldMount: () => !cancelled });
    return () => {
      cancelled = true;
      void disposeLazyPlotlyPane(container);
    };
  }, [spec]);

  return <div class="lazy-plotly-view" data-testid="lazy-plotly-view" ref={containerRef} />;
}
