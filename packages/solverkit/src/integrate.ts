import type { EvalContext, Model } from "@ballista/engine";
import {
  createStepResult,
  type Sink,
  type SolveFailure,
  type SolveReport,
  type SolverConfig,
  type Stepper,
} from "./types.js";

const DEFAULT_STEP_COUNT = 100;

/**
 * Relative slack applied when deciding whether the remaining span is small
 * enough to treat as the final step. Needed because summing `t += h` drifts
 * by a few ULP per step (0.1 has no exact binary representation): without
 * slack, ten 0.1-steps to t_f=1 leave `remaining` a hair above zero and spawn
 * a spurious eleventh near-zero step instead of landing exactly on t_f.
 */
const FINAL_STEP_EPS_REL = 1e-9;

/** True iff every channel of `y` is finite -- the per-accepted-step NaN/Inf guard (§5.1, P2.03). */
function isFiniteState(y: Float64Array): boolean {
  for (let i = 0; i < y.length; i++) {
    if (!Number.isFinite(y[i]!)) return false;
  }
  return true;
}

/**
 * Fixed-step driver (§5.1): init the stepper, advance from `tspan[0]` to
 * `tspan[1]` at (approximately) `cfg.h`, clamping the final step so it lands
 * exactly on t_f, dispatching every accepted step to `sinks`. Every stepped
 * state is checked for finiteness before being accepted; a NaN/Inf channel
 * stops the solve immediately with a typed `non-finite-state` failure
 * carrying the last-good (t, y) rather than propagating garbage further
 * (§5.1's error taxonomy -- "the single most valuable debugging feature in
 * any solver"). maxSteps/hMin enforcement (P2.29) and adaptive step-size
 * control (P2.27/28) remain separate tasks.
 *
 * `current` and `out.yNext` are two buffers preallocated once and copied
 * between (not swapped) each step, so a stepper never sees the buffer it is
 * writing into aliased with the state it is reading from, while the loop
 * itself still allocates nothing per step beyond that one fixed-size copy.
 */
export function integrate(
  model: Model,
  ctx: EvalContext,
  y0: Float64Array,
  tspan: readonly [number, number],
  cfg: SolverConfig,
  stepper: Stepper,
  sinks: readonly Sink[] = [],
): SolveReport {
  const [t0, tFinal] = tspan;
  const h = cfg.h ?? (tFinal - t0) / DEFAULT_STEP_COUNT;

  stepper.init(model, ctx);

  const current = Float64Array.from(y0);
  const out = createStepResult(model.dim);

  let t = t0;
  let nSteps = 0;
  let nRHS = 0;

  for (const sink of sinks) sink.start?.(model, t0, current);

  while (t < tFinal) {
    const remaining = tFinal - t;
    const isFinalStep = remaining <= h * (1 + FINAL_STEP_EPS_REL);
    const hStep = isFinalStep ? remaining : h;

    stepper.step(t, current, hStep, out);
    nSteps++;
    nRHS += out.nRHS;

    if (!isFiniteState(out.yNext)) {
      const failure: SolveFailure = {
        reason: "non-finite-state",
        message: `non-finite state produced by stepper "${stepper.info.id}" advancing from t=${t}`,
        t,
        y: current,
      };
      const report: SolveReport = {
        status: "failed",
        tFinal: t,
        yFinal: current,
        nSteps,
        nRHS,
        nRejected: 0,
        failure,
      };
      for (const sink of sinks) sink.finish?.(report);
      return report;
    }

    current.set(out.yNext);
    // Assigning t_f directly (rather than t + hStep) guarantees the final
    // time is bit-exact even though hStep = tFinal - t is itself rounded.
    t = isFinalStep ? tFinal : t + hStep;
    for (const sink of sinks) sink.accept?.(t, current, out);
  }

  const report: SolveReport = {
    status: "ok",
    tFinal: t,
    yFinal: current,
    nSteps,
    nRHS,
    nRejected: 0,
  };

  for (const sink of sinks) sink.finish?.(report);

  return report;
}
