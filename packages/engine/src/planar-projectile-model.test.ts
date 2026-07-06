import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";

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

  describe("analytic jacobian (P1.22)", () => {
    it("is undefined when a force lacks a closed-form derivative (Magnus)", () => {
      const model = createPlanarProjectileModel([
        new GravityForce(),
        new QuadraticDragForce(),
        new MagnusForce(),
      ]);
      expect(model.jacobian).toBeUndefined();
    });

    it("is defined for gravity + quadratic drag alone", () => {
      const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
      expect(model.jacobian).toBeTypeOf("function");
    });

    it("matches central finite differences to 1e-7 at 10 random states", () => {
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
      const dim = model.dim;

      const states: [number, number, number, number][] = [
        [0, 0, 12.3, 4.1],
        [10, 5, -8.2, 15.6],
        [-3, 20, 25.0, -30.1],
        [0, 0.5, 0.5, -0.8],
        [100, 10, -1.5, -1.5],
        [0, 0, 40, 0],
        [0, 0, 0, 40],
        [5, 5, 5, 5],
        [-10, -10, -20, 20],
        [1, 1, 33.3, -12.7],
      ];

      const centralDifferenceJacobian = (y: Float64Array): Float64Array => {
        const fd = new Float64Array(dim * dim);
        const yPlus = new Float64Array(y);
        const yMinus = new Float64Array(y);
        const outPlus = new Float64Array(dim);
        const outMinus = new Float64Array(dim);
        for (let col = 0; col < dim; col++) {
          const h = 1e-6 * Math.max(1, Math.abs(y[col]!));
          yPlus[col] = y[col]! + h;
          yMinus[col] = y[col]! - h;
          model.rhs(0, yPlus, outPlus, ctx);
          model.rhs(0, yMinus, outMinus, ctx);
          for (let row = 0; row < dim; row++) {
            fd[row * dim + col] = (outPlus[row]! - outMinus[row]!) / (2 * h);
          }
          yPlus[col] = y[col]!;
          yMinus[col] = y[col]!;
        }
        return fd;
      };

      for (const state of states) {
        const y = new Float64Array(state);
        const analytic = new Float64Array(dim * dim);
        model.jacobian!(0, y, analytic, ctx);
        const fd = centralDifferenceJacobian(y);

        for (let i = 0; i < dim * dim; i++) {
          expect(Math.abs(analytic[i]! - fd[i]!)).toBeLessThan(1e-7);
        }
      }
    });
  });
});
