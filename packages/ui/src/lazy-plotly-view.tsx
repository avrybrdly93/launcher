/**
 * Preact mount point for a lazy-loaded Plotly exploratory pane (§6.2 ADR-007;
 * P3.42's convergence-study log-log plot is this component's first
 * consumer). Thin: all figure construction stays in `@ballista/viz`'s
 * `buildConvergenceFigure`/`buildWorkPrecisionFigure`/`buildPhasePlotFigure`
 * (pure, no DOM); this only owns the mount/update/dispose lifecycle around
 * `renderLazyPlotlyPane`/`disposeLazyPlotlyPane`, mirroring
 * `canvas-viewport.tsx`'s `useRef` + `useEffect` bootstrap/dispose pattern.
 */

import {
  disposeLazyPlotlyPane,
  plotlyFigureSpecsEqual,
  renderLazyPlotlyPane,
  type PlotlyFigureSpec,
} from "@ballista/viz";
import { useLayoutEffect, useRef } from "preact/hooks";

export interface LazyPlotlyViewProps {
  readonly spec: PlotlyFigureSpec;
}

/**
 * Returns a spec whose *identity* only changes when the figure it describes
 * changes (P0.124).
 *
 * **What this fixes.** The effect below is keyed on the spec, and every one of
 * this component's five call sites built a fresh spec object on every render --
 * three of them assigning it to a local named `figureSpec`, which reads as a
 * cached value and is not one. So a parent re-rendering for any reason at all,
 * a keystroke in a text field included, purged the Plotly pane and called
 * `newPlot` again. P0.118 made each of those cycles *safe*; this stops them
 * happening.
 *
 * **Why here rather than a `useMemo` at each call site.** Two of the five
 * derive the figure's inputs fresh per render too (`traceMeritPoints(...)`,
 * `scaleEigenvaluesByH(...)`), so a `useMemo` over those inputs is a no-op that
 * looks like a fix -- and there would be a sixth call site eventually. One
 * comparison covers every present and future caller, and
 * `plotlyFigureSpecsEqual` is fail-safe toward remounting, so a comparison that
 * is ever wrong costs the churn this fix removes rather than a stale plot.
 *
 * **The ref is written during render, deliberately.** That is what makes this a
 * cache rather than state: it produces the same answer for the same input and
 * schedules no extra render, which `useState` here would.
 *
 * **Passing the held object to `renderLazyPlotlyPane` rather than the incoming
 * prop is a readability choice and NOT a behavioural one**, which is worth
 * saying because it looks like one. The two coincide at every moment the effect
 * can run: the ref is only reassigned to `spec` itself, so on any render where
 * the dependency changed, `mounted.current === spec`. Substituting one for the
 * other was tried as a control and changed no test, correctly. What the naming
 * buys is that the argument and the effect key are visibly the same value.
 */
function useStableSpec(spec: PlotlyFigureSpec): PlotlyFigureSpec {
  const mounted = useRef(spec);
  if (mounted.current !== spec && !plotlyFigureSpecsEqual(mounted.current, spec)) {
    mounted.current = spec;
  }
  return mounted.current;
}

/**
 * Mounts `spec` into a Plotly pane, re-rendering in place whenever the figure
 * `spec` describes changes -- by value, not by object identity, see
 * {@link useStableSpec} -- and disposing on unmount. Uses `useLayoutEffect` (runs
 * synchronously after commit) rather than `useEffect` (deferred to
 * `requestAnimationFrame`, which jsdom doesn't implement) so this stays
 * testable without a real browser -- there's no visible-paint reason this
 * particular effect needs to wait for a frame anyway, since the whole point
 * is mounting Plotly as soon as the container exists.
 */
export function LazyPlotlyView({ spec }: LazyPlotlyViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stableSpec = useStableSpec(spec);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Latched by the cleanup below and read by `renderLazyPlotlyPane` after its
    // dynamic import resolves. A route change during that import would
    // otherwise mount a `responsive: true` plot into a container this effect
    // has already given up, leaving Plotly handlers alive on a detached node
    // with no cleanup left to run (P0.118).
    let cancelled = false;
    void renderLazyPlotlyPane(container, stableSpec, { shouldMount: () => !cancelled });
    return () => {
      cancelled = true;
      void disposeLazyPlotlyPane(container);
    };
  }, [stableSpec]);

  return <div class="lazy-plotly-view" data-testid="lazy-plotly-view" ref={containerRef} />;
}
