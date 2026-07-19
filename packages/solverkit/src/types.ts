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
  /** rhs evaluations consumed by this attempt, for `StatsCollector` (P2.05) accounting. */
  nRHS: number;
}

/** Preallocates a {@link StepResult} sized for a model of the given dimension. */
export function createStepResult(dim: number): StepResult {
  return { yNext: new Float64Array(dim), accepted: false, h: 0, errorEstimate: 0, nRHS: 0 };
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

export type StepperId = string;
export type ControllerKind = "I" | "PI";

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
   * Quantize the accepted state to Float32 precision after every step
   * (§4.7, P2.21) by rounding each channel through `Math.fround` -- the
   * cheapest faithful stand-in for storing the trajectory in a
   * `Float32Array`, without threading float32 arithmetic through every
   * force/environment computation. `eps_f32 ~ 1.19e-7` is ~9 orders of
   * magnitude coarser than `eps_f64 ~ 2.22e-16`, so the rounding-error
   * branch of the V-shaped total-error curve (`E(h) ~ C1*h^p + C2*eps/h`)
   * is reached at a far larger `h`, previewing the precision the GPU path
   * (§10.1, P7.14) will actually compute in. Off by default -- Float64 is
   * the platform's numerics core (ADR-014).
   */
  readonly float32Mode?: boolean;
}

/** Typed failure taxonomy (§5.1): every way a solve can fail to reach t_f, not a generic Error. */
export type SolveFailureReason =
  "step-size-underflow" | "max-steps-exceeded" | "non-finite-state" | "event-localization-failure";

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
  start?(model: Model, t0: number, y0: Float64Array): void;
  accept?(t: number, y: Float64Array, step: StepResult): void;
  finish?(report: SolveReport): void;
}
