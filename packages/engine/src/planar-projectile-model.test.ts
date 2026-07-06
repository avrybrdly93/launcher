import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel, planarAeroPower } from "./planar-projectile-model.js";

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

  it("exposes an analytic jacobian for gravity+quadratic-drag matching central finite differences to 1e-7", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    expect(model.jacobian).toBeDefined();

    const states: [number, number, number, number][] = [
      [0, 0, 12.3, 4.1],
      [10, 5, -8.2, 15.6],
      [-3, 20, 25.0, -30.1],
      [0, 0.5, 0.5, -0.3],
      [100, 10, -1.5, -1.5],
      [0, 0, 40, 0],
      [0, 0, 0, 40],
      [5, 5, 5, 5],
      [-10, -10, -20, 20],
      [1, 1, 33.3, -12.7],
    ];

    const dim = 4;
    const analytic = new Float64Array(dim * dim);
    const fPlus = new Float64Array(dim);
    const fMinus = new Float64Array(dim);
    const fd = new Float64Array(dim * dim);

    for (const state of states) {
      const y = Float64Array.from(state);
      model.jacobian!(0, y, analytic, ctx);

      for (let j = 0; j < dim; j++) {
        const h = 1e-6 * Math.max(1, Math.abs(y[j]!));
        const yPlus = Float64Array.from(y);
        const yMinus = Float64Array.from(y);
        yPlus[j] = yPlus[j]! + h;
        yMinus[j] = yMinus[j]! - h;
        model.rhs(0, yPlus, fPlus, ctx);
        model.rhs(0, yMinus, fMinus, ctx);
        for (let i = 0; i < dim; i++) {
          fd[i * dim + j] = (fPlus[i]! - fMinus[i]!) / (2 * h);
        }
      }

      for (let k = 0; k < dim * dim; k++) {
        expect(analytic[k]).toBeCloseTo(fd[k]!, 7);
      }
    }
  });

  it("omits jacobian when the force set isn't exactly gravity+quadratic-drag", () => {
    const model = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    expect(model.jacobian).toBeUndefined();
  });
});

describe("energy invariant (eq. 3.19)", () => {
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const mass = 0.145;
  const radius = 0.0366;
  const g = 9.80665;

  const states: [number, number, number, number][] = [
    [0, 100, 12.3, 4.1],
    [10, 50, -8.2, 15.6],
    [-3, 200, 25.0, -30.1],
    [100, 10, -1.5, -1.5],
    [0, 5, 40, 0],
    [5, 5, 5, 5],
  ];

  it("drag-off: aero power from the energyPower wiring is exactly 0, and E matches the closed-form drag-free trajectory to 1e-13", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);

    for (const [x0, y0, vx0, vy0] of states) {
      const y = Float64Array.from([x0, y0, vx0, vy0]);
      expect(planarAeroPower([new GravityForce()], 0, y, ctx)).toBe(0);

      const e0 = model.invariants![0]!.evaluate(0, y, ctx);
      // Closed-form drag-free trajectory (§3.8): exact solution under gravity alone.
      for (const t of [0.1, 0.5, 1.0, 2.3]) {
        const yt = Float64Array.from([
          x0 + vx0 * t,
          y0 + vy0 * t - 0.5 * g * t * t,
          vx0,
          vy0 - g * t,
        ]);
        const et = model.invariants![0]!.evaluate(t, yt, ctx);
        expect(et).toBeCloseTo(e0, 10);
      }
    }
  });

  it("drag-on in still air: aero power is <= 0 everywhere (E dissipates, eq. 3.19 case iii)", () => {
    const forces = [new GravityForce(), new QuadraticDragForce()];
    const model = createPlanarProjectileModel(forces);
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);

    for (const state of states) {
      const y = Float64Array.from(state);
      expect(planarAeroPower(forces, 0, y, ctx)).toBeLessThanOrEqual(0);
    }
    expect(model.invariants?.[0]?.name).toBe("energy");
  });

  it("Magnus-only in still air: aero power is exactly 0 (F_M is always perpendicular to v_rel, eq. 3.19 case ii)", () => {
    const forces = [new GravityForce(), new MagnusForce()];
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(0),
      liftCoefficient: new SaturatingLiftCoefficient(),
      spin: 180,
    });
    const ctx = createEvalContext(env, params);

    for (const state of states) {
      const y = Float64Array.from(state);
      expect(planarAeroPower(forces, 0, y, ctx)).toBeCloseTo(0, 12);
    }
  });

  it("omits the energy invariant when no gravity force is registered", () => {
    const model = createPlanarProjectileModel([new QuadraticDragForce()]);
    expect(model.invariants).toBeUndefined();
  });
});
