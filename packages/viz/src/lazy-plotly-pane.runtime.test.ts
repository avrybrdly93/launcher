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
  newPlot.mockReset();
  newPlot.mockResolvedValue(undefined);
  purge.mockReset();
});

/** A minimal valid figure; the ordering cases below care about lifecycle, not content. */
const SPEC = {
  traces: [{ name: "a", x: [1, 2], y: [3, 4] }],
  xAxis: { title: "x" },
  yAxis: { title: "y" },
} as const;

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
  it("purges a container that was rendered", async () => {
    const container = {} as HTMLElement;
    await renderLazyPlotlyPane(container, SPEC);
    await disposeLazyPlotlyPane(container);
    expect(purge).toHaveBeenCalledTimes(1);
    expect(purge).toHaveBeenCalledWith(container);
  });

  /**
   * This case previously asserted the opposite — that disposing an
   * unrendered container "loads Plotly then calls purge". That assertion
   * encoded the defect rather than a requirement: nothing was mounted, so
   * there was nothing to purge, and calling `loadPlotlyModule()` to find
   * that out *initiates* the ~4.8 MB dynamic import the whole module exists
   * to defer. Rewritten rather than deleted, because the container's
   * behaviour on dispose is still worth pinning — just to the contract it
   * should have had. See P0.118.
   */
  it("does nothing, and does not load Plotly, for a container that was never rendered", async () => {
    const container = {} as HTMLElement;
    await disposeLazyPlotlyPane(container);
    expect(purge).not.toHaveBeenCalled();
    expect(newPlot).not.toHaveBeenCalled();
  });
});

/**
 * The P0.118 ordering guarantees. Each of these fails on the pre-P0.118
 * implementation, where `render` and `dispose` were two independent
 * unawaited async calls with no knowledge of each other.
 *
 * `newPlot` is made to resolve on a promise this file controls, so the
 * "dispose arrives while a render is in flight" window — which is a
 * scheduling accident in production and the entire mechanism of P0.118 — is
 * reproduced deterministically rather than waited for.
 */
describe("renderLazyPlotlyPane / disposeLazyPlotlyPane ordering (P0.118)", () => {
  it("does not mount at all when a dispose arrives before newPlot is reached", async () => {
    // No stalled mock is needed to open this window: `renderLazyPlotlyPane`
    // returns as soon as its operation suspends on `await loadPlotlyModule()`,
    // so a dispose issued on the next line lands strictly between the render
    // being asked for and Plotly being touched. That is the real ordering a
    // route change produces, not a contrived one.
    const container = {} as HTMLElement;

    // A first render so the container has a lifecycle and something to purge.
    await renderLazyPlotlyPane(container, SPEC);
    newPlot.mockClear();
    purge.mockClear();

    const pending = renderLazyPlotlyPane(container, SPEC);
    const disposed = disposeLazyPlotlyPane(container);
    await Promise.all([pending, disposed]);

    // The superseded render never reached newPlot...
    expect(newPlot).not.toHaveBeenCalled();
    // ...and the purge still ran, because the first render did mount.
    expect(purge).toHaveBeenCalledTimes(1);
  });

  it("never purges while a newPlot is still in flight", async () => {
    const container = {} as HTMLElement;
    const events: string[] = [];
    let releaseNewPlot!: () => void;

    newPlot.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          events.push("newPlot:start");
          releaseNewPlot = () => {
            events.push("newPlot:end");
            resolve();
          };
        }),
    );
    purge.mockImplementationOnce(() => {
      events.push("purge");
    });

    const rendering = renderLazyPlotlyPane(container, SPEC);
    // Let the render get as far as its newPlot call before disposing.
    await vi.waitFor(() => expect(events).toContain("newPlot:start"));
    const disposing = disposeLazyPlotlyPane(container);

    // Drain the microtask queue *before* releasing newPlot, so a dispose that
    // does not wait its turn gets a real opportunity to purge early. Without
    // this the assertion has no teeth: `disposeLazyPlotlyPane` suspends on its
    // first await and returns, so a synchronous `releaseNewPlot()` on the next
    // line would beat even the unsequenced implementation to the queue and the
    // test would pass against the very defect it exists to catch. Verified by
    // reverting the module: with this line the case fails, without it it does not.
    await new Promise((resolve) => setTimeout(resolve, 0));

    releaseNewPlot();
    await Promise.all([rendering, disposing]);

    // The interleaving `purge, newPlot:end` is the one that leaves Plotly
    // re-initialising state on a container it has just released, and is what
    // produces the `_redrawFromAutoMarginCount` read on a torn-down graph div.
    expect(events).toEqual(["newPlot:start", "newPlot:end", "purge"]);
  });

  it("re-renders normally after a dispose, so a spec change is not swallowed", async () => {
    // The component's effect cleanup runs *before* the re-run, so every spec
    // change is a dispose immediately followed by a render on the same
    // container. A cancellation scheme that latched would break exactly this.
    const container = {} as HTMLElement;
    await renderLazyPlotlyPane(container, SPEC);
    newPlot.mockClear();

    void disposeLazyPlotlyPane(container);
    await renderLazyPlotlyPane(container, SPEC);

    expect(newPlot).toHaveBeenCalledTimes(1);
    expect(purge).toHaveBeenCalledTimes(1);
  });

  it("keeps two containers independent", async () => {
    const first = {} as HTMLElement;
    const second = {} as HTMLElement;
    await renderLazyPlotlyPane(first, SPEC);
    await renderLazyPlotlyPane(second, SPEC);
    purge.mockClear();

    await disposeLazyPlotlyPane(first);

    expect(purge).toHaveBeenCalledTimes(1);
    expect(purge).toHaveBeenCalledWith(first);
  });

  it("surfaces a render failure to the caller rather than leaving it on the queue", async () => {
    const container = {} as HTMLElement;
    newPlot.mockRejectedValueOnce(new Error("plotly exploded"));

    await expect(renderLazyPlotlyPane(container, SPEC)).rejects.toThrow("plotly exploded");

    // ...and the container is still usable afterwards: a failed operation
    // must not wedge the queue for every later one.
    newPlot.mockResolvedValueOnce(undefined);
    await expect(renderLazyPlotlyPane(container, SPEC)).resolves.toBeUndefined();
  });
});
