import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { createGravityQuadraticDragJacobian } from "./jacobian.js";

const DIM = 4;
const FD_STEP = 1e-6;

/** Central-difference Jacobian of `model.rhs`, row-major to match the analytic convention. */
function centralDifferenceJacobian(
  rhs: (t: number, y: Float64Array, out: Float64Array) => void,
  t: number,
  y: Float64Array,
): Float64Array {
  const out = new Float64Array(DIM * DIM);
  const yPlus = Float64Array.from(y);
  const yMinus = Float64Array.from(y);
  const fPlus = new Float64Array(DIM);
  const fMinus = new Float64Array(DIM);

  for (let col = 0; col < DIM; col++) {
    const h = FD_STEP * Math.max(1, Math.abs(y[col]!));
    yPlus[col] = y[col]! + h;
    yMinus[col] = y[col]! - h;

    rhs(t, yPlus, fPlus);
    rhs(t, yMinus, fMinus);

    for (let row = 0; row < DIM; row++) {
      out[row * DIM + col] = (fPlus[row]! - fMinus[row]!) / (2 * h);
    }

    yPlus[col] = y[col]!;
    yMinus[col] = y[col]!;
  }

  return out;
}

describe("createGravityQuadraticDragJacobian (P1.22)", () => {
  const mass = 0.145;
  const radius = 0.0366;
  const cd = new ConstantCd(0.47);
  const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
  const environment = new Environment(
    new ConstantAtmosphere(),
    new UniformGravity(),
    new ZeroWind(),
  );

  const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()], {
    params,
    environment,
  });
  const jacobian = createGravityQuadraticDragJacobian(params, environment);
  const ctx = createEvalContext(environment, params);
  const rhs = (t: number, y: Float64Array, out: Float64Array): void => model.rhs(t, y, out, ctx);

  it("is wired onto the model when the force set is exactly {gravity, quadratic drag}", () => {
    expect(model.jacobian).toBeDefined();
  });

  it("is absent when Magnus (or any other force) is present", () => {
    const withMagnus = createPlanarProjectileModel(
      [new GravityForce(), new QuadraticDragForce(), new MagnusForce()],
      { params, environment },
    );
    expect(withMagnus.jacobian).toBeUndefined();
  });

  it("is absent when jacobianEnv is not supplied", () => {
    const noEnv = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    expect(noEnv.jacobian).toBeUndefined();
  });

  it("matches central finite differences to 1e-7 at 10 random states", () => {
    const states: [number, number, number, number][] = [
      [0, 0, 12.3, 4.1],
      [10, 5, -8.2, 15.6],
      [-3, 20, 25.0, -30.1],
      [0, 0.5, 3.001, -2.002],
      [100, 10, -1.5, -1.5],
      [0, 0, 40, 0],
      [0, 0, 0, 40],
      [5, 5, 5, 5],
      [-10, -10, -20, 20],
      [1, 1, 33.3, -12.7],
    ];

    for (const state of states) {
      const y = new Float64Array(state);
      const analytic = new Float64Array(DIM * DIM);
      jacobian(0, y, analytic);

      const fd = centralDifferenceJacobian(rhs, 0, y);

      for (let i = 0; i < DIM * DIM; i++) {
        expect(analytic[i]).toBeCloseTo(fd[i]!, 7);
      }
    }
  });

  it("returns the zero-limit velocity block at v_rel = 0 (no 0/0 NaN)", () => {
    const y = new Float64Array([0, 0, 0, 0]);
    const out = new Float64Array(DIM * DIM);
    jacobian(0, y, out);

    expect(out[2 * DIM + 2]).toBe(0);
    expect(out[2 * DIM + 3]).toBe(0);
    expect(out[3 * DIM + 2]).toBe(0);
    expect(out[3 * DIM + 3]).toBe(0);
    expect(out.some((v) => Number.isNaN(v))).toBe(false);
  });
});
