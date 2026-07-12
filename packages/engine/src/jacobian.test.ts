import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { gravityQuadraticDragJacobian } from "./jacobian.js";

const DIM = 4;

// Deterministic pseudo-random states spanning still air, headwind/tailwind-like
// speeds, and a near-stagnation case (avoids exactly v_rel=0, where the true
// rhs is only C^1 and a central difference isn't well-defined).
const STATES: readonly [number, number, number, number][] = [
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

/** Central-difference reference Jacobian, independent of the analytic formula. */
function centralDifferenceJacobian(
  model: ReturnType<typeof createPlanarProjectileModel>,
  t: number,
  y: Float64Array,
  ctx: ReturnType<typeof createEvalContext>,
): Float64Array {
  const jac = new Float64Array(DIM * DIM);
  const yPlus = new Float64Array(y);
  const yMinus = new Float64Array(y);
  const outPlus = new Float64Array(DIM);
  const outMinus = new Float64Array(DIM);

  for (let j = 0; j < DIM; j++) {
    const h = 1e-6 * Math.max(1, Math.abs(y[j]!));
    yPlus[j] = y[j]! + h;
    yMinus[j] = y[j]! - h;

    model.rhs(t, yPlus, outPlus, ctx);
    model.rhs(t, yMinus, outMinus, ctx);

    for (let i = 0; i < DIM; i++) {
      jac[DIM * i + j] = (outPlus[i]! - outMinus[i]!) / (2 * h);
    }

    yPlus[j] = y[j]!;
    yMinus[j] = y[j]!;
  }

  return jac;
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

    for (const state of STATES) {
      const y = new Float64Array(state);
      const analytic = new Float64Array(DIM * DIM);
      gravityQuadraticDragJacobian(0, y, ctx, analytic);

      const fd = centralDifferenceJacobian(model, 0, y, ctx);

      for (let idx = 0; idx < DIM * DIM; idx++) {
        expect(analytic[idx]).toBeCloseTo(fd[idx]!, 6); // 1e-6 decimal places ~ 1e-7 abs tolerance
      }
    }
  });

  it("is exactly the identity-velocity block plus zero aero block under gravity alone", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    const y = new Float64Array([0, 100, 20, -5]);
    const out = new Float64Array(DIM * DIM);

    gravityQuadraticDragJacobian(0, y, ctx, out);

    const expected = [
      0,
      0,
      1,
      0, //
      0,
      0,
      0,
      1, //
      0,
      0,
      0,
      0, //
      0,
      0,
      0,
      0,
    ];
    for (let i = 0; i < expected.length; i++) {
      expect(out[i]).toBeCloseTo(expected[i]!, 15);
    }
  });

  it("has a continuous (zero) aero block as |v_rel| -> 0, no NaN", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const y = new Float64Array([0, 0, 0, 0]);
    const out = new Float64Array(DIM * DIM);

    gravityQuadraticDragJacobian(0, y, ctx, out);

    for (const entry of out) {
      expect(Number.isFinite(entry)).toBe(true);
    }
    expect(out[DIM * 2 + 2]).toBe(0);
    expect(out[DIM * 2 + 3]).toBe(0);
    expect(out[DIM * 3 + 2]).toBe(0);
    expect(out[DIM * 3 + 3]).toBe(0);
  });
});
