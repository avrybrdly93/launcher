import { describe, expect, it } from "vitest";
import { createEvalContext, type EvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { BuoyancyForce, GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import {
  createSpatialProjectileModel,
  spatialMechanicalEnergy,
  spatialMomentumX,
  spatialMomentumZ,
} from "./spatial-projectile-model.js";
import type { Model } from "./model.js";

/**
 * A tiny, self-contained fixed-step classical RK4 integrator, used only by
 * this test file. `packages/engine` may not depend on `@ballista/solverkit`
 * (§2.1's layering, enforced by `.dependency-cruiser.cjs`: `engine`'s allowed
 * deps are `[]`), so this mirrors just enough of solverkit's RK4 update rule
 * to drive both models over identical fixed steps and compare results
 * directly -- exactly the "direct numeric equality assertion" fallback this
 * task's plan calls for when a shared-package harness (like
 * `hashTrajectory`, which lives in `@ballista/validation`) isn't reachable
 * from here.
 */
function integrateRk4(
  model: Model,
  ctx: EvalContext,
  y0: Float64Array,
  h: number,
  steps: number,
): Float64Array[] {
  const dim = model.dim;
  const states: Float64Array[] = [Float64Array.from(y0)];
  let y = Float64Array.from(y0);
  let t = 0;

  const k1 = new Float64Array(dim);
  const k2 = new Float64Array(dim);
  const k3 = new Float64Array(dim);
  const k4 = new Float64Array(dim);
  const tmp = new Float64Array(dim);

  for (let s = 0; s < steps; s++) {
    model.rhs(t, y, k1, ctx);
    for (let i = 0; i < dim; i++) tmp[i] = y[i]! + (h / 2) * k1[i]!;
    model.rhs(t + h / 2, tmp, k2, ctx);
    for (let i = 0; i < dim; i++) tmp[i] = y[i]! + (h / 2) * k2[i]!;
    model.rhs(t + h / 2, tmp, k3, ctx);
    for (let i = 0; i < dim; i++) tmp[i] = y[i]! + h * k3[i]!;
    model.rhs(t + h, tmp, k4, ctx);

    const next = new Float64Array(dim);
    for (let i = 0; i < dim; i++) {
      next[i] = y[i]! + (h / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!);
    }
    y = next;
    t += h;
    states.push(Float64Array.from(y));
  }
  return states;
}

describe("createSpatialProjectileModel", () => {
  it("declares dim=6 with the expected channels", () => {
    const model = createSpatialProjectileModel([new GravityForce()]);
    expect(model.dim).toBe(6);
    expect(model.channels.map((c) => c.name)).toEqual(["x", "y", "z", "vx", "vy", "vz"]);
  });

  it("throws at construction for an unsupported force id (magnus is P4.24)", () => {
    expect(() => createSpatialProjectileModel([new GravityForce(), new MagnusForce()])).toThrow(
      /magnus/,
    );
  });

  it("declares partitions q=[x,y,z], p=[vx,vy,vz]", () => {
    const model = createSpatialProjectileModel([new GravityForce()]);
    expect(model.partitions).toEqual({ q: [0, 1, 2], p: [3, 4, 5] });
  });

  it("under gravity alone, acceleration is exactly (0, -g, 0)", () => {
    const model = createSpatialProjectileModel([new GravityForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    const y = new Float64Array([0, 100, 7, 20, 0, 3]);
    const out = new Float64Array(6);
    model.rhs(0, y, out, ctx);
    expect(out[0]).toBe(20); // dx/dt = vx
    expect(out[1]).toBe(0); // dy/dt = vy
    expect(out[2]).toBe(3); // dz/dt = vz
    expect(out[3]).toBe(0); // no x-force
    expect(out[4]).toBeCloseTo(-ctx.env.g, 15);
    expect(out[5]).toBe(0); // no z-force
  });

  it("declares an energy invariant equal to (1/2)m|v|^2 + mgy, matching spatialMechanicalEnergy", () => {
    const model = createSpatialProjectileModel([new GravityForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity());
    const params = createSphericalProjectileParams({
      mass: 2,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    const y = new Float64Array([0, 10, 5, 3, 4, 6]);
    const out = new Float64Array(6);
    model.rhs(0, y, out, ctx); // populates ctx.env.g

    expect(model.invariants?.[0]?.name).toBe("energy");
    const e = model.invariants![0]!.evaluate(0, y, ctx);
    const expected = 0.5 * 2 * (3 * 3 + 4 * 4 + 6 * 6) + 2 * ctx.env.g * 10;
    expect(e).toBeCloseTo(expected, 12);
    expect(e).toBeCloseTo(spatialMechanicalEnergy(y, ctx), 15);
  });

  it("declares momentum-x and momentum-z invariants equal to m*vx and m*vz", () => {
    const model = createSpatialProjectileModel([new GravityForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity());
    const params = createSphericalProjectileParams({
      mass: 2,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    const y = new Float64Array([0, 10, 0, 3, 4, 6]);

    const px = model.invariants!.find((inv) => inv.name === "momentum-x")!;
    const pz = model.invariants!.find((inv) => inv.name === "momentum-z")!;
    expect(px.evaluate(0, y, ctx)).toBe(6);
    expect(px.evaluate(0, y, ctx)).toBe(spatialMomentumX(y, ctx));
    expect(pz.evaluate(0, y, ctx)).toBe(12);
    expect(pz.evaluate(0, y, ctx)).toBe(spatialMomentumZ(y, ctx));
  });

  it("declares a terminal falling ground-impact event and a non-terminal falling apex event", () => {
    const model = createSpatialProjectileModel([new GravityForce()]);
    expect(model.events).toHaveLength(2);

    const groundImpact = model.events!.find((e) => e.name === "ground-impact")!;
    expect(groundImpact.terminal).toBe(true);
    expect(groundImpact.direction).toBe("falling");
    // g(t,y) = y - h(x); z doesn't enter, per the still-2D `Terrain` interface.
    expect(groundImpact.g(0, new Float64Array([0, 1.5, 99, 10, -5, -2]))).toBe(1.5);

    const apex = model.events!.find((e) => e.name === "apex")!;
    expect(apex.terminal).toBeFalsy();
    expect(apex.direction).toBe("falling");
    expect(apex.g(0, new Float64Array([0, 10, 0, 5, 3, 0]))).toBe(3);
  });

  it("gravity+quadratic-drag analytic jacobian matches central finite differences to 1e-7 at several 3D states", () => {
    const cd = new ConstantCd(0.47);
    const mass = 0.145;
    const radius = 0.0366;

    const model = createSpatialProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
    const ctx = createEvalContext(env, params);

    expect(model.jacobian).toBeDefined();

    const states: [number, number, number, number, number, number][] = [
      [0, 0, 0, 12.3, 4.1, 2.2],
      [10, 5, -2, -8.2, 15.6, -3.5],
      [-3, 20, 1, 25.0, -30.1, 8.0],
      [0, 0.5, 0, 0.001, -0.002, 0.0005],
      [100, 10, -5, -1.5, -1.5, 12.0],
      [5, 5, 5, 5, 5, 5],
    ];

    const h = 1e-6;
    const jac = new Float64Array(36);

    function rhsAt(y: Float64Array): Float64Array {
      const result = new Float64Array(6);
      model.rhs(0, y, result, ctx);
      return result;
    }

    for (const state of states) {
      model.jacobian!(0, Float64Array.from(state), ctx, jac);

      const fd = new Float64Array(36);
      for (let j = 0; j < 6; j++) {
        const plus = Float64Array.from(state);
        const minus = Float64Array.from(state);
        plus[j] = plus[j]! + h;
        minus[j] = minus[j]! - h;
        const fPlus = rhsAt(plus);
        const fMinus = rhsAt(minus);
        for (let i = 0; i < 6; i++) {
          fd[i * 6 + j] = (fPlus[i]! - fMinus[i]!) / (2 * h);
        }
      }

      for (let i = 0; i < 36; i++) {
        expect(Math.abs(jac[i]! - fd[i]!)).toBeLessThan(1e-7);
      }
    }
  });

  describe("P4.23 validation criterion: 2D scenarios reproduce exactly as a z=0 slice", () => {
    it("gravity+quadratic-drag+buoyancy: x/y/vx/vy match createPlanarProjectileModel bit-for-bit with z0=vz0=0", () => {
      const cd = new ConstantCd(0.47);
      const mass = 0.145;
      const radius = 0.0366;

      const planarForces = [new GravityForce(), new QuadraticDragForce(), new BuoyancyForce()];
      const spatialForces = [new GravityForce(), new QuadraticDragForce(), new BuoyancyForce()];

      const planarModel = createPlanarProjectileModel(planarForces);
      const spatialModel = createSpatialProjectileModel(spatialForces);

      const env2d = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
      const env3d = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
      const params2d = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
      const params3d = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
      const ctx2d = createEvalContext(env2d, params2d);
      const ctx3d = createEvalContext(env3d, params3d);

      const y0planar = new Float64Array([0, 50, 30, 20]);
      const y0spatial = new Float64Array([0, 50, 0, 30, 20, 0]);

      const h = 0.005;
      const steps = 400; // 2 s, well past apex, under this projectile's fall time

      const planarStates = integrateRk4(planarModel, ctx2d, y0planar, h, steps);
      const spatialStates = integrateRk4(spatialModel, ctx3d, y0spatial, h, steps);

      expect(planarStates).toHaveLength(spatialStates.length);
      for (let s = 0; s < planarStates.length; s++) {
        const p = planarStates[s]!;
        const sp = spatialStates[s]!;
        // x, y
        expect(sp[0]).toBe(p[0]);
        expect(sp[1]).toBe(p[1]);
        // z stays exactly 0 throughout (no lateral force, z0=vz0=0)
        expect(sp[2]).toBe(0);
        // vx, vy
        expect(sp[3]).toBe(p[2]);
        expect(sp[4]).toBe(p[3]);
        // vz stays exactly 0 throughout
        expect(sp[5]).toBe(0);
      }
    });

    it("gravity-only: same bit-for-bit reproduction holds with a plain drag-free scenario too", () => {
      const mass = 1;
      const radius = 0.05;

      const planarModel = createPlanarProjectileModel([new GravityForce()]);
      const spatialModel = createSpatialProjectileModel([new GravityForce()]);

      const env2d = new Environment(new ConstantAtmosphere(), new UniformGravity());
      const env3d = new Environment(new ConstantAtmosphere(), new UniformGravity());
      const params2d = createSphericalProjectileParams({
        mass,
        radius,
        dragCoefficient: new ConstantCd(0),
      });
      const params3d = createSphericalProjectileParams({
        mass,
        radius,
        dragCoefficient: new ConstantCd(0),
      });
      const ctx2d = createEvalContext(env2d, params2d);
      const ctx3d = createEvalContext(env3d, params3d);

      const y0planar = new Float64Array([0, 0, 20, 15]);
      const y0spatial = new Float64Array([0, 0, 0, 20, 15, 0]);

      const h = 0.01;
      const steps = 300;

      const planarStates = integrateRk4(planarModel, ctx2d, y0planar, h, steps);
      const spatialStates = integrateRk4(spatialModel, ctx3d, y0spatial, h, steps);

      for (let s = 0; s < planarStates.length; s++) {
        const p = planarStates[s]!;
        const sp = spatialStates[s]!;
        expect(sp[0]).toBe(p[0]);
        expect(sp[1]).toBe(p[1]);
        expect(sp[3]).toBe(p[2]);
        expect(sp[4]).toBe(p[3]);
      }
    });
  });

  it("nonzero z0/vz0 with gravity+buoyancy only (no drag): z drifts as pure inertial motion z(t) = z0 + vz0*t", () => {
    // With no drag wired in, no force ever touches vz, so vz stays exactly
    // constant and z is a pure straight-line integral of it -- unlike with
    // quadratic drag active, where u_z = vz feeds back into F_z = -k|u|u_z
    // and vz itself would decay.
    const mass = 2;
    const radius = 0.05;
    const model = createSpatialProjectileModel([new GravityForce(), new BuoyancyForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity());
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(0), // unused: no drag force wired in
    });
    const ctx = createEvalContext(env, params);

    const z0 = 3;
    const vz0 = 7;
    const y0 = new Float64Array([0, 100, z0, 20, 0, vz0]);
    const h = 0.02;
    const steps = 50;

    const states = integrateRk4(model, ctx, y0, h, steps);
    for (let s = 0; s < states.length; s++) {
      const t = s * h;
      expect(states[s]![5]).toBe(vz0); // vz never changes
      expect(states[s]![2]).toBeCloseTo(z0 + vz0 * t, 10);
    }
  });
});
