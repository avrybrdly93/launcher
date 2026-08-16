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
    const model = createPlanarProjectileModel([new GravityForce()], undefined, { e: E, muF: 1 });
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

  it("impact times match the closed form for a drag-free bouncing ball", () => {
    const { report, impacts } = bounce();
    expect(report.status).toBe("ok");

    for (let n = 0; n < impacts.length; n++) {
      const exact = exactImpactTime(n);
      // Drag-free motion under constant gravity is a quadratic, which DOPRI5
      // integrates exactly, so the only error here is the root find's. Loose
      // enough not to pin the last bits of a Brent iteration, tight enough that
      // a returned-t0 bracket (the P0.97 failure, which lands a whole flight
      // early) could not survive it.
      expect(Math.abs(impacts[n]!.t - exact)).toBeLessThan(1e-12 * exact);
    }
  });

  it("every impact lands on the ground and the sequence advances monotonically", () => {
    const { impacts } = bounce();
    for (let n = 0; n < impacts.length; n++) {
      expect(Math.abs(impacts[n]!.y[1]!)).toBeLessThan(1e-9);
      if (n > 0) expect(impacts[n]!.t).toBeGreaterThan(impacts[n - 1]!.t);
    }
  });

  it("pins the resolved impact count for this configuration", () => {
    const { impacts } = bounce();
    // Physically infinite (Zeno); 7 is what this step resolves before the
    // remaining flights fall under the event scan's floor. Pinned rather than
    // bounded so that a change in either direction is visible: resolving fewer
    // is a regression in the short-flight path, resolving more means the floor
    // moved and the note in `scanStepForEvents` needs rereading.
    expect(impacts.length).toBe(7);
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
 * **Bounds, not a pinned count, and that is deliberate.** A neighbouring step
 * size does *not* behave this well: at h = 0.4 and h = 0.5 the sequence stops
 * after two impacts and the projectile falls through the ground while the solve
 * still reports `ok`. That is a real defect, measured this run and filed as its
 * own task — the localized impact leaves `y` a hair below the terrain, so the
 * `g0 === 0` test that arms the ladder is false, the scan falls back to its
 * interior samples, and a flight shorter than a quarter step lands before the
 * first of them. Asserting `>=` here means the fix for that task, which
 * resolves *more* impacts, leaves these cases green rather than red.
 *
 * `report.status` is deliberately not asserted for the same reason: it is `ok`
 * today only because the sequence dies, and any honest fix changes it.
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
    const model = createPlanarProjectileModel([new GravityForce()], undefined, { e: E, muF: 1 });
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

  describe.each([
    { h: 0.12, minImpacts: 5, minShort: 2 },
    { h: 0.25, minImpacts: 6, minShort: 3 },
  ])("h = $h", ({ h, minImpacts, minShort }) => {
    it("reaches the sub-quarter-step regime the adaptive driver cannot", () => {
      const impacts = bounceFixedStep(h);
      const short = impacts.filter((_, n) => exactFlightBefore(n) < h / 4);
      // Unlike the adaptive block above, `h` here really is the step in play,
      // so this ratio is the flight-to-step ratio and not a nominal stand-in.
      expect(short.length).toBeGreaterThanOrEqual(minShort);
      expect(exactFlightBefore(impacts.length - 1)).toBeLessThan(h / 4);
    });

    it("resolves every impact of the sequence it reaches", () => {
      expect(bounceFixedStep(h).length).toBeGreaterThanOrEqual(minImpacts);
    });

    it("impact times match the closed form, including the short flights", () => {
      const impacts = bounceFixedStep(h);
      for (let n = 0; n < impacts.length; n++) {
        const exact = exactImpactTime(n);
        // Tight enough that a bracket resolved back to t0 -- the P0.97 failure,
        // which lands a whole flight early -- could not survive it.
        expect(Math.abs(impacts[n]!.t - exact)).toBeLessThan(1e-12 * exact);
      }
    });

    it("every impact lands on the ground and the sequence advances monotonically", () => {
      const impacts = bounceFixedStep(h);
      for (let n = 0; n < impacts.length; n++) {
        expect(Math.abs(impacts[n]!.y[1]!)).toBeLessThan(1e-9);
        if (n > 0) expect(impacts[n]!.t).toBeGreaterThan(impacts[n - 1]!.t);
      }
    });
  });
});
