import { describe, expect, it } from "vitest";
import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  GravityForce,
  QuadraticDragForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
} from "@ballista/engine";
import { ClassicalRK4Stepper } from "./classical-rk4-stepper.js";
import { measureConvergence } from "./convergence-harness.js";
import { createStepResult } from "./types.js";

/**
 * P2.48: pure vertical drop from rest is the case the blueprint calls out in
 * §3.8 as one that "starts *at* the kink" -- v_rel = (0,0) exactly at t=0,
 * where the quadratic-drag force ∝ |v_rel|*v_rel is C^1 but not C^2 as a
 * function on R^2 (its second derivative jumps depending on the direction
 * of approach to the origin).
 *
 * Measured finding (documented per the task's validation criterion, which
 * this test encodes rather than assumes): RK4's order does NOT degrade for
 * this scenario. Both the single-step local error at h and the accumulated
 * global error over a full flight measure order ~4-5 (design), matching
 * classical-rk4-stepper.test.ts's away-from-the-kink linear-drag benchmark
 * to within fit noise -- see the "local single-step order at the kink" case
 * below for the sharper (order-5) measurement.
 *
 * Why: every aero force here is proportional to |v_rel| (drag ∝ u^2,
 * vanishing as u->0), so gravity -- the only non-vanishing force exactly at
 * u=0 -- uniquely determines the trajectory's departure direction from the
 * kink (purely vertical, forced by (ax,ay)=(0,-g) at t=0 regardless of any
 * other u-proportional force wired in; verified separately for a spin/Magnus
 * variant during development, same result). The anisotropic (direction-
 * dependent) second derivative of the |v|*v map only bites a trajectory that
 * samples BOTH sides of the singularity (e.g. a direction-reversing crossing
 * such as a purely-vertical throw's apex, which this scenario deliberately
 * is not); a one-sided departure along a fixed ray is a smooth, indeed
 * analytic, function of time (|r*d̂|*(r*d̂) = r^2*d̂ for r >= 0), so RK4 never
 * actually samples the kink's non-smooth structure here. This test exists to
 * document that finding as a deliberate, checked fact about the platform's
 * force law -- not to assert a degradation that would be false to claim.
 */
describe("ClassicalRK4Stepper vertical-drop-from-rest kink case (P2.48, §3.8)", () => {
  const mass = 7.7e-5; // fabricated light sphere (~0.08 g), chosen for a strong-drag regime
  const radius = 0.02;
  const cd = 0.5;

  function buildScenario() {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(cd),
    });
    const ctx = createEvalContext(env, params);
    env.sample(0, 0, 0, ctx.env); // populate ctx.env.rho/g used below, matching what rhs() samples internally

    // Constant Cd makes the quadratic-drag relaxation kd = rho*Cd*A/(2m)
    // state-independent, so the 1D fall equation dv/dt = -g + kd*v^2 (v<=0,
    // falling) has the closed form v(t) = -vT*tanh(g*t/vT),
    // y(t) = y0 - (vT^2/g)*ln(cosh(g*t/vT)), with vT = sqrt(g/kd).
    const kd = (ctx.env.rho * cd * params.area) / (2 * mass);
    const g = ctx.env.g;
    const vT = Math.sqrt(g / kd);

    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const y0 = new Float64Array([0, 1000, 0, 0]); // dropped from rest: v_rel = 0 exactly at t=0, the kink

    function yExact(t: number): Float64Array {
      const x0 = y0[0]!;
      const yy0 = y0[1]!;
      const arg = (g * t) / vT;
      const vy = -vT * Math.tanh(arg);
      const y = yy0 - ((vT * vT) / g) * Math.log(Math.cosh(arg));
      return new Float64Array([x0, y, 0, vy]);
    }

    return { ctx, model, y0, yExact, vT };
  }

  it("global order over a full 0.5s flight is ~4 (design order), not degraded below it", () => {
    const { ctx, model, y0, yExact } = buildScenario();
    const tspan: readonly [number, number] = [0, 0.5];
    const hs = [0.02, 0.01, 0.005, 0.0025, 0.00125];

    const result = measureConvergence(
      () => new ClassicalRK4Stepper(),
      model,
      ctx,
      y0,
      tspan,
      yExact,
      hs,
    );

    expect(result.errors.length).toBe(hs.length);
    for (let i = 1; i < result.errors.length; i++) {
      expect(result.errors[i]!).toBeLessThan(result.errors[i - 1]!);
    }
    // Measured ~4.0-4.05 across repeated parameter sweeps during development;
    // documented here as "not degraded," per the analysis above.
    expect(result.slope).toBeGreaterThan(3.8);
    expect(result.slope).toBeLessThan(4.3);
  });

  it("local (single-step) order right at the kink is ~5 (design local order), not degraded", () => {
    const { ctx, model, y0, yExact } = buildScenario();
    const stepper = new ClassicalRK4Stepper();
    stepper.init(model, ctx);

    const hs = [0.02, 0.01, 0.005, 0.0025, 0.00125, 0.000625];
    const errors: number[] = [];
    for (const h of hs) {
      const out = createStepResult(4);
      stepper.step(0, y0, h, out);
      const exact = yExact(h);
      let sumSq = 0;
      for (let i = 0; i < 4; i++) {
        const d = out.yNext[i]! - exact[i]!;
        sumSq += d * d;
      }
      errors.push(Math.sqrt(sumSq));
    }

    for (let i = 1; i < errors.length; i++) {
      expect(errors[i]!).toBeLessThan(errors[i - 1]!);
    }

    const xs = hs.map(Math.log);
    const ys = errors.map(Math.log);
    const n = xs.length;
    const meanX = xs.reduce((a, b) => a + b, 0) / n;
    const meanY = ys.reduce((a, b) => a + b, 0) / n;
    let covariance = 0;
    let variance = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i]! - meanX;
      covariance += dx * (ys[i]! - meanY);
      variance += dx * dx;
    }
    const slope = covariance / variance;

    // Measured ~5.0 during development: the single first step starting
    // exactly at v_rel=0 achieves RK4's full local order, confirming the
    // kink is never actually sampled (see class doc comment).
    expect(slope).toBeGreaterThan(4.7);
    expect(slope).toBeLessThan(5.3);
  });
});
