import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import {
  analyticJacobianGravityQuadraticDrag,
  createFiniteDifferenceJacobianScratch,
  finiteDifferenceJacobian,
} from "./jacobian.js";

// Deterministic pseudo-random states (avoid a test dependency on a RNG library),
// mirroring the fixture in planar-projectile-model.test.ts.
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

function makeFixture() {
  const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: new ConstantCd(0.47),
  });
  const ctx = createEvalContext(env, params);
  return { model, ctx };
}

describe("analyticJacobianGravityQuadraticDrag", () => {
  it("matches central finite differences to 1e-7 at 10 random states", () => {
    const { model, ctx } = makeFixture();
    const scratch = createFiniteDifferenceJacobianScratch(4);
    const rhsOut = new Float64Array(4);
    const analytic = new Float64Array(16);
    const fd = new Float64Array(16);

    for (const state of STATES) {
      const y = new Float64Array(state);

      // Freshen ctx for this state, as the analytic Jacobian's contract requires.
      model.rhs(0, y, rhsOut, ctx);
      analyticJacobianGravityQuadraticDrag(ctx, analytic);

      finiteDifferenceJacobian((t, yy, out) => model.rhs(t, yy, out, ctx), 0, y, fd, scratch);

      for (let k = 0; k < 16; k++) {
        expect(Math.abs(analytic[k]! - fd[k]!)).toBeLessThan(1e-7);
      }
    }
  });

  it("kinematic rows are exact regardless of state", () => {
    const { model, ctx } = makeFixture();
    const rhsOut = new Float64Array(4);
    const out = new Float64Array(16);
    const y = new Float64Array([3, -7, 11, -13]);
    model.rhs(0, y, rhsOut, ctx);
    analyticJacobianGravityQuadraticDrag(ctx, out);

    expect(out[0 * 4 + 2]).toBe(1); // dx/dvx
    expect(out[1 * 4 + 3]).toBe(1); // dy/dvy
    for (const [i, j] of [
      [0, 0],
      [0, 1],
      [0, 3],
      [1, 0],
      [1, 1],
      [1, 2],
    ]) {
      expect(out[i! * 4 + j!]).toBe(0);
    }
  });

  it("drag block vanishes smoothly (no NaN) at v_rel = 0", () => {
    const { model, ctx } = makeFixture();
    const rhsOut = new Float64Array(4);
    const out = new Float64Array(16);
    const y = new Float64Array([0, 0, 0, 0]);
    model.rhs(0, y, rhsOut, ctx);
    analyticJacobianGravityQuadraticDrag(ctx, out);

    for (const v of out) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(out[2 * 4 + 2]).toBe(0);
    expect(out[2 * 4 + 3]).toBe(0);
    expect(out[3 * 4 + 2]).toBe(0);
    expect(out[3 * 4 + 3]).toBe(0);
  });
});

describe("finiteDifferenceJacobian", () => {
  it("reproduces a known-linear Jacobian exactly (up to FP roundoff)", () => {
    // y' = A y with A = [[0,1],[-2,-3]]; Jacobian is A everywhere, independent of y.
    const A = [
      [0, 1],
      [-2, -3],
    ];
    const rhs = (_t: number, y: Float64Array, out: Float64Array) => {
      out[0] = A[0]![0]! * y[0]! + A[0]![1]! * y[1]!;
      out[1] = A[1]![0]! * y[0]! + A[1]![1]! * y[1]!;
    };
    const scratch = createFiniteDifferenceJacobianScratch(2);
    const out = new Float64Array(4);

    for (const y of [
      [1, 2],
      [-5, 0.001],
      [1000, -1000],
    ]) {
      finiteDifferenceJacobian(rhs, 0, new Float64Array(y), out, scratch);
      expect(out[0]).toBeCloseTo(A[0]![0]!, 6);
      expect(out[1]).toBeCloseTo(A[0]![1]!, 6);
      expect(out[2]).toBeCloseTo(A[1]![0]!, 6);
      expect(out[3]).toBeCloseTo(A[1]![1]!, 6);
    }
  });

  it("matches the P1.22 analytic Jacobian where available", () => {
    const { model, ctx } = makeFixture();
    const scratch = createFiniteDifferenceJacobianScratch(4);
    const rhsOut = new Float64Array(4);
    const analytic = new Float64Array(16);
    const fd = new Float64Array(16);

    for (const state of STATES) {
      const y = new Float64Array(state);
      model.rhs(0, y, rhsOut, ctx);
      analyticJacobianGravityQuadraticDrag(ctx, analytic);
      finiteDifferenceJacobian((t, yy, out) => model.rhs(t, yy, out, ctx), 0, y, fd, scratch);

      for (let k = 0; k < 16; k++) {
        expect(fd[k]).toBeCloseTo(analytic[k]!, 6);
      }
    }
  });

  it("does not allocate new state given preallocated scratch (sanity: same buffer identities reused)", () => {
    const { model, ctx } = makeFixture();
    const scratch = createFiniteDifferenceJacobianScratch(4);
    const y = new Float64Array([1, 2, 3, 4]);
    const out = new Float64Array(16);
    const yPerturbedRef = scratch.yPerturbed;
    const fPlusRef = scratch.fPlus;
    const fMinusRef = scratch.fMinus;

    finiteDifferenceJacobian((t, yy, o) => model.rhs(t, yy, o, ctx), 0, y, out, scratch);

    expect(scratch.yPerturbed).toBe(yPerturbedRef);
    expect(scratch.fPlus).toBe(fPlusRef);
    expect(scratch.fMinus).toBe(fMinusRef);
  });
});
