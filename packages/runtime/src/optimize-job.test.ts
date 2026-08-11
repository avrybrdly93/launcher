import { describe, expect, it } from "vitest";
import { newtonShooting, type Aim, type Target } from "@ballista/analysis";
import { PRESET_SCENARIOS, type ScenarioSpec } from "@ballista/engine";
import { createOptimizeResidual, runOptimizeJob, type OptimizeJob } from "./optimize-job.js";

const DRAG_FREE = PRESET_SCENARIOS.find((s) => s.model.forceIds.length === 1)!;
const BASE_SCENARIO: ScenarioSpec = {
  ...DRAG_FREE,
  initialConditions: { ...DRAG_FREE.initialConditions, x0: 0, y0: 0 },
};

const GROUND_TARGET: Target = { kind: "point", center: [1200, 0] };

function job(overrides: Partial<OptimizeJob> = {}): OptimizeJob {
  return {
    baseScenario: BASE_SCENARIO,
    target: GROUND_TARGET,
    initialAim: { theta: 0.5, speed: 130 },
    ...overrides,
  };
}

describe("runOptimizeJob", () => {
  it("converges on a reachable ground target and lands on it", () => {
    const result = runOptimizeJob(job());
    expect(result.status).toBe("converged");
    expect(result.converged).toBe(true);
    expect(result.merit).toBeLessThan(1e-6);

    // The answer is checked against the physics, not against the solver's own
    // report: re-evaluate the residual at the returned aim and confirm the
    // impact is on the target.
    const residual = createOptimizeResidual(job())(result.aim);
    expect(residual.ok).toBe(true);
    expect(Math.abs(residual.impact![0]! - 1200)).toBeLessThan(1e-6);
  });

  it("streams one iteration per Newton step, in order, and exactly as many as it reports", () => {
    const seen: number[] = [];
    const result = runOptimizeJob(job(), (iteration) => seen.push(iteration.step.iteration));

    expect(seen.length).toBe(result.iterations);
    expect(seen.length).toBeGreaterThan(1);
    expect(seen).toEqual(seen.map((_, i) => i));
  });

  it("streams each iteration as it happens rather than batching them at the end", () => {
    // If the callbacks were collected and replayed after the solve, every one
    // of them would see the same (final) state. Recording the merit at call
    // time and checking it decreases proves they arrive interleaved with the
    // work.
    const merits: number[] = [];
    runOptimizeJob(job(), (iteration) => merits.push(iteration.step.merit));

    expect(merits.length).toBeGreaterThan(1);
    for (let i = 1; i < merits.length; i++) {
      expect(merits[i]!).toBeLessThan(merits[i - 1]!);
    }
  });

  it("the last streamed aim is the solve's answer, and every streamed aim is a real iterate", () => {
    const iterations: Array<{ theta: number; speed: number; nextMerit: number }> = [];
    const result = runOptimizeJob(job(), (iteration) =>
      iterations.push({
        theta: iteration.aim.theta,
        speed: iteration.aim.speed,
        nextMerit: iteration.step.nextMerit,
      }),
    );

    const last = iterations.at(-1)!;
    expect(last.theta).toBe(result.aim.theta);
    expect(last.speed).toBe(result.aim.speed);

    // Each reported iterate must actually produce the merit the step says it
    // reached -- this is what would fail if the aim tracking latched onto a
    // rejected line-search trial instead of the accepted one.
    const residual = createOptimizeResidual(job());
    for (const entry of iterations) {
      const evaluation = residual({ theta: entry.theta, speed: entry.speed });
      const norm = Math.hypot(...evaluation.residual!);
      expect(norm).toBeCloseTo(entry.nextMerit, 9);
    }
  });

  it("passes its solver options through: a 2-iteration cap stops at 2", () => {
    const result = runOptimizeJob(job({ solver: { maxIterations: 2 } }));
    expect(result.status).toBe("max-iterations");
    expect(result.iterations).toBe(2);
  });

  it("reports the same answer as calling newtonShooting directly", () => {
    const spec = job();
    const direct = newtonShooting(createOptimizeResidual(spec), spec.initialAim);
    const viaJob = runOptimizeJob(spec);

    expect(viaJob.status).toBe(direct.status);
    expect(viaJob.iterations).toBe(direct.iterations);
    expect(viaJob.aim.theta).toBe(direct.aim.theta);
    expect(viaJob.aim.speed).toBe(direct.aim.speed);
    expect(viaJob.merit).toBe(direct.merit);
  });

  it("an unreachable target fails as an outcome, not as a throw", () => {
    // 500 km downrange is far outside a 130 m/s shot's envelope, so the solve
    // cannot converge -- but it must still return a result a UI can render.
    const result = runOptimizeJob(job({ target: { kind: "point", center: [500_000, 0] } }));
    expect(result.converged).toBe(false);
    expect(result.status).not.toBe("converged");
    expect(Number.isFinite(result.merit)).toBe(true);
  });

  it("every streamed value survives a structured clone, which is what crossing a worker boundary means", () => {
    const iterations: unknown[] = [];
    const result = runOptimizeJob(job(), (iteration) => iterations.push(iteration));

    expect(iterations.length).toBeGreaterThan(0);
    for (const iteration of iterations) {
      expect(() => structuredClone(iteration)).not.toThrow();
    }
    expect(() => structuredClone(result)).not.toThrow();
  });

  it("the job itself survives a structured clone, so it can be posted to a worker", () => {
    // The reason OptimizeSolverOptions re-declares NewtonShootingOptions'
    // numeric subset instead of accepting it whole: the real interface carries
    // `projection`, a function, and a function is a DataCloneError.
    const spec: OptimizeJob = job({ solver: { maxIterations: 5, residualTolerance: 1e-8 } });
    expect(() => structuredClone(spec)).not.toThrow();
    const cloned = structuredClone(spec) as OptimizeJob;
    expect(runOptimizeJob(cloned).status).toBe(runOptimizeJob(spec).status);
  });
});

describe("runOptimizeJob: which aim a step reports", () => {
  it("an accepted step below full length still reports the accepted trial", () => {
    // Default options accept α = 1 at every iteration on this problem, so the
    // aim tracking is never asked to distinguish an accepted trial from the
    // full Newton step. A near-1 Armijo constant forces real backtracking:
    // this configuration accepts α = 0.25, 0.25, 0.25, 0.5, 0.5, 1, 1, 1.
    const spec = job({ solver: { armijoC: 0.99, maxBacktracks: 6 } });
    const iterations: Array<{ alpha: number; aim: Aim; nextMerit: number }> = [];
    const result = runOptimizeJob(spec, (it) =>
      iterations.push({ alpha: it.step.alpha, aim: it.aim, nextMerit: it.step.nextMerit }),
    );

    expect(result.status).toBe("converged");
    // Require the backtracking actually happened, or the test proves nothing.
    expect(iterations.some((entry) => entry.alpha > 0 && entry.alpha < 1)).toBe(true);

    const residual = createOptimizeResidual(spec);
    for (const entry of iterations) {
      const norm = Math.hypot(...residual(entry.aim).residual!);
      expect(norm).toBeCloseTo(entry.nextMerit, 9);
    }
    expect(iterations.at(-1)!.aim).toEqual(result.aim);
  });

  it("a step that was not accepted reports the standing iterate, not the rejected trial", () => {
    // Denying the line search any backtracks from a poor initial aim makes it
    // fail outright on iteration 0: the full Newton step overshoots, Armijo
    // rejects it, and the solver records a step with α = 0 without moving.
    const start: Aim = { theta: 1.5, speed: 20 };
    const spec = job({ initialAim: start, solver: { maxBacktracks: 0 } });

    const iterations: Array<{ alpha: number; aim: Aim }> = [];
    const result = runOptimizeJob(spec, (it) =>
      iterations.push({ alpha: it.step.alpha, aim: it.aim }),
    );

    expect(result.status).toBe("line-search-failed");
    expect(iterations).toHaveLength(1);
    expect(iterations[0]!.alpha).toBe(0);

    // The iterate never moved, so this is the initial aim -- and crucially not
    // the trial the line search evaluated and threw away. That the solver did
    // evaluate other aims is what makes the distinction observable: reporting
    // "the last aim evaluated" would have reported one of those instead.
    expect(iterations[0]!.aim).toEqual(start);
    expect(result.aim).toEqual(start);
    expect(result.evaluations).toBeGreaterThan(1);
  });
});
