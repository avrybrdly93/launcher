import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { createGravityQuadraticDragJacobian } from "./jacobian.js";

/** Central finite-difference Jacobian of model.rhs, used only as an oracle in this test. */
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

  for (let col = 0; col < dim; col++) {
    const h = 1e-6 * Math.max(1, Math.abs(y[col]!));
    yPlus[col] = y[col]! + h;
    yMinus[col] = y[col]! - h;
    rhs(t, yPlus, fPlus);
    rhs(t, yMinus, fMinus);
    yPlus[col] = y[col]!;
    yMinus[col] = y[col]!;

    for (let row = 0; row < dim; row++) {
      out[row * dim + col] = (fPlus[row]! - fMinus[row]!) / (2 * h);
    }
  }
  return out;
}

describe("createGravityQuadraticDragJacobian", () => {
  const mass = 0.145;
  const radius = 0.0366;
  const cd = new ConstantCd(0.47);

  const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
  const ctx = createEvalContext(env, params);
  const rhs = (t: number, y: Float64Array, out: Float64Array): void => model.rhs(t, y, out, ctx);
  const jacobian = createGravityQuadraticDragJacobian(env, params);

  // 10 states with speed well away from the u=0 kink (Sec. 3.8: u*u_i is only
  // C1 there, so a symmetric FD step straddling it is not a fair oracle).
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

  it("matches central finite differences to 1e-7 at 10 states", () => {
    for (const state of states) {
      const y = new Float64Array(state);
      const out = new Float64Array(16);
      jacobian(0, y, out);
      const expected = fdJacobian(rhs, 0, y);

      for (let i = 0; i < 16; i++) {
        expect(Math.abs(out[i]! - expected[i]!)).toBeLessThan(1e-7);
      }
    }
  });

  it("has the exact kinematic rows d(dx/dt)/d(vx)=1, d(dy/dt)/d(vy)=1", () => {
    const y = new Float64Array([1, 2, 3, 4]);
    const out = new Float64Array(16);
    jacobian(0, y, out);
    expect(out[0 * 4 + 2]).toBe(1);
    expect(out[1 * 4 + 3]).toBe(1);
    expect(out[0 * 4 + 0]).toBe(0);
    expect(out[0 * 4 + 1]).toBe(0);
    expect(out[0 * 4 + 3]).toBe(0);
    expect(out[1 * 4 + 0]).toBe(0);
    expect(out[1 * 4 + 1]).toBe(0);
    expect(out[1 * 4 + 2]).toBe(0);
  });

  it("is symmetric in the drag block (mixed partials d(ax)/d(vy) = d(ay)/d(vx))", () => {
    const y = new Float64Array([0, 0, 17, -9]);
    const out = new Float64Array(16);
    jacobian(0, y, out);
    expect(out[2 * 4 + 3]).toBe(out[3 * 4 + 2]);
  });

  it("is the zero matrix in the drag block at u=0 (no NaN, matches C1 limit)", () => {
    const y = new Float64Array([0, 0, 0, 0]);
    const out = new Float64Array(16);
    jacobian(0, y, out);
    for (const v of out) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(out[2 * 4 + 2]).toBe(0);
    expect(out[2 * 4 + 3]).toBe(0);
    expect(out[3 * 4 + 2]).toBe(0);
    expect(out[3 * 4 + 3]).toBe(0);
  });

  it("row/col x and y (position) are entirely zero — spatially uniform env", () => {
    const y = new Float64Array([3, 7, 15, -22]);
    const out = new Float64Array(16);
    jacobian(0, y, out);
    for (let col = 0; col < 4; col++) {
      expect(out[0 * 4 + col]! === (col === 2 ? 1 : 0)).toBe(true);
      expect(out[1 * 4 + col]! === (col === 3 ? 1 : 0)).toBe(true);
    }
    for (let row = 0; row < 4; row++) {
      expect(out[row * 4 + 0]).toBe(0);
      expect(out[row * 4 + 1]).toBe(0);
    }
  });
});
