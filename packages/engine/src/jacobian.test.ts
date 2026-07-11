import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { gravityQuadraticDragJacobian } from "./jacobian.js";

const DIM = 4;

// Deterministic pseudo-random states (avoid a test dependency on a RNG library),
// spanning still, slow, fast, and axis-aligned relative velocities.
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

function centralDifferenceJacobian(
  rhs: (y: Float64Array, out: Float64Array) => void,
  y: Float64Array,
  out: Float64Array,
): void {
  const fPlus = new Float64Array(DIM);
  const fMinus = new Float64Array(DIM);
  const yPerturbed = Float64Array.from(y);

  for (let j = 0; j < DIM; j++) {
    const h = 1e-6 * Math.max(1, Math.abs(y[j]!));
    const original = y[j]!;

    yPerturbed[j] = original + h;
    rhs(yPerturbed, fPlus);
    yPerturbed[j] = original - h;
    rhs(yPerturbed, fMinus);
    yPerturbed[j] = original;

    for (let i = 0; i < DIM; i++) {
      out[i * DIM + j] = (fPlus[i]! - fMinus[i]!) / (2 * h);
    }
  }
}

describe("gravityQuadraticDragJacobian", () => {
  it("matches central finite differences of the rhs to 1e-7 at 10 states", () => {
    const mass = 0.145;
    const radius = 0.0366;
    const cd = new ConstantCd(0.47);

    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
    const ctx = createEvalContext(env, params);

    const rhs = (y: Float64Array, out: Float64Array): void => {
      model.rhs(0, y, out, ctx);
    };

    const analytic = new Float64Array(DIM * DIM);
    const fd = new Float64Array(DIM * DIM);

    for (const state of STATES) {
      const y = new Float64Array(state);

      gravityQuadraticDragJacobian(0, y, ctx, analytic);
      centralDifferenceJacobian(rhs, y, fd);

      for (let k = 0; k < DIM * DIM; k++) {
        expect(analytic[k]).toBeCloseTo(fd[k]!, 7);
      }
    }
  });

  it("vanishes at zero relative velocity (C^1 kink, no NaN)", () => {
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const ctx = createEvalContext(env, params);

    const out = new Float64Array(DIM * DIM);
    gravityQuadraticDragJacobian(0, new Float64Array([0, 0, 0, 0]), ctx, out);

    expect(out[2 * DIM + 2]).toBe(0);
    expect(out[2 * DIM + 3]).toBe(0);
    expect(out[3 * DIM + 2]).toBe(0);
    expect(out[3 * DIM + 3]).toBe(0);
    expect(Array.from(out).every((v) => Number.isFinite(v))).toBe(true);
  });

  it("always sets the position-row velocity-identity block", () => {
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const ctx = createEvalContext(env, params);

    const out = new Float64Array(DIM * DIM);
    gravityQuadraticDragJacobian(0, new Float64Array([1, 2, 3, 4]), ctx, out);

    expect(out[0 * DIM + 2]).toBe(1);
    expect(out[1 * DIM + 3]).toBe(1);
    expect(out[0 * DIM + 0]).toBe(0);
    expect(out[0 * DIM + 1]).toBe(0);
    expect(out[0 * DIM + 3]).toBe(0);
    expect(out[1 * DIM + 0]).toBe(0);
    expect(out[1 * DIM + 1]).toBe(0);
    expect(out[1 * DIM + 2]).toBe(0);
  });
});
