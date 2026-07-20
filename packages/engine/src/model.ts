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
}

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
