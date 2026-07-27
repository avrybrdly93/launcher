import { describe, expect, it } from "vitest";
import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  GravityForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
  mechanicalEnergy,
} from "@ballista/engine";
import { createDormandPrince54Stepper } from "./dormand-prince-54.js";
import { EventCollector } from "./event-collector.js";
import { integrate } from "./integrate.js";

describe("integrate: restitution bounce event action (P4.11, §4.9 'reflect')", () => {
  it("with e=1, muF=1 (perfectly elastic, frictionless) the ball bounces N times and conserves E at every impact to 1e-10", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    const model = createPlanarProjectileModel([new GravityForce()], undefined, {
      e: 1,
      muF: 1,
    });

    const y0 = new Float64Array([0, 5, 3, 0]);
    // Snapshotted from the same evaluate() path mechanicalEnergy reads,
    // after model.rhs has sampled ctx.env once (before that, ctx.env.g is
    // still its unsampled default -- see mechanicalEnergy's own doc note).
    model.rhs(0, y0, new Float64Array(model.dim), ctx);
    const e0 = mechanicalEnergy(y0, ctx);
    const stepper = createDormandPrince54Stepper();
    const collector = new EventCollector();

    const report = integrate(
      model,
      ctx,
      y0,
      [0, 12],
      { stepper: stepper.info.id, h: 0.05, maxSteps: 5000 },
      stepper,
      [collector],
    );

    // Reached the full tspan -- a bounce never stops the solve.
    expect(report.status).toBe("ok");
    expect(report.tFinal).toBe(12);

    const impacts = collector.events.filter((r) => r.event.name === "ground-impact");
    // This task's literal validation criterion needs "N bounces" for some
    // N > 1 -- a single impact would prove nothing about re-arming.
    expect(impacts.length).toBeGreaterThanOrEqual(4);

    for (const impact of impacts) {
      // Every impact lands (near enough) exactly on the ground.
      expect(Math.abs(impact.y[1]!)).toBeLessThan(1e-9);
      const e = mechanicalEnergy(impact.y, ctx);
      expect(Math.abs(e - e0)).toBeLessThan(1e-10 * Math.max(1, Math.abs(e0)));
    }

    // Perfectly elastic and frictionless: the final state's energy matches
    // the initial energy too, not just at the sampled impacts.
    expect(Math.abs(mechanicalEnergy(report.yFinal, ctx) - e0)).toBeLessThan(
      1e-10 * Math.max(1, Math.abs(e0)),
    );
  });

  it("re-arms: successive impacts are strictly increasing in time and horizontal position keeps advancing", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    const model = createPlanarProjectileModel([new GravityForce()], undefined, {
      e: 1,
      muF: 1,
    });

    const y0 = new Float64Array([0, 5, 3, 0]);
    const stepper = createDormandPrince54Stepper();
    const collector = new EventCollector();

    integrate(
      model,
      ctx,
      y0,
      [0, 12],
      { stepper: stepper.info.id, h: 0.05, maxSteps: 5000 },
      stepper,
      [collector],
    );

    const impacts = collector.events.filter((r) => r.event.name === "ground-impact");
    expect(impacts.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < impacts.length; i++) {
      expect(impacts[i]!.t).toBeGreaterThan(impacts[i - 1]!.t);
      expect(impacts[i]!.y[0]!).toBeGreaterThan(impacts[i - 1]!.y[0]!);
    }
  });

  it("with e<1 each bounce loses energy and successive apex heights strictly decrease", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    const model = createPlanarProjectileModel([new GravityForce()], undefined, {
      e: 0.8,
      muF: 1,
    });

    const y0 = new Float64Array([0, 5, 0, 0]);
    model.rhs(0, y0, new Float64Array(model.dim), ctx);
    const e0 = mechanicalEnergy(y0, ctx);
    const stepper = createDormandPrince54Stepper();
    const collector = new EventCollector();

    integrate(
      model,
      ctx,
      y0,
      [0, 8],
      { stepper: stepper.info.id, h: 0.05, maxSteps: 5000 },
      stepper,
      [collector],
    );

    const impacts = collector.events.filter((r) => r.event.name === "ground-impact");
    expect(impacts.length).toBeGreaterThanOrEqual(2);

    let prevSpeedSq = Infinity;
    for (const impact of impacts) {
      const vx = impact.y[2]!;
      const vy = impact.y[3]!;
      const speedSq = vx * vx + vy * vy;
      expect(speedSq).toBeLessThan(prevSpeedSq);
      prevSpeedSq = speedSq;

      // Each impact strictly dissipates energy relative to the launch.
      expect(mechanicalEnergy(impact.y, ctx)).toBeLessThan(e0);
    }
  });

  it("without restitution, ground impact still stops the solve (backward compatible)", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    const model = createPlanarProjectileModel([new GravityForce()]);

    const y0 = new Float64Array([0, 5, 3, 0]);
    const stepper = createDormandPrince54Stepper();
    const collector = new EventCollector();

    const report = integrate(
      model,
      ctx,
      y0,
      [0, 12],
      { stepper: stepper.info.id, h: 0.05, maxSteps: 5000 },
      stepper,
      [collector],
    );

    expect(report.status).toBe("ok");
    expect(report.tFinal).toBeLessThan(12);
    // Only the non-terminal apex is dispatched; ground-impact (no `action`)
    // ends the trajectory and is never surfaced through the collector.
    expect(collector.events.some((r) => r.event.name === "ground-impact")).toBe(false);
  });
});
