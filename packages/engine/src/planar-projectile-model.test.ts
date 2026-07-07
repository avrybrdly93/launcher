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
});

describe("createPlanarProjectileModel analytic jacobian (P1.22)", () => {
  const mass = 0.145;
  const radius = 0.0366;

  function makeGravityDragModel() {
    return createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
  }

  function makeCtx() {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(0.47),
    });
    return createEvalContext(env, params);
  }

  /** Central finite-difference Jacobian, column j = d(rhs)/d(y_j), h scaled for O(1e-10) accuracy. */
  function fdJacobian(
    model: ReturnType<typeof makeGravityDragModel>,
    y: Float64Array,
    ctx: ReturnType<typeof makeCtx>,
  ) {
    const h = 1e-6;
    const out = new Float64Array(16);
    const plus = new Float64Array(4);
    const minus = new Float64Array(4);
    for (let j = 0; j < 4; j++) {
      const yPlus = Float64Array.from(y);
      const yMinus = Float64Array.from(y);
      yPlus[j] = yPlus[j]! + h;
      yMinus[j] = yMinus[j]! - h;
      model.rhs(0, yPlus, plus, ctx);
      model.rhs(0, yMinus, minus, ctx);
      for (let i = 0; i < 4; i++) {
        out[i * 4 + j] = (plus[i]! - minus[i]!) / (2 * h);
      }
    }
    return out;
  }

  it("is defined when forces are gravity + quadratic drag only (no Magnus)", () => {
    const model = makeGravityDragModel();
    expect(typeof model.jacobian).toBe("function");
  });

  it("is undefined once Magnus is added to the composition", () => {
    const model = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    expect(model.jacobian).toBeUndefined();
  });

  it("matches central finite differences to 1e-7 at 10 random states", () => {
    const model = makeGravityDragModel();
    const ctx = makeCtx();

    const states: [number, number, number, number][] = [
      [0, 0, 12.3, 4.1],
      [10, 5, -8.2, 15.6],
      [-3, 20, 25.0, -30.1],
      [0, 0.5, 3.1, -2.2],
      [100, 10, -1.5, -1.5],
      [0, 0, 40, 0],
      [0, 0, 0, 40],
      [5, 5, 5, 5],
      [-10, -10, -20, 20],
      [1, 1, 33.3, -12.7],
    ];

    for (const [x, yPos, vx, vy] of states) {
      const y = new Float64Array([x, yPos, vx, vy]);
      const analytic = new Float64Array(16);
      model.jacobian!(0, y, analytic, ctx);
      const fd = fdJacobian(model, y, ctx);

      for (let k = 0; k < 16; k++) {
        expect(Math.abs(analytic[k]! - fd[k]!)).toBeLessThan(1e-7);
      }
    }
  });
});
