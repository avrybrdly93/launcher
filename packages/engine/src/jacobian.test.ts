import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { createGravityQuadraticDragJacobian } from "./jacobian.js";

// Central-difference J = df/dy of the real composed rhs, independent of the
// analytic module under test, so the comparison is a genuine cross-check.
function centralDifferenceJacobian(
  rhs: (t: number, y: Float64Array, out: Float64Array) => void,
  t: number,
  y: Float64Array,
  h: number,
): Float64Array {
  const dim = y.length;
  const out = new Float64Array(dim * dim);
  const yPlus = new Float64Array(y);
  const yMinus = new Float64Array(y);
  const fPlus = new Float64Array(dim);
  const fMinus = new Float64Array(dim);

  for (let j = 0; j < dim; j++) {
    yPlus.set(y);
    yMinus.set(y);
    yPlus[j] = yPlus[j]! + h;
    yMinus[j] = yMinus[j]! - h;
    rhs(t, yPlus, fPlus);
    rhs(t, yMinus, fMinus);
    for (let i = 0; i < dim; i++) {
      out[4 * i + j] = (fPlus[i]! - fMinus[i]!) / (2 * h);
    }
  }
  return out;
}

describe("createGravityQuadraticDragJacobian", () => {
  const mass = 0.145;
  const radius = 0.0366;
  const area = Math.PI * radius * radius;
  const cdValue = 0.47;
  const rho = 1.225; // ConstantAtmosphere ISA sea-level density

  const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass,
    radius,
    dragCoefficient: new ConstantCd(cdValue),
  });
  const ctx = createEvalContext(env, params);
  const rhs = (t: number, y: Float64Array, out: Float64Array): void => model.rhs(t, y, out, ctx);
  const jacobian = createGravityQuadraticDragJacobian({ mass, area, cd: cdValue, rho });

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

  it("matches central finite differences of the real composed rhs to 1e-7 at 10 states", () => {
    for (const state of states) {
      const y = new Float64Array(state);
      const analytic = new Float64Array(16);
      jacobian(0, y, analytic);
      const fd = centralDifferenceJacobian(rhs, 0, y, 1e-5);

      for (let idx = 0; idx < 16; idx++) {
        expect(analytic[idx]).toBeCloseTo(fd[idx]!, 7);
      }
    }
  });

  it("is exactly the zero drag-velocity block at v_rel = 0 (no NaN, matches P1.09's limit)", () => {
    const out = new Float64Array(16);
    jacobian(0, new Float64Array([0, 0, 0, 0]), out);
    expect(out[2 * 4 + 2]).toBe(0);
    expect(out[2 * 4 + 3]).toBe(0);
    expect(out[3 * 4 + 2]).toBe(0);
    expect(out[3 * 4 + 3]).toBe(0);
    expect(out.every((v) => Number.isFinite(v))).toBe(true);
  });

  it("velocity-position block is zero (const rho/Cd/area/wind => no positional dependence)", () => {
    const out = new Float64Array(16);
    jacobian(0, new Float64Array([3, 7, 15, -20]), out);
    expect(out[2 * 4 + 0]).toBe(0);
    expect(out[2 * 4 + 1]).toBe(0);
    expect(out[3 * 4 + 0]).toBe(0);
    expect(out[3 * 4 + 1]).toBe(0);
  });
});
