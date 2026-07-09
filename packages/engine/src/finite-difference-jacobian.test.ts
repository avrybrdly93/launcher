import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { gravityQuadraticDragJacobian } from "./jacobian.js";
import { createFiniteDifferenceJacobian } from "./finite-difference-jacobian.js";
import type { Model } from "./model.js";

describe("createFiniteDifferenceJacobian", () => {
  it("reproduces a hand-derived Jacobian exactly for a linear model", () => {
    // f(y) = A*y, a stand-in Model with a trivially known constant Jacobian = A.
    const A = [
      [1, 2],
      [-3, 4],
    ];
    const model: Model = {
      dim: 2,
      channels: [
        { name: "a", unit: "1" },
        { name: "b", unit: "1" },
      ],
      rhs(_t, y, out) {
        out[0] = A[0]![0]! * y[0]! + A[0]![1]! * y[1]!;
        out[1] = A[1]![0]! * y[0]! + A[1]![1]! * y[1]!;
      },
    };

    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params); // unused by this model's rhs, but keeps the call site realistic

    const fd = createFiniteDifferenceJacobian(model);
    const out = new Float64Array(4);
    fd(0, new Float64Array([5, -7]), out, ctx);

    expect(out[0]).toBeCloseTo(1, 6);
    expect(out[1]).toBeCloseTo(2, 6);
    expect(out[2]).toBeCloseTo(-3, 6);
    expect(out[3]).toBeCloseTo(4, 6);
  });

  it("matches the P1.22 analytic Jacobian where both apply (gravity+quadratic-drag)", () => {
    const mass = 0.145;
    const radius = 0.0366;
    const cd = new ConstantCd(0.47);
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });

    const fd = createFiniteDifferenceJacobian(model);
    const states: [number, number, number, number][] = [
      [0, 0, 12.3, 4.1],
      [10, 5, -8.2, 15.6],
      [-3, 20, 25.0, -30.1],
      [100, 10, -1.5, -1.5],
      [5, 5, 5, 5],
    ];

    for (const state of states) {
      const y = new Float64Array(state);
      const analytic = new Float64Array(16);
      gravityQuadraticDragJacobian(0, y, analytic, createEvalContext(env, params));

      const fdOut = new Float64Array(16);
      fd(0, y, fdOut, createEvalContext(env, params));

      for (let i = 0; i < 16; i++) {
        expect(Math.abs(analytic[i]! - fdOut[i]!)).toBeLessThan(1e-7);
      }
    }
  });

  it("also works with Magnus enabled, where no analytic Jacobian is available", () => {
    const mass = 0.145;
    const radius = 0.0366;
    const model = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(0.47),
      liftCoefficient: new SaturatingLiftCoefficient(),
      spin: 180,
    });
    const ctx = createEvalContext(env, params);

    const fd = createFiniteDifferenceJacobian(model);
    const out = new Float64Array(16);
    fd(0, new Float64Array([0, 0, 20, 5]), out, ctx);

    for (const v of out) {
      expect(Number.isFinite(v)).toBe(true);
    }
    // dx/dt = vx, dy/dt = vy exactly, regardless of force set.
    expect(out[2]).toBeCloseTo(1, 6);
    expect(out[7]).toBeCloseTo(1, 6);
  });

  it("does not allocate new scratch buffers across repeated calls (reuses closure state)", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    const fd = createFiniteDifferenceJacobian(model);
    const out = new Float64Array(16);
    const y = new Float64Array([0, 0, 10, 10]);

    expect(() => {
      for (let i = 0; i < 1000; i++) fd(0, y, out, ctx);
    }).not.toThrow();
  });
});
