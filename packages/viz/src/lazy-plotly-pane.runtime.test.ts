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

/**
 * P0.118. Both entry points `await` the dynamic import before touching Plotly,
 * which opens a window in which a caller can be torn down between the request
 * to mount and the mount itself. Two things must hold across that window, and
 * neither held before: a mount abandoned by its caller must not happen at all,
 * and a teardown must never overtake the mount it is meant to undo.
 *
 * The failure both prevent is the same one: a `responsive: true` plot left
 * attached to a container nothing owns any more. Plotly's resize/auto-margin
 * handlers keep that graph reachable, and they later dereference a graph
 * object the route change has already dismantled.
 */
describe("mount/teardown races on one container", () => {
  const SPEC = {
    traces: [{ name: "a", x: [1, 2], y: [3, 4] }],
    xAxis: { title: "x" },
    yAxis: { title: "y" },
  };

  it("does not mount when shouldMount reports the caller has gone", async () => {
    const container = {} as HTMLElement;

    await renderLazyPlotlyPane(container, SPEC, { shouldMount: () => false });

    expect(newPlot).not.toHaveBeenCalled();
  });

  it("mounts when shouldMount reports the caller is still there", async () => {
    const container = {} as HTMLElement;

    await renderLazyPlotlyPane(container, SPEC, { shouldMount: () => true });

    expect(newPlot).toHaveBeenCalledTimes(1);
  });

  it("consults shouldMount after the import resolves, not before", async () => {
    const container = {} as HTMLElement;
    // Latches at the moment of the call, which is the whole question: asking
    // before the await would read a caller that is still alive and mount into
    // one that is not by the time newPlot runs.
    let importResolved = false;
    void loadPlotlyModule().then(() => {
      importResolved = true;
    });

    let observed: boolean | undefined;
    await renderLazyPlotlyPane(container, SPEC, {
      shouldMount: () => {
        observed = importResolved;
        return true;
      },
    });

    expect(observed).toBe(true);
  });

  it("purges after an in-flight mount completes, never in the middle of one", async () => {
    const container = {} as HTMLElement;
    const order: string[] = [];
    let releaseNewPlot!: () => void;
    // Resolves the moment newPlot is entered, so the teardown below is
    // requested at a point the test knows is mid-mount rather than after a
    // guessed number of microtask ticks.
    let signalEntered!: () => void;
    const entered = new Promise<void>((resolve) => (signalEntered = resolve));
    newPlot.mockImplementationOnce(() => {
      signalEntered();
      return new Promise<void>((resolve) => {
        releaseNewPlot = () => {
          order.push("newPlot settled");
          resolve();
        };
      });
    });
    purge.mockImplementationOnce(() => {
      order.push("purge");
    });

    const mounted = renderLazyPlotlyPane(container, SPEC);
    // This is the interleaving that used to strand a plot: teardown asked for
    // while the mount is past its import and inside newPlot.
    await entered;
    const disposed = disposeLazyPlotlyPane(container);

    // Give the teardown every chance to overtake the mount before releasing
    // it. Without this the test passes whether or not the operations are
    // serialised, because purge never gets a turn to run early -- which is
    // exactly the false pass a queue-removing mutation slipped through.
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseNewPlot();
    await Promise.all([mounted, disposed]);

    expect(order).toEqual(["newPlot settled", "purge"]);
  });

  it("keeps a failed mount from stalling the teardown queued behind it", async () => {
    const container = {} as HTMLElement;
    newPlot.mockRejectedValueOnce(new Error("plotly blew up"));

    await expect(renderLazyPlotlyPane(container, SPEC)).rejects.toThrow("plotly blew up");
    await disposeLazyPlotlyPane(container);

    expect(purge).toHaveBeenCalledTimes(1);
  });

  it("serialises operations per container, so a second container is not held up by the first", async () => {
    const slow = {} as HTMLElement;
    const other = {} as HTMLElement;
    let releaseSlow!: () => void;
    newPlot.mockImplementationOnce(() => new Promise<void>((resolve) => (releaseSlow = resolve)));

    const slowMount = renderLazyPlotlyPane(slow, SPEC);
    await renderLazyPlotlyPane(other, SPEC);

    // The second container mounted while the first was still blocked: the
    // queue is per container, not a single global lock on the module.
    expect(newPlot).toHaveBeenCalledTimes(2);
    releaseSlow();
    await slowMount;
  });
});
