import type { EvalContext, Model } from "@ballista/engine";

/**
 * Stable metadata describing a stepper's numerical properties (§5.1): the
 * convergence harness (P2.07) asserts `order`/`embeddedOrder` against
 * measured slopes, and the solver advisor (P2.47) reads `symplectic`/`fsal`.
 */
export interface StepperInfo {
  readonly id: string;
  readonly order: number;
  readonly embeddedOrder?: number;
  readonly fsal: boolean;
  readonly denseOrder?: number;
  readonly symplectic: boolean;
}

/**
 * Why an implicit stepper's Newton iteration failed to converge within its
 * budget (P2.39): `"max-iterations"` when the residual never dropped below
 * the convergence tolerance in the allotted iterations,
 * `"singular-jacobian"` when {@link solveLinearSystemInPlace} (via
 * `dense-linear-solve.js`) hit a numerically singular iteration matrix,
 * `"damping-exhausted"` when the halving schedule is empty (a negative
 * `maxDampingHalvings`, so no candidate step is even attempted --
 * {@link BackwardEulerStepper}'s normal, non-negative schedule always
 * accepts *some* candidate at the final halving as a last resort, so this
 * is only a misconfiguration guard, not a naturally-occurring outcome),
 * and `"non-finite-residual"` when the scaled residual norm itself
 * evaluates to NaN (e.g. the model's rhs returns NaN at the current
 * iterate).
 */
export type NewtonFailureReason =
  "max-iterations" | "singular-jacobian" | "damping-exhausted" | "non-finite-residual";

/**
 * Preallocated output of a single {@link Stepper.step} call (§5.1). Owned by
 * the caller (`integrate`'s driver loop) and reused across every step of a
 * solve, so a step never allocates: the stepper only ever writes into
 * `out.yNext` and the scalar fields in place, never returns a new object.
 */
export interface StepResult {
  /** State at t+h, written in place by the stepper; same length as the model's `dim`. */
  readonly yNext: Float64Array;
  /** Whether this attempt was accepted; fixed-step methods (P2.06 Euler, ...) always accept. */
  accepted: boolean;
  /** Step size actually attempted (may differ from the requested h once P2.27's controller lands). */
  h: number;
  /** Local error norm estimate for embedded-pair steppers (P2.23); 0 for non-adaptive steppers. */
  errorEstimate: number;
  /**
   * Raw per-component local error $\boldsymbol\delta$ (P2.23), same length
   * as `yNext`; `errorEstimate` is this array's unscaled RMS norm. A
   * caller doing tolerance-scaled step acceptance (P2.26's
   * `scaledErrorNorm`, eq. 4.9) reads this directly, since per-component
   * `atol`/`rtol` scaling can't be recovered from the single RMS scalar
   * once channels have different magnitudes. Untouched (stale or zero) by
   * non-adaptive steppers, which never populate it -- only meaningful
   * alongside a nonzero `errorEstimate`.
   */
  readonly delta: Float64Array;
  /** rhs evaluations consumed by this attempt, for `StatsCollector` (P2.05) accounting. */
  nRHS: number;
  /**
   * Newton iterations consumed by an implicit stepper's step attempt
   * (P2.39), e.g. {@link BackwardEulerStepper}. `0` and untouched by
   * explicit steppers, which have no Newton loop -- same staleness
   * convention as `delta`/`errorEstimate` for non-adaptive steppers: only
   * meaningful for a stepper that actually populates it.
   */
  newtonIterations: number;
  /**
   * Set by an implicit stepper (P2.39) the moment its Newton iteration
   * fails to converge within budget; `undefined` on a converged/accepted
   * step and left untouched by steppers with no Newton loop. This is what
   * lets a forced non-convergence surface a typed reason through `out`
   * instead of only the NaN `yNext`/`accepted: false` pair `integrate`'s
   * P2.03 non-finite-state guard already produces.
   */
  newtonFailureReason: NewtonFailureReason | undefined;
}

/** Preallocates a {@link StepResult} sized for a model of the given dimension. */
export function createStepResult(dim: number): StepResult {
  return {
    yNext: new Float64Array(dim),
    accepted: false,
    h: 0,
    errorEstimate: 0,
    delta: new Float64Array(dim),
    nRHS: 0,
    newtonIterations: 0,
    newtonFailureReason: undefined,
  };
}

/**
 * A time-integration method (§5.1). SolverKit never special-cases a
 * particular Stepper; every method from Euler (P2.06) to DOPRI5 (P2.24)
 * implements this same interface, which is what lets the convergence
 * harness (P2.07) and solver-panel dropdown (§5.5 worked example 3) treat
 * every registered method uniformly.
 */
export interface Stepper {
  readonly info: StepperInfo;
  /** Allocates stage buffers sized for `model`/`ctx`; called once before stepping starts (ADR-004). */
  init(model: Model, ctx: EvalContext): void;
  /**
   * Advances the solution by one step of (requested) size h, writing the
   * result into `out`. `compensation` (P2.20), when the caller requested
   * `SolverConfig.compensatedSummation`, is a driver-owned, per-channel
   * Kahan running-error buffer persisted across the whole solve; a stepper
   * that performs its final state update as a single `y + increment`
   * addition (currently just {@link ExplicitEulerStepper}) can fold it
   * into that addition via {@link kahanAdd} to recover the low-order bits
   * a plain addition would round away -- the only point in the pipeline
   * where those bits are still recoverable, since by the time `out.yNext`
   * reaches the driver the addition has already happened and rounded.
   * Steppers that ignore the parameter (the default) are unaffected.
   */
  step(t: number, y: Float64Array, h: number, out: StepResult, compensation?: Float64Array): void;
  /** Dense-output interpolant at fractional position theta in [0, 1] of the last accepted step. */
  interpolant?(theta: number, out: Float64Array): void;
}

/** A {@link Stepper}'s registry name, e.g. `"classical-rk4"` or `"dopri5"` (§5.2 `ScenarioSpec` round-tripping). */
export type StepperId = string;
/** Step-size controller strategy (§4.5): `"I"` is the elementary eq. 4.10 controller, `"PI"` the chatter-suppressing PI variant. */
export type ControllerKind = "I" | "PI";

/**
 * Numeric representation used for state storage between accepted steps
 * (§4.7, ADR-014, P2.21). `"float64"` (default) is the platform's one
 * correctness-tested baseline. `"float32"` is an explicit, opt-in
 * pedagogical/preview mode: the accepted state is rounded to IEEE 754
 * single-precision after every step (simulating storage in a
 * `Float32Array`, which is what a future WebGPU backend would use, §10.1),
 * raising the effective rounding-error floor from
 * `eps64 ≈ 2.2e-16` to `eps32 ≈ 1.19e-7`. This shifts the §4.7 V-shaped
 * total-error curve's minimum to a larger `h`, since the rounding branch
 * `C2 * eps / h` now overtakes the falling truncation branch `C1 * h^p`
 * much sooner as h shrinks. Not held to Float64's absolute error bounds --
 * validated only for that qualitative V-curve-shape shift.
 */
export type SolverPrecision = "float64" | "float32";

/**
 * Configuration for one {@link integrate} call (§5.1). `stepper` names the
 * method for reporting/serialization (ScenarioSpec round-tripping, §5.2);
 * the caller resolves it to a concrete {@link Stepper} instance and passes
 * that instance to `integrate` directly, since SolverKit itself owns no
 * global stepper registry.
 */
export interface SolverConfig {
  readonly stepper: StepperId;
  readonly h?: number;
  readonly rtol?: number;
  readonly atol?: number | Float64Array;
  readonly controller?: ControllerKind;
  readonly maxSteps: number;
  readonly hMin?: number;
  /**
   * Kahan-compensate the per-step state update (P2.20) instead of a plain
   * overwrite, trading a few extra flops/step for O(eps) accumulated
   * rounding error instead of O(nSteps * eps). Off by default since most
   * solves never run deep enough into the rounding-dominated regime for it
   * to matter.
   */
  readonly compensatedSummation?: boolean;
  /**
   * State-storage precision (§4.7, ADR-014, P2.21). Defaults to `"float64"`.
   * See {@link SolverPrecision} for the rounding model and rationale.
   */
  readonly precision?: SolverPrecision;
}

/** Typed failure taxonomy (§5.1): every way a solve can fail to reach t_f, not a generic Error. */
export type SolveFailureReason =
  "step-size-underflow" | "max-steps-exceeded" | "non-finite-state" | "event-localization-failure";

/**
 * Thrown by an adaptive step-size controller (P2.27's `attemptAdaptiveStep`,
 * P2.28's `attemptAdaptivePIStep`) when a step can't be resolved to an
 * accepted state without shrinking `h` below a floor -- either an explicit
 * `SolverConfig.hMin` or the controllers' own consecutive-rejections
 * backstop (§4.5: "h_min floor with diagnostic failure, not silent stall").
 * `integrate` (P2.29) catches this and converts it into a typed
 * `step-size-underflow` {@link SolveFailure} carrying the last-good `(t, y)`
 * rather than letting a generic exception propagate out of a solve.
 */
export class StepSizeUnderflowError extends Error {
  constructor(
    message: string,
    readonly t: number,
    readonly y: Float64Array,
  ) {
    super(message);
    this.name = "StepSizeUnderflowError";
  }
}

/** A typed solve failure, carrying the last-good (t, y) so callers can inspect, report, or resume. */
export interface SolveFailure {
  readonly reason: SolveFailureReason;
  readonly message: string;
  readonly t: number;
  readonly y: Float64Array;
}

/** Outcome of an {@link integrate} run (§5.1). */
export interface SolveReport {
  readonly status: "ok" | "failed" | "canceled";
  readonly tFinal: number;
  readonly yFinal: Float64Array;
  readonly nSteps: number;
  readonly nRHS: number;
  readonly nRejected: number;
  readonly failure?: SolveFailure;
}

/**
 * A composable output of a solve (§5.1, §5.4): `TrajectoryRecorder` (P2.04),
 * `StatsCollector` (P2.05), `InvariantMonitor` (P2.37), and `EventCollector`
 * (P2.32) all implement this. `integrate` never accumulates results itself
 * -- batch/Monte Carlo callers attach only the sinks they need, which is the
 * difference between 1e3 and 1e5 runs/s (§5.1).
 */
export interface Sink {
  readonly id: string;
  /** Called once before the first step, with the initial condition. */
  start?(model: Model, t0: number, y0: Float64Array): void;
  /** Called once per accepted step, with the state just written to `yNext`/`out`. */
  accept?(t: number, y: Float64Array, step: StepResult): void;
  /** Called once after the solve concludes, whether it succeeded, failed, or was canceled. */
  finish?(report: SolveReport): void;
}
