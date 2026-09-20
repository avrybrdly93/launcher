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
import type { Stepper } from "./types.js";

/**
 * P0.103 / ADR-021: a bouncing solve ends in a resting contact instead of
 * dropping the ball through the ground.
 *
 * **The defect, measured on this tree before the fix**: a drag-free ball
 * released from y = 5 with e = 0.2 over tspan [0, 12] at h = 0.12 resolved 7
 * impacts, the last at t = 1.514683 against t_inf = 1.514715, and then
 * reported `status: "ok"` with yFinal[1] = -539.08. The sequence is Zeno, so
 * no integrator resolves every impact -- that part is the model, not a bug.
 * The bug is that after the last resolvable impact nothing caught the ball.
 *
 * **READ THE FLOOR SECTION AT THE BOTTOM BEFORE CONCLUDING THIS TASK IS
 * FINISHED.** A rest threshold ends the sequence only if the sequence is
 * still being *resolved* when it reaches the threshold, and in most
 * configurations it is not: the impacts stop being detected first, for
 * P0.101's separate reason. That is measured here, not assumed, and it is why
 * P0.103's own "never reports ok with y far below zero" is not yet a
 * universal statement about this repository.
 *
 * Every closed form below is for the drag-free ball, which is why this file
 * wires `GravityForce` alone: with drag there is no `t_inf` to compare
 * against and the assertions would be self-referential.
 */

const H0 = 5;
const T_SPAN: readonly [number, number] = [0, 12];

/** Impact speed of a drag-free drop from `H0`, sqrt(2 g h). */
const V0 = Math.sqrt(2 * G_STD * H0);
/** Time of the first impact, sqrt(2 h / g). */
const T0 = Math.sqrt((2 * H0) / G_STD);

/** Zeno accumulation point: t0 (1 + 2e/(1-e)). Infinite for e = 1. */
function tInf(e: number): number {
  return T0 * (1 + (2 * e) / (1 - e));
}

/**
 * The impact number at which a `vRest` threshold first fires: the smallest n
 * with e^n V0 <= vRest. This is the *model's* answer, independent of any
 * solver, which is what makes "impacts === restsAt(e, vRest)" a check on the
 * solve rather than a restatement of it.
 */
function restsAt(e: number, vRest: number): number {
  return Math.ceil(Math.log(vRest / V0) / Math.log(e));
}

function run(e: number, vRest: number, stepper: Stepper, cfg: { h?: number; rtol?: number }) {
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass: 1,
    radius: 0.05,
    dragCoefficient: new ConstantCd(0),
  });
  const ctx = createEvalContext(env, params);
  const model = createPlanarProjectileModel([new GravityForce()], undefined, { e, muF: 1, vRest });
  const collector = new EventCollector();
  const report = integrate(
    model,
    ctx,
    new Float64Array([0, H0, 3, 0]),
    T_SPAN,
    { stepper: stepper.info.id, maxSteps: 2_000_000, ...cfg },
    stepper,
    [collector],
  );
  return {
    report,
    impacts: collector.events.filter((r) => r.event.name === "ground-impact"),
  };
}

const STEPPERS = [
  ["dopri5", () => createDormandPrince54Stepper()],
  ["rk4+hermite", () => new HermiteDenseOutputStepper(new ClassicalRK4Stepper())],
] as const;

describe("restitution: the Zeno tail ends in a resting contact (P0.103, ADR-021)", () => {
  it("vRest = 0 is a rest condition at the UNDERFLOW floor, not the absence of one", () => {
    const { report, impacts } = run(0.2, 0, createDormandPrince54Stepper(), { h: 0.12 });

    // This case pinned the defect until P0.101's surface snap landed: 7
    // impacts, then `status: "ok"` with yFinal[1] = -539.08, the ball 539 m
    // under the ground. It is kept, rewritten to what the same configuration
    // does now, because it is the only case in this file exercising the
    // sequence with no threshold to stop it.
    //
    // ADR-021 said vRest = 0 "means no rest condition" and that the Zeno
    // accumulation therefore survives. That is true of the reals and false of
    // float64, which is the correction this test carries: the rebound speed
    // decays geometrically, e^465 * v0 falls below the smallest denormal, v_y
    // underflows to exactly 0, and `e*|v_y| <= vRest` is then `0 <= 0`. The
    // sequence is finite at the underflow floor and the ball ends at rest.
    expect(report.status).toBe("ok");
    expect(impacts).toHaveLength(465);
    // Only 8 of those advance time; the rest fire at the step start once the
    // flight is shorter than the finest DEPARTURE_THETAS rung (P0.144).
    expect(new Set(impacts.map((r) => r.t)).size).toBe(8);

    // It stops just short of the accumulation point, which is the honest
    // statement of what was truncated: 6.46e-6 s of a 1.51 s sequence.
    expect(report.tFinal).toBeLessThan(tInf(0.2));
    expect(tInf(0.2) - report.tFinal).toBeCloseTo(6.4628e-6, 9);

    // On the ground with no normal velocity left. Exact, not a tolerance.
    expect(report.yFinal[1]).toBe(0);
    expect(report.yFinal[3]).toBe(0);
  });

  it("with a rest threshold above the detection floor, every configuration ends at rest on the ground", () => {
    for (const [name, make] of STEPPERS) {
      for (const vRest of [0.5, 0.2]) {
        for (const e of [0.2, 0.5, 0.8]) {
          const { report, impacts } = run(e, vRest, make(), { h: 0.12 });
          const where = `${name} vRest=${vRest} e=${e}`;

          expect(report.status, where).toBe("ok");
          // Ended at the resting contact, not at t_f.
          expect(report.tFinal, where).toBeLessThan(T_SPAN[1]);
          // On the ground, with no normal velocity left.
          expect(Math.abs(report.yFinal[1]!), where).toBeLessThan(1e-12);
          expect(report.yFinal[3], where).toBe(0);
          // Never past the accumulation point: the rest condition truncates
          // the sequence, it does not extend it.
          expect(report.tFinal, where).toBeLessThan(tInf(e));

          // And it fired at the impact the *model* says it should, not
          // wherever the solver happened to give up.
          expect(impacts, where).toHaveLength(restsAt(e, vRest));
          expect(Math.abs(impacts.at(-1)!.y[3]!) * e, where).toBeLessThanOrEqual(vRest);
          expect(Math.abs(impacts.at(-2)!.y[3]!) * e, where).toBeGreaterThan(vRest);
        }
      }
    }
  });

  it("the truncation matches the closed form and is bounded by its value at vRest", () => {
    for (const vRest of [0.5, 0.2]) {
      for (const e of [0.2, 0.5, 0.8]) {
        const { report, impacts } = run(e, vRest, createDormandPrince54Stepper(), { h: 0.12 });
        const where = `vRest=${vRest} e=${e}`;
        const vRebound = Math.abs(impacts.at(-1)!.y[3]!) * e;

        // Remaining flight time after a rebound at v+ is the geometric sum
        // 2 v+/g (1 + e + e^2 + ...) = 2 v+ / (g (1 - e)).
        const lostTime = tInf(e) - report.tFinal;
        expect(lostTime, where).toBeCloseTo((2 * vRebound) / (G_STD * (1 - e)), 9);

        // ...and since v+ <= vRest by construction, the same expression at
        // vRest bounds it. That bound is what a caller picks vRest from, so
        // it is checked rather than quoted.
        expect(lostTime, where).toBeLessThanOrEqual((2 * vRest) / (G_STD * (1 - e)));

        // The discarded apex is v+^2 / 2g, bounded at vRest the same way.
        expect((vRebound * vRebound) / (2 * G_STD), where).toBeLessThanOrEqual(
          (vRest * vRest) / (2 * G_STD),
        );
      }
    }
  });

  it("a perfectly elastic ball never rests, and is not Zeno either", () => {
    // e = 1: the rebound speed equals the approach speed and neither decays,
    // so no threshold below V0 can ever fire. The rest condition and the
    // accumulation point appear and disappear together, which is why e = 1
    // needs no special case anywhere in the implementation.
    const { report, impacts } = run(1, 0.5, createDormandPrince54Stepper(), { h: 0.12 });

    expect(report.status).toBe("ok");
    expect(report.tFinal).toBe(T_SPAN[1]);
    expect(impacts.length).toBeGreaterThanOrEqual(4);
    for (const impact of impacts) {
      expect(Math.abs(Math.abs(impact.y[3]!) - V0)).toBeLessThan(1e-9);
    }
  });

  it("the tangential impulse still applies at the resting contact", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    const model = createPlanarProjectileModel([new GravityForce()], undefined, {
      e: 0.2,
      muF: 0.5,
      vRest: 0.2,
    });
    const stepper = createDormandPrince54Stepper();
    const collector = new EventCollector();
    const report = integrate(
      model,
      ctx,
      new Float64Array([0, H0, 3, 0]),
      T_SPAN,
      { stepper: stepper.info.id, h: 0.12, maxSteps: 200_000 },
      stepper,
      [collector],
    );

    // v_x halved at every impact including the last: a resting contact is
    // still an impact, and muF is a property of the surface pair rather than
    // of the bounce.
    const impacts = collector.events.filter((r) => r.event.name === "ground-impact");
    expect(report.yFinal[2]).toBeCloseTo(3 * 0.5 ** impacts.length, 12);
  });
});

describe("restitution: the detection floor is GONE, which is what closed P0.101", () => {
  /**
   * **This block was the honest half of P0.103 and is now the proof its fix
   * works.** A rest threshold can only end a sequence that is still being
   * *resolved* when it gets there, and before P0.101 landed it usually was
   * not: at `vRest = 1e-3`, 22 of these 24 configurations lost an impact
   * first and free-fell exactly as they had before the threshold existed.
   *
   * The mechanism was P0.101's, measured: `restitutionBounceAction` passed
   * the localized root's position through, and that position is zero only to
   * within the root find's own error -- up to ~1e-15 m, of either sign. When
   * it landed negative the next step started nominally below the terrain,
   * `scanStepForEvents`' `g0 === 0` test was false, the `DEPARTURE_THETAS`
   * ladder was not armed, and a flight shorter than a quarter step ended
   * before the first interior sample. No sign change, no impact, no rest.
   *
   * `withSurfaceSnap` writes `terrain.height(x)` back after the bounce, so
   * `g0 === 0` holds exactly and the ladder arms. All 24 now rest.
   */
  it("at vRest = 1e-3 all 24 configurations rest, at the impact the model predicts", () => {
    let rested = 0;
    let tunnelled = 0;

    for (const [name, make] of STEPPERS) {
      for (const h of [0.05, 0.12, 0.2, 0.4]) {
        for (const e of [0.2, 0.5, 0.8]) {
          const { report, impacts } = run(e, 1e-3, make(), { h });
          const where = `${name} h=${h} e=${e}`;
          const atRest = report.yFinal[3] === 0 && Math.abs(report.yFinal[1]!) < 1e-9;
          if (atRest) {
            rested++;
            // The count comes from the MODEL -- ceil(log(vRest/v0)/log(e)),
            // 6, 14 and 42 for e = 0.2, 0.5, 0.8 -- and is now hit identically
            // by both steppers at all four step sizes. Before the snap these
            // counts were whatever the detection floor allowed: 4, 8, 25, 3,
            // 17, 2, ... varying with `h` and with the stepper, which is the
            // thing an impact count must never depend on.
            expect(impacts, where).toHaveLength(restsAt(e, 1e-3));
          } else {
            tunnelled++;
          }
        }
      }
    }

    // This read {rested: 2, tunnelled: 22} when it was written, as a
    // deliberate forcing function against P0.101. P0.101 landed, it failed,
    // and it is RE-MEASURED here rather than relaxed -- the assertion is
    // still an exact pair, not a bound.
    expect({ rested, tunnelled }).toEqual({ rested: 24, tunnelled: 0 });
  });

  it("the adaptive driver keeps the second impact now, and rests where the model says", () => {
    // The worst case in the file, and the one that proves the snap addresses
    // the CAUSE. Traced before the fix: the first bounce localized to
    // y = -2.220e-16, `g0 === 0` was false by that much, the ladder stayed
    // unarmed, and the controller's next proposed step was ~11 s because a
    // drag-free parabola has no local error to control -- so the whole 0.4 s
    // rebound sat inside the first quarter of ONE step and was never
    // bracketed. One impact resolved, then free-fall to yFinal[1] = -570.48
    // with `status: "ok"`.
    //
    // Nothing about the controller changed. The step is still ~11 s; the
    // difference is that the step now starts exactly on the surface, so the
    // departure ladder arms and brackets the rebound inside it.
    const { report, impacts } = run(0.2, 0.2, createDormandPrince54Stepper(), { rtol: 1e-8 });

    expect(report.status).toBe("ok");
    // restsAt(0.2, 0.2) = 3: the model's count, not the solver's.
    expect(impacts).toHaveLength(restsAt(0.2, 0.2));
    // The first impact still localizes a hair below the surface -- the root
    // find's error is unchanged and is not what was fixed. What changed is
    // that the residual no longer costs an impact.
    expect(impacts[0]!.y[1]).toBeLessThan(0);
    expect(impacts[0]!.y[1]).toBeCloseTo(0, 12);
    // On the ground, at rest, before the accumulation point.
    expect(report.yFinal[1]).toBe(0);
    expect(report.yFinal[3]).toBe(0);
    expect(report.tFinal).toBeLessThan(tInf(0.2));
  });
});
