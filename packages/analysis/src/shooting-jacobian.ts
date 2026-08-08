import type { Aim, ResidualFunction, ShootingResidual } from "./shooting-residual.js";

/**
 * The finite-difference Jacobian of §7 Phase 5 (P5.05): $\partial F/\partial
 * (\theta, v_0)$ for P5.04's shooting residual.
 *
 * P5.06's Newton step solves `J Δaim = −F`, so this matrix is the only thing
 * standing between a working solver and one that converges linearly while
 * looking healthy. There is no analytic Jacobian available here: `F` is the
 * output of an ODE solve with an event-localized endpoint, so its derivative
 * is either a tangent-linear integration (P5.10, a later task) or a finite
 * difference of the residual — this task.
 *
 * **The whole difficulty is the step size, and it is not the usual one.** The
 * textbook finite-difference tradeoff balances truncation error, which falls
 * as `h^p`, against *rounding* error, which grows as `ε/h` — giving the
 * familiar V-shaped error curve with its minimum near `√ε` for a forward
 * difference. That analysis assumes the only corruption in `F` is machine
 * epsilon. **Here it usually is not.** `F` comes out of an adaptive solve, and
 * an adaptive controller chooses a different step *sequence* for every aim, so
 * two nearby aims are integrated by two different discretizations. Their
 * truncation errors do not cancel. The residual therefore carries an effective
 * noise floor set by the integration tolerance — around `rtol`, not around
 * `ε` — and since a differencing scheme divides that noise by `h`, the error
 * curve turns upward at a step size orders of magnitude larger than `√ε`, and
 * the minimum it turns up from is orders of magnitude worse. Shrinking `h` in
 * pursuit of accuracy makes the Jacobian monotonically *worse* from there, and
 * nothing about the resulting numbers looks wrong.
 *
 * Two things follow, and this module is built on both.
 *
 * 1. **The inner solve must be quiet.** Either fixed-step — every aim gets the
 *    identical grid, so truncation error is a smooth function of the aim and
 *    largely cancels in the difference — or adaptive at a tolerance far tighter
 *    than the accuracy wanted from the Jacobian. This module cannot enforce
 *    that (it only sees a {@link ResidualFunction}), which is why it takes the
 *    noise floor as a declared input rather than assuming `ε`.
 * 2. **The step must be derived from that noise floor, not from `ε`.** See
 *    {@link finiteDifferenceStep} for the formula and
 *    {@link DEFAULT_NOISE_FLOOR} for what the default assumes.
 *
 * `shooting-jacobian.test.ts` measures the V-curve on a drag-free problem with
 * an exact analytic Jacobian, documents where the plateau sits for both
 * schemes, and runs the identical sweep against a deliberately loose adaptive
 * inner solve so the blowup this comment describes is demonstrated rather than
 * asserted.
 */

/**
 * Which difference quotient to use.
 *
 * `central` costs twice the evaluations of `forward` and is worth it almost
 * always: its truncation error is `O(h²)` rather than `O(h)`, which buys a
 * plateau several orders of magnitude lower for the same noise floor. `forward`
 * exists because a Newton solve already has `F(aim)` in hand at the current
 * iterate, so a forward Jacobian is `n` extra evaluations per iteration where a
 * central one is `2n` — the right trade only when the residual is expensive and
 * the noise floor is high enough that the extra accuracy would be swallowed by
 * noise anyway.
 */
export type FiniteDifferenceScheme = "forward" | "central";

/**
 * The relative accuracy assumed for the residual when the caller does not say.
 *
 * This is machine epsilon, i.e. **the assumption that the inner solve is
 * effectively noise-free** — true for a fixed-step solve, and for an adaptive
 * one only at a tolerance near `ε`. It is the optimistic default on purpose:
 * it produces the smallest steps, so a caller who is wrong about their inner
 * solve sees a *bad Jacobian*, which the plateau test can detect, rather than a
 * silently over-large step that yields a plausible but truncation-biased
 * matrix. Callers integrating at `rtol = 1e-8` should pass `noiseFloor: 1e-8`.
 */
export const DEFAULT_NOISE_FLOOR = Number.EPSILON;

/** Order of the truncation error of each scheme: `O(h^ORDER)`. */
const SCHEME_ORDER: Record<FiniteDifferenceScheme, number> = {
  forward: 1,
  central: 2,
};

/** How the aim's two components are ordered along the Jacobian's columns. */
export const AIM_COLUMNS = ["theta", "speed"] as const;

/** Tuning for {@link shootingJacobian}. Every field has a defensible default. */
export interface JacobianOptions {
  /** Difference quotient. Defaults to `"central"`. */
  readonly scheme?: FiniteDifferenceScheme;
  /**
   * Relative accuracy of the residual — the *fraction* of `F`'s own magnitude
   * below which its value is noise. Defaults to {@link DEFAULT_NOISE_FLOOR}.
   *
   * For an adaptive inner solve this is essentially `rtol`. For a fixed-step
   * solve it is much smaller than the solve's own truncation error, because
   * what matters is not how far `F` sits from the true residual but how
   * *smoothly* that error varies with the aim — a fixed grid makes the bias
   * nearly common to both evaluations, so it cancels in the difference.
   */
  readonly noiseFloor?: number;
  /** Absolute step in `θ` (radians), overriding the derived one. */
  readonly thetaStep?: number;
  /** Absolute step in `v₀` (m/s), overriding the derived one. */
  readonly speedStep?: number;
  /**
   * Typical magnitude of `θ`, used to scale the derived step. Defaults to 1
   * radian rather than `|θ|`, because an aim near zero elevation is an ordinary
   * shot, not a degenerate one, and scaling by `|θ|` there would collapse the
   * step to nothing.
   */
  readonly thetaScale?: number;
  /** Typical magnitude of `v₀`. Defaults to `max(|v₀|, 1)`. */
  readonly speedScale?: number;
}

/** One finite-difference Jacobian evaluation. */
export interface ShootingJacobian {
  /**
   * `∂F_i/∂aim_j` in row-major order: `matrix[i][j]`, with rows indexed by
   * residual component (the layout's position axes) and columns by
   * {@link AIM_COLUMNS} — column 0 is `∂F/∂θ` (metres per radian), column 1 is
   * `∂F/∂v₀` (metres per metre-per-second, i.e. seconds).
   *
   * `null` when {@link ok} is false.
   *
   * **Expect the vertical row to be structurally zero** for the usual setup: a
   * ground-impact terminal event pins `y_impact` to the ground for every aim,
   * so `∂F_y/∂θ = ∂F_y/∂v₀ = 0` exactly and this matrix is rank 1 — regardless
   * of where the target sits, since a target above the ground only shifts
   * `F_y` by a constant. That is a property of the *problem*, not a defect
   * here: a ground-impact shot has one scalar equation (downrange miss) and two
   * unknowns, which is why P5.08 speaks of low and high arcs and P5.22 of
   * locking two of three quantities. P5.06 must not hand this matrix to an
   * unguarded 2×2 solve.
   */
  readonly matrix: number[][] | null;
  /** Whether every evaluation the scheme needed succeeded. */
  readonly ok: boolean;
  /** The scheme actually used. */
  readonly scheme: FiniteDifferenceScheme;
  /** The absolute steps used, in the aim's own units. */
  readonly steps: { readonly theta: number; readonly speed: number };
  /** Residual evaluations spent, including the base point for `"forward"`. */
  readonly evaluations: number;
  /** The aim differentiated about, echoed back for traceability. */
  readonly aim: Aim;
  /**
   * The base-point evaluation `F(aim)`. Present for `"forward"`, which needs it
   * anyway, so a Newton iteration gets the residual and its Jacobian from one
   * call. `null` for `"central"`, which never evaluates the base point.
   */
  readonly base: ShootingResidual | null;
  /**
   * Why {@link ok} is false — naming the perturbation that failed, since "the
   * Jacobian failed" is not actionable but "the +θ perturbation left the
   * reachable set" is.
   */
  readonly failure?: string;
}

/**
 * The step size that minimizes total finite-difference error for a given
 * scheme and noise floor.
 *
 * Writing the total error of a `p`-th order scheme as truncation plus
 * amplified noise,
 *
 * $$E(h) \approx C h^{p} + \frac{\varepsilon_F}{h},$$
 *
 * setting `E'(h) = 0` gives `h* ∝ ε_F^{1/(p+1)}`, and the constants `C` and the
 * scheme's own factor of 2 move the optimum by well under an order of
 * magnitude — irrelevant next to a noise floor that ranges over ten. So the
 * step is `scale · ε_F^{1/(p+1)}`: the square root of the noise floor for a
 * forward difference, the cube root for a central one.
 *
 * The consequence worth internalizing: at `ε_F = ε` a central difference wants
 * `h ≈ 6e-6`, but at `ε_F = 1e-6` — an inner solve at `rtol = 1e-6` — it wants
 * `h ≈ 1e-2`, **three and a half orders of magnitude larger**. A caller who
 * keeps the machine-epsilon step while loosening their tolerance is not being
 * conservative; they are sitting far up the noise branch of the V.
 *
 * @param noiseFloor Relative accuracy of the function being differenced.
 * @param scheme Which difference quotient the step is for.
 * @param scale Typical magnitude of the variable being perturbed.
 */
export function finiteDifferenceStep(
  noiseFloor: number,
  scheme: FiniteDifferenceScheme,
  scale: number,
): number {
  if (!(noiseFloor > 0) || !Number.isFinite(noiseFloor)) {
    throw new Error(
      `finiteDifferenceStep: noiseFloor must be finite and positive; got ${noiseFloor}`,
    );
  }
  if (!(scale > 0) || !Number.isFinite(scale)) {
    throw new Error(`finiteDifferenceStep: scale must be finite and positive; got ${scale}`);
  }
  const order = SCHEME_ORDER[scheme];
  return scale * Math.pow(noiseFloor, 1 / (order + 1));
}

/** Perturb one component of an aim, leaving the other alone. */
function perturb(aim: Aim, column: (typeof AIM_COLUMNS)[number], delta: number): Aim {
  return column === "theta"
    ? { theta: aim.theta + delta, speed: aim.speed }
    : { theta: aim.theta, speed: aim.speed + delta };
}

/**
 * Finite-difference Jacobian of a {@link ResidualFunction} with respect to the
 * aim.
 *
 * **Steps are per-variable and scaled**, which is not a refinement but a
 * correctness requirement: `θ` is order 1 radian and `v₀` is order 60 m/s, so
 * any single shared step is either far too coarse for one or far too fine for
 * the other. Passing an explicit `thetaStep`/`speedStep` overrides the derived
 * value — the plateau sweep in the tests does exactly that, since sweeping the
 * step *is* the measurement.
 *
 * **A failed perturbation is a returned value, not a throw**, matching
 * {@link ResidualFunction}'s contract and for the same reason: a Newton line
 * search (P5.06) that differentiates near the reachability boundary will step
 * outside it, and that is an ordinary incident in an optimization which the
 * caller handles by shortening its step. It is reported rather than
 * silently one-sided — falling back to a one-sided difference would quietly
 * halve the scheme's order and move the plateau, which is precisely the kind of
 * invisible accuracy loss this module exists to prevent.
 */
export function shootingJacobian(
  residual: ResidualFunction,
  aim: Aim,
  options: JacobianOptions = {},
): ShootingJacobian {
  const scheme = options.scheme ?? "central";
  const noiseFloor = options.noiseFloor ?? DEFAULT_NOISE_FLOOR;
  const thetaScale = options.thetaScale ?? 1;
  const speedScale = options.speedScale ?? Math.max(Math.abs(aim.speed), 1);

  const steps = {
    theta: options.thetaStep ?? finiteDifferenceStep(noiseFloor, scheme, thetaScale),
    speed: options.speedStep ?? finiteDifferenceStep(noiseFloor, scheme, speedScale),
  };
  for (const column of AIM_COLUMNS) {
    const step = steps[column];
    if (!(step > 0) || !Number.isFinite(step)) {
      throw new Error(`shootingJacobian: ${column} step must be finite and positive; got ${step}`);
    }
  }

  let evaluations = 0;
  const evaluate = (at: Aim): ShootingResidual => {
    evaluations++;
    return residual(at);
  };

  const failed = (failure: string, base: ShootingResidual | null): ShootingJacobian => ({
    matrix: null,
    ok: false,
    scheme,
    steps,
    evaluations,
    aim,
    base,
    failure,
  });

  const base = scheme === "forward" ? evaluate(aim) : null;
  if (base !== null && (!base.ok || base.residual === null)) {
    return failed(
      "the base aim produced no impact, so a forward difference has nothing to difference from",
      base,
    );
  }

  const columns: number[][] = [];
  for (const column of AIM_COLUMNS) {
    const step = steps[column];
    const plus = evaluate(perturb(aim, column, step));
    if (!plus.ok || plus.residual === null) {
      return failed(`the +${column} perturbation (step ${step}) produced no impact`, base);
    }

    if (scheme === "forward") {
      const from = base!.residual!;
      columns.push(plus.residual.map((value, row) => (value - from[row]!) / step));
      continue;
    }

    const minus = evaluate(perturb(aim, column, -step));
    if (!minus.ok || minus.residual === null) {
      return failed(`the -${column} perturbation (step ${step}) produced no impact`, base);
    }
    columns.push(plus.residual.map((value, row) => (value - minus.residual![row]!) / (2 * step)));
  }

  const rows = columns[0]!.length;
  const matrix: number[][] = [];
  for (let row = 0; row < rows; row++) {
    matrix.push(columns.map((column) => column[row]!));
  }

  return { matrix, ok: true, scheme, steps, evaluations, aim, base };
}
