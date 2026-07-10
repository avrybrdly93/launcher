import { describe, expect, it } from "vitest";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createEvalContext, type EvalContext } from "./eval-context.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { analyticJacobianGravityQuadraticDrag } from "./jacobian.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";

const DIM = 4;

/** Central finite-difference Jacobian with a per-component scaled step, for comparison only. */
function centralFdJacobian(
  rhs: (t: number, y: Float64Array, out: Float64Array, ctx: EvalContext) => void,
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  out: Float64Array,
): void {
  const yPlus = Float64Array.from(y);
  const yMinus = Float64Array.from(y);
  const fPlus = new Float64Array(DIM);
  const fMinus = new Float64Array(DIM);

  for (let j = 0; j < DIM; j++) {
    const h = 1e-6 * Math.max(1, Math.abs(y[j]!));
    yPlus[j] = y[j]! + h;
    yMinus[j] = y[j]! - h;

    rhs(t, yPlus, fPlus, ctx);
    rhs(t, yMinus, fMinus, ctx);

    for (let i = 0; i < DIM; i++) {
      out[i * DIM + j] = (fPlus[i]! - fMinus[i]!) / (2 * h);
    }

    yPlus[j] = y[j]!;
    yMinus[j] = y[j]!;
  }
}

describe("analyticJacobianGravityQuadraticDrag", () => {
  const mass = 0.145;
  const radius = 0.0366;
  const params = createSphericalProjectileParams({
    mass,
    radius,
    dragCoefficient: new ConstantCd(0.47),
  });
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);

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
    const ctx = createEvalContext(env, params);
    const analytic = new Float64Array(DIM * DIM);
    const fd = new Float64Array(DIM * DIM);

    for (const state of states) {
      const y = new Float64Array(state);
      analyticJacobianGravityQuadraticDrag(0, y, ctx, analytic);
      centralFdJacobian(model.rhs, 0, y, ctx, fd);

      for (let k = 0; k < DIM * DIM; k++) {
        expect(analytic[k]).toBeCloseTo(fd[k]!, 7);
      }
    }
  });

  it("matches the §4.6 linearized-drag eigenvalue ratio (streamwise : crosswise = 2:1)", () => {
    const ctx = createEvalContext(env, params);
    const out = new Float64Array(DIM * DIM);
    // Pure streamwise state: vx = u, vy = 0.
    analyticJacobianGravityQuadraticDrag(0, new Float64Array([0, 0, 40, 0]), ctx, out);
    const streamwise = out[2 * DIM + 2]!; // d(ax)/d(vx)
    const crosswise = out[3 * DIM + 3]!; // d(ay)/d(vy)
    expect(streamwise / crosswise).toBeCloseTo(2, 10);
  });

  it("is finite (all zero) in the drag block at the exact zero-velocity state", () => {
    const ctx = createEvalContext(env, params);
    const out = new Float64Array(DIM * DIM);
    analyticJacobianGravityQuadraticDrag(0, new Float64Array([0, 0, 0, 0]), ctx, out);
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
    expect(out[2 * DIM + 2]).toBe(0);
    expect(out[3 * DIM + 3]).toBe(0);
  });

  it("createPlanarProjectileModel wires the analytic jacobian only for gravity+quadratic-drag", () => {
    expect(model.jacobian).toBe(analyticJacobianGravityQuadraticDrag);

    const withMagnus = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    expect(withMagnus.jacobian).toBeUndefined();

    const cl = new SaturatingLiftCoefficient();
    const paramsWithSpin = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(0.47),
      liftCoefficient: cl,
      spin: 100,
    });
    expect(paramsWithSpin.liftCoefficient).toBeDefined(); // sanity: params actually carry Magnus config
  });
});
