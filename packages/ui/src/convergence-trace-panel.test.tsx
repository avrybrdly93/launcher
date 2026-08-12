// @vitest-environment jsdom
/**
 * The live half of P5.18's validation criterion — "UI shows live convergence
 * trace; cancel works" — under a real render cycle, since the panel is
 * hook-based (see `solver-lab-route.test.tsx` for the same jsdom-mount
 * pattern).
 *
 * The runner is a controllable fake rather than a real pool, so a test can
 * hold the solve open between two iterations and assert what the DOM shows
 * *at that moment*. That is the only way to distinguish a trace that fills in
 * live from one that appears all at once when the promise resolves — which is
 * exactly the distinction the criterion is about, and which a fake that
 * resolved immediately could not see.
 */
import { render, type ComponentChildren } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PRESET_SCENARIOS, type ScenarioSpec } from "@ballista/engine";
import type { OptimizeIteration, OptimizeJob, OptimizeJobResult } from "@ballista/runtime";
import type { PlotlyFigureSpec } from "@ballista/viz";

/**
 * Only the lazy-load boundary is faked, and only because jsdom cannot host
 * Plotly: mounting the real pane pulls `plotly.js-dist-min` into jsdom, which
 * throws on the browser APIs it expects and floods the run with unhandled
 * errors. `buildNewtonTraceFigure` is deliberately *not* mocked -- it is the
 * thing under test here, so the spec these tests read is the real one the app
 * would draw.
 */
const renderLazyPlotlyPane = vi.fn(async (_container: HTMLElement, _spec: PlotlyFigureSpec) => {});
const disposeLazyPlotlyPane = vi.fn(async (_container: HTMLElement) => {});
vi.mock("@ballista/viz", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ballista/viz")>()),
  renderLazyPlotlyPane,
  disposeLazyPlotlyPane,
}));

const { ConvergenceTracePanel } = await import("./convergence-trace-panel.js");
type OptimizeRunner = import("./convergence-trace-panel.js").OptimizeRunner;

const DRAG_FREE = PRESET_SCENARIOS.find((s) => s.model.forceIds.length === 1)!;
const BASE: ScenarioSpec = {
  ...DRAG_FREE,
  initialConditions: { ...DRAG_FREE.initialConditions, x0: 0, y0: 0 },
};
const JOB: OptimizeJob = {
  baseScenario: BASE,
  target: { kind: "point", center: [1200, 0] },
  initialAim: { theta: 0.5, speed: 130 },
};

const RESULT: OptimizeJobResult = {
  converged: true,
  status: "converged",
  aim: { theta: 0.63, speed: 104.9 },
  merit: 4e-13,
  iterations: 3,
  evaluations: 12,
};

function iteration(index: number, nextMerit: number): OptimizeIteration {
  return {
    step: {
      iteration: index,
      merit: nextMerit * 10,
      rank: 1,
      singularValues: [12, 3e-12],
      alpha: 1,
      backtracks: 0,
      stepNorm: 0.01,
      predictedReduction: nextMerit * 9,
      nextMerit,
    },
    aim: { theta: 0.5 + index * 0.01, speed: 130 - index },
  };
}

/**
 * A runner the test drives by hand: `emit` pushes one iteration into the
 * panel, `finish` resolves, and `aborted` reports whether the signal fired.
 */
function createControllableRunner(): {
  runner: OptimizeRunner;
  emit: (iteration: OptimizeIteration) => void;
  finish: (result?: OptimizeJobResult) => void;
  fail: (error: Error) => void;
  aborted: () => boolean;
  started: () => boolean;
} {
  let onIteration: ((iteration: OptimizeIteration) => void) | undefined;
  let resolve: ((result: OptimizeJobResult) => void) | undefined;
  let reject: ((error: unknown) => void) | undefined;
  let signal: AbortSignal | undefined;
  let started = false;

  const runner: OptimizeRunner = (_job, options) => {
    started = true;
    onIteration = options.onIteration;
    signal = options.signal;
    return new Promise<OptimizeJobResult>((res, rej) => {
      resolve = res;
      reject = rej;
      // A real pool rejects when its signal aborts; the fake must too, or the
      // panel's cancel path would never be exercised.
      signal?.addEventListener("abort", () => rej(new Error("cancelled")));
    });
  };

  return {
    runner,
    emit: (it) => onIteration?.(it),
    finish: (result = RESULT) => resolve?.(result),
    fail: (error) => reject?.(error),
    aborted: () => signal?.aborted ?? false,
    started: () => started,
  };
}

let container: HTMLDivElement | undefined;

function mount(children: ComponentChildren): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  render(children, container);
  return container;
}

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
    container = undefined;
  }
});

/** Lets Preact flush the state updates queued by a dispatch. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function rows(root: HTMLElement): NodeListOf<Element> {
  return root.querySelectorAll('[data-testid^="convergence-trace-row-"]');
}

function click(root: HTMLElement, testid: string): void {
  root.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`)!.click();
}

function status(root: HTMLElement): HTMLElement {
  return root.querySelector<HTMLElement>('[data-testid="convergence-trace-status"]')!;
}

describe("ConvergenceTracePanel: the trace fills in live", () => {
  it("shows nothing until a solve starts, then a row per iteration as each arrives", async () => {
    const control = createControllableRunner();
    const root = mount(<ConvergenceTracePanel job={JOB} runOptimize={control.runner} />);

    expect(rows(root)).toHaveLength(0);
    expect(status(root).dataset["status"]).toBe("idle");

    click(root, "convergence-trace-solve");
    await flush();
    expect(control.started()).toBe(true);
    expect(status(root).dataset["status"]).toBe("running");

    // The point of the whole task: each of these assertions runs while the
    // solve is still in flight, so the rows are being painted mid-solve and
    // not on completion.
    control.emit(iteration(0, 50));
    await flush();
    expect(rows(root)).toHaveLength(1);

    control.emit(iteration(1, 2));
    await flush();
    expect(rows(root)).toHaveLength(2);
    expect(status(root).textContent).toContain("2 iterations");

    control.emit(iteration(2, 4e-13));
    await flush();
    expect(rows(root)).toHaveLength(3);

    // Still running — the promise has not resolved.
    expect(status(root).dataset["status"]).toBe("running");

    control.finish();
    await flush();
    expect(status(root).dataset["status"]).toBe("settled");
    expect(status(root).textContent).toContain("Converged in 3 iterations");
  });

  it("renders each row's merit in exponential form, so the converged tail is legible", async () => {
    const control = createControllableRunner();
    const root = mount(<ConvergenceTracePanel job={JOB} runOptimize={control.runner} />);

    click(root, "convergence-trace-solve");
    await flush();
    control.emit(iteration(0, 4.2e-13));
    await flush();

    const row = root.querySelector('[data-testid="convergence-trace-row-0"]')!;
    expect(row.textContent).toContain("4.200e-13");
  });
});

describe("ConvergenceTracePanel: cancel works", () => {
  it("Cancel is disabled until a solve is running, and enabled while it is", async () => {
    const control = createControllableRunner();
    const root = mount(<ConvergenceTracePanel job={JOB} runOptimize={control.runner} />);

    const cancel = root.querySelector<HTMLButtonElement>(
      '[data-testid="convergence-trace-cancel"]',
    )!;
    expect(cancel.disabled).toBe(true);

    click(root, "convergence-trace-solve");
    await flush();
    expect(cancel.disabled).toBe(false);
  });

  it("clicking Cancel aborts the signal, stops the trace, and keeps the rows already shown", async () => {
    const control = createControllableRunner();
    const root = mount(<ConvergenceTracePanel job={JOB} runOptimize={control.runner} />);

    click(root, "convergence-trace-solve");
    await flush();
    control.emit(iteration(0, 50));
    control.emit(iteration(1, 2));
    await flush();
    expect(rows(root)).toHaveLength(2);

    click(root, "convergence-trace-cancel");
    await flush();

    expect(control.aborted()).toBe(true);
    expect(status(root).dataset["status"]).toBe("cancelled");
    expect(status(root).textContent).toContain("Cancelled after 2 iterations");
    expect(rows(root)).toHaveLength(2);

    // Messages already in flight when the user clicked must not extend the
    // trace afterwards.
    control.emit(iteration(2, 1e-9));
    await flush();
    expect(rows(root)).toHaveLength(2);
  });

  it("a cancelled run reports as cancelled, not as a failure", async () => {
    const control = createControllableRunner();
    const root = mount(<ConvergenceTracePanel job={JOB} runOptimize={control.runner} />);

    click(root, "convergence-trace-solve");
    await flush();
    click(root, "convergence-trace-cancel");
    await flush();

    expect(status(root).dataset["status"]).toBe("cancelled");
    expect(status(root).textContent).not.toContain("Failed");
  });

  it("a genuine rejection is reported as a failure", async () => {
    const control = createControllableRunner();
    const root = mount(<ConvergenceTracePanel job={JOB} runOptimize={control.runner} />);

    click(root, "convergence-trace-solve");
    await flush();
    control.fail(new Error("worker exploded"));
    await flush();

    expect(status(root).dataset["status"]).toBe("failed");
    expect(status(root).textContent).toContain("worker exploded");
  });

  it("after a cancel the panel can solve again, starting from an empty trace", async () => {
    const control = createControllableRunner();
    const root = mount(<ConvergenceTracePanel job={JOB} runOptimize={control.runner} />);

    click(root, "convergence-trace-solve");
    await flush();
    control.emit(iteration(0, 50));
    await flush();
    click(root, "convergence-trace-cancel");
    await flush();
    expect(rows(root)).toHaveLength(1);

    click(root, "convergence-trace-solve");
    await flush();
    expect(rows(root)).toHaveLength(0);
    expect(status(root).dataset["status"]).toBe("running");
  });

  it("unmounting mid-solve aborts it, so a worker is not left integrating for nobody", async () => {
    const control = createControllableRunner();
    mount(<ConvergenceTracePanel job={JOB} runOptimize={control.runner} />);

    click(container!, "convergence-trace-solve");
    await flush();
    expect(control.aborted()).toBe(false);

    render(null, container!);
    await flush();
    expect(control.aborted()).toBe(true);
  });

  it("Solve is disabled while a solve is running, so two cannot overlap", async () => {
    const control = createControllableRunner();
    const runner = vi.fn(control.runner);
    const root = mount(<ConvergenceTracePanel job={JOB} runOptimize={runner} />);

    const solve = root.querySelector<HTMLButtonElement>('[data-testid="convergence-trace-solve"]')!;
    click(root, "convergence-trace-solve");
    await flush();

    expect(solve.disabled).toBe(true);
    solve.click();
    await flush();
    expect(runner).toHaveBeenCalledTimes(1);
  });
});

describe("the log‖F‖ vs iteration plot (P5.19)", () => {
  it("draws nothing before there are two points to draw a line through", async () => {
    const { runner, started } = createControllableRunner();
    const root = mount(<ConvergenceTracePanel job={JOB} runOptimize={runner} />);

    root.querySelector<HTMLButtonElement>('[data-testid="convergence-trace-solve"]')!.click();
    await flush();

    expect(started()).toBe(true);
    // Running, but no iteration has arrived: an empty axis box reads as a
    // broken plot, so there is deliberately no pane yet.
    expect(root.querySelector('[data-testid="convergence-trace-plot"]')).toBeNull();
  });

  it("appears as soon as the first iteration lands, since a step gives two residuals", async () => {
    const { runner, emit } = createControllableRunner();
    const root = mount(<ConvergenceTracePanel job={JOB} runOptimize={runner} />);

    root.querySelector<HTMLButtonElement>('[data-testid="convergence-trace-solve"]')!.click();
    await flush();
    emit(iteration(0, 3.042));
    await flush();

    expect(root.querySelector('[data-testid="convergence-trace-plot"]')).not.toBeNull();
  });

  it("hands the pane the residuals of the solve, on a log axis against linear iteration", async () => {
    const { runner, emit } = createControllableRunner();
    const root = mount(<ConvergenceTracePanel job={JOB} runOptimize={runner} />);

    root.querySelector<HTMLButtonElement>('[data-testid="convergence-trace-solve"]')!.click();
    await flush();
    emit(iteration(0, 3.042));
    emit(iteration(1, 5.472e-3));
    await flush();

    // `iteration(i, m)` builds a step from merit 10m to nextMerit m, so the
    // sequence is 30.42 -> 3.042 -> 5.472e-3 and the last point sits at k = 2.
    const spec = renderLazyPlotlyPane.mock.calls.at(-1)![1];
    expect(spec.xAxis).toEqual({ title: "Newton iteration k" });
    expect(spec.yAxis).toEqual({ title: "‖F‖ (m)", type: "log" });
    expect(spec.traces[0]!.x).toEqual([0, 1, 2]);
    // Elementwise, because `merit` is computed as `10 * nextMerit` and
    // `10 * 3.042` is not exactly 30.42 in binary.
    const y = spec.traces[0]!.y;
    expect(y).toHaveLength(3);
    expect(y[0]!).toBeCloseTo(30.42, 10);
    expect(y[1]!).toBeCloseTo(3.042, 10);
    expect(y[2]!).toBeCloseTo(5.472e-3, 10);
  });

  it("says the slope ratio needs three residuals rather than printing one it cannot compute", async () => {
    const { runner, emit } = createControllableRunner();
    const root = mount(<ConvergenceTracePanel job={JOB} runOptimize={runner} />);

    root.querySelector<HTMLButtonElement>('[data-testid="convergence-trace-solve"]')!.click();
    await flush();
    emit(iteration(0, 3.042));
    await flush();

    expect(
      root.querySelector('[data-testid="convergence-trace-slope-ratio"]')!.textContent,
    ).toContain("needs 3 residuals");
  });

  it("reports the measured ratio once three residuals exist", async () => {
    const { runner, emit } = createControllableRunner();
    const root = mount(<ConvergenceTracePanel job={JOB} runOptimize={runner} />);

    root.querySelector<HTMLButtonElement>('[data-testid="convergence-trace-solve"]')!.click();
    await flush();
    // Each step drops the residual by exactly one decade, so the two slopes are
    // equal and their ratio is 1 -- linear convergence, told apart from the 2
    // the quadratic tail of a real solve gives.
    emit(iteration(0, 1e-1));
    emit(iteration(1, 1e-2));
    await flush();

    expect(root.querySelector('[data-testid="convergence-trace-slope-ratio"]')!.textContent).toBe(
      "slope ratio (last 3): 1.00 — 2.00 is quadratic",
    );
  });

  it("keeps the plot after a cancel, showing what the solve reached before it stopped", async () => {
    const { runner, emit } = createControllableRunner();
    const root = mount(<ConvergenceTracePanel job={JOB} runOptimize={runner} />);

    root.querySelector<HTMLButtonElement>('[data-testid="convergence-trace-solve"]')!.click();
    await flush();
    emit(iteration(0, 3.042));
    await flush();
    root.querySelector<HTMLButtonElement>('[data-testid="convergence-trace-cancel"]')!.click();
    await flush();

    expect(root.querySelector('[data-testid="convergence-trace-plot"]')).not.toBeNull();
  });
});
