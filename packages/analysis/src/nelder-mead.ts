/**
 * The Nelder–Mead simplex minimizer of §7 Phase 5 (P5.12): a derivative-free
 * optimizer over `n` continuous parameters, bounded by a smooth transform and
 * restarted when its simplex collapses.
 *
 * **Why a derivative-free method exists here at all**, given that P5.10 already
 * differentiates the ODE: the blueprint (§7 preamble) wants the kit to span
 * regimes deliberately. Tangent-linear sensitivities are the efficient route
 * when the objective is a smooth functional of a trajectory and the parameter
 * count is small. They are also the route that stops working the moment an
 * objective is assembled from something that is *not* differentiable through —
 * a table lookup, a `min` over arcs, a hit/miss predicate, a user-authored
 * score. Nelder–Mead asks the objective for nothing but its value, so it is the
 * fallback that always applies, and it is what P5.14–P5.17 reach for when their
 * objectives stop being smooth. It is not the fast option and this module does
 * not pretend otherwise.
 *
 * **Bounds are imposed by a transform, not by clipping, and the difference is
 * not cosmetic.** Clipping an out-of-box vertex back onto the face flattens the
 * objective outside the box: every point beyond a bound reports the value of
 * its projection, so the simplex sees a plateau, its reflections stop changing
 * anything, and it collapses onto the face — converging to a bound that is not
 * a minimum. Reparametrizing instead means the simplex lives in an unconstrained
 * space `y` whose image is always strictly inside the box, so every point it
 * evaluates is feasible by construction and the objective it sees is the real
 * one. The transform is smooth and monotone per coordinate, so it moves the
 * minimizer's location in `y` but not which `x` is optimal.
 *
 * **What the transform costs, stated plainly: a minimum sitting exactly on a
 * bound is approached but never reached**, because `x → bound` only as
 * `y → ±∞`. Two consequences follow, and both are handled rather than hidden.
 * The iterates get within rounding of the bound long before `y` stops moving,
 * which is good enough numerically. But the simplex's *`y`-space* diameter
 * keeps growing while its `x`-space image has stopped moving, so a termination
 * test written in `y` would never fire. **Every convergence test in this module
 * is therefore evaluated on the `x` images**, never on the simplex coordinates.
 * A caller who genuinely needs an active bound reported exactly should clamp
 * the returned point, or use a method with real constraint handling — P5.16.
 *
 * **Restarts are the difference between this and a textbook implementation.**
 * Nelder–Mead has no convergence theory in more than one dimension, and
 * McKinnon's counterexamples are not pathological curiosities: the simplex
 * degenerates onto a lower-dimensional subspace, every subsequent contraction
 * happens inside that subspace, and the method reports a tidy small simplex at
 * a point that is not stationary. The standard defence, and the one P5.12's
 * criterion asks for, is to treat a converged simplex as a *hypothesis*: rebuild
 * a full-size simplex around the best point and run again. A genuine minimum
 * survives that; a collapse escapes it. This module never returns
 * `"converged"` from a first pass — convergence means a restart ran and failed
 * to improve on it.
 *
 * `nelder-mead.test.ts` takes Rosenbrock 2D to the criterion's `1e-8`, and pins
 * the restart behaviour with a start that provably collapses without it.
 */

/**
 * A scalar objective. Called only with points inside the bounds.
 *
 * A non-finite return (`NaN`, `±Infinity`) is read as `+Infinity` — "this point
 * is not admissible" — rather than as an error, so an objective may reject a
 * region by returning `NaN` and the simplex will retreat from it. The one place
 * that is fatal is the initial point: a simplex cannot be built around a vertex
 * with no finite value.
 */
export type ObjectiveFunction = (x: readonly number[]) => number;

/**
 * A box constraint on one coordinate. Omit a side to leave it unbounded; omit
 * both (or the whole entry) for a free coordinate.
 */
export interface NelderMeadBound {
  /** Inclusive in intent, approached asymptotically in practice. */
  readonly lower?: number;
  /** Inclusive in intent, approached asymptotically in practice. */
  readonly upper?: number;
}

/** Why {@link nelderMead} stopped. */
export type NelderMeadStatus =
  /**
   * The simplex met both tolerances **and** a restart from the best point
   * failed to improve on it by more than
   * {@link NelderMeadOptions.restartImprovement}.
   */
  | "converged"
  /** {@link NelderMeadOptions.maxIterations} was reached. */
  | "max-iterations"
  /** {@link NelderMeadOptions.maxEvaluations} was reached. */
  | "max-evaluations"
  /**
   * The simplex met its tolerances and improved on every restart it was
   * allowed, so {@link NelderMeadOptions.maxRestarts} ran out with the last
   * pass still making progress. The point is the best found; it is not
   * certified.
   */
  | "max-restarts"
  /** The initial point has no finite objective value. */
  | "evaluation-failed";

/** Which simplex move an iteration made. */
export type NelderMeadMove =
  "reflect" | "expand" | "contract-outside" | "contract-inside" | "shrink";

/** One iteration's diagnostics, in the order they were produced. */
export interface NelderMeadStep {
  /** 0-based iteration index, counted across restarts. */
  readonly iteration: number;
  /** How many restarts had happened when this iteration ran. */
  readonly restart: number;
  /** The move this iteration accepted. */
  readonly move: NelderMeadMove;
  /** Best vertex value after the move. */
  readonly best: number;
  /** Worst vertex value after the move. */
  readonly worst: number;
  /** The `x`-space simplex size this iteration's termination test saw. */
  readonly spread: number;
}

/** Tuning for {@link nelderMead}. Every field has a defensible default. */
export interface NelderMeadOptions {
  /**
   * Per-coordinate box constraints, index-aligned with the initial point. A
   * shorter array leaves the trailing coordinates free.
   */
  readonly bounds?: readonly NelderMeadBound[];
  /**
   * Size of the initial simplex's edges, in the *transformed* space, as either
   * one number for every coordinate or one per coordinate. Defaults to
   * `0.05 · max(|y₀ᵢ|, 1)`, the relative-5%-with-an-absolute-floor rule
   * `fminsearch` uses, which is scale-free for large coordinates and does not
   * degenerate at zero.
   */
  readonly initialStep?: number | readonly number[];
  /**
   * The first pass's simplex, given explicitly as `n + 1` vertices in the
   * caller's coordinates, overriding the one {@link initialStep} would build.
   * Restarts ignore it and rebuild from {@link initialStep} around the best
   * point — a restart that reused the simplex it is meant to escape would be
   * pointless.
   *
   * This exists because Nelder–Mead's *failure* modes are properties of a
   * specific starting simplex, not of a starting point: McKinnon's collapse
   * families are defined by their initial vertices, and without a way to state
   * them the restart machinery here could not be tested against the case it is
   * written for. It is also the way to reproduce a run exactly.
   */
  readonly initialSimplex?: readonly (readonly number[])[];
  /** Total iterations across all restarts. Defaults to `400n`. */
  readonly maxIterations?: number;
  /** Total objective evaluations across all restarts. Defaults to `800n`. */
  readonly maxEvaluations?: number;
  /**
   * Simplex size, measured on the `x` images relative to the best vertex,
   * below which the simplex counts as converged. Defaults to `1e-10`.
   */
  readonly spreadTolerance?: number;
  /**
   * Relative spread of objective values across the simplex below which it
   * counts as converged. Defaults to `1e-12`.
   */
  readonly valueTolerance?: number;
  /** Restarts allowed before giving up on certifying. Defaults to 3. */
  readonly maxRestarts?: number;
  /**
   * Relative improvement in the best value that makes a restart count as
   * having *found* something, rather than as confirming the previous pass.
   * Defaults to `1e-12`.
   */
  readonly restartImprovement?: number;
  /**
   * Use Gao–Han dimension-adaptive coefficients rather than the fixed
   * `(1, 2, ½, ½)`. Defaults to `true`.
   *
   * The two agree exactly at `n = 2`, so this changes nothing for the planar
   * aim problems of this phase; it matters from `n = 3` up, where the fixed
   * expansion factor makes the simplex progressively more likely to collapse.
   */
  readonly adaptive?: boolean;
  /** Record {@link NelderMeadResult.history}. Defaults to `true`. */
  readonly recordHistory?: boolean;
}

/** What {@link nelderMead} returns. */
export interface NelderMeadResult {
  /** Whether {@link status} is `"converged"`. */
  readonly converged: boolean;
  /** Why the iteration stopped. */
  readonly status: NelderMeadStatus;
  /** The best point found, in the caller's (bounded) coordinates. */
  readonly x: number[];
  /** The objective at {@link x}. */
  readonly fx: number;
  /** Iterations taken across all restarts. */
  readonly iterations: number;
  /** Objective evaluations spent. */
  readonly evaluations: number;
  /** Restarts performed. */
  readonly restarts: number;
  /** Per-iteration diagnostics, oldest first. */
  readonly history: readonly NelderMeadStep[];
  /** Human-readable detail when {@link converged} is false. */
  readonly failure?: string;
}

/**
 * `log(1 + eᵞ)`, the smooth monotone `ℝ → (0, ∞)` map used for one-sided
 * bounds.
 *
 * Softplus rather than `exp`: both are smooth and monotone, but `exp` turns a
 * simplex step of a few units into a factor of `e^few` in `x`, so a coordinate
 * that starts far from its bound is explored on a wildly distorted scale and
 * overflows at `y ≈ 710`. Softplus is asymptotically linear, so far from the
 * bound the transform is nearly the identity and the optimizer sees the
 * geometry the caller wrote down.
 */
function softplus(y: number): number {
  // Above ~30, eʸ ≫ 1 and log1p(eʸ) is y to within a double's precision, while
  // the intermediate would start losing digits and then overflow.
  return y > 30 ? y : Math.log1p(Math.exp(y));
}

/** Inverse of {@link softplus}: `log(eˣ − 1)`, for `x > 0`. */
function inverseSoftplus(x: number): number {
  return x > 30 ? x : Math.log(Math.expm1(x));
}

/** A per-coordinate reparametrization and its inverse. */
interface CoordinateTransform {
  /** Unconstrained `y` to bounded `x`. */
  readonly forward: (y: number) => number;
  /** Bounded `x` to unconstrained `y`. Only ever called on the initial point. */
  readonly inverse: (x: number) => number;
}

const IDENTITY_TRANSFORM: CoordinateTransform = {
  forward: (y) => y,
  inverse: (x) => x,
};

/**
 * How far inside a bound the initial point is pulled before being transformed.
 *
 * The inverse transforms are infinite exactly at the bounds, so a caller who
 * starts at one — entirely reasonable, e.g. a launch angle of 0 in `[0, π/2]` —
 * would otherwise produce a `±Infinity` vertex and an all-`NaN` simplex. The
 * point is nudged to a relative `1e-6` of the box interior instead. That is a
 * change to the *starting guess* only, and Nelder–Mead's first move is larger
 * than it by orders of magnitude.
 */
const BOUND_INSET = 1e-6;

/** Build the reparametrization for one coordinate. */
function coordinateTransform(bound: NelderMeadBound | undefined): CoordinateTransform {
  const lower = bound?.lower;
  const upper = bound?.upper;
  const hasLower = lower !== undefined && Number.isFinite(lower);
  const hasUpper = upper !== undefined && Number.isFinite(upper);

  if (hasLower && hasUpper) {
    const lo = lower;
    const hi = upper;
    if (!(hi > lo)) {
      throw new Error(`nelderMead: bound upper (${hi}) must exceed lower (${lo})`);
    }
    const half = (hi - lo) / 2;
    // x = lo + (hi − lo)·(tanh y + 1)/2. Monotone, smooth, image exactly (lo, hi).
    return {
      forward: (y) => lo + half * (Math.tanh(y) + 1),
      inverse: (x) => {
        const inset = (hi - lo) * BOUND_INSET;
        const clamped = Math.min(Math.max(x, lo + inset), hi - inset);
        return Math.atanh((clamped - lo) / half - 1);
      },
    };
  }
  if (hasLower) {
    const lo = lower;
    return {
      forward: (y) => lo + softplus(y),
      inverse: (x) => inverseSoftplus(Math.max(x - lo, BOUND_INSET)),
    };
  }
  if (hasUpper) {
    const hi = upper;
    return {
      forward: (y) => hi - softplus(-y),
      inverse: (x) => -inverseSoftplus(Math.max(hi - x, BOUND_INSET)),
    };
  }
  return IDENTITY_TRANSFORM;
}

/** The four simplex coefficients, either fixed or dimension-adaptive. */
interface SimplexCoefficients {
  readonly reflection: number;
  readonly expansion: number;
  readonly contraction: number;
  readonly shrink: number;
}

/**
 * Gao–Han (2012) adaptive coefficients, which reduce to the classical
 * `(1, 2, ½, ½)` at `n = 2`.
 *
 * The fixed expansion factor of 2 is what degrades in higher dimensions: the
 * expected volume change per iteration grows with `n`, so the simplex either
 * balloons or, after the shrink that follows, flattens. Scaling expansion as
 * `1 + 2/n` and shrink as `1 − 1/n` keeps the ratio bounded.
 */
function simplexCoefficients(n: number, adaptive: boolean): SimplexCoefficients {
  if (!adaptive) {
    return { reflection: 1, expansion: 2, contraction: 0.5, shrink: 0.5 };
  }
  return {
    reflection: 1,
    expansion: 1 + 2 / n,
    contraction: 0.75 - 1 / (2 * n),
    shrink: 1 - 1 / n,
  };
}

/**
 * Minimize `objective` over `n` continuous parameters by the Nelder–Mead
 * simplex method, with box constraints imposed by reparametrization and
 * automatic restarts on simplex collapse.
 *
 * @param objective The function to minimize. See {@link ObjectiveFunction} for
 *   how non-finite values are read.
 * @param initialPoint Starting guess, in the caller's coordinates. Its length
 *   fixes `n`. A component outside its bound is pulled just inside.
 * @param options See {@link NelderMeadOptions}.
 */
export function nelderMead(
  objective: ObjectiveFunction,
  initialPoint: readonly number[],
  options: NelderMeadOptions = {},
): NelderMeadResult {
  const n = initialPoint.length;
  if (n === 0) {
    throw new Error("nelderMead: initialPoint must have at least one coordinate");
  }
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(initialPoint[i]!)) {
      throw new Error(`nelderMead: initialPoint[${i}] is not finite (${initialPoint[i]})`);
    }
  }

  const maxIterations = options.maxIterations ?? 400 * n;
  const maxEvaluations = options.maxEvaluations ?? 800 * n;
  const spreadTolerance = options.spreadTolerance ?? 1e-10;
  const valueTolerance = options.valueTolerance ?? 1e-12;
  const maxRestarts = options.maxRestarts ?? 3;
  const restartImprovement = options.restartImprovement ?? 1e-12;
  const recordHistory = options.recordHistory ?? true;
  const { reflection, expansion, contraction, shrink } = simplexCoefficients(
    n,
    options.adaptive ?? true,
  );

  const transforms: CoordinateTransform[] = [];
  for (let i = 0; i < n; i++) {
    transforms.push(coordinateTransform(options.bounds?.[i]));
  }

  const steps: number[] = [];
  const startY: number[] = [];
  for (let i = 0; i < n; i++) {
    const y = transforms[i]!.inverse(initialPoint[i]!);
    startY.push(y);
    const requested = options.initialStep;
    const step =
      requested === undefined
        ? 0.05 * Math.max(Math.abs(y), 1)
        : typeof requested === "number"
          ? requested
          : requested[i]!;
    if (!(step > 0) || !Number.isFinite(step)) {
      throw new Error(`nelderMead: initialStep for coordinate ${i} must be positive; got ${step}`);
    }
    steps.push(step);
  }

  const history: NelderMeadStep[] = [];
  let evaluations = 0;
  let iterations = 0;
  let restarts = 0;

  /** Map a simplex point to the caller's coordinates. */
  const toX = (y: readonly number[]): number[] => {
    const x: number[] = [];
    for (let i = 0; i < n; i++) {
      x.push(transforms[i]!.forward(y[i]!));
    }
    return x;
  };

  /** Evaluate, counting the call and folding non-finite results to `+∞`. */
  const evaluate = (y: readonly number[]): number => {
    evaluations++;
    const value = objective(toX(y));
    return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
  };

  // The first pass's vertices, in simplex space: either the caller's explicit
  // simplex or the incumbent plus one displaced coordinate each.
  let firstSimplexY: number[][];
  if (options.initialSimplex === undefined) {
    firstSimplexY = [[...startY]];
    for (let i = 0; i < n; i++) {
      const vertex = [...startY];
      vertex[i] = vertex[i]! + steps[i]!;
      firstSimplexY.push(vertex);
    }
  } else {
    const given = options.initialSimplex;
    if (given.length !== n + 1) {
      throw new Error(
        `nelderMead: initialSimplex must have ${n + 1} vertices for ${n} coordinate(s); got ${given.length}`,
      );
    }
    firstSimplexY = given.map((vertex, v) => {
      if (vertex.length !== n) {
        throw new Error(
          `nelderMead: initialSimplex[${v}] has ${vertex.length} coordinate(s); expected ${n}`,
        );
      }
      const y: number[] = [];
      for (let i = 0; i < n; i++) {
        if (!Number.isFinite(vertex[i]!)) {
          throw new Error(`nelderMead: initialSimplex[${v}][${i}] is not finite (${vertex[i]})`);
        }
        y.push(transforms[i]!.inverse(vertex[i]!));
      }
      return y;
    });
  }

  let bestY = [...firstSimplexY[0]!];
  let bestValue = Number.POSITIVE_INFINITY;
  let budgetStatus: NelderMeadStatus | undefined;

  // Each pass runs a full simplex to its tolerances; the loop around it is the
  // restart mechanism described in the module comment.
  for (let pass = 0; pass <= maxRestarts; pass++) {
    if (pass > 0) {
      restarts = pass;
    }
    const passStartValue = bestValue;

    // Pass 0 uses the simplex assembled above. Every restart builds a fresh one
    // around the incumbent at the *original* step size — that is the whole
    // point of a restart, since reusing the collapsed simplex's scale would
    // just reproduce the collapse.
    let simplexY: number[][];
    const values: number[] = [];
    if (pass === 0) {
      simplexY = firstSimplexY;
      for (const vertex of simplexY) {
        values.push(evaluate(vertex));
      }
      if (!values.some((value) => Number.isFinite(value))) {
        return {
          converged: false,
          status: "evaluation-failed",
          x: toX(simplexY[0]!),
          fx: Number.POSITIVE_INFINITY,
          iterations: 0,
          evaluations,
          restarts: 0,
          history,
          failure: "the objective has no finite value at any initial simplex vertex",
        };
      }
    } else {
      simplexY = [[...bestY]];
      values.push(bestValue);
      for (let i = 0; i < n; i++) {
        const vertex = [...bestY];
        vertex[i] = vertex[i]! + steps[i]!;
        simplexY.push(vertex);
        values.push(evaluate(vertex));
      }
    }

    let order = sortedOrder(values);
    let passConverged = false;

    while (true) {
      if (iterations >= maxIterations) {
        budgetStatus = "max-iterations";
        break;
      }
      if (evaluations >= maxEvaluations) {
        budgetStatus = "max-evaluations";
        break;
      }

      const bestIndex = order[0]!;
      const worstIndex = order[n]!;
      const secondWorstIndex = order[n - 1]!;
      const bestVertexX = toX(simplexY[bestIndex]!);

      // Both termination tests live in x space — see the module comment on what
      // a y-space test would miss once a transform saturates.
      let spread = 0;
      for (let v = 0; v <= n; v++) {
        if (v === bestIndex) continue;
        const candidate = toX(simplexY[v]!);
        for (let i = 0; i < n; i++) {
          const scale = Math.max(Math.abs(bestVertexX[i]!), 1);
          spread = Math.max(spread, Math.abs(candidate[i]! - bestVertexX[i]!) / scale);
        }
      }
      const fBest = values[bestIndex]!;
      const fWorst = values[worstIndex]!;
      const valueSpread =
        Number.isFinite(fWorst) && Number.isFinite(fBest)
          ? (2 * Math.abs(fWorst - fBest)) / (Math.abs(fWorst) + Math.abs(fBest) + Number.EPSILON)
          : Number.POSITIVE_INFINITY;
      if (spread <= spreadTolerance && valueSpread <= valueTolerance) {
        passConverged = true;
        break;
      }

      // Centroid of every vertex but the worst.
      const centroid: number[] = new Array<number>(n).fill(0);
      for (let v = 0; v <= n; v++) {
        if (v === worstIndex) continue;
        const vertex = simplexY[v]!;
        for (let i = 0; i < n; i++) {
          centroid[i] = centroid[i]! + vertex[i]! / n;
        }
      }
      const worstVertex = simplexY[worstIndex]!;
      const along = (coefficient: number): number[] => {
        const point: number[] = [];
        for (let i = 0; i < n; i++) {
          point.push(centroid[i]! + coefficient * (centroid[i]! - worstVertex[i]!));
        }
        return point;
      };

      let move: NelderMeadMove;
      const reflected = along(reflection);
      const reflectedValue = evaluate(reflected);

      if (reflectedValue < values[bestIndex]!) {
        // Better than the best: try to keep going in that direction.
        const expanded = along(expansion);
        const expandedValue = evaluate(expanded);
        if (expandedValue < reflectedValue) {
          simplexY[worstIndex] = expanded;
          values[worstIndex] = expandedValue;
          move = "expand";
        } else {
          simplexY[worstIndex] = reflected;
          values[worstIndex] = reflectedValue;
          move = "reflect";
        }
      } else if (reflectedValue < values[secondWorstIndex]!) {
        simplexY[worstIndex] = reflected;
        values[worstIndex] = reflectedValue;
        move = "reflect";
      } else {
        // Reflection did not beat the second-worst: contract, on whichever side
        // of the centroid the better of (reflected, worst) sits.
        const outside = reflectedValue < values[worstIndex]!;
        const contracted = along(outside ? contraction * reflection : -contraction);
        const contractedValue = evaluate(contracted);
        const accept = outside
          ? contractedValue <= reflectedValue
          : contractedValue < values[worstIndex]!;
        if (accept) {
          simplexY[worstIndex] = contracted;
          values[worstIndex] = contractedValue;
          move = outside ? "contract-outside" : "contract-inside";
        } else {
          // Nothing worked: pull every vertex toward the best one.
          const anchor = simplexY[bestIndex]!;
          for (let v = 0; v <= n; v++) {
            if (v === bestIndex) continue;
            const vertex = simplexY[v]!;
            const pulled: number[] = [];
            for (let i = 0; i < n; i++) {
              pulled.push(anchor[i]! + shrink * (vertex[i]! - anchor[i]!));
            }
            simplexY[v] = pulled;
            values[v] = evaluate(pulled);
          }
          move = "shrink";
        }
      }

      order = sortedOrder(values);
      if (recordHistory) {
        history.push({
          iteration: iterations,
          restart: restarts,
          move,
          best: values[order[0]!]!,
          worst: values[order[n]!]!,
          spread,
        });
      }
      iterations++;
    }

    // Whatever ended the pass, keep its best vertex.
    const passBest = order[0]!;
    if (values[passBest]! < bestValue) {
      bestValue = values[passBest]!;
      bestY = [...simplexY[passBest]!];
    }

    if (budgetStatus !== undefined) break;
    if (!passConverged) break;

    if (maxRestarts === 0) {
      // Certification explicitly disabled: the caller asked for a bare
      // Nelder–Mead and gets the first pass's tolerance hit at face value.
      return {
        converged: true,
        status: "converged",
        x: toX(bestY),
        fx: bestValue,
        iterations,
        evaluations,
        restarts,
        history,
      };
    }

    if (pass > 0) {
      // A restart that failed to improve on the pass before it is the
      // certificate: two independent simplexes agree this point is a minimum.
      const denominator = Math.max(Math.abs(passStartValue), 1);
      const improvement = (passStartValue - bestValue) / denominator;
      if (improvement <= restartImprovement) {
        return {
          converged: true,
          status: "converged",
          x: toX(bestY),
          fx: bestValue,
          iterations,
          evaluations,
          restarts,
          history,
        };
      }
    }
  }

  const status: NelderMeadStatus = budgetStatus ?? "max-restarts";
  return {
    converged: false,
    status,
    x: toX(bestY),
    fx: bestValue,
    iterations,
    evaluations,
    restarts,
    history,
    failure:
      status === "max-restarts"
        ? `every one of ${maxRestarts} restart(s) improved on the pass before it, so the last simplex was still making progress`
        : `stopped after ${iterations} iteration(s) and ${evaluations} evaluation(s) without meeting both tolerances`,
  };
}

/**
 * Vertex indices ordered by ascending value, `+Infinity` last.
 *
 * `Array.prototype.sort`'s comparator is fed `Infinity - Infinity = NaN` if the
 * values are subtracted, and a `NaN` comparator result leaves the order
 * unspecified — which would silently scramble a simplex whose vertices are all
 * outside an objective's admissible region. Comparing rather than subtracting
 * keeps that case well defined.
 */
function sortedOrder(values: readonly number[]): number[] {
  const order = values.map((_, index) => index);
  order.sort((a, b) => {
    const va = values[a]!;
    const vb = values[b]!;
    if (va < vb) return -1;
    if (va > vb) return 1;
    return 0;
  });
  return order;
}
