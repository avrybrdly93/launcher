import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { finiteDifferenceJacobian } from "./jacobian.js";

const DIM = 4;

/**
 * Independent hand-rolled central-difference Jacobian, used only to check
 * the analytic P1.22 Jacobian without relying on the P1.23 fallback under
 * test elsewhere in this file (avoids a tautological comparison).
 */
function handRolledCentralDifference(
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

      const fd = handRolledCentralDifference(model, 0, y, ctx);

      for (let i = 0; i < DIM * DIM; i++) {
        expect(Math.abs(analytic[i]! - fd[i]!)).toBeLessThan(1e-7);
      }
    }
  });
});

describe("finiteDifferenceJacobian", () => {
  it("matches the P1.22 analytic Jacobian where available (gravity + quadratic drag)", () => {
    const mass = 0.145;
    const radius = 0.0366;
    const cd = new ConstantCd(0.47);

    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
    const ctx = createEvalContext(env, params);

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

      const fd = new Float64Array(DIM * DIM);
      finiteDifferenceJacobian(model, 0, y, fd, ctx);

      for (let i = 0; i < DIM * DIM; i++) {
        expect(Math.abs(analytic[i]! - fd[i]!)).toBeLessThan(1e-6);
      }
    }
  });

  it("reuses a passed-in scratch across calls without changing the result", () => {
    const model = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
      spin: 180,
    });
    const ctx = createEvalContext(env, params);

    const y1 = new Float64Array([0, 0, 12.3, 4.1]);
    const y2 = new Float64Array([10, 5, -8.2, 15.6]);
    const withoutScratch1 = new Float64Array(DIM * DIM);
    const withoutScratch2 = new Float64Array(DIM * DIM);
    finiteDifferenceJacobian(model, 0, y1, withoutScratch1, ctx);
    finiteDifferenceJacobian(model, 0, y2, withoutScratch2, ctx);

    const scratch = {
      outPlus: new Float64Array(DIM),
      outMinus: new Float64Array(DIM),
      yPerturbed: new Float64Array(DIM),
    };
    const withScratch1 = new Float64Array(DIM * DIM);
    const withScratch2 = new Float64Array(DIM * DIM);
    finiteDifferenceJacobian(model, 0, y1, withScratch1, ctx, scratch);
    finiteDifferenceJacobian(model, 0, y2, withScratch2, ctx, scratch);

    expect(withScratch1).toEqual(withoutScratch1);
    expect(withScratch2).toEqual(withoutScratch2);
  });
});
