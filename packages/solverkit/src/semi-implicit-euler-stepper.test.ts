import { describe, expect, it } from "vitest";
import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  GravityForce,
  LinearDragForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
  mechanicalEnergy,
  type ChannelMeta,
  type EvalContext,
  type Model,
} from "@ballista/engine";
import { measureConvergence } from "./convergence-harness.js";
import { ExplicitEulerStepper } from "./explicit-euler-stepper.js";
import { SemiImplicitEulerStepper } from "./semi-implicit-euler-stepper.js";
import { createStepResult, type Stepper } from "./types.js";

const OSCILLATOR_CHANNELS: readonly ChannelMeta[] = [
  { name: "x", unit: "m" },
  { name: "v", unit: "m/s" },
];

/**
 * Simple harmonic oscillator (dq/dt=v, dv/dt=-omega^2 q): a bounded,
 * periodic Hamiltonian system, standing in for the (not-yet-registered,
 * P4.31) Stage-B pendulum's small-oscillation limit. Pure uniform gravity's
 * linear potential is unbounded and non-periodic -- explicit and symplectic
 * Euler both accumulate O(h^2) position error per step there with no
 * distinguishing boundedness effect -- so this oscillator, not a single
 * ballistic arc, is what actually exercises the symplectic guarantee.
 */
function createHarmonicOscillatorModel(omega: number): Model {
  const omega2 = omega * omega;
  return {
    dim: 2,
    channels: OSCILLATOR_CHANNELS,
    partitions: { q: [0], p: [1] },
    rhs(_t: number, y: Float64Array, out: Float64Array): void {
      out[0] = y[1]!;
      out[1] = -omega2 * y[0]!;
    },
  };
}

function oscillatorEnergy(omega: number, y: Float64Array): number {
  return 0.5 * y[1]! * y[1]! + 0.5 * omega * omega * y[0]! * y[0]!;
}

/**
 * Drives `stepper` for `periods` periods of `stepsPerPeriod` steps each,
 * sampling |E/E0 - 1| once per period boundary, and returns the max over the
 * first 10 periods ("early") and the last 10 ("late"). A non-growing method
 * has `late` no larger (to within noise) than `early`; a secularly drifting
 * method has `late` many orders of magnitude past `early`.
 */
function periodBoundaryEnergyErrors(
  stepper: Stepper,
  model: Model,
  ctx: EvalContext,
  omega: number,
  y0: Float64Array,
  h: number,
  stepsPerPeriod: number,
  periods: number,
): { early: number; late: number } {
  stepper.init(model, ctx);
  const y = Float64Array.from(y0);
  const out = createStepResult(y0.length);
  const e0 = oscillatorEnergy(omega, y0);

  const earlyErrors: number[] = [];
  const lateErrors: number[] = [];
  let t = 0;
  for (let period = 0; period < periods; period++) {
    for (let s = 0; s < stepsPerPeriod; s++) {
      stepper.step(t, y, h, out);
      y.set(out.yNext);
      t += h;
    }
    const relErr = Math.abs(oscillatorEnergy(omega, y) / e0 - 1);
    if (period < 10) earlyErrors.push(relErr);
    if (period >= periods - 10) lateErrors.push(relErr);
  }

  return { early: Math.max(...earlyErrors), late: Math.max(...lateErrors) };
}

function createProjectileEvalContext(mass: number, radius: number): EvalContext {
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass,
    radius,
    dragCoefficient: new ConstantCd(0),
  });
  return createEvalContext(env, params);
}

describe("SemiImplicitEulerStepper (P2.15)", () => {
  it("one step matches the closed-form symplectic-Euler recurrence on a constant-acceleration system", () => {
    const g = 9.80665;
    const model: Model = {
      dim: 2,
      channels: OSCILLATOR_CHANNELS,
      partitions: { q: [0], p: [1] },
      rhs(_t: number, _y: Float64Array, out: Float64Array): void {
        out[0] = _y[1]!;
        out[1] = -g;
      },
    };
    const ctx = {} as EvalContext;
    const stepper = new SemiImplicitEulerStepper();
    stepper.init(model, ctx);

    const y = new Float64Array([0, 10]);
    const out = createStepResult(2);
    const h = 0.1;
    stepper.step(0, y, h, out);

    const expectedV = 10 - g * h;
    const expectedX = 0 + h * expectedV;
    expect(out.yNext[1]).toBeCloseTo(expectedV, 15);
    expect(out.yNext[0]).toBeCloseTo(expectedX, 15);
    expect(out.nRHS).toBe(1);
    expect(out.h).toBe(h);
  });

  it("declares order 1, non-FSAL, symplectic", () => {
    const stepper = new SemiImplicitEulerStepper();
    expect(stepper.info).toEqual({
      id: "semi-implicit-euler",
      order: 1,
      fsal: false,
      symplectic: true,
    });
  });

  it("throws in init() if the model declares no partitions", () => {
    const model: Model = {
      dim: 1,
      channels: [{ name: "y", unit: "1" }],
      rhs(_t, y, out) {
        out[0] = -y[0]!;
      },
    };
    const stepper = new SemiImplicitEulerStepper();
    expect(() => stepper.init(model, {} as EvalContext)).toThrow();
  });

  it("throws in init() if q/p partition arrays have mismatched lengths", () => {
    const model: Model = {
      dim: 2,
      channels: OSCILLATOR_CHANNELS,
      partitions: { q: [0], p: [] },
      rhs(_t, y, out) {
        out[0] = y[1]!;
        out[1] = 0;
      },
    };
    const stepper = new SemiImplicitEulerStepper();
    expect(() => stepper.init(model, {} as EvalContext)).toThrow();
  });

  it("throws if step() is called before init()", () => {
    const stepper = new SemiImplicitEulerStepper();
    expect(() => stepper.step(0, new Float64Array([0, 1]), 0.1, createStepResult(2))).toThrow();
  });

  it("slope 1.00 +/- 0.05 on linear-drag benchmark (3.6-3.7)", () => {
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

    const hs = [0.01, 0.005, 0.0025, 0.00125, 0.000625];
    const result = measureConvergence(
      () => new SemiImplicitEulerStepper(),
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
    expect(result.slope).toBeGreaterThan(0.95);
    expect(result.slope).toBeLessThan(1.05);
  });

  it("planar projectile model declares partitions pairing (x,y) with (vx,vy)", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    expect(model.partitions).toEqual({ q: [0, 1], p: [2, 3] });
  });

  it("gravity-only planar projectile: measured energy drift matches the closed-form O(h^2 k) prediction (opposite sign from explicit Euler)", () => {
    const mass = 1;
    const g = 9.80665;
    const ctx = createProjectileEvalContext(mass, 0.05);
    const model = createPlanarProjectileModel([new GravityForce()]);
    const y0 = new Float64Array([0, 0, 0, 50]);
    const h = 1e-3;
    const nSteps = 20000;

    function finalEnergyDrift(stepper: Stepper): number {
      stepper.init(model, ctx);
      const y = Float64Array.from(y0);
      const out = createStepResult(4);
      let t = 0;
      for (let i = 0; i < nSteps; i++) {
        stepper.step(t, y, h, out);
        y.set(out.yNext);
        t += h;
      }
      return mechanicalEnergy(y, ctx) - mechanicalEnergy(y0, ctx);
    }

    const symplecticDrift = finalEnergyDrift(new SemiImplicitEulerStepper());
    const explicitDrift = finalEnergyDrift(new ExplicitEulerStepper());

    // Closed form: dv/dt=-g has no state feedback, so v_k = v0 - g*h*k is
    // exact for BOTH methods; they differ only in whether the position
    // update uses the old or the new v. Solving the resulting recurrences in
    // closed form gives position error -0.5*g*h^2*k (symplectic, uses the
    // updated v) and +0.5*g*h^2*k (explicit, uses the old v); energy error
    // is mass*g times that. On this single unbounded ballistic arc (no
    // periodic orbit to exploit), both grow at the SAME O(h^2 k) rate --
    // symplectic Euler's headline "bounded energy" benefit is specific to
    // bounded/periodic orbits, demonstrated separately below on an
    // oscillator.
    const predicted = 0.5 * mass * g * g * h * h * nSteps;
    expect(symplecticDrift).toBeCloseTo(-predicted, 5);
    expect(explicitDrift).toBeCloseTo(predicted, 5);
  });

  it("harmonic oscillator (Stage-B pendulum small-oscillation stand-in): symplectic Euler's energy error over 100 periods is bounded and non-growing, unlike explicit Euler's secular spiral", () => {
    const omega = 2 * Math.PI;
    const stepsPerPeriod = 200;
    const h = 1 / stepsPerPeriod;
    const periods = 100;
    const model = createHarmonicOscillatorModel(omega);
    const ctx = {} as EvalContext;
    const y0 = new Float64Array([1, 0]);

    const symplectic = periodBoundaryEnergyErrors(
      new SemiImplicitEulerStepper(),
      model,
      ctx,
      omega,
      y0,
      h,
      stepsPerPeriod,
      periods,
    );
    const explicit = periodBoundaryEnergyErrors(
      new ExplicitEulerStepper(),
      model,
      ctx,
      omega,
      y0,
      h,
      stepsPerPeriod,
      periods,
    );

    // Symplectic Euler: late-period max error stays within a small factor of
    // the early-period max (bounded oscillation with some slow modulation,
    // not secular growth) and well under 1%.
    expect(symplectic.late).toBeLessThan(symplectic.early * 20);
    expect(symplectic.late).toBeLessThan(0.01);

    // Explicit Euler on the very same oscillator: the classic outward spiral
    // (§4.2 eq. |y_k+1|=sqrt(1+h^2*omega^2)|y_k|) compounds every period, so
    // by period 90-100 it is orders of magnitude past its early-period error.
    expect(explicit.late).toBeGreaterThan(explicit.early * 1000);

    // And symplectic Euler's late-period error is dramatically smaller than
    // explicit Euler's, at equal cost (one rhs eval/step, same h).
    expect(symplectic.late).toBeLessThan(explicit.late / 1000);
  });
});
