import { describe, expect, it } from "vitest";
import { createEvalContext, type EvalContext } from "./eval-context.js";
import {
  ConstantAtmosphere,
  Environment,
  UniformGravity,
  UniformWind,
  ZeroWind,
} from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import {
  BuoyancyForce,
  CoriolisForce,
  GravityForce,
  MagnusForce,
  QuadraticDragForce,
  type ForceModel,
} from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import {
  createSpatialProjectileModel,
  spatialMechanicalEnergy,
  spatialMomentumX,
  spatialMomentumZ,
} from "./spatial-projectile-model.js";
import type { Model } from "./model.js";
import { EARTH_ANGULAR_VELOCITY_RAD_S } from "./units.js";

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

  it("throws at construction for an unsupported force id", () => {
    const fakeForce: ForceModel = {
      id: "wind-shear",
      accumulate: () => {
        /* never reached: construction throws first */
      },
    };
    expect(() => createSpatialProjectileModel([new GravityForce(), fakeForce])).toThrow(
      /wind-shear/,
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

  it("gravity+quadratic-drag analytic jacobian matches central finite differences to 1e-7 at several 3D states, with a crosswind active (P4.25: exercises wz in the analytic block)", () => {
    const cd = new ConstantCd(0.47);
    const mass = 0.145;
    const radius = 0.0366;

    const model = createSpatialProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(
      new ConstantAtmosphere(),
      new UniformGravity(),
      new UniformWind(1, 0, -2.5),
    );
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

  it("P4.25: quadratic drag reads uz = vz - wz, matching wx/wy's existing treatment", () => {
    const mass = 0.145;
    const radius = 0.0366;
    const model = createSpatialProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(
      new ConstantAtmosphere(),
      new UniformGravity(),
      new UniformWind(0, 0, 6),
    );
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);

    // vz == wz: relative lateral velocity uz is exactly 0, so drag pushes
    // purely in x/y (matching a same-state run with no crosswind and no vz)
    // -- direct evidence wz is actually subtracted, not merely accepted and
    // ignored.
    const yMatchedDrift = new Float64Array([0, 10, 0, 20, -5, 6]);
    const outMatched = new Float64Array(6);
    model.rhs(0, yMatchedDrift, outMatched, ctx);

    const envNoWind = new Environment(new ConstantAtmosphere(), new UniformGravity());
    const ctxNoWind = createEvalContext(envNoWind, params);
    const yNoWind = new Float64Array([0, 10, 0, 20, -5, 0]);
    const outNoWind = new Float64Array(6);
    model.rhs(0, yNoWind, outNoWind, ctxNoWind);

    expect(outMatched[3]).toBeCloseTo(outNoWind[3]!, 15); // ax unaffected either way
    expect(outMatched[4]).toBeCloseTo(outNoWind[4]!, 15); // ay unaffected either way
    expect(outMatched[5]).toBeCloseTo(0, 15); // uz=0 -> no lateral drag force
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

  describe("P4.24: full 3D Magnus (ω̂ x v_rel, spin-axis param)", () => {
    const mass = 0.145;
    const radius = 0.0366;

    it("with the default spin axis (ê_z), matches the 2D MagnusForce exactly on a z=0 slice", () => {
      // Same reduction the other P4.23 forces already satisfy: omitting
      // `spinAxis` defaults to ê_z, which is exactly the axis the 2D
      // `MagnusForce` always implicitly uses -- so with z0=vz0=0 the two
      // models must agree bit-for-bit on x/y/vx/vy, per (3.15).
      const cd = new ConstantCd(0.3);
      const liftCoefficient = new SaturatingLiftCoefficient();
      const spin = 180; // rad/s, backspin

      const planarModel = createPlanarProjectileModel([
        new GravityForce(),
        new QuadraticDragForce(),
        new MagnusForce(),
      ]);
      const spatialModel = createSpatialProjectileModel([
        new GravityForce(),
        new QuadraticDragForce(),
        new MagnusForce(),
      ]);

      const env2d = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
      const env3d = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
      const params2d = createSphericalProjectileParams({
        mass,
        radius,
        dragCoefficient: cd,
        liftCoefficient,
        spin,
      });
      const params3d = createSphericalProjectileParams({
        mass,
        radius,
        dragCoefficient: cd,
        liftCoefficient,
        spin,
        // spinAxis omitted deliberately: exercises the ê_z default.
      });
      const ctx2d = createEvalContext(env2d, params2d);
      const ctx3d = createEvalContext(env3d, params3d);

      const y0planar = new Float64Array([0, 1, 30, 15]);
      const y0spatial = new Float64Array([0, 1, 0, 30, 15, 0]);
      const h = 0.005;
      const steps = 300;

      const planarStates = integrateRk4(planarModel, ctx2d, y0planar, h, steps);
      const spatialStates = integrateRk4(spatialModel, ctx3d, y0spatial, h, steps);

      for (let s = 0; s < planarStates.length; s++) {
        const p = planarStates[s]!;
        const sp = spatialStates[s]!;
        expect(sp[0]).toBe(p[0]);
        expect(sp[1]).toBe(p[1]);
        expect(sp[2]).toBe(0); // no sidespin -> no lateral force -> z stays exactly 0
        expect(sp[3]).toBe(p[2]);
        expect(sp[4]).toBe(p[3]);
        expect(sp[5]).toBe(0);
      }
    });

    it("sidespin (spin axis = ŷ, vertical) deflects laterally in z, sign flipping with spin sign (slice/hook)", () => {
      // Backlog validation criterion for P4.24. Spin axis along ŷ with
      // motion along x means ω̂ x v_rel points purely along ±z (no x/y
      // component -- see the derivation in spatial-projectile-model.ts's
      // "magnus" rhs case), an unambiguous, purely-lateral deflection: the
      // 2D model has no way to express this at all, since its spin axis is
      // pinned to ê_z.
      const liftCoefficient = new SaturatingLiftCoefficient();
      const vx0 = 30;
      const h = 0.01;
      const steps = 80;

      function finalStateWithSpin(spin: number): Float64Array {
        const model = createSpatialProjectileModel([new MagnusForce()]);
        const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
        const params = createSphericalProjectileParams({
          mass,
          radius,
          dragCoefficient: new ConstantCd(0), // isolate Magnus: no drag, and...
          liftCoefficient,
          spin,
          spinAxis: [0, 1, 0], // ...spin about the vertical axis (sidespin)
        });
        const ctx = createEvalContext(env, params); // ...gravity off (UniformGravity default g still
        // applies, but no GravityForce is in the registry, so it never enters the rhs)
        const y0 = new Float64Array([0, 0, 0, vx0, 0, 0]);
        const states = integrateRk4(model, ctx, y0, h, steps);
        return states[states.length - 1]!;
      }

      const noSpin = finalStateWithSpin(0);
      const positiveSpin = finalStateWithSpin(50);
      const negativeSpin = finalStateWithSpin(-50);

      // No spin -> no Magnus contribution at all (the `!omega` guard) -> z
      // stays exactly 0, pure inertial straight-line motion.
      expect(noSpin[2]).toBe(0);
      expect(noSpin[5]).toBe(0);

      // y/vy are untouched exactly, for any spin: with axis=(0,1,0), the
      // rhs's fy = k*(az*ux - ax*uz) is identically 0 whenever ax=az=0 --
      // true regardless of vz, so v never leaves the x-z plane.
      expect(positiveSpin[1]).toBe(0);
      expect(positiveSpin[4]).toBe(0);
      expect(negativeSpin[1]).toBe(0);
      expect(negativeSpin[4]).toBe(0);

      // The two spins are mirror images: at t=0, F_z = -k*vx0 with
      // k ∝ sign(omega), so opposite spins push z in opposite directions
      // from the first instant -- and since the ideal Magnus force is
      // always exactly perpendicular to v_rel (F_M . u = 0 identically, a
      // vector-triple-product identity, true for *any* axis, not just ê_z),
      // it does no work: |v| is conserved, so this is exact uniform
      // circular motion in the x-z plane with a small rotation angle over
      // this short horizon, meaning the initial-instant sign of the
      // deflection persists all the way to `steps*h` with no sign
      // reversal. A genuine slice/hook pair, not just "some" asymmetric
      // deviation.
      expect(positiveSpin[2]).toBeLessThan(0);
      expect(negativeSpin[2]).toBeGreaterThan(0);
      expect(negativeSpin[2]).toBeCloseTo(-positiveSpin[2]!, 9);
      expect(negativeSpin[5]).toBeCloseTo(-positiveSpin[5]!, 9);

      // Speed (and hence kinetic energy) is conserved to RK4's own local
      // truncation error, confirming F_M did no net work over the run --
      // the 3D generalization of blueprint §3.8's "(ii) with Magnus only, E
      // is conserved" runtime check.
      const speed0Sq = vx0 * vx0;
      const speedFinalSq =
        positiveSpin[3]! * positiveSpin[3]! + positiveSpin[5]! * positiveSpin[5]!;
      expect(speedFinalSq).toBeCloseTo(speed0Sq, 6);
    });

    it("no Magnus contribution when spin is unset, mirroring MagnusForce.accumulate's own guard", () => {
      const liftCoefficient = new SaturatingLiftCoefficient();
      const model = createSpatialProjectileModel([new MagnusForce()]);
      const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
      const params = createSphericalProjectileParams({
        mass,
        radius,
        dragCoefficient: new ConstantCd(0),
        liftCoefficient,
        // spin omitted entirely
        spinAxis: [0, 1, 0],
      });
      const ctx = createEvalContext(env, params);
      const y = new Float64Array([0, 0, 0, 20, 0, 0]);
      const out = new Float64Array(6);
      model.rhs(0, y, out, ctx);
      expect(out[3]).toBe(0);
      expect(out[4]).toBe(0);
      expect(out[5]).toBe(0);
    });

    it("no Magnus contribution when no liftCoefficient model is wired, even with spin set", () => {
      const model = createSpatialProjectileModel([new MagnusForce()]);
      const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
      const params = createSphericalProjectileParams({
        mass,
        radius,
        dragCoefficient: new ConstantCd(0),
        spin: 100,
        spinAxis: [0, 1, 0],
        // liftCoefficient omitted entirely
      });
      const ctx = createEvalContext(env, params);
      const y = new Float64Array([0, 0, 0, 20, 0, 0]);
      const out = new Float64Array(6);
      model.rhs(0, y, out, ctx);
      expect(out[3]).toBe(0);
      expect(out[4]).toBe(0);
      expect(out[5]).toBe(0);
    });

    it("a degenerate zero spin axis produces no force rather than NaN", () => {
      const liftCoefficient = new SaturatingLiftCoefficient();
      const model = createSpatialProjectileModel([new MagnusForce()]);
      const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
      const params = createSphericalProjectileParams({
        mass,
        radius,
        dragCoefficient: new ConstantCd(0),
        liftCoefficient,
        spin: 100,
        spinAxis: [0, 0, 0],
      });
      const ctx = createEvalContext(env, params);
      const y = new Float64Array([0, 0, 0, 20, 0, 0]);
      const out = new Float64Array(6);
      model.rhs(0, y, out, ctx);
      expect(out[3]).toBe(0);
      expect(out[4]).toBe(0);
      expect(out[5]).toBe(0);
    });
  });

  describe("P4.27: Coriolis force (-2m*Omega x v, latitude param)", () => {
    const mass = 0.145;
    const radius = 0.0366;
    const latitudeRad = Math.PI / 4; // 45 deg N

    it("throws at construction when the coriolis force is present but latitudeRad is omitted", () => {
      expect(() => createSpatialProjectileModel([new GravityForce(), new CoriolisForce()])).toThrow(
        /latitudeRad/,
      );
    });

    it("does not throw when latitudeRad is given but coriolis isn't in the force list (unused, not an error)", () => {
      expect(() =>
        createSpatialProjectileModel([new GravityForce()], undefined, undefined, { latitudeRad }),
      ).not.toThrow();
    });

    it("matches the hand-derived force at a specific state (vx, vy, vz all nonzero)", () => {
      const model = createSpatialProjectileModel(
        [new GravityForce(), new CoriolisForce()],
        undefined,
        undefined,
        {
          latitudeRad,
        },
      );
      const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
      const params = createSphericalProjectileParams({
        mass,
        radius,
        dragCoefficient: new ConstantCd(0),
      });
      const ctx = createEvalContext(env, params);
      const vx = 10;
      const vy = -5;
      const vz = 3;
      const y = new Float64Array([0, 0, 0, vx, vy, vz]);
      const out = new Float64Array(6);
      model.rhs(0, y, out, ctx);

      const omega = EARTH_ANGULAR_VELOCITY_RAD_S;
      const sinLat = Math.sin(latitudeRad);
      const cosLat = Math.cos(latitudeRad);
      const fxCoriolis = -2 * mass * omega * sinLat * vz;
      const fyCoriolis = 2 * mass * omega * cosLat * vz;
      const fzCoriolis = 2 * mass * omega * (sinLat * vx - cosLat * vy);
      const fyGravity = -mass * 9.80665;

      expect(out[3]).toBeCloseTo(fxCoriolis / mass, 15);
      expect(out[4]).toBeCloseTo((fyCoriolis + fyGravity) / mass, 15);
      expect(out[5]).toBeCloseTo(fzCoriolis / mass, 15);
    });

    it("does no net work: the Coriolis contribution alone is exactly perpendicular to v", () => {
      // Isolate Coriolis (no gravity) so out.(vx,vy,vz) IS the pure
      // acceleration; F.v = 0 for any v is a vector-triple-product identity
      // for -2*Omega x v, not specific to this state.
      const model = createSpatialProjectileModel([new CoriolisForce()], undefined, undefined, {
        latitudeRad,
      });
      const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
      const params = createSphericalProjectileParams({
        mass,
        radius,
        dragCoefficient: new ConstantCd(0),
      });
      const ctx = createEvalContext(env, params);
      const vx = 7;
      const vy = -11;
      const vz = 4;
      const y = new Float64Array([0, 0, 0, vx, vy, vz]);
      const out = new Float64Array(6);
      model.rhs(0, y, out, ctx);
      const power = mass * (out[3]! * vx + out[4]! * vy + out[5]! * vz);
      expect(power).toBeCloseTo(0, 9);
    });

    it("vanishes entirely at the equator when v is purely vertical (sinLat=0 term only survives via fz, which also needs cosLat*vy)", () => {
      // At the equator (lat=0): sinLat=0, cosLat=1. For a purely vertical
      // v=(0, vy, 0): fx=0, fy=0, fz=2*m*omega*(0 - vy) = -2*m*omega*vy,
      // nonzero -- the classic equatorial eastward-deflection-of-a-drop case
      // (validated end-to-end in solverkit's coriolis-deflection.test.ts).
      // This test isolates just the fx/fy channels, which the derivation
      // above says must be exactly zero for this state at any latitude
      // (vz=0), independent of lat.
      const model = createSpatialProjectileModel([new CoriolisForce()], undefined, undefined, {
        latitudeRad: 0,
      });
      const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
      const params = createSphericalProjectileParams({
        mass,
        radius,
        dragCoefficient: new ConstantCd(0),
      });
      const ctx = createEvalContext(env, params);
      const y = new Float64Array([0, 0, 0, 0, -20, 0]);
      const out = new Float64Array(6);
      model.rhs(0, y, out, ctx);
      expect(out[3]).toBe(0);
      expect(out[4]).toBe(0);
      expect(out[5]).not.toBe(0);
    });
  });
});
