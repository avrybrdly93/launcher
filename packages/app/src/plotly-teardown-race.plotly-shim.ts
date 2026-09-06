/**
 * Stands in for `plotly.js-dist-min` when `plotly-teardown-race.e2e.test.ts`
 * bundles {@link ./plotly-teardown-race.browser-fixture.js} for the browser
 * (P0.118). The test aliases the real package to this file, so the bundle
 * carries the pane module's own logic and nothing else, and the page gets the
 * genuine Plotly from a `<script>` tag instead.
 *
 * **Why not just bundle the real thing.** `plotly.js-dist-min` is ~4.8 MB, and
 * putting it through Rollup for every run of this suite costs far more than the
 * defect it is guarding against. Injecting the shipped dist file directly is
 * also closer to what a browser actually executes -- it is the same bytes, not
 * a re-bundled derivative.
 *
 * **This does not weaken what the test measures.** The thing under test is the
 * *ordering* of `newPlot` and `purge` on one container across an `await`, and
 * that ordering lives entirely in `lazy-plotly-pane.ts`. Both calls still land
 * on real Plotly, which is what makes the reported `_redrawFromAutoMarginCount`
 * error reachable at all -- a mocked Plotly cannot produce it, which is exactly
 * why the unit tests beside that module could not close P0.118 on their own.
 */

/**
 * The real Plotly, injected into the page before this module evaluates.
 *
 * Read at module scope rather than per call: the pane module memoizes the
 * dynamic import, so a lazily-read global would be captured on first use
 * anyway, and reading it here makes an injection-order mistake fail loudly at
 * load rather than quietly at the first plot.
 */
export default (globalThis as unknown as { Plotly: unknown }).Plotly;
