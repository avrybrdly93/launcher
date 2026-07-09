import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { gravityQuadraticDragJacobian } from "./jacobian.js";

const DIM = 4;
const FD_STEP = 1e-5;

/** Central-difference Jacobian of model.rhs at y, for cross-checking the analytic formula. */
function finiteDifferenceJacobian(
  model: ReturnType<typeof createPlanarProjectileModel>,
  t: number,
  y: Float64Array,
  ctx: ReturnType<typeof createEvalContext>,
  out: Float64Array,
): void {
  const fPlus = new Float64Array(DIM);
  const fMinus = new Float64Array(DIM);
  const yPerturbed = Float64Array.from(y);

  for (let j = 0; j < DIM; j++) {
    const original = yPerturbed[j]!;
    yPerturbed[j] = original + FD_STEP;
    model.rhs(t, yPerturbed, fPlus, ctx);
    yPerturbed[j] = original - FD_STEP;
    model.rhs(t, yPerturbed, fMinus, ctx);
    yPerturbed[j] = original;

    for (let i = 0; i < DIM; i++) {
      out[i * DIM + j] = (fPlus[i]! - fMinus[i]!) / (2 * FD_STEP);
    }
  }
}

describe("gravityQuadraticDragJacobian", () => {
  it("matches central finite differences of the rhs to 1e-7 at 10 states", () => {
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

    // Deterministic states spanning a range of speeds/directions, all with
    // nonzero relative velocity (the rhs is only C1, not C2, exactly at
    // v_rel=0 -- a separate documented case, P2.48 -- so it is excluded here).
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

    const analyticJ = new Float64Array(DIM * DIM);
    const fdJ = new Float64Array(DIM * DIM);

    for (const state of states) {
      const y = Float64Array.from(state);
      gravityQuadraticDragJacobian(0, y, analyticJ, ctx);
      finiteDifferenceJacobian(model, 0, y, ctx, fdJ);

      for (let i = 0; i < DIM * DIM; i++) {
        expect(Math.abs(analyticJ[i]! - fdJ[i]!)).toBeLessThan(1e-7);
      }
    }
  });

  it("is wired as model.jacobian when only gravity + quadratic drag are registered", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    expect(model.jacobian).toBeDefined();

    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const y = Float64Array.from([0, 0, 20, 10]);
    const out = new Float64Array(DIM * DIM);
    const direct = new Float64Array(DIM * DIM);

    model.jacobian!(0, y, out, ctx);
    gravityQuadraticDragJacobian(0, y, direct, ctx);

    expect(out).toEqual(direct);
  });

  it("is left undefined when Magnus is also registered (out of scope for the analytic formula)", () => {
    const model = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    expect(model.jacobian).toBeUndefined();
  });
});
