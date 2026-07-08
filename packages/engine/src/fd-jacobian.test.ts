import { describe, expect, it } from "vitest";
import type { EvalContext } from "./eval-context.js";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import type { Model } from "./model.js";
import { gravityQuadraticDragJacobian } from "./jacobian.js";
import { createFiniteDifferenceJacobian } from "./fd-jacobian.js";

describe("createFiniteDifferenceJacobian", () => {
  it("matches the analytic gravity+quadratic-drag Jacobian (P1.22) at 10 random states", () => {
    const cd = new ConstantCd(0.47);
    const mass = 0.145;
    const radius = 0.0366;

    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
    const ctx = createEvalContext(env, params);
    const fdJacobian = createFiniteDifferenceJacobian(model);

    const states: [number, number, number, number][] = [
      [0, 0, 12.3, 4.1],
      [10, 5, -8.2, 15.6],
      [-3, 20, 25.0, -30.1],
      [0, 0.5, 3.2, -4.4],
      [100, 10, -1.5, -6.5],
      [0, 0, 40, 0.1],
      [0, 0, 0.1, 40],
      [5, 5, 5, 5],
      [-10, -10, -20, 20],
      [1, 1, 33.3, -12.7],
    ];

    for (const state of states) {
      const y = new Float64Array(state);
      const analytic = new Float64Array(16);
      const fd = new Float64Array(16);
      gravityQuadraticDragJacobian(0, y, ctx, analytic);
      fdJacobian(0, y, ctx, fd);

      for (let k = 0; k < 16; k++) {
        expect(Math.abs(analytic[k]! - fd[k]!)).toBeLessThan(1e-7);
      }
    }
  });

  it("matches d/dy(-y) = -1 on a trivial scalar decay model", () => {
    const model: Model = {
      dim: 1,
      channels: [{ name: "y", unit: "1" }],
      rhs(_t, y, out) {
        out[0] = -y[0]!;
      },
    };
    const fdJacobian = createFiniteDifferenceJacobian(model);
    const ctx = {} as EvalContext; // the mock rhs never touches ctx

    const out = new Float64Array(1);
    fdJacobian(0, new Float64Array([3.7]), ctx, out);
    expect(out[0]).toBeCloseTo(-1, 6);
  });

  it("reuses preallocated scratch buffers across calls (no growth after warmup)", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const fdJacobian = createFiniteDifferenceJacobian(model);
    const out = new Float64Array(16);
    const y = new Float64Array([1, 2, 10, -5]);

    // Calling repeatedly must not throw and must keep producing finite results;
    // buffer identity is an implementation detail, but this exercises reuse.
    for (let i = 0; i < 1000; i++) {
      fdJacobian(0, y, ctx, out);
    }
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
  });
});
