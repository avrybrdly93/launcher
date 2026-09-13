/**
 * Per-thread observable capture for the fixed-step planar RK4 flight: apex and
 * range, reduced as the trajectory is produced rather than from a recorded
 * history (P7.16).
 *
 * ## What this is for
 *
 * `wgsl-rk4-kernel.ts` runs one trajectory per GPU thread and writes back the
 * **final state**. That is enough for P7.14's agreement check and useless for an
 * ensemble study, which wants range and apex per trajectory and does not want
 * the trajectory: writing every step of 1e4 flights back across the bus to
 * compute two scalars per flight is the readback dominating the compute.
 *
 * So the reduction has to happen on-device, and this module is the **CPU
 * reference it is measured against** -- the same algorithm, in the same order,
 * at a parameterised working precision. `wgsl-observables-kernel.ts` is its
 * transcription.
 *
 * ## Why the reference is parameterised by precision rather than written twice
 *
 * P7.16's criterion is "matches CPU observables within f32 tolerance", and the
 * 101st run's claim commit settled which of three possible comparisons that
 * names. The gate is the device reduction against **this module at
 * `round = toF32`**: same algorithm, same trajectory, same precision, so a
 * disagreement is about the device and nothing else. Comparing instead against
 * `@ballista/analysis`'s f64 `apex`/`range` over an f64 adaptive solve would
 * move three things at once -- arithmetic width, execution target, and
 * fixed-step against event-localised -- and a pass would be a statement about
 * how the three happened to cancel.
 *
 * That gate alone would only prove a transcription agrees with its own twin.
 * Two further checks in `planar-observables-reduction.test.ts` are what make it
 * evidence about correctness rather than about copying:
 *
 * 1. At `round = identity` the helpers below reproduce
 *    `hermiteValue` and `hermiteStationaryPoint` from
 *    `@ballista/analysis` **exactly**, so this is one algorithm with a
 *    precision knob and not a second implementation free to drift. That is the
 *    same argument `observables.ts` makes for sharing those two functions with
 *    `observable-sink.ts`.
 * 2. On the drag-free case the results are checked against the closed forms
 *    $h_{\max} = v_{y0}^2/2g$ and $R = v_0^2 \sin 2\theta / g$, where the
 *    Hermite refinement is not merely accurate but exact to roundoff: $y(t)$ is
 *    a quadratic, $v_y(t)$ is linear, and a cubic Hermite reproduces any cubic
 *    exactly, so the interpolant *is* the arc.
 *
 * ## Why apex is refined rather than read off the rows
 *
 * Identically to `observables.ts`'s `apex`, and the reasoning is imported
 * wholesale: the apex almost never falls on a step boundary, so a row-wise
 * maximum of the vertical position is $O(h^2)$ accurate. Each **downward** zero
 * crossing of $v_y$ is refined instead, on the cubic Hermite basis with the
 * recorded $v_y$ as the derivative -- free here, since $\dot y = v_y$ is a state
 * channel. Differentiating that cubic gives a quadratic whose root in $[0,1]$ is
 * the apex.
 *
 * Downward crossings only: the upward crossing on a bouncing arc is a *minimum*
 * of $y$. Endpoints are candidates too, which is what makes a monotonic arc --
 * a downward launch, or a flight cut off while still climbing -- report its
 * launch or final row rather than nothing.
 *
 * ## Why range is a captured event and not the final row
 *
 * `observables.ts`'s `range` reads the last recorded row, and says plainly that
 * this is only the impact point because `integrate` root-localizes the terminal
 * crossing before dispatching to its sinks. **The GPU kernel has no event
 * localization and cannot have one**: a per-thread terminal event means a
 * per-thread trip count, and the uniform trip count is the whole reason §4.10
 * picks fixed-step RK4 for ensembles.
 *
 * So the ground crossing is captured instead -- the first downward crossing of
 * $y = 0$ -- and refined to the same Hermite basis. That recovers the quantity
 * event localization would have produced, without a data-dependent loop. The
 * flight keeps integrating past it; {@link PlanarObservables.impacted} says
 * whether a crossing was ever seen, and a caller that ignores it and reads
 * `range` off a flight that never landed gets `0`, documented rather than
 * silently plausible.
 *
 * **First crossing only**, matching `heightAtDownrange`'s convention: a bouncing
 * trajectory reports its first landing, which is the one "range" means.
 *
 * ## Divergence-free, which is a constraint on this file and not only on the shader
 *
 * The WGSL transcription must not branch on per-thread state, so the algorithm
 * here is written in the shape that transcribes to `select`: flags rather than
 * early returns, both roots of the quadratic always computed, and the impact
 * bisection hoisted **out** of the step loop and run exactly once at
 * {@link PlanarObservableReducer.finish}. Hoisting it is not a micro-optimisation
 * -- a 60-iteration bisection inside the step loop would cost more than the
 * integration it is observing, and running it only on the crossing step is
 * exactly the data-dependent branch that is forbidden. Capturing ten floats of
 * bracket and bisecting once afterwards is uniform across every thread.
 *
 * The shape is deliberate and the CPU side does not need it. It is here so that
 * the two implementations are the same algorithm rather than two algorithms with
 * the same output on the cases tested.
 */

import {
  DIM,
  VX,
  VY,
  X,
  Y,
  integratePlanarRk4,
  type PlanarDragParams,
  type RoundFn,
} from "@ballista/solverkit";

/**
 * Halvings used to invert the vertical Hermite for the ground crossing.
 *
 * 60 matches `heightAtDownrange`'s bisection in `observables.ts`, and the count
 * is fixed rather than tolerance-driven for the reason that module gives --
 * 60 halvings take the parameter to roundoff on a scalar polynomial evaluation
 * -- plus one this module adds: **a tolerance-driven loop has a data-dependent
 * trip count**, which is what the shader may not have. A fixed count is the
 * same work on every thread.
 *
 * It is more halvings than binary32 can resolve; the surplus iterations are
 * no-ops that cost a little arithmetic and keep the two implementations
 * identical rather than "identical apart from the loop bound".
 */
export const IMPACT_BISECTION_STEPS = 60;

/** Observables reduced from one flight. */
export interface PlanarObservables {
  /** Greatest vertical position reached, Hermite-refined across the apex step. */
  readonly apexHeight: number;
  /** Time at which {@link apexHeight} occurs, on the flight's own clock. */
  readonly apexT: number;
  /**
   * Horizontal distance from the launch point to the first ground crossing.
   *
   * `0` when {@link impacted} is false -- the flight never crossed `y = 0`, so
   * there is no impact point to measure to. Check {@link impacted} before
   * reading this, exactly as `observables.ts` says to check `SolveReport.status`
   * before trusting its impact observables.
   */
  readonly range: number;
  /** Time of the first ground crossing, or `0` when {@link impacted} is false. */
  readonly impactT: number;
  /** Whether a downward crossing of `y = 0` was ever seen. */
  readonly impacted: boolean;
}

/**
 * Cubic Hermite value at `theta`, with every operation taken at `round`'s
 * precision.
 *
 * Operation-for-operation from `@ballista/analysis`'s `hermiteValue`; at
 * `round = identity` the
 * two are asserted bit-identical, which is what licenses calling this "the same
 * function at another precision" rather than a second implementation.
 */
export function hermiteValueAt(
  y0: number,
  d0: number,
  y1: number,
  d1: number,
  h: number,
  theta: number,
  round: RoundFn,
): number {
  const t2 = round(theta * theta);
  const t3 = round(t2 * theta);
  const c0 = round(round(round(2 * t3) - round(3 * t2)) + 1);
  const c1 = round(round(t3 - round(2 * t2)) + theta);
  const c2 = round(round(-round(2 * t3)) + round(3 * t2));
  const c3 = round(t3 - t2);
  return round(
    round(round(round(c0 * y0) + round(round(h * c1) * d0)) + round(c2 * y1)) +
      round(round(h * c3) * d1),
  );
}

/**
 * The `theta` in `[0, 1]` at which the cubic Hermite above is stationary.
 *
 * Returns `{ theta, valid }` rather than `number | undefined` because WGSL has
 * no option type and the transcription must not branch: the shader computes
 * both roots unconditionally and `select`s between them, so this returns the
 * same shape. `valid === false` leaves `theta` unspecified; callers must not
 * read it.
 *
 * Both roots are computed even when the first is already in range, for the same
 * reason. The sign-stable form `q = -(b + sign(b)*sqrt(disc))/2` is
 * `hermiteStationaryPoint`'s, kept because the near-degenerate case it
 * protects (`|a| << |b|`, a nearly-linear derivative) is exactly what a small
 * step produces -- and f32 has far fewer digits to lose to the cancellation the
 * textbook formula suffers there.
 */
export function hermiteStationaryThetaAt(
  y0: number,
  d0: number,
  y1: number,
  d1: number,
  h: number,
  round: RoundFn,
): { readonly theta: number; readonly valid: boolean } {
  const dy = round(y1 - y0);
  const hd0 = round(h * d0);
  const hd1 = round(h * d1);
  const a = round(3 * round(round(hd0 + hd1) - round(2 * dy)));
  // `2 * h * d0` in the reference is `(2 * h) * d0`, not `2 * (h * d0)`. The two
  // agree exactly in both precisions -- scaling by a power of two is exact away
  // from overflow -- but the reference's association is kept rather than relied
  // on being equivalent.
  const b = round(2 * round(round(round(3 * dy) - round(round(2 * h) * d0)) - hd1));
  const c = hd0;

  // The a == 0 branch: the derivative is genuinely linear and the root is -c/b.
  const linearRoot = round(round(-c) / b);
  const linearOk = a === 0 && b !== 0;

  // The quadratic branch. Computed unconditionally; a negative discriminant
  // makes sqrtDisc NaN and every comparison below false, which is the rejection
  // the reference expresses with an early return.
  const disc = round(round(b * b) - round(round(4 * a) * c));
  const sqrtDisc = round(Math.sqrt(disc));
  const q = round(round(-0.5) * round(b + (b >= 0 ? sqrtDisc : round(-sqrtDisc))));
  const root0 = round(q / a);
  const root1 = round(c / q);
  const quadOk = a !== 0 && disc >= 0;

  const root0Ok = quadOk && root0 >= 0 && root0 <= 1;
  const root1Ok = quadOk && q !== 0 && root1 >= 0 && root1 <= 1;
  const linearInRange = linearOk && linearRoot >= 0 && linearRoot <= 1;

  // Order matches the reference's `roots` array: the linear root when a == 0,
  // otherwise q/a before c/q.
  if (linearInRange) return { theta: linearRoot, valid: true };
  if (root0Ok) return { theta: root0, valid: true };
  if (root1Ok) return { theta: root1, valid: true };
  return { theta: 0, valid: false };
}

/**
 * Incremental reducer: fed the flight one accepted step at a time, in order.
 *
 * Stateful rather than a function over a history array because the thing it
 * models has no history array -- a GPU thread holds its previous state in
 * registers and sees each step once. A reducer that needed the trajectory would
 * not be a reference for the shader, it would be a reference for a different
 * program.
 */
export class PlanarObservableReducer {
  private readonly round: RoundFn;
  private readonly x0: number;

  private prevT: number;
  private prev: Float64Array;

  private bestT: number;
  private bestHeight: number;

  private impacted = false;
  private impactBracketT = 0;
  private impactH = 0;
  private impactY0 = 0;
  private impactVy0 = 0;
  private impactY1 = 0;
  private impactVy1 = 0;
  private impactX0 = 0;
  private impactVx0 = 0;
  private impactX1 = 0;
  private impactVx1 = 0;

  /**
   * @param y0 initial state `[x, y, vx, vy]`, already at working precision.
   * @param t0 launch time on the flight's own clock.
   */
  constructor(y0: ArrayLike<number>, t0: number, round: RoundFn) {
    this.round = round;
    this.prev = new Float64Array(DIM);
    for (let i = 0; i < DIM; i++) this.prev[i] = y0[i]!;
    this.prevT = t0;
    this.x0 = this.prev[X]!;
    // The launch point is always an apex candidate: it is the answer for a
    // downward launch, and it costs nothing otherwise.
    this.bestT = t0;
    this.bestHeight = this.prev[Y]!;
  }

  /** Accepts the state at the end of one step. `t` is that step's end time. */
  step(t: number, y: ArrayLike<number>): void {
    const round = this.round;
    const h = round(t - this.prevT);

    const y0 = this.prev[Y]!;
    const vy0 = this.prev[VY]!;
    const y1 = y[Y]!;
    const vy1 = y[VY]!;

    // Apex: downward crossings of v_y only. h <= 0 cannot arise from a
    // fixed-step march, but the guard is the reference's and is kept so the
    // shapes match.
    const apexCrossing = vy0 >= 0 && vy1 < 0 && h > 0;
    const stat = hermiteStationaryThetaAt(y0, vy0, y1, vy1, h, round);
    if (apexCrossing && stat.valid) {
      const height = hermiteValueAt(y0, vy0, y1, vy1, h, stat.theta, round);
      this.consider(round(this.prevT + round(stat.theta * h)), height);
    }

    // Ground crossing: capture the bracket, refine after the loop.
    if (!this.impacted && y0 >= 0 && y1 < 0 && h > 0) {
      this.impacted = true;
      this.impactBracketT = this.prevT;
      this.impactH = h;
      this.impactY0 = y0;
      this.impactVy0 = vy0;
      this.impactY1 = y1;
      this.impactVy1 = vy1;
      this.impactX0 = this.prev[X]!;
      this.impactVx0 = this.prev[VX]!;
      this.impactX1 = y[X]!;
      this.impactVx1 = y[VX]!;
    }

    for (let i = 0; i < DIM; i++) this.prev[i] = y[i]!;
    this.prevT = t;
  }

  /** Closes the flight and returns its observables. */
  finish(): PlanarObservables {
    const round = this.round;
    // The final row is an apex candidate, for the arc cut off while climbing.
    this.consider(this.prevT, this.prev[Y]!);

    if (!this.impacted) {
      return {
        apexHeight: this.bestHeight,
        apexT: this.bestT,
        range: 0,
        impactT: 0,
        impacted: false,
      };
    }

    // Bisection on the vertical Hermite, which the capture above already knows
    // brackets a sign change: y(0) >= 0 > y(1). A bisection on such a bracket
    // cannot leave it, which is why no convergence test -- and so no
    // data-dependent trip count -- is needed.
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < IMPACT_BISECTION_STEPS; i++) {
      const mid = round(round(0.5) * round(lo + hi));
      const value = hermiteValueAt(
        this.impactY0,
        this.impactVy0,
        this.impactY1,
        this.impactVy1,
        this.impactH,
        mid,
        round,
      );
      if (value >= 0) lo = mid;
      else hi = mid;
    }
    const theta = round(round(0.5) * round(lo + hi));

    const impactX = hermiteValueAt(
      this.impactX0,
      this.impactVx0,
      this.impactX1,
      this.impactVx1,
      this.impactH,
      theta,
      round,
    );

    return {
      apexHeight: this.bestHeight,
      apexT: this.bestT,
      range: round(Math.abs(round(impactX - this.x0))),
      impactT: round(this.impactBracketT + round(theta * this.impactH)),
      impacted: true,
    };
  }

  private consider(t: number, height: number): void {
    if (height > this.bestHeight) {
      this.bestHeight = height;
      this.bestT = t;
    }
  }
}

/** Options for {@link reducePlanarObservables}. */
export interface PlanarObservablesOptions {
  /** Initial state `[x, y, vx, vy]`. */
  readonly y0: ArrayLike<number>;
  /** Fixed step size. */
  readonly h: number;
  /** Number of steps to take. */
  readonly steps: number;
  /** Model parameters. */
  readonly params: PlanarDragParams;
  /** Working precision: `toF32` for the shader comparison, `identity` for f64. */
  readonly round: RoundFn;
  /** Start time; defaults to 0. */
  readonly t0?: number;
}

/**
 * Integrates one flight with {@link integratePlanarRk4} and reduces it.
 *
 * Driven through that function's `onStep` hook rather than re-implementing the
 * march, so the trajectory this reduces is by construction the same one P7.14
 * compared against the device -- the reduction is the only new thing in the
 * comparison.
 */
export function reducePlanarObservables(options: PlanarObservablesOptions): PlanarObservables {
  const { round } = options;
  const t0 = round(options.t0 ?? 0);
  const y0 = new Float64Array(DIM);
  for (let i = 0; i < DIM; i++) y0[i] = round(options.y0[i]!);

  const reducer = new PlanarObservableReducer(y0, t0, round);
  integratePlanarRk4({
    y0,
    h: options.h,
    steps: options.steps,
    params: options.params,
    round,
    t0,
    onStep: (_step, t, y) => reducer.step(t, y),
  });
  return reducer.finish();
}
