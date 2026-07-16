import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { createGravityQuadraticDragJacobian } from "./planar-projectile-jacobian.js";

const DIM = 4;

/** Central finite-difference Jacobian, used only to validate the analytic form above. */
function finiteDifferenceJacobian(
  rhs: (t: number, y: Float64Array, out: Float64Array) => void,
  t: number,
  y: Float64Array,
  out: Float64Array,
): void {
  const h = 1e-6;
  const yPlus = new Float64Array(DIM);
  const yMinus = new Float64Array(DIM);
  const fPlus = new Float64Array(DIM);
  const fMinus = new Float64Array(DIM);

  for (let col = 0; col < DIM; col++) {
    yPlus.set(y);
    yMinus.set(y);
    const step = h * Math.max(1, Math.abs(y[col]!));
    yPlus[col] = y[col]! + step;
    yMinus[col] = y[col]! - step;

    rhs(t, yPlus, fPlus);
    rhs(t, yMinus, fMinus);

    for (let row = 0; row < DIM; row++) {
      out[row * DIM + col] = (fPlus[row]! - fMinus[row]!) / (2 * step);
    }
  }
}

describe("createGravityQuadraticDragJacobian", () => {
  it("matches central finite differences to 1e-7 at 10 random states", () => {
    const mass = 0.145;
    const radius = 0.0366;
    const cd = new ConstantCd(0.47);

    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
    const ctx = createEvalContext(env, params);

    const rhs = (t: number, y: Float64Array, out: Float64Array): void => {
      model.rhs(t, y, out, ctx);
    };
    const jacobian = createGravityQuadraticDragJacobian(env, params);

    // Deterministic pseudo-random states (avoid a test dependency on a RNG library).
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

    for (const [x, yPos, vx, vy] of states) {
      const y = new Float64Array([x, yPos, vx, vy]);
      const analytic = new Float64Array(DIM * DIM);
      const fd = new Float64Array(DIM * DIM);

      jacobian(0, y, analytic);
      finiteDifferenceJacobian(rhs, 0, y, fd);

      for (let i = 0; i < DIM * DIM; i++) {
        expect(analytic[i]).toBeCloseTo(fd[i]!, 7);
      }
    }
  });

  it("is exactly zero in the velocity block at v_rel = 0 (matches the smooth limit)", () => {
    const mass = 0.145;
    const radius = 0.0366;
    const cd = new ConstantCd(0.47);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
    const jacobian = createGravityQuadraticDragJacobian(env, params);

    const y = new Float64Array([0, 0, 0, 0]);
    const out = new Float64Array(DIM * DIM);
    jacobian(0, y, out);

    expect(out[0 * DIM + 2]).toBe(1); // dx/dt = vx
    expect(out[1 * DIM + 3]).toBe(1); // dy/dt = vy
    expect(out[2 * DIM + 2]).toBe(0);
    expect(out[2 * DIM + 3]).toBe(0);
    expect(out[3 * DIM + 2]).toBe(0);
    expect(out[3 * DIM + 3]).toBe(0);
    expect(out.every((v) => Number.isFinite(v))).toBe(true);
  });
});
