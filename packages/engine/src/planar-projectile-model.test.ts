import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import {
  createPlanarProjectileModel,
  gravityQuadraticDragJacobian,
} from "./planar-projectile-model.js";
import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

/** Central-difference Jacobian, row-major out[dim*i+j] = df_i/dy_j, cbrt(eps)-scaled step. */
function centralDifferenceJacobian(
  model: Model,
  t: number,
  y: Float64Array,
  ctx: EvalContext,
): Float64Array {
  const n = model.dim;
  const jac = new Float64Array(n * n);
  const yPerturbed = Float64Array.from(y);
  const fPlus = new Float64Array(n);
  const fMinus = new Float64Array(n);
  const step = Math.cbrt(Number.EPSILON);

  for (let j = 0; j < n; j++) {
    const h = step * Math.max(1, Math.abs(y[j]!));
    yPerturbed[j] = y[j]! + h;
    model.rhs(t, yPerturbed, fPlus, ctx);
    yPerturbed[j] = y[j]! - h;
    model.rhs(t, yPerturbed, fMinus, ctx);
    yPerturbed[j] = y[j]!;
    for (let i = 0; i < n; i++) {
      jac[n * i + j] = (fPlus[i]! - fMinus[i]!) / (2 * h);
    }
  }
  return jac;
}

describe("createPlanarProjectileModel", () => {
  it("declares dim=4 with the expected channels", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    expect(model.dim).toBe(4);
    expect(model.channels.map((c) => c.name)).toEqual(["x", "y", "vx", "vy"]);
  });

  it("under gravity alone, acceleration is exactly (0, -g)", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    const y = new Float64Array([0, 100, 20, 0]);
    const out = new Float64Array(4);
    model.rhs(0, y, out, ctx);
    expect(out[0]).toBe(20); // dx/dt = vx
    expect(out[1]).toBe(0); // dy/dt = vy
    expect(out[2]).toBe(0); // no horizontal force
    expect(out[3]).toBeCloseTo(-ctx.env.g, 15);
  });

  it("matches the hand-expanded RHS (eq. 3.18) at 10 random states to 1e-14", () => {
    const cd = new ConstantCd(0.47);
    const cl = new SaturatingLiftCoefficient();
    const mass = 0.145;
    const radius = 0.0366;
    const spin = 180;

    const model = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: cd,
      liftCoefficient: cl,
      spin,
    });
    const ctx = createEvalContext(env, params);
    const area = Math.PI * radius * radius;
    const rho = 1.225; // ConstantAtmosphere ISA sea-level density

    // Deterministic pseudo-random states (avoid a test dependency on a RNG library).
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

    for (const [x, yPos, vx, vy] of states) {
      const y = new Float64Array([x, yPos, vx, vy]);
      const out = new Float64Array(4);
      model.rhs(0, y, out, ctx);

      const g = 9.80665;
      const ux = vx;
      const uy = vy; // ZeroWind => v_rel = v
      const u = Math.hypot(ux, uy);
      const kd = (rho * cd.cd(0, 0) * area) / (2 * mass);
      const S = u < 1e-9 ? 0 : (Math.abs(spin) * radius) / u;
      const km = (rho * cl.cl(S) * area) / (2 * mass);
      const sgn = Math.sign(spin);

      const expectedVx = -kd * u * ux - km * u * uy * sgn;
      const expectedVy = -g - kd * u * uy + km * u * ux * sgn;

      expect(out[0]).toBeCloseTo(vx, 14);
      expect(out[1]).toBeCloseTo(vy, 14);
      expect(out[2]).toBeCloseTo(expectedVx, 12);
      expect(out[3]).toBeCloseTo(expectedVy, 12);
    }
  });
});

describe("gravityQuadraticDragJacobian", () => {
  it("is attached to the model only for the exact gravity+quadratic-drag composition", () => {
    const withMagnus = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    expect(withMagnus.jacobian).toBeUndefined();

    const gravityOnly = createPlanarProjectileModel([new GravityForce()]);
    expect(gravityOnly.jacobian).toBeUndefined();

    const exact = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    expect(exact.jacobian).toBe(gravityQuadraticDragJacobian);
  });

  it("matches central finite differences to 1e-7 at 10 random states", () => {
    const cd = new ConstantCd(0.47);
    const mass = 0.145;
    const radius = 0.0366;

    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
    const ctx = createEvalContext(env, params);

    // Deterministic pseudo-random states, including one near-stagnation case.
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

    expect(model.jacobian).toBeDefined();
    for (const [x, yPos, vx, vy] of states) {
      const y = new Float64Array([x, yPos, vx, vy]);
      const analytic = new Float64Array(16);
      model.jacobian!(0, y, analytic, ctx);
      const fd = centralDifferenceJacobian(model, 0, y, ctx);

      for (let k = 0; k < 16; k++) {
        expect(analytic[k]).toBeCloseTo(fd[k]!, 7);
      }
    }
  });

  it("resolves the removable u=0 singularity to a zero drag-velocity block", () => {
    const cd = new ConstantCd(0.47);
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({ mass: 1, radius: 0.05, dragCoefficient: cd });
    const ctx = createEvalContext(env, params);

    const y = new Float64Array([0, 0, 0, 0]);
    const out = new Float64Array(16);
    model.jacobian!(0, y, out, ctx);

    expect(out[10]).toBe(0);
    expect(out[11]).toBe(0);
    expect(out[14]).toBe(0);
    expect(out[15]).toBe(0);
    // dx/dt, dy/dt rows are unaffected by the singularity.
    expect(out[2]).toBe(1);
    expect(out[7]).toBe(1);
  });
});
