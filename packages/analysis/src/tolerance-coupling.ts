import { type FiniteDifferenceScheme, finiteDifferenceStep } from "./shooting-jacobian.js";

/**
 * The inner/outer tolerance coupling rule of P5.31 (ADR-017).
 *
 * Every inverse solve in this package is two nested numerical methods: an
 * **outer** optimizer (`newtonShooting`, `levenbergMarquardt`, `brentMinimize`)
 * driving a residual to zero, and an **inner** initial-value problem
 * (`integrate`) evaluating that residual by flying a trajectory. The two carry
 * separate tolerances — `NewtonShootingOptions.residualTolerance` outside,
 * `SolverConfig.rtol`/`atol` inside — and nothing in the type system relates
 * them. A caller can ask for a micrometre miss from a residual known only to a
 * metre, and every layer will report success: the integrator meets its
 * tolerance, the Newton iteration meets its own on a number that is noise, and
 * the answer is wrong with `status: "converged"`.
 *
 * This module is the rule that relates them, and ADR-017 is the argument. The
 * short version is that there are **two** independent constraints and the
 * binding one changes with the parameters:
 *
 * 1. **The residual's noise floor must sit below the tolerance being tested.**
 *    An inner solve at relative tolerance `rtol` returns a residual carrying
 *    absolute error of order `rtol · L`, where `L` is the trajectory's own
 *    scale. Asking the outer solver for `‖F‖ < τ` is meaningless unless
 *    `rtol · L ≪ τ`. This clause is *linear* in `τ`.
 *
 * 2. **The finite-difference Jacobian must be accurate enough to step with.**
 *    This is where the classic "inner tolerance is the square of the outer"
 *    heuristic comes from, and it is worth seeing exactly where the square
 *    appears. {@link finiteDifferenceStep} already derives the optimal step for
 *    a scheme of truncation order `p` against a relative noise floor `ε`:
 *    `h* ∝ ε^{1/(p+1)}`. Substituting it back into the same error model
 *    `E(h) ≈ C h^p + ε/h` gives the *achievable* relative Jacobian accuracy
 *
 *        η ≈ ε^{p/(p+1)}      i.e.      ε ≤ η^{(p+1)/p}.
 *
 *    For a **forward** difference (`p = 1`) that is `ε ≤ η²` — the square, in
 *    the form it is usually quoted. For a **central** difference (`p = 2`) it
 *    is `ε ≤ η^{3/2}`, which is materially looser: at `η = 1e-3` the forward
 *    rule demands `1e-6` and the central rule only `3.2e-5`.
 *
 * **So the heuristic as usually stated is the forward-difference case, and
 * this package differences centrally by default.** Quoting the square at a
 * central-difference caller over-tightens the inner solve by an order and a
 * half of magnitude, which on this repo's own benchmark is real time
 * (`inverse-solve-perf.json`). {@link coupleTolerances} therefore takes the
 * scheme as an input rather than hard-coding the exponent.
 *
 * Neither clause dominates the other. Clause 1 scales with `τ/L` and clause 2
 * does not involve `τ` at all, so a demanding target on a short flight is
 * limited by the noise floor while a loose target on a long one is limited by
 * the Jacobian. {@link ToleranceCoupling.binding} reports which, because "your
 * tolerance is too loose" is not actionable and "your tolerance is too loose
 * *for the Jacobian*, so tighten it or difference centrally" is.
 *
 * `tolerance-coupling.test.ts` measures the rule on a real drag-and-wind
 * shooting problem rather than only unit-testing the arithmetic: it sweeps the
 * inner `rtol` across seven orders of magnitude and records what the outer
 * Newton solve actually does at each, so the breakdown the rule predicts is
 * observed rather than asserted.
 */

/** Order of the truncation error of each scheme, `O(h^p)`. Mirrors `shooting-jacobian.ts`. */
const SCHEME_ORDER: Record<FiniteDifferenceScheme, number> = {
  forward: 1,
  central: 2,
};

/**
 * Default relative accuracy demanded of the finite-difference Jacobian.
 *
 * `1e-3` rather than something near `ε`, because a Newton iteration with a
 * Jacobian carrying relative error `η` converges *linearly* with rate about
 * `η` once it leaves the quadratic phase — so `1e-3` buys roughly three
 * decimal digits per iteration, which reaches any sane residual tolerance in a
 * handful of steps. Demanding more costs inner tolerance, and inner tolerance
 * is the expensive axis: it buys steps, and steps are the whole run time.
 */
export const DEFAULT_JACOBIAN_ACCURACY = 1e-3;

/**
 * Default margin by which the residual's noise floor must sit below the outer
 * tolerance.
 *
 * `0.1` — one decimal digit of headroom. The error model behind clause 1 is an
 * order-of-magnitude statement (`rtol · L` is a bound the integrator controls,
 * not a value it reports), so a margin of 10 is meaningful and a margin of
 * 1000 would be spending inner tolerance on a false precision about the model.
 */
export const DEFAULT_NOISE_MARGIN = 0.1;

/**
 * Smallest relative tolerance the rule will ask an adaptive solver for.
 *
 * `1e-13`, about 450·ε. Below it an adaptive controller spends most of its
 * steps chasing round-off in its own error estimate rather than truncation
 * error, and the returned trajectory is not more accurate for the extra work.
 * The rule clamps here and says so via {@link ToleranceCoupling.binding}
 * rather than returning an unreachable number, because a caller whose demand
 * lands below the floor has a problem the tolerance cannot fix.
 */
export const RTOL_FLOOR = 1e-13;

/** `atol` is set to this fraction of `rtol`, matching the existing configs in this repo. */
const ATOL_RATIO = 1e-2;

/** What the caller wants from the outer solve. */
export interface ToleranceCouplingRequest {
  /**
   * The outer solver's residual tolerance, in the residual's own units
   * (metres, for a shooting residual) — `NewtonShootingOptions.residualTolerance`.
   */
  readonly residualTolerance: number;
  /**
   * Characteristic magnitude of the quantity the residual is a difference of —
   * for a shooting solve, the downrange distance, in metres.
   *
   * Required rather than defaulted, because clause 1 is a statement about
   * `rtol · L` and there is no defensible default for `L`: a 30 m lob and a
   * 3 km shot differ by two orders of magnitude in how much absolute error the
   * same `rtol` buys. Passing the target's own distance is right for a
   * shooting problem.
   */
  readonly residualScale: number;
  /**
   * Which difference quotient the outer solver's Jacobian uses. Defaults to
   * `"central"`, matching `JacobianOptions.scheme`.
   *
   * This is the input that decides whether the rule is a square or a 3/2
   * power; see this module's header.
   */
  readonly scheme?: FiniteDifferenceScheme;
  /** Relative Jacobian accuracy demanded. Defaults to {@link DEFAULT_JACOBIAN_ACCURACY}. */
  readonly jacobianAccuracy?: number;
  /** Margin on clause 1. Defaults to {@link DEFAULT_NOISE_MARGIN}. */
  readonly noiseMargin?: number;
}

/** Which of the two clauses (or the floor) decided the tolerance. */
export type ToleranceBinding = "residual-floor" | "jacobian" | "rtol-floor";

/** The coupled tolerances, and enough diagnostics to argue with them. */
export interface ToleranceCoupling {
  /** `SolverConfig.rtol` for the inner IVP. */
  readonly rtol: number;
  /** `SolverConfig.atol` for the inner IVP. */
  readonly atol: number;
  /**
   * `JacobianOptions.noiseFloor` for the outer solver, which is the same
   * number as {@link rtol} and is surfaced separately so a caller wiring both
   * ends cannot set one and forget the other — the single most likely way to
   * use this module wrongly.
   */
  readonly noiseFloor: number;
  /** Which clause produced {@link rtol}. */
  readonly binding: ToleranceBinding;
  /** Clause 1's limit: `noiseMargin · residualTolerance / residualScale`. */
  readonly residualFloorLimit: number;
  /** Clause 2's limit: `jacobianAccuracy^{(p+1)/p}`. */
  readonly jacobianLimit: number;
  /**
   * Relative Jacobian accuracy actually achievable at {@link rtol}, i.e.
   * `rtol^{p/(p+1)}`. Equal to the requested `jacobianAccuracy` when clause 2
   * binds and better than it otherwise.
   */
  readonly achievableJacobianAccuracy: number;
  /**
   * Absolute error the residual is expected to carry at {@link rtol}, i.e.
   * `rtol · residualScale`, in the residual's units. Compare it to
   * `residualTolerance`: the ratio is the headroom the outer solve has.
   */
  readonly residualNoise: number;
  /**
   * The finite-difference step {@link finiteDifferenceStep} will derive at
   * this noise floor for a unit-scaled variable. Reported because it is the
   * number that moves most under a tolerance change and the one a caller is
   * most likely to leave stale — three and a half orders of magnitude between
   * `rtol = 1e-6` and `rtol = ε` for a central difference.
   */
  readonly unitDifferenceStep: number;
}

function positive(name: string, value: number): number {
  if (!(value > 0) || !Number.isFinite(value)) {
    throw new Error(`coupleTolerances: ${name} must be finite and positive; got ${value}`);
  }
  return value;
}

/**
 * Derives inner-IVP tolerances from what the outer optimizer is being asked
 * for. See this module's header for the two clauses and ADR-017 for why.
 *
 * The result is a *ceiling*, not a recommendation to run at: a caller already
 * integrating tighter than this is fine and should stay there. What the rule
 * catches is the other direction.
 */
export function coupleTolerances(request: ToleranceCouplingRequest): ToleranceCoupling {
  const residualTolerance = positive("residualTolerance", request.residualTolerance);
  const residualScale = positive("residualScale", request.residualScale);
  const jacobianAccuracy = positive(
    "jacobianAccuracy",
    request.jacobianAccuracy ?? DEFAULT_JACOBIAN_ACCURACY,
  );
  const noiseMargin = positive("noiseMargin", request.noiseMargin ?? DEFAULT_NOISE_MARGIN);
  if (jacobianAccuracy >= 1) {
    throw new Error(
      `coupleTolerances: jacobianAccuracy must be below 1 (it is a relative error); got ${jacobianAccuracy}`,
    );
  }
  const scheme = request.scheme ?? "central";
  const order = SCHEME_ORDER[scheme];

  const residualFloorLimit = (noiseMargin * residualTolerance) / residualScale;
  const jacobianLimit = Math.pow(jacobianAccuracy, (order + 1) / order);

  const unclamped = Math.min(residualFloorLimit, jacobianLimit);
  const rtol = Math.max(unclamped, RTOL_FLOOR);
  const binding: ToleranceBinding =
    rtol > unclamped
      ? "rtol-floor"
      : residualFloorLimit <= jacobianLimit
        ? "residual-floor"
        : "jacobian";

  return {
    rtol,
    atol: rtol * ATOL_RATIO,
    noiseFloor: rtol,
    binding,
    residualFloorLimit,
    jacobianLimit,
    achievableJacobianAccuracy: Math.pow(rtol, order / (order + 1)),
    residualNoise: rtol * residualScale,
    unitDifferenceStep: finiteDifferenceStep(rtol, scheme, 1),
  };
}

/** One way a configuration fails the rule. */
export interface ToleranceViolation {
  readonly clause: ToleranceBinding;
  readonly message: string;
}

/** The verdict on an existing configuration. */
export interface ToleranceCouplingReport {
  /** True when nothing is violated. */
  readonly satisfied: boolean;
  /** Empty when {@link satisfied}. Ordered most-binding first. */
  readonly violations: readonly ToleranceViolation[];
  /** What {@link coupleTolerances} would have chosen for the same request. */
  readonly recommended: ToleranceCoupling;
}

/**
 * Audits tolerances a caller already has, rather than choosing new ones.
 *
 * This is the form the rule takes at a call site that cannot simply adopt
 * `coupleTolerances`' output — a scenario file with its own `SolverConfig`, a
 * benchmark pinning a specific tolerance, a test exercising a deliberately
 * loose solve. It returns a verdict and the reason rather than throwing,
 * because "these tolerances are inconsistent" is a diagnostic about a
 * *configuration*, and a library that threw on it could not be used to
 * *measure* the inconsistency — which is exactly what this module's own test
 * does.
 *
 * The `noiseFloor` check is the one worth reading twice. It is not a
 * restatement of the `rtol` check: a caller can integrate tightly and still
 * hand the Jacobian a stale, optimistic noise floor, and the result is a
 * difference step derived for a residual far cleaner than the one it is
 * differencing — the noise branch of the V-curve in `shooting-jacobian.ts`,
 * reached while every tolerance in sight looks conservative.
 */
export function checkToleranceCoupling(
  actual: { readonly rtol: number; readonly noiseFloor?: number },
  request: ToleranceCouplingRequest,
): ToleranceCouplingReport {
  const recommended = coupleTolerances(request);
  const rtol = positive("rtol", actual.rtol);
  const violations: ToleranceViolation[] = [];

  if (rtol > recommended.residualFloorLimit) {
    violations.push({
      clause: "residual-floor",
      message:
        `inner rtol ${rtol.toExponential(2)} leaves the residual with ` +
        `${(rtol * request.residualScale).toExponential(2)} of noise, which is not below ` +
        `the outer residualTolerance ${request.residualTolerance.toExponential(2)} ` +
        `by the required margin — the outer solve would be converging on noise. ` +
        `Need rtol <= ${recommended.residualFloorLimit.toExponential(2)}.`,
    });
  }
  if (rtol > recommended.jacobianLimit) {
    const order = SCHEME_ORDER[request.scheme ?? "central"];
    violations.push({
      clause: "jacobian",
      message:
        `inner rtol ${rtol.toExponential(2)} caps the ${request.scheme ?? "central"} ` +
        `finite-difference Jacobian's relative accuracy at ` +
        `${Math.pow(rtol, order / (order + 1)).toExponential(2)}, short of the requested ` +
        `${(request.jacobianAccuracy ?? DEFAULT_JACOBIAN_ACCURACY).toExponential(2)}. ` +
        `Need rtol <= ${recommended.jacobianLimit.toExponential(2)}.`,
    });
  }
  if (actual.noiseFloor !== undefined && actual.noiseFloor < rtol) {
    violations.push({
      clause: "jacobian",
      message:
        `the Jacobian's declared noiseFloor ${actual.noiseFloor.toExponential(2)} is below ` +
        `the inner solve's own rtol ${rtol.toExponential(2)}, so the difference step is ` +
        `derived for a cleaner residual than the one being differenced. ` +
        `Set noiseFloor to the inner rtol.`,
    });
  }

  // Most-binding first: whichever clause is furthest from being met.
  violations.sort((a, b) => {
    const limit = (v: ToleranceViolation) =>
      v.clause === "residual-floor" ? recommended.residualFloorLimit : recommended.jacobianLimit;
    return limit(a) - limit(b);
  });

  return { satisfied: violations.length === 0, violations, recommended };
}
