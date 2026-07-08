import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { gravityQuadraticDragJacobian } from "./jacobian.js";

/** Central finite-difference Jacobian of `model.rhs` at (t, y), for comparison against the analytic one. */
function centralDifferenceJacobian(
  model: ReturnType<typeof createPlanarProjectileModel>,
  t: number,
  y: Float64Array,
  ctx: ReturnType<typeof createEvalContext>,
): Float64Array {
  const dim = model.dim;
  const jac = new Float64Array(dim * dim);
  const outPlus = new Float64Array(dim);
  const outMinus = new Float64Array(dim);
  const yPerturbed = Float64Array.from(y);

  for (let col = 0; col < dim; col++) {
    const h = 1e-6 * Math.max(1, Math.abs(y[col]!));
    const original = y[col]!;

    yPerturbed[col] = original + h;
    model.rhs(t, yPerturbed, outPlus, ctx);

    yPerturbed[col] = original - h;
    model.rhs(t, yPerturbed, outMinus, ctx);

    yPerturbed[col] = original;

    for (let row = 0; row < dim; row++) {
      jac[row * dim + col] = (outPlus[row]! - outMinus[row]!) / (2 * h);
    }
  }

  return jac;
}

describe("gravityQuadraticDragJacobian", () => {
  const mass = 0.145;
  const radius = 0.0366;
  const cd = new ConstantCd(0.47);

  function makeCtx() {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
    return { env, ctx: createEvalContext(env, params) };
  }

  it("matches central finite differences to 1e-7 at 10 states", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const { ctx } = makeCtx();

    const states: [number, number, number, number][] = [
      [0, 0, 12.3, 4.1],
      [10, 5, -8.2, 15.6],
      [-3, 20, 25.0, -30.1],
      [0, 0.5, 5.0, -2.0],
      [100, 10, -1.5, -1.5],
      [0, 0, 40, 0],
      [0, 0, 0, 40],
      [5, 5, 5, 5],
      [-10, -10, -20, 20],
      [1, 1, 33.3, -12.7],
    ];

    for (const [x, yPos, vx, vy] of states) {
      const y = new Float64Array([x, yPos, vx, vy]);

      const analytic = new Float64Array(16);
      model.jacobian!(0, y, analytic, ctx);

      const fd = centralDifferenceJacobian(model, 0, y, ctx);

      for (let i = 0; i < 16; i++) {
        expect(analytic[i]).toBeCloseTo(fd[i]!, 7);
      }
    }
  });

  it("attaches jacobian to gravity+quadratic-drag-only models", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    expect(model.jacobian).toBe(gravityQuadraticDragJacobian);
  });

  it("does not attach jacobian when Magnus is present", () => {
    const model = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    expect(model.jacobian).toBeUndefined();
  });

  it("is exactly zero at v_rel = 0 (no NaN from the 0/0 limit)", () => {
    const { ctx } = makeCtx();
    const y = new Float64Array([0, 0, 0, 0]);
    const out = new Float64Array(16);
    gravityQuadraticDragJacobian(0, y, out, ctx);

    expect(Array.from(out)).toEqual([0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
