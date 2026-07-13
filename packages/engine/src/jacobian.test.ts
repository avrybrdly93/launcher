import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { BuoyancyForce, GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { finiteDifferenceJacobian } from "./jacobian.js";
import type { Model } from "./model.js";
import type { EvalContext } from "./eval-context.js";

/** Central finite-difference Jacobian, used only as an independent oracle in this test. */
function centralDifferenceJacobian(
  model: Model,
  t: number,
  y: Float64Array,
  ctx: EvalContext,
): Float64Array {
  const n = model.dim;
  const J = new Float64Array(n * n);
  const yPerturbed = Float64Array.from(y);
  const fPlus = new Float64Array(n);
  const fMinus = new Float64Array(n);

  for (let j = 0; j < n; j++) {
    const orig = y[j]!;
    const h = 1e-6 * Math.max(1, Math.abs(orig));

    yPerturbed[j] = orig + h;
    model.rhs(t, yPerturbed, fPlus, ctx);
    yPerturbed[j] = orig - h;
    model.rhs(t, yPerturbed, fMinus, ctx);
    yPerturbed[j] = orig;

    for (let i = 0; i < n; i++) {
      J[i * n + j] = (fPlus[i]! - fMinus[i]!) / (2 * h);
    }
  }
  return J;
}

describe("gravityQuadraticDragJacobian", () => {
  it("is wired as .jacobian on a gravity+quadratic-drag-only model", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    expect(model.jacobian).toBeTypeOf("function");
  });

  it("is omitted when a non-analytic force (e.g. Magnus, buoyancy) is present", () => {
    const withMagnus = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    const withBuoyancy = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new BuoyancyForce(),
    ]);
    expect(withMagnus.jacobian).toBeUndefined();
    expect(withBuoyancy.jacobian).toBeUndefined();
  });

  it("matches central finite differences to 1e-7 at 10 states", () => {
    const mass = 0.145;
    const radius = 0.0366;

    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);

    // Same deterministic state set used by planar-projectile-model.test.ts (all u != 0).
    const states: [number, number, number, number][] = [
      [0, 0, 12.3, 4.1],
      [10, 5, -8.2, 15.6],
      [-3, 20, 25.0, -30.1],
      [0, 0.5, 0.001, -0.002],
      [100, 10, -1.5, -1.5],
      [0, 0, 40, 0],
      [0, 0, 0, 40],
      [5, 5, 5, 5],
      [-10, -10, -20, 20],
      [1, 1, 33.3, -12.7],
    ];

    for (const state of states) {
      const y = new Float64Array(state);
      const analytic = new Float64Array(16);
      model.jacobian!(0, y, analytic, ctx);
      const numeric = centralDifferenceJacobian(model, 0, y, ctx);

      for (let idx = 0; idx < 16; idx++) {
        expect(analytic[idx]).toBeCloseTo(numeric[idx]!, 7);
      }
    }
  });

  it("vanishes the velocity-coupling block exactly at v_rel = 0 (removable singularity, §3.8)", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);

    const y = new Float64Array([0, 0, 0, 0]);
    const out = new Float64Array(16);
    model.jacobian!(0, y, out, ctx);

    expect(out[2 * 4 + 2]).toBe(0);
    expect(out[2 * 4 + 3]).toBe(0);
    expect(out[3 * 4 + 2]).toBe(0);
    expect(out[3 * 4 + 3]).toBe(0);
    // Kinematic block (dx/dt=vx, dy/dt=vy) is unaffected by the drag singularity.
    expect(out[0 * 4 + 2]).toBe(1);
    expect(out[1 * 4 + 3]).toBe(1);
  });
});

describe("finiteDifferenceJacobian", () => {
  it("matches the P1.22 analytic Jacobian where available", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);

    const states: [number, number, number, number][] = [
      [0, 0, 12.3, 4.1],
      [10, 5, -8.2, 15.6],
      [-3, 20, 25.0, -30.1],
      [100, 10, -1.5, -1.5],
      [-10, -10, -20, 20],
    ];

    for (const state of states) {
      const y = new Float64Array(state);
      const analytic = new Float64Array(16);
      model.jacobian!(0, y, analytic, ctx);
      const fd = new Float64Array(16);
      finiteDifferenceJacobian(model, 0, y, fd, ctx);

      for (let idx = 0; idx < 16; idx++) {
        expect(fd[idx]).toBeCloseTo(analytic[idx]!, 6);
      }
    }
  });

  it("falls back correctly for a force composition with no analytic Jacobian (Magnus + buoyancy)", () => {
    const model = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
      new BuoyancyForce(),
    ]);
    expect(model.jacobian).toBeUndefined();

    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
      liftCoefficient: new SaturatingLiftCoefficient(),
      spin: 180,
    });
    const ctx = createEvalContext(env, params);

    const y = new Float64Array([0, 10, 25, -8]);
    const fd = new Float64Array(16);
    finiteDifferenceJacobian(model, 0, y, fd, ctx);
    const oracle = centralDifferenceJacobian(model, 0, y, ctx);

    // Kinematic identity rows hold for any force composition.
    expect(fd[0 * 4 + 2]).toBeCloseTo(1, 9);
    expect(fd[1 * 4 + 3]).toBeCloseTo(1, 9);
    for (let idx = 0; idx < 16; idx++) {
      expect(fd[idx]).toBeCloseTo(oracle[idx]!, 6);
    }
  });
});
