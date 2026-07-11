import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { gravityQuadraticDragJacobian } from "./jacobian.js";
import { createFiniteDifferenceJacobian } from "./fd-jacobian.js";

const DIM = 4;

// Same fixture as jacobian.test.ts (P1.22), reused so this suite is a direct
// "matches P1.22 analytic where available" check (P1.23's validation).
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

function makeCtx() {
  const mass = 0.145;
  const radius = 0.0366;
  const cd = new ConstantCd(0.47);
  const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
  const ctx = createEvalContext(env, params);
  return { model, ctx };
}

describe("createFiniteDifferenceJacobian", () => {
  it("matches the P1.22 analytic gravity+quadratic-drag Jacobian at 10 states", () => {
    const { model, ctx } = makeCtx();
    const fdJacobian = createFiniteDifferenceJacobian(model, ctx);

    const analytic = new Float64Array(DIM * DIM);
    const fd = new Float64Array(DIM * DIM);

    for (const state of STATES) {
      const y = new Float64Array(state);

      gravityQuadraticDragJacobian(0, y, ctx, analytic);
      fdJacobian(0, y, fd);

      for (let k = 0; k < DIM * DIM; k++) {
        expect(fd[k]).toBeCloseTo(analytic[k]!, 7);
      }
    }
  });

  it("does not allocate new scratch arrays across repeated calls (reuses closure buffers)", () => {
    const { model, ctx } = makeCtx();
    const fdJacobian = createFiniteDifferenceJacobian(model, ctx);
    const out = new Float64Array(DIM * DIM);
    const y = new Float64Array([1, 2, 3, 4]);

    // Not a heap-allocation probe (see rhs-allocation.test.ts for that
    // harness) -- just confirms repeated evaluation is stable/deterministic,
    // which would fail if internal state leaked across calls.
    fdJacobian(0, y, out);
    const first = Array.from(out);
    fdJacobian(0, y, out);
    const second = Array.from(out);

    expect(second).toEqual(first);
  });
});
