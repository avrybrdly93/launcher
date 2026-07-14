import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import type { WindModel } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { gravityQuadraticDragJacobian } from "./jacobian.js";
import type { EvalContext } from "./eval-context.js";

/** Uniform, spatially-constant wind for test purposes (no UniformWind class yet, P1.29). */
class ConstantWind implements WindModel {
  constructor(
    private readonly wx: number,
    private readonly wy: number,
  ) {}

  sample(_t: number, _x: number, _y: number, out: { wx: number; wy: number }): void {
    out.wx = this.wx;
    out.wy = this.wy;
  }
}

/** Central-difference Jacobian of model.rhs, scaled step per (4.1)-style FD practice. */
function centralDifferenceJacobian(
  rhs: (t: number, y: Float64Array, out: Float64Array) => void,
  t: number,
  y: Float64Array,
  out: Float64Array,
): void {
  const dim = y.length;
  const yPlus = new Float64Array(dim);
  const yMinus = new Float64Array(dim);
  const fPlus = new Float64Array(dim);
  const fMinus = new Float64Array(dim);

  for (let col = 0; col < dim; col++) {
    const h = 1e-6 * Math.max(1, Math.abs(y[col]!));
    yPlus.set(y);
    yMinus.set(y);
    yPlus[col] = y[col]! + h;
    yMinus[col] = y[col]! - h;

    rhs(t, yPlus, fPlus);
    rhs(t, yMinus, fMinus);

    for (let row = 0; row < dim; row++) {
      out[row * dim + col] = (fPlus[row]! - fMinus[row]!) / (2 * h);
    }
  }
}

function buildContext(wind: WindModel = new ZeroWind()): {
  ctx: EvalContext;
  rhs: (t: number, y: Float64Array, out: Float64Array) => void;
} {
  const cd = new ConstantCd(0.47);
  const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), wind);
  const params = createSphericalProjectileParams({
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: cd,
  });
  const ctx = createEvalContext(env, params);
  return { ctx, rhs: (t, y, out) => model.rhs(t, y, out, ctx) };
}

describe("gravityQuadraticDragJacobian", () => {
  const states: [number, number, number, number][] = [
    [0, 0, 12.3, 4.1],
    [10, 5, -8.2, 15.6],
    [-3, 20, 25.0, -30.1],
    [0, 0.5, 3.0, -2.0],
    [100, 10, -1.5, -1.5],
    [0, 0, 40, 0],
    [0, 0, 0, 40],
    [5, 5, 5, 5],
    [-10, -10, -20, 20],
    [1, 1, 33.3, -12.7],
  ];

  it("matches central finite differences to 1e-7 at 10 random states", () => {
    const { ctx, rhs } = buildContext();
    const analytic = new Float64Array(16);
    const fd = new Float64Array(16);

    for (const state of states) {
      const y = new Float64Array(state);
      gravityQuadraticDragJacobian(0, y, ctx, analytic);
      centralDifferenceJacobian(rhs, 0, y, fd);

      for (let i = 0; i < 16; i++) {
        expect(analytic[i]!).toBeCloseTo(fd[i]!, 7);
      }
    }
  });

  it("matches central finite differences under uniform nonzero wind", () => {
    const { ctx, rhs } = buildContext(new ConstantWind(3, -1.5));
    const analytic = new Float64Array(16);
    const fd = new Float64Array(16);

    for (const state of states) {
      const y = new Float64Array(state);
      gravityQuadraticDragJacobian(0, y, ctx, analytic);
      centralDifferenceJacobian(rhs, 0, y, fd);

      for (let i = 0; i < 16; i++) {
        expect(analytic[i]!).toBeCloseTo(fd[i]!, 7);
      }
    }
  });

  it("kinematic rows are exactly the identity block regardless of state", () => {
    const { ctx } = buildContext();
    const out = new Float64Array(16);
    gravityQuadraticDragJacobian(0, new Float64Array([1, 2, 3, 4]), ctx, out);

    expect(out[0 * 4 + 0]).toBe(0);
    expect(out[0 * 4 + 1]).toBe(0);
    expect(out[0 * 4 + 2]).toBe(1);
    expect(out[0 * 4 + 3]).toBe(0);
    expect(out[1 * 4 + 0]).toBe(0);
    expect(out[1 * 4 + 1]).toBe(0);
    expect(out[1 * 4 + 2]).toBe(0);
    expect(out[1 * 4 + 3]).toBe(1);
  });

  it("drag block is finite zero at v_rel = 0 (no NaN at the C1 kink, §3.8)", () => {
    const { ctx } = buildContext();
    const out = new Float64Array(16);
    gravityQuadraticDragJacobian(0, new Float64Array([0, 0, 0, 0]), ctx, out);

    for (const v of out) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(out[2 * 4 + 2]).toBe(0);
    expect(out[3 * 4 + 3]).toBe(0);
  });
});
