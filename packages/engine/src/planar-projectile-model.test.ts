import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce, totalForcePower } from "./forces.js";
import { createPlanarProjectileModel, mechanicalEnergy } from "./planar-projectile-model.js";
import { FunctionTerrain } from "./terrain.js";

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

  it("gravity+quadratic-drag analytic jacobian matches central finite differences to 1e-7 at 10 states", () => {
    const cd = new ConstantCd(0.47);
    const mass = 0.145;
    const radius = 0.0366;

    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
    const ctx = createEvalContext(env, params);

    expect(model.jacobian).toBeDefined();

    const states: [number, number, number, number][] = [
      [0, 0, 12.3, 4.1],
      [10, 5, -8.2, 15.6],
      [-3, 20, 25.0, -30.1],
      [0, 0.5, 0.001, -0.002],
      [100, 10, -1.5, -1.5],
      [0, 0, 40, 0],
      [0, 0, 0.001, 40],
      [5, 5, 5, 5],
      [-10, -10, -20, 20],
      [1, 1, 33.3, -12.7],
    ];

    const h = 1e-6;
    const jac = new Float64Array(16);

    function rhsAt(y: Float64Array): Float64Array {
      const result = new Float64Array(4);
      model.rhs(0, y, result, ctx);
      return result;
    }

    for (const state of states) {
      model.jacobian!(0, Float64Array.from(state), ctx, jac);

      // Central finite differences: column j of J is d(rhs)/dy_j.
      const fd = new Float64Array(16);
      for (let j = 0; j < 4; j++) {
        const plus = Float64Array.from(state);
        const minus = Float64Array.from(state);
        plus[j] = plus[j]! + h;
        minus[j] = minus[j]! - h;

        const fPlus = rhsAt(plus);
        const fMinus = rhsAt(minus);
        for (let i = 0; i < 4; i++) {
          fd[i * 4 + j] = (fPlus[i]! - fMinus[i]!) / (2 * h);
        }
      }

      for (let i = 0; i < 16; i++) {
        expect(Math.abs(jac[i]! - fd[i]!)).toBeLessThan(1e-7);
      }
    }
  });

  it("declares an energy invariant equal to (1/2)m|v|^2 + mgy", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity());
    const params = createSphericalProjectileParams({
      mass: 2,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    const y = new Float64Array([0, 10, 3, 4]);
    const out = new Float64Array(4);
    model.rhs(0, y, out, ctx); // samples ctx.env so ctx.env.g is populated

    expect(model.invariants?.[0]?.name).toBe("energy");
    const e = model.invariants![0]!.evaluate(0, y, ctx);
    const expected = 0.5 * 2 * (3 * 3 + 4 * 4) + 2 * ctx.env.g * 10;
    expect(e).toBeCloseTo(expected, 12);
    expect(e).toBeCloseTo(mechanicalEnergy(y, ctx), 15);
  });

  it("drag-off: dE/dt reconstructed from per-force powers is 0 to 1e-13 (ideal Magnus does no work)", () => {
    const cl = new SaturatingLiftCoefficient();
    const mass = 0.145;
    const radius = 0.0366;
    const spin = 180;

    const forces = [new GravityForce(), new MagnusForce()];
    const model = createPlanarProjectileModel(forces);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(0.47), // unused: no drag force wired in
      liftCoefficient: cl,
      spin,
    });
    const ctx = createEvalContext(env, params);

    const states: [number, number, number, number][] = [
      [0, 0, 12.3, 4.1],
      [10, 5, -8.2, 15.6],
      [-3, 20, 25.0, -30.1],
      [0, 0, 40, 0],
      [5, 5, 5, 5],
      [-10, -10, -20, 20],
    ];

    for (const state of states) {
      const y = Float64Array.from(state);
      const out = new Float64Array(4);
      model.rhs(0, y, out, ctx); // populates ctx.env for this state

      // dE/dt = sum_i(F_i . v) + mgy_dot; gravity's own -mg*vy term always
      // cancels the +mg*vy term algebraically, leaving only the aero
      // (here: Magnus-only) forces' contribution.
      const dEdt = totalForcePower(forces, 0, y, ctx) + mass * ctx.env.g * y[3]!;
      expect(Math.abs(dEdt)).toBeLessThan(1e-13);
    }
  });

  it("declares a terminal falling ground-impact event and a non-terminal falling apex event", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    expect(model.events).toHaveLength(2);

    const groundImpact = model.events!.find((e) => e.name === "ground-impact")!;
    expect(groundImpact).toBeDefined();
    expect(groundImpact.terminal).toBe(true);
    expect(groundImpact.direction).toBe("falling");

    const apex = model.events!.find((e) => e.name === "apex")!;
    expect(apex).toBeDefined();
    expect(apex.terminal).toBeFalsy();
    expect(apex.direction).toBe("falling");
  });

  it("apex event g(t,y) = v_y, evaluated at several states", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    const apex = model.events!.find((e) => e.name === "apex")!;

    expect(apex.g(0, new Float64Array([0, 10, 5, 3]))).toBe(3);
    expect(apex.g(0, new Float64Array([0, 10, 5, 0]))).toBe(0);
    expect(apex.g(0, new Float64Array([0, 10, 5, -7]))).toBe(-7);
  });

  it("ground-impact event g(t,y) = y - h(x) against flat terrain (the default)", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    const groundImpact = model.events!.find((e) => e.name === "ground-impact")!;

    expect(groundImpact.g(0, new Float64Array([0, 1.5, 10, -5]))).toBe(1.5);
    expect(groundImpact.g(0, new Float64Array([100, 0, 10, -5]))).toBe(0);
    expect(groundImpact.g(0, new Float64Array([-40, -0.01, 10, -5]))).toBeCloseTo(-0.01, 12);
  });

  it("ground-impact event honors a custom terrain passed to createPlanarProjectileModel", () => {
    const slope = new FunctionTerrain((x) => 0.2 * x);
    const model = createPlanarProjectileModel([new GravityForce()], slope);
    const groundImpact = model.events!.find((e) => e.name === "ground-impact")!;

    // At x=10, h(x)=2, so y=3 sits 1 above the slope and y=2 sits exactly on it.
    expect(groundImpact.g(0, new Float64Array([10, 3, 0, 0]))).toBeCloseTo(1, 12);
    expect(groundImpact.g(0, new Float64Array([10, 2, 0, 0]))).toBeCloseTo(0, 12);
  });
});
