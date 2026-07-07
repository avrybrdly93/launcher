import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { createGravityQuadraticDragJacobian, createFiniteDifferenceJacobian } from "./jacobian.js";
import type { Model } from "./model.js";

const DIM = 4;

/** Central-difference reference Jacobian, used only to check the analytic one. */
function centralDifferenceJacobian(
  rhs: (t: number, y: Float64Array, out: Float64Array) => void,
  t: number,
  y: Float64Array,
  h: number,
): Float64Array {
  const j = new Float64Array(DIM * DIM);
  const yPlus = Float64Array.from(y);
  const yMinus = Float64Array.from(y);
  const fPlus = new Float64Array(DIM);
  const fMinus = new Float64Array(DIM);

  for (let col = 0; col < DIM; col++) {
    const step = h * Math.max(1, Math.abs(y[col]!));
    yPlus[col] = y[col]! + step;
    yMinus[col] = y[col]! - step;
    rhs(t, yPlus, fPlus);
    rhs(t, yMinus, fMinus);
    yPlus[col] = y[col]!;
    yMinus[col] = y[col]!;

    for (let row = 0; row < DIM; row++) {
      j[row * DIM + col] = (fPlus[row]! - fMinus[row]!) / (2 * step);
    }
  }
  return j;
}

describe("createGravityQuadraticDragJacobian", () => {
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
  const jacobian = createGravityQuadraticDragJacobian(ctx);
  const rhs = (t: number, y: Float64Array, out: Float64Array): void => model.rhs(t, y, out, ctx);

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
    for (const state of states) {
      const y = new Float64Array(state);
      const out = new Float64Array(DIM * DIM);
      jacobian(0, y, out);

      const reference = centralDifferenceJacobian(rhs, 0, y, 1e-6);

      for (let i = 0; i < DIM * DIM; i++) {
        expect(out[i]).toBeCloseTo(reference[i]!, 7);
      }
    }
  });

  it("declares the exact-derivative kinematic rows (dx'/dvx = dy'/dvy = 1, no other position/kinematic coupling)", () => {
    const y = new Float64Array([1, 2, 12.3, -4.1]);
    const out = new Float64Array(DIM * DIM);
    jacobian(0, y, out);

    expect(out[0 * DIM + 0]).toBe(0);
    expect(out[0 * DIM + 1]).toBe(0);
    expect(out[0 * DIM + 2]).toBe(1);
    expect(out[0 * DIM + 3]).toBe(0);
    expect(out[1 * DIM + 0]).toBe(0);
    expect(out[1 * DIM + 1]).toBe(0);
    expect(out[1 * DIM + 2]).toBe(0);
    expect(out[1 * DIM + 3]).toBe(1);
  });

  it("is symmetric in the velocity block (drag is grad of a scalar potential in v)", () => {
    const y = new Float64Array([0, 0, 17, -6]);
    const out = new Float64Array(DIM * DIM);
    jacobian(0, y, out);
    expect(out[2 * DIM + 3]).toBeCloseTo(out[3 * DIM + 2]!, 15);
  });

  it("vanishes smoothly at v_rel = 0 (C1 kink, §3.8) instead of producing NaN", () => {
    const y = new Float64Array([0, 0, 0, 0]);
    const out = new Float64Array(DIM * DIM);
    jacobian(0, y, out);
    expect(out[2 * DIM + 2]).toBe(0);
    expect(out[2 * DIM + 3]).toBe(0);
    expect(out[3 * DIM + 2]).toBe(0);
    expect(out[3 * DIM + 3]).toBe(0);
    expect(Array.from(out).some((v) => Number.isNaN(v))).toBe(false);
  });
});

describe("createFiniteDifferenceJacobian", () => {
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
  const analytic = createGravityQuadraticDragJacobian(ctx);
  const fd = createFiniteDifferenceJacobian(model, ctx);

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

  it("matches the P1.22 analytic Jacobian where available", () => {
    for (const state of states) {
      const y = new Float64Array(state);
      const outAnalytic = new Float64Array(DIM * DIM);
      const outFd = new Float64Array(DIM * DIM);
      analytic(0, y, outAnalytic);
      fd(0, y, outFd);

      for (let i = 0; i < DIM * DIM; i++) {
        expect(outFd[i]).toBeCloseTo(outAnalytic[i]!, 6);
      }
    }
  });

  it("reuses preallocated scratch buffers across calls (no per-call allocation of the working arrays)", () => {
    // Not a strict allocation-count test (that's P1.21's harness) — just a
    // smoke check that repeated calls with different states don't corrupt
    // each other via shared scratch buffers.
    const y1 = new Float64Array([0, 0, 12.3, 4.1]);
    const y2 = new Float64Array([10, 5, -8.2, 15.6]);
    const out1 = new Float64Array(DIM * DIM);
    const out2 = new Float64Array(DIM * DIM);
    fd(0, y1, out1);
    fd(0, y2, out2);
    fd(0, y1, out1);

    const expected1 = new Float64Array(DIM * DIM);
    analytic(0, y1, expected1);
    for (let i = 0; i < DIM * DIM; i++) {
      expect(out1[i]).toBeCloseTo(expected1[i]!, 6);
    }
  });

  it("works generically on a model with no analytic Jacobian of its own", () => {
    const decayModel: Model = {
      dim: 2,
      channels: [
        { name: "y0", unit: "1" },
        { name: "y1", unit: "1" },
      ],
      rhs(_t, y, out, _ctx) {
        out[0] = -2 * y[0]!;
        out[1] = 3 * y[1]! * y[1]!;
      },
    };
    const decayCtx = createEvalContext(env, params);
    const decayFd = createFiniteDifferenceJacobian(decayModel, decayCtx);
    const y = new Float64Array([1.5, -2.0]);
    const out = new Float64Array(4);
    decayFd(0, y, out);

    expect(out[0 * 2 + 0]).toBeCloseTo(-2, 6);
    expect(out[0 * 2 + 1]).toBeCloseTo(0, 6);
    expect(out[1 * 2 + 0]).toBeCloseTo(0, 6);
    expect(out[1 * 2 + 1]).toBeCloseTo(6 * y[1]!, 5);
  });
});
