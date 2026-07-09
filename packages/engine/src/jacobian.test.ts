import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import {
  ConstantAtmosphere,
  Environment,
  UniformGravity,
  ZeroWind,
  type WindModel,
} from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams, type ProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { createGravityQuadraticDragJacobian } from "./jacobian.js";
import type { Model } from "./model.js";

const DIM = 4;

/** Uniform, time-and-position-independent wind — spatially uniform so the
 * analytic Jacobian's "no position dependence" assumption still holds exactly. */
class UniformWind implements WindModel {
  constructor(
    private readonly wx: number,
    private readonly wy: number,
  ) {}

  sample(_t: number, _x: number, _y: number, out: { wx: number; wy: number }): void {
    out.wx = this.wx;
    out.wy = this.wy;
  }
}

/** Central-difference Jacobian of `model.rhs` at (t, y), scaled step per component. */
function finiteDifferenceJacobian(
  model: Model,
  t: number,
  y: Float64Array,
  ctx: ReturnType<typeof createEvalContext>,
): Float64Array {
  const jac = new Float64Array(DIM * DIM);
  const fPlus = new Float64Array(DIM);
  const fMinus = new Float64Array(DIM);
  const yPerturbed = new Float64Array(y);

  for (let j = 0; j < DIM; j++) {
    const h = 1e-6 * Math.max(1, Math.abs(y[j]!));
    yPerturbed.set(y);
    yPerturbed[j] = y[j]! + h;
    model.rhs(t, yPerturbed, fPlus, ctx);

    yPerturbed.set(y);
    yPerturbed[j] = y[j]! - h;
    model.rhs(t, yPerturbed, fMinus, ctx);

    for (let i = 0; i < DIM; i++) {
      jac[i * DIM + j] = (fPlus[i]! - fMinus[i]!) / (2 * h);
    }
  }
  return jac;
}

function buildModel(env: Environment, params: ProjectileParams) {
  const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
  const ctx = createEvalContext(env, params);
  return { model, ctx };
}

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

describe("gravityQuadraticDragJacobian", () => {
  it("matches central finite differences to 1e-7 at 10 random states (still air)", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const { model, ctx } = buildModel(env, params);
    const analyticJacobian = createGravityQuadraticDragJacobian(env, params);

    for (const [x, y, vx, vy] of STATES) {
      const state = new Float64Array([x, y, vx, vy]);
      const analytic = new Float64Array(DIM * DIM);
      analyticJacobian(0, state, analytic);
      const fd = finiteDifferenceJacobian(model, 0, state, ctx);

      for (let i = 0; i < DIM * DIM; i++) {
        expect(analytic[i]).toBeCloseTo(fd[i]!, 7);
      }
    }
  });

  it("matches central finite differences to 1e-7 with a uniform crosswind", () => {
    const env = new Environment(
      new ConstantAtmosphere(),
      new UniformGravity(),
      new UniformWind(3, -1.5),
    );
    const params = createSphericalProjectileParams({
      mass: 0.4593,
      radius: 0.11,
      dragCoefficient: new ConstantCd(0.25),
    });
    const { model, ctx } = buildModel(env, params);
    const analyticJacobian = createGravityQuadraticDragJacobian(env, params);

    for (const [x, y, vx, vy] of STATES) {
      const state = new Float64Array([x, y, vx, vy]);
      const analytic = new Float64Array(DIM * DIM);
      analyticJacobian(0, state, analytic);
      const fd = finiteDifferenceJacobian(model, 0, state, ctx);

      for (let i = 0; i < DIM * DIM; i++) {
        expect(analytic[i]).toBeCloseTo(fd[i]!, 7);
      }
    }
  });

  it("has the exact kinematic identity block (dx/dvx = dy/dvy = 1, no position dependence)", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0.47),
    });
    const analyticJacobian = createGravityQuadraticDragJacobian(env, params);
    const out = new Float64Array(DIM * DIM);
    analyticJacobian(0, new Float64Array([10, 20, 15, -5]), out);

    // row 0 (dx/dt): only dvx contributes
    expect(out[0 * DIM + 0]).toBe(0);
    expect(out[0 * DIM + 1]).toBe(0);
    expect(out[0 * DIM + 2]).toBe(1);
    expect(out[0 * DIM + 3]).toBe(0);
    // row 1 (dy/dt): only dvy contributes
    expect(out[1 * DIM + 0]).toBe(0);
    expect(out[1 * DIM + 1]).toBe(0);
    expect(out[1 * DIM + 2]).toBe(0);
    expect(out[1 * DIM + 3]).toBe(1);
    // no position dependence anywhere (columns 0, 1 all zero)
    for (let i = 0; i < DIM; i++) {
      expect(out[i * DIM + 0]).toBe(0);
      expect(out[i * DIM + 1]).toBe(0);
    }
  });

  it("returns finite zeros for the drag partials at v_rel = 0 (no NaN)", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0.47),
    });
    const analyticJacobian = createGravityQuadraticDragJacobian(env, params);
    const out = new Float64Array(DIM * DIM);
    analyticJacobian(0, new Float64Array([0, 0, 0, 0]), out);

    for (const v of out) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(out[2 * DIM + 2]).toBe(0);
    expect(out[2 * DIM + 3]).toBe(0);
    expect(out[3 * DIM + 2]).toBe(0);
    expect(out[3 * DIM + 3]).toBe(0);
  });

  it("velocity block is symmetric (dFx/dvy = dFy/dvx)", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const analyticJacobian = createGravityQuadraticDragJacobian(env, params);
    const out = new Float64Array(DIM * DIM);
    analyticJacobian(0, new Float64Array([0, 0, 18, -6]), out);

    expect(out[2 * DIM + 3]).toBeCloseTo(out[3 * DIM + 2]!, 15);
  });
});
