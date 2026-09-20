import type { ChannelMeta } from "./schema.js";
import type { EvalContext } from "./eval-context.js";

/** A quantity g(t,y) whose root marks an event of interest (ground impact, apex, ...). */
export interface EventSpec {
  readonly name: string;
  /** The event-indicator function; the event fires where this crosses zero. */
  g(t: number, y: Float64Array): number;
  /** Zero-crossing direction that counts as this event firing; any direction if omitted (§4.9). */
  readonly direction?: "rising" | "falling" | "any";
  /** Whether this event stops integration when it fires; non-terminal if omitted. */
  readonly terminal?: boolean;
  /**
   * Optional post-event state transform (§4.9's "stop or reflect", P4.11):
   * only meaningful on a `terminal` event. When present, firing the event
   * still truncates the step to the localized crossing, but instead of
   * ending the solve, the driver writes the reflected state (e.g. a
   * restitution bounce: v_y ← −e·v_y, v_x ← μ_f·v_x) into `out` and keeps
   * integrating from there. The event is re-armed for free -- nothing
   * distinguishes the post-action state from any other, so the same
   * per-step scan picks this event up again on a later crossing.
   *
   * The return value decides whether this particular firing continues or
   * ends the solve ({@link EventActionOutcome}, ADR-021). Returning nothing
   * means `"continue"`, which is what every action did before the outcome
   * existed, so an action written against the older signature keeps its
   * behaviour exactly.
   */
  action?(t: number, y: Float64Array, out: Float64Array): EventActionOutcome | void;
}

/**
 * What the driver does with the state an {@link EventSpec.action} just wrote
 * (ADR-021).
 *
 * - `"continue"` (also what returning nothing means) -- reflect and keep
 *   integrating, the P4.11 bounce behaviour.
 * - `"stop"` -- reflect and end the solve here, `status: "ok"`, `tFinal` at
 *   the localized crossing and `yFinal` the post-action state.
 *
 * `"stop"` exists because "this impact ends the flight" was inexpressible:
 * a terminal event either had an action and always continued, or had none
 * and always stopped without transforming the state. A restitution sequence
 * needs both -- it bounces until the rebound is too small to be a bounce,
 * and that last impact is a resting contact, which is a *stop with a
 * transform*. See ADR-021 for why that condition belongs to the model and
 * not to the driver.
 */
export type EventActionOutcome = "continue" | "stop";

/** A conserved or monotone quantity of the model, used as a runtime correctness check (§3.8). */
export interface InvariantSpec {
  readonly name: string;
  /** Current value of the invariant quantity at (t, y). */
  evaluate(t: number, y: Float64Array, ctx: EvalContext): number;
  /**
   * Instantaneous rate of change of the invariant from non-conservative
   * forcing, e.g. dE/dt = F_aero.v (eq. 3.19). Optional -- only declared
   * when the model can express it in closed form -- and used by
   * `InvariantMonitor` (P2.37) to accumulate the work-integral term of the
   * residual R(t) = value(t) - value(0) - integral(power, 0, t): a nonzero
   * residual on an invariant with no declared drift (e.g. gravity-only
   * energy) signals numerical error rather than expected physics.
   */
  power?(t: number, y: Float64Array, ctx: EvalContext): number;
}

/**
 * The abstract right-hand-side model SolverKit integrates (§3.7). The
 * projectile is the first registered Model, not a special case: SolverKit
 * never imports anything projectile-specific, only this interface.
 */
export interface Model {
  readonly dim: number;
  readonly channels: readonly ChannelMeta[];
  /** Writes dy/dt at (t, y) into `out`. */
  rhs(t: number, y: Float64Array, out: Float64Array, ctx: EvalContext): void;
  readonly invariants?: readonly InvariantSpec[];
  readonly events?: readonly EventSpec[];
  /** Optional analytic J = df/dy, row-major dim*dim; needs ctx (env/params) same as rhs. */
  jacobian?(t: number, y: Float64Array, ctx: EvalContext, out: Float64Array): void;
  /** Index sets (q, p) for symplectic/Verlet steppers requiring second-order mechanical structure. */
  readonly partitions?: { readonly q: readonly number[]; readonly p: readonly number[] };
}
