import type { EvalContext, Model } from "@ballista/engine";
import { attemptAdaptiveStep } from "./i-controller.js";
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
 * Absolute-tolerance floor (eq. 4.9's $atol_i$) used when `cfg.atol` is
 * unset for an adaptive solve. Purely relative tolerance (`atol=0`) is
 * hazardous whenever a channel's magnitude legitimately passes through
 * (or starts at) exactly 0 -- `sc_i` would collapse to 0 and divide any
 * nonzero `delta_i` there by zero. `1e-6` matches the blueprint's example
 * rtol scale (§4.5) and is small enough not to mask genuine relative-error
 * control on channels that stay well above it.
 */
const DEFAULT_ATOL = 1e-6;

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
 * Rounds every channel of `y` to the nearest IEEE 754 single-precision value
 * in place (P2.21's Float32 mode, §4.7). This is how the driver simulates
 * storing the accepted state in a `Float32Array` between steps without
 * requiring every stepper to internally compute in Float32: each step's
 * rhs is still evaluated in Float64, but the state it reads next step has
 * already lost its bits below `eps32 ≈ 1.19e-7`, which is what makes the
 * rounding-error branch of the V-curve rise so much sooner as h shrinks.
 */
function roundToFloat32(y: Float64Array): void {
  for (let i = 0; i < y.length; i++) {
    y[i] = Math.fround(y[i]!);
  }
}

/**
 * Fixed- or adaptive-step driver (§5.1): init the stepper, advance from
 * `tspan[0]` to `tspan[1]`, clamping the final step so it lands exactly on
 * t_f, dispatching every accepted step to `sinks`. Every stepped state is
 * checked for finiteness before being accepted; a NaN/Inf channel stops the
 * solve immediately with a typed `non-finite-state` failure carrying the
 * last-good (t, y) rather than propagating garbage further (§5.1's error
 * taxonomy -- "the single most valuable debugging feature in any solver").
 *
 * `cfg.rtol` set selects adaptive stepping (§4.5): each step runs P2.27's
 * eq. (4.9)/(4.10) accept-reject loop ({@link attemptAdaptiveStep}) against
 * an embedded-pair `stepper` (`stepper.info.embeddedOrder` must be
 * defined), `cfg.h` (or the same default-step-count guess the fixed path
 * uses) seeding only the *first* step's size thereafter. `cfg.atol`
 * defaults to `DEFAULT_ATOL` when unset. Rejected attempts are counted into
 * `SolveReport.nRejected` and their rhs evaluations into `nRHS`, but never
 * advance `t`. `cfg.h` set (and `cfg.rtol` unset) instead runs the plain
 * fixed-step path at (approximately) `cfg.h`. `cfg.controller` (P2.28's PI
 * variant), `cfg.hMin`-underflow-as-typed-failure, and `cfg.maxSteps`
 * enforcement (P2.29) remain separate tasks.
 *
 * `current` and `out.yNext` are two buffers preallocated once and copied
 * between (not swapped) each step, so a stepper never sees the buffer it is
 * writing into aliased with the state it is reading from, while the loop
 * itself still allocates nothing per step beyond that one fixed-size copy.
 * `cfg.compensatedSummation` (P2.20) allocates a per-channel Kahan
 * compensation buffer and passes it to `stepper.step`, so a stepper that
 * understands the optional fifth parameter (currently
 * {@link ExplicitEulerStepper}) can Kahan-compensate its own `y + h*f`
 * addition -- the only place the low-order bits genuinely lost to rounding
 * are still recoverable (post-hoc correction against the driver's `current`
 * copy cannot recover them, since the stepper's addition has already
 * rounded by the time `integrate` sees `out.yNext`).
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
  let h = cfg.h ?? (tFinal - t0) / DEFAULT_STEP_COUNT;

  const adaptive = cfg.rtol !== undefined;
  const embeddedOrder = stepper.info.embeddedOrder;
  if (adaptive && embeddedOrder === undefined) {
    throw new Error(
      `integrate: adaptive stepping (cfg.rtol set) requires an embedded-pair stepper; "${stepper.info.id}" has no embeddedOrder`,
    );
  }
  const rtol = cfg.rtol ?? 0;
  const atol = cfg.atol ?? DEFAULT_ATOL;

  stepper.init(model, ctx);

  const current = Float64Array.from(y0);
  const out = createStepResult(model.dim);
  const compensation = cfg.compensatedSummation ? new Float64Array(model.dim) : undefined;
  const float32Mode = cfg.precision === "float32";
  if (float32Mode) roundToFloat32(current);

  let t = t0;
  let nSteps = 0;
  let nRHS = 0;
  let nRejected = 0;

  for (const sink of sinks) sink.start?.(model, t0, current);

  while (t < tFinal) {
    const remaining = tFinal - t;
    const isFinalAttempt = remaining <= h * (1 + FINAL_STEP_EPS_REL);
    const hStep = isFinalAttempt ? remaining : h;

    // The step size actually accepted -- for a rejected-then-shrunk
    // adaptive attempt this is *less* than the requested `hStep`, which is
    // why `t` below advances by this, never by `hStep` itself (advancing by
    // the request would silently skip past the ground truth at t whenever
    // a step was rejected, exactly what P2.27's rejection loop exists to
    // prevent).
    let acceptedH: number;
    if (adaptive) {
      const outcome = attemptAdaptiveStep(
        stepper,
        embeddedOrder!,
        t,
        current,
        hStep,
        rtol,
        atol,
        out,
      );
      nRejected += outcome.rejections;
      nRHS += outcome.nRHS;
      h = outcome.hNext;
      acceptedH = outcome.h;
    } else {
      stepper.step(t, current, hStep, out, compensation);
      nRHS += out.nRHS;
      acceptedH = hStep;
    }
    nSteps++;

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
        nRejected,
        failure,
      };
      for (const sink of sinks) sink.finish?.(report);
      return report;
    }

    current.set(out.yNext);
    if (float32Mode) roundToFloat32(current);
    // Assigning t_f directly (rather than t + acceptedH) guarantees the
    // final time is bit-exact even though hStep = tFinal - t is itself
    // rounded -- but only once the *accepted* step actually covers the
    // full requested `hStep` (never true for a shrunk adaptive attempt,
    // which under-reaches t_f and must keep looping).
    t = isFinalAttempt && acceptedH === hStep ? tFinal : t + acceptedH;
    for (const sink of sinks) sink.accept?.(t, current, out);
  }

  const report: SolveReport = {
    status: "ok",
    tFinal: t,
    yFinal: current,
    nSteps,
    nRHS,
    nRejected,
  };

  for (const sink of sinks) sink.finish?.(report);

  return report;
}
