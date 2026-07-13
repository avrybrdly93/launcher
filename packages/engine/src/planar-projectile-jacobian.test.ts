import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { gravityQuadraticDragJacobian } from "./planar-projectile-jacobian.js";

const DIM = 4;

/** Central finite-difference Jacobian, used only as an independent oracle in this test. */
function centralDifferenceJacobian(
  rhs: (t: number, y: Float64Array, out: Float64Array) => void,
  t: number,
  y: Float64Array,
  out: Float64Array,
): void {
  const h = 1e-6;
  const yPlus = new Float64Array(y);
  const yMinus = new Float64Array(y);
  const fPlus = new Float64Array(DIM);
  const fMinus = new Float64Array(DIM);

  for (let col = 0; col < DIM; col++) {
    yPlus.set(y);
    yMinus.set(y);
    yPlus[col]! += h;
    yMinus[col]! -= h;
    rhs(t, yPlus, fPlus);
    rhs(t, yMinus, fMinus);
    for (let row = 0; row < DIM; row++) {
      out[row * DIM + col] = (fPlus[row]! - fMinus[row]!) / (2 * h);
    }
  }
}

describe("gravityQuadraticDragJacobian", () => {
  const cd = new ConstantCd(0.47);
  const mass = 0.145;
  const radius = 0.0366;

  const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
  const ctx = createEvalContext(env, params);
  const rhs = (t: number, y: Float64Array, out: Float64Array): void => model.rhs(t, y, out, ctx);

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

  it("matches central finite differences to 1e-7 at 10 random states", () => {
    for (const state of states) {
      const y = new Float64Array(state);
      const analytic = new Float64Array(DIM * DIM);
      const fd = new Float64Array(DIM * DIM);

      gravityQuadraticDragJacobian(0, y, analytic, ctx);
      centralDifferenceJacobian(rhs, 0, y, fd);

      for (let i = 0; i < DIM * DIM; i++) {
        expect(analytic[i]).toBeCloseTo(fd[i]!, 7);
      }
    }
  });

  it("drag Jacobian block vanishes smoothly as v_rel -> 0 (no NaN)", () => {
    const y = new Float64Array([0, 0, 0, 0]);
    const out = new Float64Array(DIM * DIM);
    gravityQuadraticDragJacobian(0, y, out, ctx);
    for (const v of out) {
      expect(Number.isNaN(v)).toBe(false);
    }
    expect(out[2 * DIM + 2]).toBe(0);
    expect(out[2 * DIM + 3]).toBe(0);
    expect(out[3 * DIM + 2]).toBe(0);
    expect(out[3 * DIM + 3]).toBe(0);
  });

  it("kinematic rows are exact: d(x)/d(vx) = 1, d(y)/d(vy) = 1, no other dependence", () => {
    const y = new Float64Array([1, 2, 3, 4]);
    const out = new Float64Array(DIM * DIM);
    gravityQuadraticDragJacobian(0, y, out, ctx);
    expect(out[0 * DIM + 0]).toBe(0);
    expect(out[0 * DIM + 1]).toBe(0);
    expect(out[0 * DIM + 2]).toBe(1);
    expect(out[0 * DIM + 3]).toBe(0);
    expect(out[1 * DIM + 0]).toBe(0);
    expect(out[1 * DIM + 1]).toBe(0);
    expect(out[1 * DIM + 2]).toBe(0);
    expect(out[1 * DIM + 3]).toBe(1);
  });
});
