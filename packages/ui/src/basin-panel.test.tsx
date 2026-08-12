// @vitest-environment jsdom
/**
 * The "two-arc basins render" half of P5.20's criterion, under a real render
 * cycle — the analysis package proves the basins exist, this proves they reach
 * the screen.
 *
 * The sweep runner is a controllable fake rather than a real pool, for the same
 * reason `convergence-trace-panel.test.tsx` fakes its optimize runner: a test
 * can hold the sweep open and assert what the DOM shows *at that moment*,
 * which is the only way to check that Cancel is live exactly while a sweep is.
 */
import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BasinGrid, BasinOutcome } from "@ballista/analysis";
import type { PlotlyFigureSpec } from "@ballista/viz";

/**
 * Only the lazy-load boundary is faked, and only because jsdom cannot host
 * Plotly. `buildBasinFigure` is deliberately *not* mocked — the spec these
 * tests read is the real one the app would draw.
 */
const renderLazyPlotlyPane = vi.fn(async (_container: HTMLElement, _spec: PlotlyFigureSpec) => {});
const disposeLazyPlotlyPane = vi.fn(async (_container: HTMLElement) => {});
vi.mock("@ballista/viz", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ballista/viz")>()),
  renderLazyPlotlyPane,
  disposeLazyPlotlyPane,
}));

const { BasinPanel } = await import("./basin-panel.js");
type BasinSweepRunner = import("./basin-panel.js").BasinSweepRunner;

const GLYPHS: Record<string, BasinOutcome> = {
  L: "low",
  H: "high",
  ".": "unconverged",
  x: "failed",
};

function gridOf(...rows: readonly string[]): BasinGrid {
  const outcomes = rows.map((row) => [...row].map((glyph) => GLYPHS[glyph]!));
  return {
    thetas: outcomes[0]!.map((_, index) => index / 10),
    speeds: outcomes.map((_, index) => 50 + index),
    outcomes,
    cells: outcomes.flatMap((row, rowIndex) =>
      row.map((outcome, column) => ({
        column,
        row: rowIndex,
        start: { theta: column / 10, speed: 50 + rowIndex },
        outcome,
        solution: null,
        downrangeMiss: null,
        rangeSlope: null,
        iterations: 0,
      })),
    ),
    evaluations: 900,
  };
}

let host: HTMLDivElement | undefined;

function mount(runSweep: BasinSweepRunner): HTMLDivElement {
  host = document.createElement("div");
  document.body.append(host);
  render(<BasinPanel runSweep={runSweep} />, host);
  return host;
}

afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
    host = undefined;
  }
  vi.clearAllMocks();
});

function query(root: HTMLElement, id: string): HTMLElement | null {
  return root.querySelector(`[data-testid="${id}"]`);
}

/** A sweep whose resolution the test controls. */
function deferredSweep(): {
  runner: BasinSweepRunner;
  resolve: (grid: BasinGrid) => void;
  reject: (error: unknown) => void;
  aborted: () => boolean;
} {
  let resolve!: (grid: BasinGrid) => void;
  let reject!: (error: unknown) => void;
  let signal: AbortSignal | undefined;
  const runner: BasinSweepRunner = (options) => {
    signal = options.signal;
    return new Promise<BasinGrid>((res, rej) => {
      resolve = res;
      reject = rej;
      options.signal?.addEventListener("abort", () => rej(new Error("aborted")));
    });
  };
  // Forwarded through arrows rather than returned directly: `resolve` and
  // `reject` are only assigned when the runner is first called, which is after
  // this object is built.
  return {
    runner,
    resolve: (grid: BasinGrid) => resolve(grid),
    reject: (error: unknown) => reject(error),
    aborted: () => signal?.aborted ?? false,
  };
}

/** Lets queued microtasks (the await chain inside `sweep`) run. */
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe("BasinPanel (P5.20)", () => {
  it("shows no map before the first sweep", () => {
    const root = mount(async () => gridOf("LH"));

    expect(query(root, "basin-map")).toBeNull();
    expect(query(root, "basin-status")!.textContent).toBe("Not swept yet.");
    expect((query(root, "basin-cancel") as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders the map once a sweep lands, with both basins counted in the legend", async () => {
    const root = mount(async () => gridOf("LLHH", "LLHH"));

    (query(root, "basin-sweep") as HTMLButtonElement).click();
    await flush();

    expect(query(root, "basin-map")).not.toBeNull();
    expect(query(root, "basin-legend-low")!.textContent).toContain("4");
    expect(query(root, "basin-legend-high")!.textContent).toContain("4");
    expect(query(root, "basin-status")!.textContent).toContain("4 low, 4 high");
  });

  it("hands the real figure spec to the pane, axes on the initial guess", async () => {
    const root = mount(async () => gridOf("LH"));

    (query(root, "basin-sweep") as HTMLButtonElement).click();
    await flush();

    expect(renderLazyPlotlyPane).toHaveBeenCalled();
    const spec = renderLazyPlotlyPane.mock.calls.at(-1)![1];
    expect(spec.xAxis.title).toContain("initial");
    expect(spec.yAxis.title).toContain("initial");
    expect(spec.traces[0]!.kind).toBe("heatmap");
  });

  it("reports the boundary measurement under the map", async () => {
    const root = mount(async () => gridOf("LLHH", "LLHH", "LLHH", "LLHH"));

    (query(root, "basin-sweep") as HTMLButtonElement).click();
    await flush();

    expect(query(root, "basin-boundary")!.textContent).toBe(
      "boundary: 2.00 cells per row (2.00 is a single smooth curve)",
    );
  });

  it("enables Cancel only while a sweep is in flight", async () => {
    const { runner, resolve } = deferredSweep();
    const root = mount(runner);

    (query(root, "basin-sweep") as HTMLButtonElement).click();
    await flush();

    expect((query(root, "basin-cancel") as HTMLButtonElement).disabled).toBe(false);
    expect((query(root, "basin-sweep") as HTMLButtonElement).disabled).toBe(true);
    expect(query(root, "basin-status")!.textContent).toBe("Sweeping…");

    resolve(gridOf("LH"));
    await flush();

    expect((query(root, "basin-cancel") as HTMLButtonElement).disabled).toBe(true);
    expect((query(root, "basin-sweep") as HTMLButtonElement).disabled).toBe(false);
  });

  it("cancels the sweep and says so, without blanking a map already on screen", async () => {
    let call = 0;
    const first = gridOf("LLHH");
    let rejectSecond!: (error: unknown) => void;
    const runner: BasinSweepRunner = (options) => {
      call += 1;
      if (call === 1) return Promise.resolve(first);
      return new Promise<BasinGrid>((_res, rej) => {
        rejectSecond = rej;
        options.signal?.addEventListener("abort", () => rej(new Error("aborted")));
      });
    };
    const root = mount(runner);

    (query(root, "basin-sweep") as HTMLButtonElement).click();
    await flush();
    expect(query(root, "basin-legend-low")!.textContent).toContain("2");

    (query(root, "basin-sweep") as HTMLButtonElement).click();
    await flush();
    (query(root, "basin-cancel") as HTMLButtonElement).click();
    await flush();
    // Silences the unused-binding lint without changing what the test drives.
    expect(typeof rejectSecond).toBe("function");

    expect(query(root, "basin-status")!.textContent).toBe("Cancelled. Showing the previous sweep.");
    // The first sweep's map is still a true map of the grid it was swept on.
    expect(query(root, "basin-map")).not.toBeNull();
    expect(query(root, "basin-legend-low")!.textContent).toContain("2");
  });

  it("reports a thrown sweep as a failure rather than as a cancel", async () => {
    const root = mount(async () => {
      throw new Error("worker died");
    });

    (query(root, "basin-sweep") as HTMLButtonElement).click();
    await flush();

    expect(query(root, "basin-status")!.textContent).toBe("Failed: worker died");
    expect(query(root, "basin-status")!.dataset.status).toBe("failed");
  });

  it("aborts an in-flight sweep on unmount, so its workers stop", async () => {
    const { runner, aborted } = deferredSweep();
    const root = mount(runner);

    (query(root, "basin-sweep") as HTMLButtonElement).click();
    await flush();
    expect(aborted()).toBe(false);

    render(null, root);
    root.remove();
    host = undefined;

    expect(aborted()).toBe(true);
  });
});
