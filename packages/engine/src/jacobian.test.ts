import { describe, expect, it } from "vitest";
import { createEvalContext, type EvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd, TabulatedReynoldsCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import {
  createFiniteDifferenceJacobianScratch,
  finiteDifferenceJacobian,
  gravityQuadraticDragJacobian,
} from "./jacobian.js";
import type { Model } from "./model.js";

const DIM = 4;

/** Central finite-difference Jacobian, used only as an independent oracle in this test. */
function centralDifferenceJacobian(
  model: Model,
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  h: number,
): Float64Array {
  const J = new Float64Array(DIM * DIM);
  const yPlus = new Float64Array(y);
  const yMinus = new Float64Array(y);
  const fPlus = new Float64Array(DIM);
  const fMinus = new Float64Array(DIM);

  for (let j = 0; j < DIM; j++) {
    yPlus.set(y);
    yMinus.set(y);
    yPlus[j] = yPlus[j]! + h;
    yMinus[j] = yMinus[j]! - h;
    model.rhs(t, yPlus, fPlus, ctx);
    model.rhs(t, yMinus, fMinus, ctx);
    for (let i = 0; i < DIM; i++) {
      J[i * DIM + j] = (fPlus[i]! - fMinus[i]!) / (2 * h);
    }
  }
  return J;
}

function makeCtx(cd: ConstantCd | TabulatedReynoldsCd, radius = 0.05, mass = 0.5): EvalContext {
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
  return createEvalContext(env, params);
}

describe("gravityQuadraticDragJacobian", () => {
  it("has identity in the position-on-velocity block and zero position columns", () => {
    const ctx = makeCtx(new ConstantCd(0.47));
    const J = new Float64Array(DIM * DIM);
    gravityQuadraticDragJacobian(0, new Float64Array([1, 2, 10, -5]), J, ctx);

    expect(J[0 * DIM + 2]).toBe(1); // dx/dt = vx
    expect(J[1 * DIM + 3]).toBe(1); // dy/dt = vy
    for (let i = 0; i < DIM; i++) {
      expect(J[i * DIM + 0]).toBe(0); // no x-dependence
      expect(J[i * DIM + 1]).toBe(0); // no y-dependence
    }
  });

  it("is exactly zero at the stagnation point (u = 0)", () => {
    const ctx = makeCtx(new ConstantCd(0.47));
    const J = new Float64Array(DIM * DIM);
    gravityQuadraticDragJacobian(0, new Float64Array([0, 0, 0, 0]), J, ctx);
    expect(J[2 * DIM + 2]).toBe(0);
    expect(J[2 * DIM + 3]).toBe(0);
    expect(J[3 * DIM + 2]).toBe(0);
    expect(J[3 * DIM + 3]).toBe(0);
  });

  it("matches central finite differences to 1e-7 at 10 states with constant Cd", () => {
    const cd = new ConstantCd(0.47);
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const ctx = makeCtx(cd);

    const states: [number, number, number, number][] = [
      [0, 0, 12.3, 4.1],
      [10, 5, -8.2, 15.6],
      [-3, 20, 25.0, -30.1],
      [0, 0.5, 0.05, -0.03],
      [100, 10, -1.5, -1.5],
      [0, 0, 40, 0],
      [0, 0, 0, 40],
      [5, 5, 5, 5],
      [-10, -10, -20, 20],
      [1, 1, 33.3, -12.7],
    ];

    const h = 1e-5;
    for (const state of states) {
      const y = new Float64Array(state);
      const analytic = new Float64Array(DIM * DIM);
      gravityQuadraticDragJacobian(0, y, analytic, ctx);
      const fd = centralDifferenceJacobian(model, 0, y, ctx, h);
      for (let k = 0; k < DIM * DIM; k++) {
        expect(analytic[k]!).toBeCloseTo(fd[k]!, 7);
      }
    }
  });

  it("matches central finite differences to 1e-7 through the tabulated Cd(Re) drag-crisis region", () => {
    // radius/rho chosen so speeds of tens of m/s land Re in [1e5, 4e5], the
    // steepest part of SMOOTH_SPHERE_CD_TABLE, where the dCd/dRe chain-rule
    // term this Jacobian includes is not negligible.
    const cd = new TabulatedReynoldsCd();
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const ctx = makeCtx(cd, 0.1, 2);

    const states: [number, number, number, number][] = [
      [0, 0, 15, 0],
      [0, 0, 0, 20],
      [0, 0, 25, 25],
      [0, 0, -30, 10],
      [0, 0, 40, -20],
      [0, 0, -18, -18],
      [0, 0, 50, 5],
      [0, 0, 5, 50],
      [0, 0, -45, 30],
      [0, 0, 22, -35],
    ];

    const h = 1e-5;
    for (const state of states) {
      const y = new Float64Array(state);
      const analytic = new Float64Array(DIM * DIM);
      gravityQuadraticDragJacobian(0, y, analytic, ctx);
      const fd = centralDifferenceJacobian(model, 0, y, ctx, h);
      for (let k = 0; k < DIM * DIM; k++) {
        expect(analytic[k]!).toBeCloseTo(fd[k]!, 7);
      }
    }
  });
});

describe("finiteDifferenceJacobian", () => {
  const states: [number, number, number, number][] = [
    [0, 0, 12.3, 4.1],
    [10, 5, -8.2, 15.6],
    [-3, 20, 25.0, -30.1],
    [0, 0.5, 0.05, -0.03],
    [100, 10, -1.5, -1.5],
    [0, 0, 40, 0],
    [0, 0, 0, 40],
    [5, 5, 5, 5],
    [-10, -10, -20, 20],
    [1, 1, 33.3, -12.7],
  ];

  it("matches the P1.22 analytic gravity+quadratic-drag Jacobian at 10 states", () => {
    const cd = new ConstantCd(0.47);
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const ctx = makeCtx(cd);

    for (const state of states) {
      const y = new Float64Array(state);
      const analytic = new Float64Array(DIM * DIM);
      const fd = new Float64Array(DIM * DIM);
      gravityQuadraticDragJacobian(0, y, analytic, ctx);
      finiteDifferenceJacobian(model, 0, y, fd, ctx);
      for (let k = 0; k < DIM * DIM; k++) {
        expect(fd[k]!).toBeCloseTo(analytic[k]!, 5);
      }
    }
  });

  it("matches the P1.22 analytic Jacobian through the tabulated Cd(Re) drag-crisis region", () => {
    const cd = new TabulatedReynoldsCd();
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const ctx = makeCtx(cd, 0.1, 2);
    const crisisStates: [number, number, number, number][] = [
      [0, 0, 15, 0],
      [0, 0, 0, 20],
      [0, 0, 25, 25],
      [0, 0, -30, 10],
      [0, 0, 40, -20],
      [0, 0, -18, -18],
      [0, 0, 50, 5],
      [0, 0, 5, 50],
      [0, 0, -45, 30],
      [0, 0, 22, -35],
    ];

    for (const state of crisisStates) {
      const y = new Float64Array(state);
      const analytic = new Float64Array(DIM * DIM);
      const fd = new Float64Array(DIM * DIM);
      gravityQuadraticDragJacobian(0, y, analytic, ctx);
      finiteDifferenceJacobian(model, 0, y, fd, ctx);
      for (let k = 0; k < DIM * DIM; k++) {
        expect(fd[k]!).toBeCloseTo(analytic[k]!, 4);
      }
    }
  });

  it("is exact for a purely gravitational model (constant acceleration)", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    const ctx = makeCtx(new ConstantCd(0));
    const y = new Float64Array([3, 7, 11, -13]);
    const J = new Float64Array(DIM * DIM);
    finiteDifferenceJacobian(model, 0, y, J, ctx);
    expect(Array.from(J)).toEqual([
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
    ]);
  });

  it("produces identical results when reusing a supplied scratch buffer", () => {
    const cd = new ConstantCd(0.47);
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const ctx = makeCtx(cd);
    const scratch = createFiniteDifferenceJacobianScratch(model.dim);

    for (const state of states) {
      const y = new Float64Array(state);
      const withScratch = new Float64Array(DIM * DIM);
      const withoutScratch = new Float64Array(DIM * DIM);
      finiteDifferenceJacobian(model, 0, y, withScratch, ctx, scratch);
      finiteDifferenceJacobian(model, 0, y, withoutScratch, ctx);
      expect(Array.from(withScratch)).toEqual(Array.from(withoutScratch));
    }
  });
});
