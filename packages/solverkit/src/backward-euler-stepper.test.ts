import { describe, expect, it } from "vitest";
import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  GravityForce,
  ISA,
  LinearDragForce,
  QuadraticDragForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
  dragRelaxationTimeLinear,
  sutherlandViscosity,
  type CharacteristicEnvironment,
  type ChannelMeta,
  type EvalContext,
  type Model,
} from "@ballista/engine";
import { BackwardEulerStepper } from "./backward-euler-stepper.js";
import { measureConvergence } from "./convergence-harness.js";
import { ExplicitEulerStepper } from "./explicit-euler-stepper.js";
import { integrate } from "./integrate.js";
import { isStepperStable } from "./stability-boundary-sweep.js";
import { createStepResult, type SolverConfig } from "./types.js";

const DECAY_CHANNELS: readonly ChannelMeta[] = [{ name: "y", unit: "1" }];
const VX = 2;

/** ydot = -y, dim 1. */
function createDecayModel(): Model {
  return {
    dim: 1,
    channels: DECAY_CHANNELS,
    rhs(_t: number, y: Float64Array, out: Float64Array): void {
      out[0] = -y[0]!;
    },
  };
}

function createEvalContextFixture(): EvalContext {
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass: 1,
    radius: 0.05,
    dragCoefficient: new ConstantCd(0),
  });
  return createEvalContext(env, params);
}

/** P1.36's dust-grain preset projectile (§3.8's canonical stiffness demonstration). */
function createDustGrainParams() {
  const radius = 5e-6;
  const mass = (4 / 3) * Math.PI * Math.pow(radius, 3) * 2000;
  return createSphericalProjectileParams({ mass, radius, dragCoefficient: new ConstantCd(0.5) });
}

describe("BackwardEulerStepper (P2.38)", () => {
  it("one step of ydot=-y matches the implicit-Euler closed form y0/(1+h)", () => {
    const model = createDecayModel();
    const ctx = createEvalContextFixture();
    const stepper = new BackwardEulerStepper();
    stepper.init(model, ctx);

    const y = new Float64Array([1]);
    const out = createStepResult(1);
    const h = 0.1;

    stepper.step(0, y, h, out);

    expect(out.yNext[0]).toBeCloseTo(1 / (1 + h), 12);
    expect(out.accepted).toBe(true);
    expect(out.h).toBe(h);
    expect(out.nRHS).toBeGreaterThan(0);
  });

  it("declares order 1, non-FSAL, non-symplectic", () => {
    const stepper = new BackwardEulerStepper();
    expect(stepper.info).toEqual({
      id: "backward-euler",
      order: 1,
      fsal: false,
      symplectic: false,
    });
  });

  it("throws if step() is called before init()", () => {
    const stepper = new BackwardEulerStepper();
    expect(() => stepper.step(0, new Float64Array([1]), 0.1, createStepResult(1))).toThrow();
  });

  it("drives integrate() end to end, matching the closed-form implicit-Euler product (1/(1+h))^n", () => {
    const model = createDecayModel();
    const ctx = createEvalContextFixture();
    const stepper = new BackwardEulerStepper();
    const cfg: SolverConfig = { stepper: "backward-euler", h: 0.1, maxSteps: 1000 };

    const report = integrate(model, ctx, new Float64Array([1]), [0, 1], cfg, stepper, []);

    expect(report.status).toBe("ok");
    expect(report.nSteps).toBe(10);
    expect(report.yFinal[0]).toBeCloseTo((1 / 1.1) ** 10, 12);
  });

  it("FD-fallback jacobian path matches the analytic-jacobian path on gravity+quadratic-drag", () => {
    const params = createSphericalProjectileParams({
      mass: 0.1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0.47),
    });
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const ctx = createEvalContext(env, params);

    const withAnalyticJacobian = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
    ]);
    expect(withAnalyticJacobian.jacobian).toBeDefined();

    // Same rhs, no `jacobian` field -- forces BackwardEulerStepper onto its
    // in-place finite-difference fallback (P1.23's formula).
    const withoutJacobian: Model = {
      dim: withAnalyticJacobian.dim,
      channels: withAnalyticJacobian.channels,
      rhs: withAnalyticJacobian.rhs,
    };

    const y0 = new Float64Array([0, 50, 20, -5]);
    const h = 0.05;

    const analyticStepper = new BackwardEulerStepper();
    analyticStepper.init(withAnalyticJacobian, ctx);
    const outAnalytic = createStepResult(4);
    analyticStepper.step(0, y0, h, outAnalytic);

    const fdStepper = new BackwardEulerStepper();
    fdStepper.init(withoutJacobian, ctx);
    const outFD = createStepResult(4);
    fdStepper.step(0, y0, h, outFD);

    expect(outAnalytic.accepted).toBe(true);
    expect(outFD.accepted).toBe(true);
    for (let i = 0; i < 4; i++) {
      expect(outFD.yNext[i]).toBeCloseTo(outAnalytic.yNext[i]!, 6);
    }
  });

  describe("A-stability demo on the dust-grain scenario (§4.6)", () => {
    it("stays bounded at h = 100 * h_crit(explicit Euler), where explicit Euler is already grossly unstable", () => {
      const params = createDustGrainParams();
      const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
      const ctx = createEvalContext(env, params);
      // gravity+linear-drag has no analytic jacobian (P1.22 scopes that to
      // quadratic drag), so this also exercises BackwardEulerStepper's FD
      // fallback on the platform's actual named stiffness scenario.
      const model = createPlanarProjectileModel([new GravityForce(), new LinearDragForce()]);

      const charEnv: CharacteristicEnvironment = {
        rho: ISA.rho0,
        eta: sutherlandViscosity(ISA.T0),
      };
      const tau = dragRelaxationTimeLinear(params, charEnv);
      const predictedHCritEuler = 2 * tau; // §4.6: h < 2/|lambda_max| for explicit Euler

      const y0 = new Float64Array([0, 0.01, 15, 0]); // P1.36 dust-grain preset ICs
      const nSteps = 20;
      const hDemo = 100 * predictedHCritEuler;

      const explicitEuler = new ExplicitEulerStepper();
      expect(isStepperStable(explicitEuler, model, ctx, y0, hDemo, nSteps, VX)).toBe(false);

      const backwardEuler = new BackwardEulerStepper();
      expect(isStepperStable(backwardEuler, model, ctx, y0, hDemo, nSteps, VX)).toBe(true);
    });
  });

  it("slope 1.00 +/- 0.1 on linear-drag benchmark (3.6-3.7)", () => {
    const mass = 3.372e-7;
    const radius = 0.01;
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    env.sample(0, 0, 0, ctx.env);

    const b = 6 * Math.PI * ctx.env.eta * radius;
    const tau = mass / b;
    const vT = (mass * ctx.env.g) / b;

    const model = createPlanarProjectileModel([new GravityForce(), new LinearDragForce()]);
    const y0 = new Float64Array([0, 100, 20, 5]);
    const tspan: readonly [number, number] = [0, 0.2];

    function yExact(t: number): Float64Array {
      const [x0, yy0, vx0, vy0] = y0 as unknown as [number, number, number, number];
      const decay = Math.exp(-t / tau);
      const oneMinusDecay = -Math.expm1(-t / tau);
      const vx = vx0 * decay;
      const vy = -vT + (vy0 + vT) * decay;
      const x = x0 + vx0 * tau * oneMinusDecay;
      const y = yy0 - vT * t + (vy0 + vT) * tau * oneMinusDecay;
      return new Float64Array([x, y, vx, vy]);
    }

    const hs = [0.02, 0.01, 0.005, 0.0025, 0.00125];
    const result = measureConvergence(
      () => new BackwardEulerStepper(),
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
    expect(result.slope).toBeGreaterThan(0.9);
    expect(result.slope).toBeLessThan(1.1);
  });
});
