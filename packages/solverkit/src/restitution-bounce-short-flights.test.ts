import { describe, expect, it } from "vitest";
import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  G_STD,
  GravityForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
} from "@ballista/engine";
import { ClassicalRK4Stepper } from "./classical-rk4-stepper.js";
import { createDormandPrince54Stepper } from "./dormand-prince-54.js";
import { EventCollector } from "./event-collector.js";
import { HermiteDenseOutputStepper } from "./hermite-dense-output.js";
import { integrate } from "./integrate.js";

/**
 * Closed-form regression pin for a drag-free bouncing ball (filed under P0.98).
 *
 * **Read this before assuming what the file covers.** P0.98 asked for a test of
 * restitution bounces whose whole flight is shorter than a quarter step, on the
 * reasoning that `restitutionBounceAction` reflects `v_y` and leaves `y`
 * exactly at 0, so every bounce after the first begins a step with the ground
 * event already active -- the configuration P0.97 found returning silently
 * wrong answers. That reasoning is sound, but **the regime is not reachable
 * from the adaptive driver**, which is why this file does not claim P0.98.
 *
 * Measured, not assumed: with `createDormandPrince54Stepper` the driver
 * truncates each step to land on the localized event, so the step shrinks in
 * lockstep with the bounces. Across every bounce of the `e = 0.5` and `e = 0.2`
 * sequences the ratio `flight / step` sits at exactly 5.00 -- each flight is
 * covered by about five steps, never a fraction of one. Emptying P0.97's
 * `DEPARTURE_THETAS` ladder entirely leaves all five cases below green, which
 * is the direct proof that the sub-interval path is not exercised here.
 * Reaching it needs a fixed step, and that is currently blocked by a separate
 * defect: a stepper with no dense output has event detection silently switched
 * off (see the `hasEvents` guard in `integrate.ts`), filed as its own task.
 *
 * What this file therefore is: a closed-form pin on impact *times* and the
 * resolved impact *count* for a bouncing solve, which did not exist before.
 * `restitution-bounce.test.ts` asserts energy conservation, re-arming and
 * monotone decay, but never checks an impact time against an analytical value.
 *
 * The oracle is closed form, so no reference implementation is involved. A
 * drag-free ball released from rest at `h0` first strikes the ground at
 *
 *   t0 = sqrt(2 h0 / g)
 *
 * with speed `v0 = g t0`. Restitution `e` returns it upward at `e^n v0` after
 * the nth impact, and a projectile launched vertically at speed `u` is aloft
 * for `2u/g`, so the nth bounce lasts `2 e^n t0` and the impacts fall at
 *
 *   t_n = t0 (1 + 2 e (1 - e^n) / (1 - e)),   n = 0, 1, 2, ...
 *
 * summing the geometric series. The whole sequence accumulates at
 * `t_inf = t0 (1 + 2e/(1-e))`, which is Zeno: infinitely many impacts in finite
 * time. No integrator resolves all of them, so the count below is pinned at
 * what this configuration actually resolves rather than at a physical truth.
 *
 * Nothing here was broken when written; every assertion passed first time. It
 * is a pin, not a bug report.
 */
/**
 * Where a drag-free bounce sequence stops advancing in time (P0.101).
 *
 * Since the surface snap landed, a `vRest: 0` sequence has **two regimes**
 * and an assertion that does not distinguish them is asserting the wrong
 * thing about one of them:
 *
 *   * impacts 0..7 are genuinely *resolved*: each has its own time, matching
 *     the closed form to under 1e-15 relative.
 *   * from impact 8 the remaining flight is shorter than the finest rung of
 *     the `DEPARTURE_THETAS` ladder, so the scan sees the ball leave and
 *     return inside the first sub-interval and the event fires at the step
 *     start. Time stops advancing, `y` is pinned to exactly 0 by the snap,
 *     and `v_y` grinds down by a factor `e` per impact -- alternating sign,
 *     because each record is the pre-action state -- until it underflows to
 *     0 and the rest condition `e*|v_y| <= 0` ends the solve.
 *
 * The saturated tail is an artefact of finite precision, not physics, and it
 * is filed as P0.144. It is pinned here rather than ignored, because the
 * thing that must never come back is the *old* behaviour, where the sequence
 * simply stopped being detected and the ball fell through the ground.
 */
const RESOLVED_IMPACTS = 8;
/** Total records including the saturated tail, down to the denormal floor. */
const TOTAL_IMPACTS = 465;

describe("integrate: drag-free bouncing ball against the closed form (P0.98 groundwork)", () => {
  // Chosen so that the *default* step is in play (h = tspan/100 = 0.12, the
  // DEFAULT_STEP_COUNT path P0.97's mechanism note is written against) and so
  // that several resolved bounces fall below h/4. e = 0.2 decays fast enough to
  // get there within the resolvable range; e = 0.5 does not -- its last
  // resolvable bounce is still longer than h/4, which is why this file does not
  // reuse the existing tests' parameters.
  const H0 = 5;
  const E = 0.2;
  const T_END = 12;
  const H_NOMINAL = T_END / 100;

  function bounce() {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    // vRest: 0 -- the subject here is the bounce SEQUENCE, so a rest
    // condition would truncate the very thing being counted (ADR-021).
    const model = createPlanarProjectileModel([new GravityForce()], undefined, {
      e: E,
      muF: 1,
      vRest: 0,
    });
    const stepper = createDormandPrince54Stepper();
    const collector = new EventCollector();
    const report = integrate(
      model,
      ctx,
      new Float64Array([0, H0, 0, 0]),
      [0, T_END],
      { stepper: stepper.info.id, maxSteps: 50000 },
      stepper,
      [collector],
    );
    return {
      report,
      impacts: collector.events.filter((r) => r.event.name === "ground-impact"),
    };
  }

  /** Closed-form time of the impact that ends the nth bounce (n = 0 is the drop). */
  const exactImpactTime = (n: number): number =>
    Math.sqrt((2 * H0) / G_STD) * (1 + (2 * E * (1 - E ** n)) / (1 - E));

  /** Closed-form duration of the flight that ends at impact n. */
  const exactFlightBefore = (n: number): number =>
    n === 0 ? Math.sqrt((2 * H0) / G_STD) : 2 * E ** n * Math.sqrt((2 * H0) / G_STD);

  it("resolves bounces far shorter than the nominal step, decaying by four orders of magnitude", () => {
    const { impacts } = bounce();
    const short = impacts.filter((_, n) => exactFlightBefore(n) < H_NOMINAL / 4);

    // Short against the *nominal* step tspan/100. Deliberately not phrased as
    // "shorter than a step": the driver truncates to land on each event, so the
    // live step shrinks with the bounces and the true ratio stays near 5. See
    // the file comment -- this is the distinction that keeps P0.98 open.
    expect(short.length).toBeGreaterThanOrEqual(4);
    expect(exactFlightBefore(impacts.length - 1)).toBeLessThan(H_NOMINAL / 8);
  });

  it("impact times match the closed form for every resolved impact", () => {
    const { report, impacts } = bounce();
    expect(report.status).toBe("ok");

    // Asserted, not derived from the data: if saturation crept earlier the
    // loop below would silently check fewer impacts and still pass.
    expect(new Set(impacts.map((r) => r.t)).size).toBe(RESOLVED_IMPACTS);

    for (let n = 0; n < RESOLVED_IMPACTS; n++) {
      const exact = exactImpactTime(n);
      // Drag-free motion under constant gravity is a quadratic, which DOPRI5
      // integrates exactly, so the only error here is the root find's. Loose
      // enough not to pin the last bits of a Brent iteration, tight enough that
      // a returned-t0 bracket (the P0.97 failure, which lands a whole flight
      // early) could not survive it.
      expect(Math.abs(impacts[n]!.t - exact)).toBeLessThan(1e-12 * exact);
    }

    // The tail is at one time exactly, and that time is the last resolved
    // impact's -- equality rather than a tolerance, because a drifting tail
    // would mean the events are advancing time again and the split above is
    // no longer the right description.
    for (let n = RESOLVED_IMPACTS; n < impacts.length; n++) {
      expect(impacts[n]!.t).toBe(impacts[RESOLVED_IMPACTS - 1]!.t);
    }
  });

  it("every impact lands on the ground, and time advances until it saturates", () => {
    const { impacts } = bounce();
    for (let n = 0; n < impacts.length; n++) {
      expect(Math.abs(impacts[n]!.y[1]!)).toBeLessThan(1e-9);
    }
    // Strictly increasing through the resolved regime...
    for (let n = 1; n < RESOLVED_IMPACTS; n++) {
      expect(impacts[n]!.t).toBeGreaterThan(impacts[n - 1]!.t);
    }
    // ...and exactly constant after it. Stated as equality on purpose: the
    // weaker `>=` over the whole sequence would also pass on a run that never
    // saturated, and that is the distinction this test exists to make.
    for (let n = RESOLVED_IMPACTS; n < impacts.length; n++) {
      expect(impacts[n]!.t).toBe(impacts[n - 1]!.t);
    }
  });

  it("pins the resolved impact count, and the ball ends at rest on the ground", () => {
    const { report, impacts } = bounce();
    // Physically infinite (Zeno). This pin read 7 until P0.101's surface snap
    // landed; it is 8 resolved times now, and the extra one is the impact the
    // localized root's ~1e-15 residual used to cost. Pinned rather than
    // bounded so a change in either direction is visible: resolving fewer is a
    // regression in the short-flight path, resolving more means the floor
    // moved and the note in `scanStepForEvents` needs rereading.
    expect(new Set(impacts.map((r) => r.t)).size).toBe(RESOLVED_IMPACTS);
    expect(impacts.length).toBe(TOTAL_IMPACTS);

    // The point of the whole exercise: the solve ends ON the ground rather
    // than 539 m below it, which is where this configuration finished before
    // the snap. Exact zeros, not tolerances -- the snap writes the terrain
    // height and the rest condition writes the velocity.
    expect(report.yFinal[1]).toBe(0);
    expect(report.yFinal[3]).toBe(0);
  });

  it("the resolved impacts stop short of the Zeno accumulation point", () => {
    const { impacts } = bounce();
    const tInf = Math.sqrt((2 * H0) / G_STD) * (1 + (2 * E) / (1 - E));
    const last = impacts[impacts.length - 1]!.t;
    expect(last).toBeLessThan(tInf);
    // ...but close to it: the unresolved tail is a small fraction of the drop.
    expect(tInf - last).toBeLessThan(1e-3 * tInf);
  });
});

/**
 * P0.98 proper: bounces whose whole flight is shorter than a quarter step.
 *
 * The block above could not reach this regime and says so — an adaptive driver
 * truncates each step to land on the localized event, so the live step shrinks
 * in lockstep with the bounces and `flight / step` sits at ~5 forever. A
 * *fixed* step is what breaks that coupling: `h` stays where the caller put it
 * while the flights decay geometrically, so after a few bounces the entire
 * flight lands inside the first sub-interval of the event scan. That is the
 * configuration P0.97's `DEPARTURE_THETAS` ladder exists for, and until now
 * nothing exercised it.
 *
 * A fixed-step stepper reaches it only via `HermiteDenseOutputStepper`:
 * `integrate`'s `hasEvents` guard requires `stepper.interpolant`, and no bare
 * fixed-step stepper in this package has one (that guard's silence is P0.99,
 * still open). Wrapping `ClassicalRK4Stepper` gives it cubic dense output and
 * with it event detection.
 *
 * Measured for these two step sizes, against the closed form: at h = 0.12 the
 * last two impacts arrive from flights of 0.135 h and 0.027 h, and at h = 0.25
 * the last three from 0.065 h, 0.013 h and 0.003 h — all well under the quarter
 * step, and every impact time exact to within 5e-16 relative. RK4 integrates a
 * quadratic exactly and the Hermite cubic reproduces it exactly, so the only
 * error is the root find's.
 *
 * **Exact counts, derived rather than observed (P0.145).** These blocks carried
 * `minImpacts` lower bounds of 5 and 6 until the 120th run. They were written
 * when the resolved count depended on `h` and on the sign of a rounding
 * residual — at h = 0.4 and h = 0.5 the sequence used to stop after two impacts
 * and the projectile fell through the ground while the solve still reported
 * `ok`, so a `>=` bound meant the fix for that (P0.101's surface snap, which
 * resolves *more* impacts) left these cases green rather than red. That fix has
 * landed, and a bound that can no longer fail for the reason it was written is
 * not a test.
 *
 * The count is now pinned exactly, and `resolvedBounceCount` below is where it
 * comes from — **the model, not a previous run's output**. Since the snap the
 * ball rests exactly on the surface between bounces, so `activeAtStart` holds
 * and `event-detection.ts` arms the `DEPARTURE_THETAS` ladder. Its finest rung
 * puts the scan's first sample at `theta_min * h` after the step start, so a
 * bounce is resolved exactly while its flight outlasts that sample:
 *
 *   bounce n is resolved  <=>  2 e^n t0 > theta_min * h
 *
 * and the resolved count is the first `n` that fails it. **The rule is a
 * prediction and not a fit**: it returns 8 at h = 0.12, 0.25 and 0.4 and
 * **7** at h = 0.5, and the solver returns 8, 8, 8, 7. The h = 0.5 case is
 * carried below for exactly that reason — a derivation that only ever agreed
 * with `RESOLVED_IMPACTS` on this file's own two step sizes would be
 * indistinguishable from the constant 8.
 *
 * `report.status` is deliberately not asserted: it is `ok` today only because
 * the sequence saturates (P0.144), and any honest fix there changes it.
 */
describe("integrate: fixed-step restitution bounces shorter than a quarter step (P0.98)", () => {
  const H0 = 5;
  const E = 0.2;
  const T_END = 12;

  function bounceFixedStep(h: number) {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    // vRest: 0, for the reason given at the first call site above.
    const model = createPlanarProjectileModel([new GravityForce()], undefined, {
      e: E,
      muF: 1,
      vRest: 0,
    });
    const stepper = new HermiteDenseOutputStepper(new ClassicalRK4Stepper());
    const collector = new EventCollector();
    integrate(
      model,
      ctx,
      new Float64Array([0, H0, 0, 0]),
      [0, T_END],
      { stepper: stepper.info.id, maxSteps: 50000, h },
      stepper,
      [collector],
    );
    return collector.events.filter((r) => r.event.name === "ground-impact");
  }

  /** Closed-form time of the impact that ends the nth bounce (n = 0 is the drop). */
  const exactImpactTime = (n: number): number =>
    Math.sqrt((2 * H0) / G_STD) * (1 + (2 * E * (1 - E ** n)) / (1 - E));

  /** Closed-form duration of the flight that ends at impact n. */
  const exactFlightBefore = (n: number): number =>
    n === 0 ? Math.sqrt((2 * H0) / G_STD) : 2 * E ** n * Math.sqrt((2 * H0) / G_STD);

  /**
   * The finest rung of `event-detection.ts`'s `DEPARTURE_THETAS`, written the
   * same way that file builds it (`INTERIOR_THETAS[0] * 2 ** -k` down to
   * k = 12) rather than as a decimal, so a change to the ladder shows up here
   * as a changed prediction instead of a stale constant.
   */
  const FINEST_DEPARTURE_THETA = 0.25 * 2 ** -12;

  /**
   * How many bounces the scan resolves at step `h`, from the model alone: the
   * first sample of an armed scan sits `FINEST_DEPARTURE_THETA * h` after the
   * step start, and a bounce is resolved exactly while its flight outlasts it.
   * No solver output is involved, which is the point — the tests below assert
   * that the solver agrees with this, not the other way round.
   */
  const resolvedBounceCount = (h: number): number => {
    let n = 0;
    while (exactFlightBefore(n) > FINEST_DEPARTURE_THETA * h) n++;
    return n;
  };

  /** Bounces whose flight is under a quarter step, among the resolved ones. */
  const shortBounceCount = (h: number): number => {
    let count = 0;
    for (let n = 0; n < resolvedBounceCount(h); n++) {
      if (exactFlightBefore(n) < h / 4) count++;
    }
    return count;
  };

  // The prediction is checked at a step size this file does not otherwise use,
  // and where it disagrees with RESOLVED_IMPACTS. Without this case the rule
  // could be the constant 8 and nothing here would notice.
  it("the closed-form resolved count is a prediction, not a restatement of 8", () => {
    expect(resolvedBounceCount(0.12)).toBe(RESOLVED_IMPACTS);
    expect(resolvedBounceCount(0.25)).toBe(RESOLVED_IMPACTS);
    expect(resolvedBounceCount(0.4)).toBe(RESOLVED_IMPACTS);
    // h = 0.5 puts the finest rung past the 8th flight, so the model says the
    // sequence saturates one bounce earlier.
    expect(resolvedBounceCount(0.5)).toBe(RESOLVED_IMPACTS - 1);
    expect(new Set(bounceFixedStep(0.5).map((r) => r.t)).size).toBe(RESOLVED_IMPACTS - 1);
  });

  describe.each([{ h: 0.12 }, { h: 0.25 }])("h = $h", ({ h }) => {
    it("reaches the sub-quarter-step regime the adaptive driver cannot", () => {
      const impacts = bounceFixedStep(h);
      // Indexed over the RESOLVED impacts only: the saturated tail (P0.144)
      // shares one time and is not a sequence of flights, so numbering those
      // records as bounces counted 457 of them as sub-quarter-step.
      const short = impacts
        .slice(0, RESOLVED_IMPACTS)
        .filter((_, n) => exactFlightBefore(n) < h / 4);
      // Unlike the adaptive block above, `h` here really is the step in play,
      // so this ratio is the flight-to-step ratio and not a nominal stand-in.
      // Five at both step sizes, bounces 3..7: h/4 is 0.03 and 0.0625, and the
      // flights either side of both are 0.080785 (n = 2) and 0.016157 (n = 3).
      expect(short.length).toBe(shortBounceCount(h));
      expect(short.length).toBe(5);
      // The claim this block exists to make. It read `impacts.length - 1`
      // until P0.145, which since the snap is index 464, whose closed-form
      // flight underflows to 0 -- so it asserted 0 < h/4 and could not fail.
      expect(exactFlightBefore(RESOLVED_IMPACTS - 1)).toBeLessThan(h / 4);
    });

    it("resolves every impact of the sequence it reaches", () => {
      const impacts = bounceFixedStep(h);
      // Exact, and both halves matter: the distinct-time count is what
      // "resolved" means, and `impacts.length` is the total including the
      // saturated tail. The old `>= minImpacts` bound was read against the
      // total, so 5 and 6 were loose against 465 rather than against 8.
      expect(new Set(impacts.map((r) => r.t)).size).toBe(resolvedBounceCount(h));
      expect(new Set(impacts.map((r) => r.t)).size).toBe(RESOLVED_IMPACTS);
      expect(impacts.length).toBe(TOTAL_IMPACTS);
    });

    it("impact times match the closed form, including the short flights", () => {
      const impacts = bounceFixedStep(h);
      // Since the snap, the fixed-step answer is the SAME answer the adaptive
      // driver gives, at both step sizes: 8 resolved times and 465 records.
      // The impact count no longer depends on `h` or on the stepper, which is
      // what it should never have depended on.
      expect(new Set(impacts.map((r) => r.t)).size).toBe(RESOLVED_IMPACTS);
      for (let n = 0; n < RESOLVED_IMPACTS; n++) {
        const exact = exactImpactTime(n);
        // Tight enough that a bracket resolved back to t0 -- the P0.97 failure,
        // which lands a whole flight early -- could not survive it.
        expect(Math.abs(impacts[n]!.t - exact)).toBeLessThan(1e-12 * exact);
      }
    });

    it("every impact lands on the ground, and time advances until it saturates", () => {
      const impacts = bounceFixedStep(h);
      for (let n = 0; n < impacts.length; n++) {
        expect(Math.abs(impacts[n]!.y[1]!)).toBeLessThan(1e-9);
      }
      for (let n = 1; n < RESOLVED_IMPACTS; n++) {
        expect(impacts[n]!.t).toBeGreaterThan(impacts[n - 1]!.t);
      }
      for (let n = RESOLVED_IMPACTS; n < impacts.length; n++) {
        expect(impacts[n]!.t).toBe(impacts[n - 1]!.t);
      }
    });
  });
});
