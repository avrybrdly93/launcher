import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";

const DIM = 4;

/** Central-difference Jacobian of `model.rhs` at (t, y), column j from perturbing y[j]. */
function finiteDifferenceJacobian(
  model: ReturnType<typeof createPlanarProjectileModel>,
  t: number,
  y: Float64Array,
  ctx: ReturnType<typeof createEvalContext>,
): Float64Array {
  const jac = new Float64Array(DIM * DIM);
  const outPlus = new Float64Array(DIM);
  const outMinus = new Float64Array(DIM);
  const yPerturbed = Float64Array.from(y);

  for (let col = 0; col < DIM; col++) {
    const h = Math.max(1e-6, Math.abs(y[col]!) * 1e-6);

    yPerturbed[col] = y[col]! + h;
    model.rhs(t, yPerturbed, outPlus, ctx);

    yPerturbed[col] = y[col]! - h;
    model.rhs(t, yPerturbed, outMinus, ctx);

    yPerturbed[col] = y[col]!;

    for (let row = 0; row < DIM; row++) {
      jac[row * DIM + col] = (outPlus[row]! - outMinus[row]!) / (2 * h);
    }
  }
  return jac;
}

describe("gravityQuadraticDragJacobian", () => {
  it("is attached to the model only when forces are exactly gravity + quadratic drag", () => {
    const withMagnusModule = createPlanarProjectileModel([new GravityForce()]);
    expect(withMagnusModule.jacobian).toBeUndefined();
  });

  it("matches central finite differences of the rhs to 1e-7 at 10 random states", () => {
    const mass = 0.145;
    const radius = 0.0366;
    const cd = new ConstantCd(0.47);

    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    expect(model.jacobian).toBeDefined();

    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
    const ctx = createEvalContext(env, params);

    // Deterministic pseudo-random states with nonzero relative speed (the
    // Jacobian is singular at v_rel = 0, so that state is excluded).
    const states: [number, number, number, number][] = [
      [0, 0, 12.3, 4.1],
      [10, 5, -8.2, 15.6],
      [-3, 20, 25.0, -30.1],
      [0, 0.5, 0.5, -0.7],
      [100, 10, -1.5, -1.5],
      [0, 0, 40, 0.001],
      [0, 0, 0.001, 40],
      [5, 5, 5, 5],
      [-10, -10, -20, 20],
      [1, 1, 33.3, -12.7],
    ];

    for (const [x, yPos, vx, vy] of states) {
      const y = new Float64Array([x, yPos, vx, vy]);
      const analytic = new Float64Array(DIM * DIM);
      model.jacobian!(0, y, analytic, ctx);

      const fd = finiteDifferenceJacobian(model, 0, y, ctx);

      for (let i = 0; i < DIM * DIM; i++) {
        expect(Math.abs(analytic[i]! - fd[i]!)).toBeLessThan(1e-7);
      }
    }
  });
});
