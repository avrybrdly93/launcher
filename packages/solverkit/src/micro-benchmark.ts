import type { EvalContext, Model } from "@ballista/engine";
import { createStepResult, type Stepper } from "./types.js";

/** One stepper's measured throughput (P2.43). */
export interface BenchmarkResult {
  readonly id: string;
  readonly steps: number;
  readonly elapsedMs: number;
  readonly stepsPerSec: number;
}

const BATCH_SIZE = 200;

/**
 * Measures a stepper's sustained steps/sec (P2.43, extends the P1.21/P2.42
 * allocation harnesses' warmup discipline to a throughput measurement).
 * JIT-warms with `warmupSteps` first, then runs steps in batches until at
 * least `minDurationMs` of wall time has elapsed, reporting
 * `steps / elapsed`. Duration-bounded rather than iteration-count-bounded:
 * a single fixed iteration count would run cheap methods (Euler, 1 rhs
 * eval/step) for a blink and expensive ones (DOPRI5, 7 rhs evals/step) for
 * close to 7x as long, which is both wasteful in CI and biases a
 * regression check's statistical noise floor differently per method.
 */
export function benchmarkStepper(
  stepper: Stepper,
  model: Model,
  ctx: EvalContext,
  y0: Float64Array,
  h: number,
  minDurationMs: number,
  warmupSteps: number,
): BenchmarkResult {
  stepper.init(model, ctx);
  const y = Float64Array.from(y0);
  const out = createStepResult(model.dim);

  const runSteps = (n: number): void => {
    for (let i = 0; i < n; i++) {
      stepper.step(i * h, y, h, out);
      y.set(out.yNext);
    }
  };

  runSteps(warmupSteps);

  let steps = 0;
  const start = performance.now();
  let elapsedMs = 0;
  while (elapsedMs < minDurationMs) {
    runSteps(BATCH_SIZE);
    steps += BATCH_SIZE;
    elapsedMs = performance.now() - start;
  }

  return { id: stepper.info.id, steps, elapsedMs, stepsPerSec: (steps / elapsedMs) * 1000 };
}
