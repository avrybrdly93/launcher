import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { createGravityQuadraticDragJacobian } from "./planar-projectile-jacobian.js";
import { createFiniteDifferenceJacobian } from "./finite-difference-jacobian.js";

const DIM = 4;

// Deterministic pseudo-random states (avoid a test dependency on a RNG library).
const STATES: [number, number, number, number][] = [
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

describe("createFiniteDifferenceJacobian", () => {
  it("matches the P1.22 analytic Jacobian where available", () => {
    const mass = 0.145;
    const radius = 0.0366;
    const cd = new ConstantCd(0.47);

    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
    const ctx = createEvalContext(env, params);

    const analyticJacobian = createGravityQuadraticDragJacobian(env, params);
    const fdJacobian = createFiniteDifferenceJacobian(model, ctx);

    for (const [x, yPos, vx, vy] of STATES) {
      const y = new Float64Array([x, yPos, vx, vy]);
      const analytic = new Float64Array(DIM * DIM);
      const fd = new Float64Array(DIM * DIM);

      analyticJacobian(0, y, analytic);
      fdJacobian(0, y, fd);

      for (let i = 0; i < DIM * DIM; i++) {
        expect(fd[i]).toBeCloseTo(analytic[i]!, 6);
      }
    }
  });

  it("produces a finite result on a model the analytic form can't handle (Magnus included)", () => {
    const mass = 0.145;
    const radius = 0.0366;
    const cd = new ConstantCd(0.47);
    const cl = new SaturatingLiftCoefficient();
    const spin = 180;

    const model = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: cd,
      liftCoefficient: cl,
      spin,
    });
    const ctx = createEvalContext(env, params);
    const fdJacobian = createFiniteDifferenceJacobian(model, ctx);

    for (const [x, yPos, vx, vy] of STATES) {
      const y = new Float64Array([x, yPos, vx, vy]);
      const fd = new Float64Array(DIM * DIM);
      fdJacobian(0, y, fd);
      expect(fd.every((v) => Number.isFinite(v))).toBe(true);
    }
  });
});
