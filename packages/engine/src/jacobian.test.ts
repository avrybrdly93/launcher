import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd, TabulatedReynoldsCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { createGravityQuadraticDragJacobian, gravityQuadraticDragJacobian } from "./jacobian.js";

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

/** Central-difference Jacobian of `model.rhs` at `y`, for cross-checking the analytic formula. */
function centralDifferenceJacobian(
  model: ReturnType<typeof createPlanarProjectileModel>,
  t: number,
  y: Float64Array,
  ctx: ReturnType<typeof createEvalContext>,
  h = 1e-6,
): Float64Array {
  const jac = new Float64Array(16);
  const yPlus = Float64Array.from(y);
  const yMinus = Float64Array.from(y);
  const fPlus = new Float64Array(4);
  const fMinus = new Float64Array(4);

  for (let j = 0; j < 4; j++) {
    const step = h * Math.max(1, Math.abs(y[j]!));
    yPlus[j] = y[j]! + step;
    yMinus[j] = y[j]! - step;

    model.rhs(t, yPlus, fPlus, ctx);
    model.rhs(t, yMinus, fMinus, ctx);

    for (let i = 0; i < 4; i++) {
      jac[i * 4 + j] = (fPlus[i]! - fMinus[i]!) / (2 * step);
    }

    yPlus[j] = y[j]!;
    yMinus[j] = y[j]!;
  }

  return jac;
}

describe("gravityQuadraticDragJacobian", () => {
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

  it("matches central finite differences to 1e-7 at 10 states", () => {
    for (const state of STATES) {
      const y = new Float64Array(state);
      const analytic = new Float64Array(16);
      gravityQuadraticDragJacobian(0, y, ctx, analytic);
      const fd = centralDifferenceJacobian(model, 0, y, ctx);

      for (let k = 0; k < 16; k++) {
        expect(analytic[k]!).toBeCloseTo(fd[k]!, 6);
      }
    }
  });

  it("produces a symmetric drag block (J_vx,vy == J_vy,vx)", () => {
    const y = new Float64Array([0, 0, 12.3, -8.7]);
    const out = new Float64Array(16);
    gravityQuadraticDragJacobian(0, y, ctx, out);
    expect(out[2 * 4 + 3]).toBeCloseTo(out[3 * 4 + 2]!, 15);
  });

  it("leaves the position-derivative rows/columns of the velocity block at 0 (frozen environment)", () => {
    const y = new Float64Array([3, 7, 12.3, -8.7]);
    const out = new Float64Array(16);
    gravityQuadraticDragJacobian(0, y, ctx, out);
    // row VX, VY against column X, Y
    expect(out[2 * 4 + 0]).toBe(0);
    expect(out[2 * 4 + 1]).toBe(0);
    expect(out[3 * 4 + 0]).toBe(0);
    expect(out[3 * 4 + 1]).toBe(0);
  });

  it("kinematic rows are exact: d(dx/dt)/d(vx)=1, d(dy/dt)/d(vy)=1, all else 0", () => {
    const y = new Float64Array([3, 7, 12.3, -8.7]);
    const out = new Float64Array(16);
    gravityQuadraticDragJacobian(0, y, ctx, out);
    expect(out[0 * 4 + 0]).toBe(0);
    expect(out[0 * 4 + 1]).toBe(0);
    expect(out[0 * 4 + 2]).toBe(1);
    expect(out[0 * 4 + 3]).toBe(0);
    expect(out[1 * 4 + 0]).toBe(0);
    expect(out[1 * 4 + 1]).toBe(0);
    expect(out[1 * 4 + 2]).toBe(0);
    expect(out[1 * 4 + 3]).toBe(1);
  });

  it("resolves the removable singularity at v_rel=0 to the zero matrix (no NaN)", () => {
    const y = new Float64Array([0, 0, 0, 0]);
    const out = new Float64Array(16);
    gravityQuadraticDragJacobian(0, y, ctx, out);
    for (const entry of out) {
      expect(Number.isFinite(entry)).toBe(true);
    }
    expect(out[2 * 4 + 2]).toBe(0);
    expect(out[2 * 4 + 3]).toBe(0);
    expect(out[3 * 4 + 2]).toBe(0);
    expect(out[3 * 4 + 3]).toBe(0);
  });

  it("createGravityQuadraticDragJacobian binds ctx into the Model.jacobian (t,y,out) shape", () => {
    const boundJacobian = createGravityQuadraticDragJacobian(ctx);
    const y = new Float64Array([0, 0, 12.3, -8.7]);
    const viaModel = new Float64Array(16);
    const viaBound = new Float64Array(16);
    gravityQuadraticDragJacobian(0, y, ctx, viaModel);
    boundJacobian(0, y, viaBound);
    expect(Array.from(viaBound)).toEqual(Array.from(viaModel));
  });

  it("documented limitation: diverges from FD once Cd varies with Reynolds number", () => {
    const tabulatedParams = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new TabulatedReynoldsCd(),
    });
    const tabulatedCtx = createEvalContext(env, tabulatedParams);
    const tabulatedModel = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
    ]);
    // ~50 m/s puts Re (~2.5e5 for this radius) in the drag-crisis table's
    // steepest region (Re: 2e5->3e5, Cd: 0.4->0.1), where Cd's sensitivity
    // to Re is largest.
    const y = new Float64Array([0, 0, 50, 0]);

    const analytic = new Float64Array(16);
    gravityQuadraticDragJacobian(0, y, tabulatedCtx, analytic);
    const fd = centralDifferenceJacobian(tabulatedModel, 0, y, tabulatedCtx);

    const diff = Math.abs(analytic[2 * 4 + 2]! - fd[2 * 4 + 2]!);
    expect(diff).toBeGreaterThan(1e-6);
  });
});
