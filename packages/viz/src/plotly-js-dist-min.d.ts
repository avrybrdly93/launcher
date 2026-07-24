/**
 * `plotly.js-dist-min` ships no types of its own; this declares only the
 * narrow slice of its API {@link lazy-plotly-pane.ts} actually calls, kept
 * separate from `@types/plotly.js`'s much larger (and version-mismatched)
 * surface.
 */
declare module "plotly.js-dist-min" {
  interface PlotlyStatic {
    newPlot(
      root: HTMLElement,
      data: readonly Record<string, unknown>[],
      layout?: Record<string, unknown>,
      config?: Record<string, unknown>,
    ): Promise<unknown>;
    purge(root: HTMLElement): void;
  }
  const Plotly: PlotlyStatic;
  export default Plotly;
}
