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
  it("the defect, kept as a measurement: vRest = 0 still free-falls through the ground", () => {
    const { report, impacts } = run(0.2, 0, createDormandPrince54Stepper(), { h: 0.12 });

    // The 26th run's filing, reproduced on this tree, and deliberately pinned
    // rather than deleted: it is the only thing proving the passing cases
    // below are the rest condition working rather than the configuration
    // having become harmless on its own.
    expect(report.status).toBe("ok");
    expect(impacts).toHaveLength(7);
    expect(impacts.at(-1)!.t).toBeCloseTo(1.514683, 6);
    expect(tInf(0.2)).toBeCloseTo(1.514715, 6);
    expect(report.tFinal).toBe(12);
    expect(report.yFinal[1]).toBeLessThan(-500);
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

describe("restitution: the detection floor is what limits the rest condition (P0.101)", () => {
  /**
   * **This block is the honest half of P0.103 and it is why the task is not
   * closed.** A rest threshold can only end a sequence that is still being
   * resolved when it gets there. Below about `vRest = 0.05` it usually is
   * not: the impacts stop being *detected* first, and from that point the
   * ball free-falls exactly as it did before the threshold existed.
   *
   * The mechanism is P0.101's, measured: `restitutionBounceAction` passes the
   * localized root's position through, and that position is zero only to
   * within the root find's own error -- up to ~1e-15 m, of either sign. When
   * it lands negative the next step starts nominally below the terrain,
   * `scanStepForEvents`' `g0 === 0` test is false, the `DEPARTURE_THETAS`
   * ladder is not armed, and a flight shorter than a quarter step ends before
   * the first interior sample. No sign change, no impact, no rest.
   */
  it("at vRest = 1e-3 only 2 of 24 configurations reach the rest contact", () => {
    let rested = 0;
    let tunnelled = 0;

    for (const [, make] of STEPPERS) {
      for (const h of [0.05, 0.12, 0.2, 0.4]) {
        for (const e of [0.2, 0.5, 0.8]) {
          const { report, impacts } = run(e, 1e-3, make(), { h });
          const atRest = report.yFinal[3] === 0 && Math.abs(report.yFinal[1]!) < 1e-9;
          if (atRest) {
            rested++;
            expect(impacts).toHaveLength(restsAt(e, 1e-3));
          } else {
            tunnelled++;
            // Every non-resting configuration failed the same way: it lost an
            // impact BEFORE the threshold would have fired. None of them
            // reached the threshold and declined to rest, which is what makes
            // this P0.101's floor rather than a defect in the rest condition.
            expect(impacts.length).toBeLessThan(restsAt(e, 1e-3));
            expect(report.tFinal).toBe(T_SPAN[1]);
          }
        }
      }
    }

    // A forcing function, deliberately: landing P0.101 should raise `rested`
    // and this assertion should then fail. When it does, that is the fix
    // working -- re-measure and update the numbers, do not relax the check.
    expect({ rested, tunnelled }).toEqual({ rested: 2, tunnelled: 22 });
  });

  it("the adaptive driver loses the SECOND impact, whatever vRest says", () => {
    // Traced: the bounce at t = 1.009810 localizes to y = -2.220e-16, and the
    // controller's next proposed step is ~11 s because a drag-free parabola
    // has no local error to control -- so the whole 0.4 s rebound falls inside
    // the first quarter of one step and is never bracketed. A rest threshold
    // cannot help an impact that was never seen.
    const { report, impacts } = run(0.2, 0.2, createDormandPrince54Stepper(), { rtol: 1e-8 });

    expect(impacts).toHaveLength(1);
    expect(impacts[0]!.y[1]).toBeCloseTo(0, 12);
    expect(impacts[0]!.y[1]).toBeLessThan(0);
    expect(report.status).toBe("ok");
    expect(report.yFinal[1]).toBeLessThan(-500);
  });
});
