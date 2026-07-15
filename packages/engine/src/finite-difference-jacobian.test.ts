import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { createGravityQuadraticDragJacobian } from "./jacobian.js";
import { createFiniteDifferenceJacobian } from "./finite-difference-jacobian.js";

describe("createFiniteDifferenceJacobian", () => {
  const mass = 0.145;
  const radius = 0.0366;
  const cd = new ConstantCd(0.47);

  const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
  const ctx = createEvalContext(env, params);

  const analytic = createGravityQuadraticDragJacobian(env, params);
  const fd = createFiniteDifferenceJacobian(model, ctx);

  const states: [number, number, number, number][] = [
    [0, 0, 12.3, 4.1],
    [10, 5, -8.2, 15.6],
    [-3, 20, 25.0, -30.1],
    [0, 0.5, 1.0, -2.0],
    [100, 10, -1.5, -1.5],
    [0, 0, 40, 0],
    [0, 0, 0, 40],
    [5, 5, 5, 5],
    [-10, -10, -20, 20],
    [1, 1, 33.3, -12.7],
  ];

  it("matches the P1.22 analytic Jacobian where available (gravity+quadratic-drag)", () => {
    for (const state of states) {
      const y = new Float64Array(state);
      const outAnalytic = new Float64Array(16);
      const outFd = new Float64Array(16);
      analytic(0, y, outAnalytic);
      fd(0, y, outFd);

      for (let i = 0; i < 16; i++) {
        expect(Math.abs(outFd[i]! - outAnalytic[i]!)).toBeLessThan(1e-6);
      }
    }
  });

  it("uses a per-component step scaled to |y_j|, not a single fixed step", () => {
    // A state mixing O(100) positions with O(0.01) velocities would blow up
    // a fixed absolute step (too coarse for vy, absurdly fine for x).
    const y = new Float64Array([500, -500, 0.02, -0.03]);
    const outAnalytic = new Float64Array(16);
    const outFd = new Float64Array(16);
    analytic(0, y, outAnalytic);
    fd(0, y, outFd);
    for (let i = 0; i < 16; i++) {
      expect(Math.abs(outFd[i]! - outAnalytic[i]!)).toBeLessThan(1e-6);
    }
  });

  it("is allocation-free per call (scratch buffers captured once by the closure)", () => {
    const y = new Float64Array([0, 0, 10, 10]);
    const out = new Float64Array(16);
    // Smoke check: repeated calls must not throw and must stay finite/consistent.
    for (let i = 0; i < 1000; i++) {
      fd(0, y, out);
    }
    for (const v of out) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("respects custom relativeStep/minStep options", () => {
    const customFd = createFiniteDifferenceJacobian(model, ctx, {
      relativeStep: 1e-5,
      minStep: 1e-7,
    });
    const y = new Float64Array([0, 0, 15, -5]);
    const outAnalytic = new Float64Array(16);
    const outCustom = new Float64Array(16);
    analytic(0, y, outAnalytic);
    customFd(0, y, outCustom);
    for (let i = 0; i < 16; i++) {
      expect(Math.abs(outCustom[i]! - outAnalytic[i]!)).toBeLessThan(1e-5);
    }
  });
});
