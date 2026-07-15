import { describe, expect, it } from "vitest";
import { createEvalContext, type EvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { gravityQuadraticDragJacobian } from "./jacobian.js";
import type { Model } from "./model.js";

const DIM = 4;

/** Central-difference Jacobian of model.rhs, used as the ground truth to check the analytic formula against. */
function centralDifferenceJacobian(
  model: Model,
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  h = 1e-6,
): Float64Array {
  const J = new Float64Array(DIM * DIM);
  const yPerturbed = Float64Array.from(y);
  const fPlus = new Float64Array(DIM);
  const fMinus = new Float64Array(DIM);

  for (let j = 0; j < DIM; j++) {
    yPerturbed[j] = y[j]! + h;
    model.rhs(t, yPerturbed, fPlus, ctx);
    yPerturbed[j] = y[j]! - h;
    model.rhs(t, yPerturbed, fMinus, ctx);
    yPerturbed[j] = y[j]!;

    for (let i = 0; i < DIM; i++) {
      J[i * DIM + j] = (fPlus[i]! - fMinus[i]!) / (2 * h);
    }
  }
  return J;
}

describe("gravityQuadraticDragJacobian", () => {
  const cd = new ConstantCd(0.47);
  const mass = 0.145;
  const radius = 0.0366;
  const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
  const ctx = createEvalContext(env, params);

  // Same deterministic pseudo-random states as planar-projectile-model.test.ts (all nonzero speed, away
  // from the v_rel=0 kink where the RHS is only C1 and central differences lose second-order accuracy).
  const states: Array<[number, number, number, number]> = [
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

  it("matches central finite differences to 1e-7 at 10 states", () => {
    for (const state of states) {
      const y = new Float64Array(state);
      const analytic = new Float64Array(DIM * DIM);
      gravityQuadraticDragJacobian(0, y, ctx, analytic);
      const fd = centralDifferenceJacobian(model, 0, y, ctx);

      for (let k = 0; k < DIM * DIM; k++) {
        expect(analytic[k]!).toBeCloseTo(fd[k]!, 7);
      }
    }
  });

  it("kinematic rows are exact: dx'/dvx = 1, dy'/dvy = 1, all other kinematic entries 0", () => {
    const y = new Float64Array([1, 2, 3, 4]);
    const J = new Float64Array(DIM * DIM);
    gravityQuadraticDragJacobian(0, y, ctx, J);
    expect([J[0]!, J[1]!, J[2]!, J[3]!]).toEqual([0, 0, 1, 0]);
    expect([J[4]!, J[5]!, J[6]!, J[7]!]).toEqual([0, 0, 0, 1]);
  });

  it("acceleration rows have zero position-derivative entries under position-independent env", () => {
    const y = new Float64Array([3, 7, 15, -9]);
    const J = new Float64Array(DIM * DIM);
    gravityQuadraticDragJacobian(0, y, ctx, J);
    expect(J[2 * DIM + 0]).toBe(0); // d(ax)/dx
    expect(J[2 * DIM + 1]).toBe(0); // d(ax)/dy
    expect(J[3 * DIM + 0]).toBe(0); // d(ay)/dx
    expect(J[3 * DIM + 1]).toBe(0); // d(ay)/dy
  });

  it("no NaN at v_rel = 0; drag-term partials vanish smoothly (C1 kink, §3.8)", () => {
    const y = new Float64Array([0, 0, 0, 0]);
    const J = new Float64Array(DIM * DIM);
    gravityQuadraticDragJacobian(0, y, ctx, J);
    for (let k = 0; k < DIM * DIM; k++) {
      expect(Number.isFinite(J[k]!)).toBe(true);
    }
    expect(J[2 * DIM + 2]).toBe(0);
    expect(J[2 * DIM + 3]).toBe(0);
    expect(J[3 * DIM + 2]).toBe(0);
    expect(J[3 * DIM + 3]).toBe(0);
  });

  it("vx/vy cross term is symmetric (isotropic drag is a gradient field in v_rel)", () => {
    const y = new Float64Array([0, 0, 17, -22]);
    const J = new Float64Array(DIM * DIM);
    gravityQuadraticDragJacobian(0, y, ctx, J);
    expect(J[2 * DIM + 3]).toBeCloseTo(J[3 * DIM + 2]!, 15);
  });
});
