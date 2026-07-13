import { describe, expect, it } from "vitest";
import { createEvalContext, type EvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import type { Model } from "./model.js";

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

/** Central-difference J = ∂f/∂y, column by column, for cross-checking the analytic jacobian (P1.22). */
function centralDifferenceJacobian(
  model: Model,
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  h = 1e-6,
): Float64Array {
  const dim = model.dim;
  const J = new Float64Array(dim * dim);
  const yPlus = Float64Array.from(y);
  const yMinus = Float64Array.from(y);
  const fPlus = new Float64Array(dim);
  const fMinus = new Float64Array(dim);

  for (let col = 0; col < dim; col++) {
    yPlus.set(y);
    yMinus.set(y);
    yPlus[col] = yPlus[col]! + h;
    yMinus[col] = yMinus[col]! - h;
    model.rhs(t, yPlus, fPlus, ctx);
    model.rhs(t, yMinus, fMinus, ctx);
    for (let row = 0; row < dim; row++) {
      J[row * dim + col] = (fPlus[row]! - fMinus[row]!) / (2 * h);
    }
  }
  return J;
}

describe("createPlanarProjectileModel jacobian (P1.22)", () => {
  it("is exposed (analytic) for gravity + quadratic drag with no Magnus", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    expect(typeof model.jacobian).toBe("function");
  });

  it("is withheld when a force (Magnus) has no closed-form derivative", () => {
    const model = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    expect(model.jacobian).toBeUndefined();
  });

  it("matches central finite differences to 1e-7 at 10 states", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);

    // 10 states spanning quadrants/magnitudes, all with |v_rel| well clear of
    // the C^1-but-not-C^2 kink at v_rel=0 (§3.8) so central FD is well-behaved.
    const states: [number, number, number, number][] = [
      [0, 0, 12.3, 4.1],
      [10, 5, -8.2, 15.6],
      [-3, 20, 25.0, -30.1],
      [0, 0.5, 2.0, -3.0],
      [100, 10, -1.5, -1.5],
      [0, 0, 40, 0],
      [0, 0, 0, 40],
      [5, 5, 5, 5],
      [-10, -10, -20, 20],
      [1, 1, 33.3, -12.7],
    ];

    for (const state of states) {
      const y = new Float64Array(state);
      const analytic = new Float64Array(16);
      model.jacobian!(0, y, analytic, ctx);
      const fd = centralDifferenceJacobian(model, 0, y, ctx);

      for (let i = 0; i < 16; i++) {
        expect(Math.abs(analytic[i]! - fd[i]!)).toBeLessThan(1e-7);
      }
    }
  });

  it("returns a finite, all-zero velocity block at v_rel = 0 (matches the C^1 zero-gradient kink, §3.8)", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const y = new Float64Array([0, 0, 0, 0]);
    const out = new Float64Array(16);
    model.jacobian!(0, y, out, ctx);

    for (const v of out) expect(Number.isFinite(v)).toBe(true);
    // rows 2,3 (dvx/dt, dvy/dt): only the trivial identity rows 0,1 are nonzero.
    expect(Array.from(out.slice(8, 16))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
