// @vitest-environment jsdom
/**
 * InverseSolverRoute mount test (P5.18). jsdom has no `Worker`, so the
 * factory is stubbed with an in-process fake that runs the real
 * `postOptimizeResult` — the same shared definition a real
 * `optimize-worker-entry.ts` calls — one message per macrotask. That makes
 * this an end-to-end check of the actual wiring (route → pool → job →
 * streamed iterations → panel → DOM) with only the thread faked, rather than
 * a check that the component renders.
 */
import { render, type ComponentChildren } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postOptimizeResult, type OptimizeRequest, type WorkerLike } from "@ballista/runtime";

const terminations: Array<() => boolean> = [];

vi.mock("./optimize-worker-factory.js", () => ({
  createOptimizeWorker: (): WorkerLike => {
    let terminated = false;
    terminations.push(() => terminated);
    const worker: WorkerLike = {
      postMessage(message) {
        const queue: unknown[] = [];
        postOptimizeResult((out) => queue.push(out), message as OptimizeRequest);
        const drain = (index: number): void => {
          if (terminated || index >= queue.length) return;
          setTimeout(() => {
            if (terminated) return;
            worker.onmessage?.({ data: queue[index] });
            drain(index + 1);
          }, 0);
        };
        drain(0);
      },
      terminate() {
        terminated = true;
      },
      onmessage: null,
      onerror: null,
    };
    return worker;
  },
}));

const { INVERSE_SOLVER_ROUTE_MODULE } = {
  INVERSE_SOLVER_ROUTE_MODULE: "./inverse-solver-route.js",
};
const { InverseSolverRoute, INVERSE_SOLVER_JOB } = await import(INVERSE_SOLVER_ROUTE_MODULE);

let container: HTMLDivElement | undefined;

function mount(children: ComponentChildren): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  render(children, container);
  return container;
}

beforeEach(() => {
  terminations.length = 0;
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
    container = undefined;
  }
});

/** Waits until `predicate` holds or the attempt budget runs out. */
async function until(predicate: () => boolean, attempts = 200): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

function rows(root: HTMLElement): number {
  return root.querySelectorAll('[data-testid^="convergence-trace-row-"]').length;
}

describe("InverseSolverRoute (P5.18)", () => {
  it("mounts with an idle trace and a back link", () => {
    const root = mount(<InverseSolverRoute />);
    expect(root.querySelector('[data-testid="inverse-solver-route"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="inverse-solver-back-link"]')).not.toBeNull();
    expect(
      root.querySelector<HTMLElement>('[data-testid="convergence-trace-status"]')!.dataset[
        "status"
      ],
    ).toBe("idle");
    expect(rows(root)).toBe(0);
  });

  it("solving fills the trace from a real streamed solve and reports convergence", async () => {
    const root = mount(<InverseSolverRoute />);
    root.querySelector<HTMLButtonElement>('[data-testid="convergence-trace-solve"]')!.click();

    const statusEl = (): HTMLElement =>
      root.querySelector<HTMLElement>('[data-testid="convergence-trace-status"]')!;
    await until(() => statusEl().dataset["status"] === "settled");

    expect(statusEl().dataset["status"]).toBe("settled");
    expect(statusEl().textContent).toContain("Converged");
    // Every iteration the solver took is a row -- the trace is the solve, not
    // a summary of it.
    expect(rows(root)).toBeGreaterThan(1);
  });

  it("the exhibit's job is a reachable target, so the route has something to converge to", () => {
    expect(INVERSE_SOLVER_JOB.target).toEqual({ kind: "point", center: [1200, 0] });
    expect(INVERSE_SOLVER_JOB.baseScenario.initialConditions.x0).toBe(0);
    expect(INVERSE_SOLVER_JOB.baseScenario.initialConditions.y0).toBe(0);
  });

  it("navigating away mid-solve terminates the pool's worker rather than leaking a thread", async () => {
    const root = mount(<InverseSolverRoute />);
    expect(terminations).toHaveLength(1);
    expect(terminations[0]!()).toBe(false);

    // Start a solve and wait for the trace to move. Two reasons: it is the
    // case the teardown exists for -- a user leaving while a worker is still
    // integrating -- and Preact defers effects until a commit, so an unmount
    // that raced the very first render would find no cleanup registered yet
    // and would prove nothing.
    root.querySelector<HTMLButtonElement>('[data-testid="convergence-trace-solve"]')!.click();
    await until(() => rows(root) > 0);
    expect(rows(root)).toBeGreaterThan(0);

    render(null, container!);
    await until(() => terminations[0]!());
    expect(terminations[0]!()).toBe(true);
  });
});
