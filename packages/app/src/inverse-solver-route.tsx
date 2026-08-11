/**
 * Inverse-solver route (P5.18): runs a Newton shooting solve in a worker and
 * shows its convergence trace filling in live, with a working Cancel.
 *
 * **The pool is created once for the route and torn down with it.** A worker
 * is a thread; spawning one per solve would pay the module-graph load on
 * every click, and leaking one per mount would accumulate them across
 * navigations. `size: 1` because an optimize job is sequential — see
 * `WorkerPool.runOptimize` for why there is nothing to fan out.
 *
 * The panel takes `runOptimize` as a prop rather than reaching for a pool
 * itself, so the trace behaviour is testable without a real Worker; this
 * route is the edge that supplies the real one. The trace *plot* is P5.19,
 * which will read the same streamed data this route already receives.
 */

import { createWorkerPool, type OptimizeJob } from "@ballista/runtime";
import { PRESET_SCENARIOS, type ScenarioSpec } from "@ballista/engine";
import { ConvergenceTracePanel } from "@ballista/ui";
import { useEffect, useMemo } from "preact/hooks";
import { createOptimizeWorker } from "./optimize-worker-factory.js";
import "./solver-lab-route.css";

/**
 * A drag-free shot at a ground target 1200 m downrange, launched from the
 * origin. Fixed rather than picked, exactly as the energy-drift route's
 * exhibit is: P5.21 is the task that makes the target draggable, and P5.22
 * the one that makes the unknowns selectable.
 */
const DRAG_FREE = PRESET_SCENARIOS.find((s) => s.model.forceIds.length === 1)!;

export const INVERSE_SOLVER_JOB: OptimizeJob = {
  baseScenario: {
    ...DRAG_FREE,
    initialConditions: { ...DRAG_FREE.initialConditions, x0: 0, y0: 0 },
  } satisfies ScenarioSpec,
  target: { kind: "point", center: [1200, 0] },
  initialAim: { theta: 0.5, speed: 130 },
};

export function InverseSolverRoute() {
  const pool = useMemo(() => createWorkerPool({ createWorker: createOptimizeWorker, size: 1 }), []);
  useEffect(() => () => pool.terminate(), [pool]);

  return (
    <div class="solver-lab-route" data-testid="inverse-solver-route">
      <a href="#/" class="solver-lab-route-back" data-testid="inverse-solver-back-link">
        &larr; Back to simulator
      </a>
      <h1>Inverse solver</h1>
      <p>
        Newton shooting drives the miss distance <code>‖F‖</code> to zero by varying the launch
        angle and speed. The solve runs in a worker and reports each iteration as it happens, so the
        trace below fills in while it works rather than appearing at the end.
      </p>
      <ConvergenceTracePanel job={INVERSE_SOLVER_JOB} runOptimize={pool.runOptimize} />
    </div>
  );
}
