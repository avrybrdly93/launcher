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
import { ConvergenceTracePanel, type OptimizeRunner } from "./convergence-trace-panel.js";

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
