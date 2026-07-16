import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { createGravityQuadraticDragJacobian } from "./jacobian.js";

/** Central finite-difference Jacobian of `rhs` at (t, y), as a reference oracle. */
function fdJacobian(
  rhs: (t: number, y: Float64Array, out: Float64Array) => void,
  t: number,
  y: Float64Array,
): Float64Array {
  const dim = y.length;
  const out = new Float64Array(dim * dim);
  const yPlus = new Float64Array(y);
  const yMinus = new Float64Array(y);
  const fPlus = new Float64Array(dim);
  const fMinus = new Float64Array(dim);

  for (let j = 0; j < dim; j++) {
    const h = 1e-6 * Math.max(1, Math.abs(y[j]!));
    yPlus[j] = y[j]! + h;
    yMinus[j] = y[j]! - h;
    rhs(t, yPlus, fPlus);
    rhs(t, yMinus, fMinus);
    yPlus[j] = y[j]!;
    yMinus[j] = y[j]!;

    for (let i = 0; i < dim; i++) {
      out[i * dim + j] = (fPlus[i]! - fMinus[i]!) / (2 * h);
    }
  }
  return out;
}

describe("createGravityQuadraticDragJacobian", () => {
  it("matches central finite differences of the rhs to 1e-7 at 10 states", () => {
    const cd = new ConstantCd(0.47);
    const mass = 0.145;
    const radius = 0.0366;

    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const environment = new Environment(
      new ConstantAtmosphere(),
      new UniformGravity(),
      new ZeroWind(),
    );
    const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
    const ctx = createEvalContext(environment, params);
    const analyticJacobian = createGravityQuadraticDragJacobian(environment, params);

    const rhs = (t: number, y: Float64Array, out: Float64Array): void => {
      model.rhs(t, y, out, ctx);
    };

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
      analyticJacobian(0, y, analytic);
      const numeric = fdJacobian(rhs, 0, y);

      for (let idx = 0; idx < 16; idx++) {
        expect(Math.abs(analytic[idx]! - numeric[idx]!)).toBeLessThan(1e-7);
      }
    }
  });

  it("returns the exact kinematic rows plus zero drag terms at v_rel = 0", () => {
    const cd = new ConstantCd(0.47);
    const environment = new Environment(
      new ConstantAtmosphere(),
      new UniformGravity(),
      new ZeroWind(),
    );
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: cd,
    });
    const analyticJacobian = createGravityQuadraticDragJacobian(environment, params);

    const out = new Float64Array(16);
    analyticJacobian(0, new Float64Array([0, 0, 0, 0]), out);

    expect(Array.from(out)).toEqual([0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
