import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd, TabulatedReynoldsCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { createGravityQuadraticDragJacobian } from "./jacobian.js";
import { createFiniteDifferenceJacobian } from "./finite-difference-jacobian.js";
import type { Model } from "./model.js";

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
  it("matches the P1.22 analytic Jacobian where it is available (gravity + quadratic drag)", () => {
    const mass = 0.145;
    const radius = 0.0366;
    const area = Math.PI * radius * radius;
    const cdValue = 0.47;
    const rho = 1.225;

    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(cdValue),
    });
    const ctx = createEvalContext(env, params);

    const analytic = createGravityQuadraticDragJacobian({ mass, area, cd: cdValue, rho });
    const fd = createFiniteDifferenceJacobian(model, ctx);

    for (const state of STATES) {
      const y = new Float64Array(state);
      const jAnalytic = new Float64Array(16);
      const jFd = new Float64Array(16);
      analytic(0, y, jAnalytic);
      fd(0, y, jFd);

      for (let idx = 0; idx < 16; idx++) {
        expect(jFd[idx]).toBeCloseTo(jAnalytic[idx]!, 7);
      }
    }
  });

  it("stays finite on the Cd(Re)/Magnus cases the analytic Jacobian doesn't cover", () => {
    const mass = 0.0027;
    const radius = 0.02;
    const spin = 300;

    const model = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new TabulatedReynoldsCd(),
      liftCoefficient: new SaturatingLiftCoefficient(),
      spin,
    });
    const ctx = createEvalContext(env, params);
    const fd = createFiniteDifferenceJacobian(model, ctx);

    for (const state of STATES) {
      const y = new Float64Array(state);
      const j = new Float64Array(16);
      fd(0, y, j);
      expect(j.every((v) => Number.isFinite(v))).toBe(true);
    }
  });

  it("matches a hand-known Jacobian on a trivial decoupled model (ẏ = -y => J = -I)", () => {
    const dim = 3;
    const model: Model = {
      dim,
      channels: [
        { name: "a", unit: "1" },
        { name: "b", unit: "1" },
        { name: "c", unit: "1" },
      ],
      rhs(_t, y, out): void {
        for (let i = 0; i < dim; i++) out[i] = -y[i]!;
      },
    };
    const ctx = createEvalContext(
      new Environment(new ConstantAtmosphere(), new UniformGravity()),
      createSphericalProjectileParams({ mass: 1, radius: 1, dragCoefficient: new ConstantCd(0) }),
    );
    const fd = createFiniteDifferenceJacobian(model, ctx);

    const y = new Float64Array([1, -2, 3]);
    const out = new Float64Array(9);
    fd(0, y, out);

    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < dim; j++) {
        expect(out[dim * i + j]).toBeCloseTo(i === j ? -1 : 0, 6);
      }
    }
  });
});
