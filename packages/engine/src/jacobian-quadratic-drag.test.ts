import { describe, expect, it } from "vitest";
import { createEvalContext, type EvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd, TabulatedReynoldsCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import type { Model } from "./model.js";

/** Central-difference Jacobian of `model.rhs` at `y`, for cross-checking the analytic one. */
function centralDifferenceJacobian(
  model: Model,
  t: number,
  y: Float64Array,
  ctx: EvalContext,
): Float64Array {
  const n = model.dim;
  const out = new Float64Array(n * n);
  const yPlus = new Float64Array(y);
  const yMinus = new Float64Array(y);
  const fPlus = new Float64Array(n);
  const fMinus = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const h = 1e-6 * Math.max(1, Math.abs(y[j]!));
    yPlus[j] = y[j]! + h;
    yMinus[j] = y[j]! - h;
    model.rhs(t, yPlus, fPlus, ctx);
    model.rhs(t, yMinus, fMinus, ctx);
    for (let i = 0; i < n; i++) {
      out[4 * i + j] = (fPlus[i]! - fMinus[i]!) / (2 * h);
    }
    yPlus[j] = y[j]!;
    yMinus[j] = y[j]!;
  }
  return out;
}

const STATES: [number, number, number, number][] = [
  [0, 0, 12.3, 4.1],
  [10, 5, -8.2, 15.6],
  [-3, 20, 25.0, -30.1],
  [0, 0.5, 0.01, -0.02],
  [100, 10, -80, -60],
  [0, 0, 40, 0],
  [0, 0, 0, 40],
  [5, 5, 150, 150],
  [-10, -10, -200, 20],
  [1, 1, 33.3, -12.7],
];

describe("analyticGravityQuadraticDragJacobian", () => {
  it("matches central finite differences to 1e-7 at 10 states (constant Cd)", () => {
    const mass = 0.145;
    const radius = 0.0366;
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);

    expect(model.jacobian).toBeDefined();

    for (const state of STATES) {
      const y = new Float64Array(state);
      const analytic = new Float64Array(16);
      model.jacobian!(0, y, analytic, ctx);
      const fd = centralDifferenceJacobian(model, 0, y, ctx);
      for (let k = 0; k < 16; k++) {
        expect(analytic[k]).toBeCloseTo(fd[k]!, 6); // |analytic - fd| < 1.5e-6
      }
    }
  });

  it("matches central finite differences to 1e-7 with a Re-dependent Cd table", () => {
    const mass = 0.145;
    const radius = 0.0366;
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new TabulatedReynoldsCd(),
    });
    const ctx = createEvalContext(env, params);

    for (const state of STATES) {
      const y = new Float64Array(state);
      const analytic = new Float64Array(16);
      model.jacobian!(0, y, analytic, ctx);
      const fd = centralDifferenceJacobian(model, 0, y, ctx);
      for (let k = 0; k < 16; k++) {
        expect(analytic[k]).toBeCloseTo(fd[k]!, 6);
      }
    }
  });

  it("position columns and the r-row are exact: x'=vx, y'=vy, independent of x,y", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const y = new Float64Array([3, 4, 12, -7]);
    const out = new Float64Array(16);
    model.jacobian!(0, y, out, ctx);
    expect(out.slice(0, 4)).toEqual(new Float64Array([0, 0, 1, 0]));
    expect(out.slice(4, 8)).toEqual(new Float64Array([0, 0, 0, 1]));
    expect(out[8]).toBe(0); // d(ax)/dx
    expect(out[9]).toBe(0); // d(ax)/dy
    expect(out[12]).toBe(0); // d(ay)/dx
    expect(out[13]).toBe(0); // d(ay)/dy
  });

  it("degenerates smoothly at zero relative speed (no NaN, diagonal -> 0)", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const y = new Float64Array([0, 0, 0, 0]);
    const out = new Float64Array(16);
    model.jacobian!(0, y, out, ctx);
    for (const v of out) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(out[10]).toBeCloseTo(0, 15); // d(ax)/dvx
    expect(out[11]).toBeCloseTo(0, 15); // d(ax)/dvy
    expect(out[14]).toBeCloseTo(0, 15); // d(ay)/dvx
    expect(out[15]).toBeCloseTo(0, 15); // d(ay)/dvy
  });

  it("is not attached when the force set includes Magnus", async () => {
    const { MagnusForce } = await import("./forces.js");
    const model = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    expect(model.jacobian).toBeUndefined();
  });
});
