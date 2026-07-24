import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `plotly.js-dist-min` throws (`self is not defined`) outside a real
 * browser global scope, so its actual code never runs under Vitest's node
 * environment (confirmed by hand; see `lazy-plotly-pane.bundle.test.ts` for
 * the real-module bundle-splitting proof instead). This file mocks the
 * module to exercise `loadPlotlyModule`/`renderLazyPlotlyPane`/
 * `disposeLazyPlotlyPane`'s own logic -- memoization and correct
 * pass-through of the built figure -- independent of Plotly's internals.
 */
const newPlot = vi.fn().mockResolvedValue(undefined);
const purge = vi.fn();

vi.mock("plotly.js-dist-min", () => ({
  default: { newPlot, purge },
}));

const {
  loadPlotlyModule,
  renderLazyPlotlyPane,
  disposeLazyPlotlyPane,
  resetLazyPlotlyModuleForTesting,
} = await import("./lazy-plotly-pane.js");

afterEach(() => {
  resetLazyPlotlyModuleForTesting();
  newPlot.mockClear();
  purge.mockClear();
});

describe("loadPlotlyModule", () => {
  it("resolves to the (mocked) Plotly default export", async () => {
    const plotly = await loadPlotlyModule();
    expect(plotly).toBe((await import("plotly.js-dist-min")).default);
  });

  it("memoizes the dynamic import -- a second call reuses the same promise/module", async () => {
    const first = loadPlotlyModule();
    const second = loadPlotlyModule();
    expect(second).toBe(first);
    expect(await second).toBe(await first);
  });
});

describe("renderLazyPlotlyPane", () => {
  it("loads Plotly then calls newPlot with the built data/layout for the given container", async () => {
    const container = {} as HTMLElement;
    const spec = {
      traces: [{ name: "a", x: [1, 2], y: [3, 4] }],
      xAxis: { title: "x" },
      yAxis: { title: "y" },
    };

    await renderLazyPlotlyPane(container, spec);

    expect(newPlot).toHaveBeenCalledTimes(1);
    const [calledContainer, data, layout, config] = newPlot.mock.calls[0]!;
    expect(calledContainer).toBe(container);
    expect(data).toEqual([
      { name: "a", x: [1, 2], y: [3, 4], mode: "lines+markers", type: "scatter" },
    ]);
    expect(layout).toMatchObject({ xaxis: { title: "x" }, yaxis: { title: "y" } });
    expect(config).toMatchObject({ responsive: true, displaylogo: false });
  });
});

describe("disposeLazyPlotlyPane", () => {
  it("loads Plotly then calls purge on the given container", async () => {
    const container = {} as HTMLElement;
    await disposeLazyPlotlyPane(container);
    expect(purge).toHaveBeenCalledTimes(1);
    expect(purge).toHaveBeenCalledWith(container);
  });
});
