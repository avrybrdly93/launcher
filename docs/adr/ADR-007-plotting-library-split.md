# ADR-007: Custom Canvas Plotter for Always-On Panes, Lazy Plotly for Exploratory Panes

**Status:** Accepted
**Date:** 2026-07-24

## Context

§6.2 lists two distinct classes of analysis plot. The always-on panes (time
series of $y$, $v$, $E$, $\mathcal R_E$, step-size trace $h_k$) render on
every solve, are small in data volume, and need to match the app's own
visual style exactly (P3.29). The exploratory panes (work–precision
log–log studies comparing methods, phase plots) are opened on demand from
Solver Lab, want real zoom/pan/hover/export, and are read by fewer users
less often.

A single plotting library for both would force a bad trade either way:

- A full-featured library (Plotly, or similar) for _every_ pane would add
  its multi-hundred-kB-gzipped weight to the initial bundle, blowing the
  §2.6 300 kB budget before a single trajectory has even solved.
- A minimal custom plotter for _every_ pane would mean reimplementing
  zoom/pan/hover/export/log-axis interaction — real product surface,
  not a rounding error — for the exploratory panes that most want it.

## Decision

Split by pane, not by plot type:

- **Always-on panes** (`plot-pane.ts`, P3.29) use a thin custom Canvas 2D
  plotter: pure `PlotSeries` derivation from recorder output plus a direct
  `drawPlotPane` pass, sharing `axes-layer.ts`'s tick logic with the
  world-space view. Tiny, fast, in the initial bundle.
- **Exploratory panes** (`lazy-plotly-pane.ts`, P3.30) use real Plotly
  (`plotly.js-dist-min`), loaded via a single memoized `import()` inside
  `loadPlotlyModule()` — never a static import anywhere in the module
  graph. Rollup/Vite always treat a dynamic `import()` expression as its
  own chunk boundary regardless of how the _containing_ module is itself
  imported elsewhere, so Plotly's weight lands in a chunk that only loads
  the first time a caller actually opens an exploratory pane.
  Figure construction (`buildWorkPrecisionFigure`, `buildPhasePlotFigure`,
  `buildPlotlyFigure`) is kept as pure data shaping with no dependency on
  the Plotly module itself, so it stays unit-testable without ever loading
  the library.

`lazy-plotly-pane.bundle.test.ts` builds a real consumer of
`loadPlotlyModule`/`renderLazyPlotlyPane` through Vite/Rollup and asserts
directly on the resulting chunk graph: the initial chunk's module list
excludes `plotly.js-dist-min` entirely and stays under 5 kB, while the
chunk containing Plotly is a dynamic-only entry (`isDynamicEntry`, reachable
only via `dynamicImports`, never any chunk's static `imports`) carrying
Plotly's real multi-hundred-kB weight. This is the validation criterion
this ADR exists to satisfy, checked by construction rather than by
inspection.

## Consequences

- The initial bundle's plotting cost is exactly `plot-pane.ts`'s own
  (small) size, unaffected by how large Plotly itself grows.
- Exploratory panes pay a one-time load delay (network + parse) the first
  time they're opened in a session; acceptable for panes that are opened
  deliberately, not on every frame.
- `check-bundle-size.mjs`'s §2.6 budget does not need to special-case
  Plotly today: nothing in `packages/app` yet statically references
  `lazy-plotly-pane.ts`'s exports (its Solver Lab UI wiring is a later
  task, consistent with every other Phase 3 viz module shipped
  isolated-and-unit-tested first), so Plotly is entirely absent from the
  current app bundle, not merely deferred to a lazy chunk within it. When
  that wiring lands, `check-bundle-size.mjs` will need to sum only the
  statically-reachable-from-entry chunk set (e.g. via Vite's
  `build.manifest`) rather than every `.js` file under `dist/`, since the
  latter would count Plotly's lazy chunk against the initial-load budget
  it is specifically designed to sit outside of.
- Revisit this split if the custom canvas plotter's scope creeps toward
  needing Plotly-grade interaction on the always-on panes (§6.2's own
  caveat), or if Plotly's bundle weight makes even lazy-loading it feel
  too expensive on slow connections (§6.4 names uPlot as the fallback to
  evaluate first).
