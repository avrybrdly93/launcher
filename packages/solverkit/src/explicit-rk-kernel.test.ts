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
  type ChannelMeta,
  type EvalContext,
  type Model,
} from "@ballista/engine";
import { ExplicitEulerStepper } from "./explicit-euler-stepper.js";
import {
  EULER_TABLEAU,
  ExplicitRKStepper,
  HEUN_TABLEAU,
  MIDPOINT_TABLEAU,
  RK4_TABLEAU,
} from "./explicit-rk-kernel.js";
import { HeunRK2Stepper } from "./heun-rk2-stepper.js";
import { measureConvergence } from "./convergence-harness.js";
import { integrate } from "./integrate.js";
import { MidpointRK2Stepper } from "./midpoint-rk2-stepper.js";
import { createStepResult, type SolverConfig, type Stepper } from "./types.js";

const DECAY_CHANNELS: readonly ChannelMeta[] = [{ name: "y", unit: "1" }];

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

function createProjectileFixture(): { model: Model; ctx: EvalContext } {
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: new ConstantCd(0.47),
  });
  const ctx = createEvalContext(env, params);
  const model = createPlanarProjectileModel([new GravityForce(), new LinearDragForce()]);
  return { model, ctx };
}

const RANDOM_STATES: readonly Float64Array[] = [
  new Float64Array([0, 10, 20, 5]),
  new Float64Array([3.2, 50, -8.1, 12.4]),
  new Float64Array([-4, 0.5, 15, -30]),
  new Float64Array([100, 200, -1.5, 0.2]),
  new Float64Array([0.001, 1e3, 400, -400]),
];

/** Runs `stepper` and `generic` from identical (t, y, h) and asserts every output field matches bit-for-bit. */
function expectBitIdenticalStep(
  model: Model,
  ctx: EvalContext,
  reference: Stepper,
  generic: Stepper,
  t: number,
  y: Float64Array,
  h: number,
): void {
  reference.init(model, ctx);
  generic.init(model, ctx);

  const outRef = createStepResult(y.length);
  const outGeneric = createStepResult(y.length);
  reference.step(t, y, h, outRef);
  generic.step(t, y, h, outGeneric);

  for (let i = 0; i < y.length; i++) {
    expect(outGeneric.yNext[i]).toBe(outRef.yNext[i]);
  }
  expect(outGeneric.h).toBe(outRef.h);
  expect(outGeneric.nRHS).toBe(outRef.nRHS);
  expect(outGeneric.accepted).toBe(outRef.accepted);
}

describe("ExplicitRKStepper / stepExplicitRK (P2.12)", () => {
  describe("reproduces P2.06/10/11 bit-identically via tableaux", () => {
    it("Euler tableau matches ExplicitEulerStepper", () => {
      const { model, ctx } = createProjectileFixture();
      const generic = new ExplicitRKStepper(
        { id: "explicit-euler-generic", order: 1, fsal: false, symplectic: false },
        EULER_TABLEAU,
      );
      for (const y of RANDOM_STATES) {
        for (const h of [0.1, 0.01, 1e-3]) {
          expectBitIdenticalStep(model, ctx, new ExplicitEulerStepper(), generic, 1.5, y, h);
        }
      }
    });

    it("midpoint tableau matches MidpointRK2Stepper", () => {
      const { model, ctx } = createProjectileFixture();
      const generic = new ExplicitRKStepper(
        { id: "midpoint-rk2-generic", order: 2, fsal: false, symplectic: false },
        MIDPOINT_TABLEAU,
      );
      for (const y of RANDOM_STATES) {
        for (const h of [0.1, 0.01, 1e-3]) {
          expectBitIdenticalStep(model, ctx, new MidpointRK2Stepper(), generic, 1.5, y, h);
        }
      }
    });

    it("Heun tableau matches HeunRK2Stepper", () => {
      const { model, ctx } = createProjectileFixture();
      const generic = new ExplicitRKStepper(
        { id: "heun-rk2-generic", order: 2, fsal: false, symplectic: false },
        HEUN_TABLEAU,
      );
      for (const y of RANDOM_STATES) {
        for (const h of [0.1, 0.01, 1e-3]) {
          expectBitIdenticalStep(model, ctx, new HeunRK2Stepper(), generic, 1.5, y, h);
        }
      }
    });

    it("Euler tableau end to end via integrate() matches the decay model closed-form Euler product", () => {
      const model = createDecayModel();
      const ctx = createEvalContextFixture();
      const stepper = new ExplicitRKStepper(
        { id: "explicit-euler-generic", order: 1, fsal: false, symplectic: false },
        EULER_TABLEAU,
      );
      const cfg: SolverConfig = { stepper: "explicit-euler-generic", h: 0.1, maxSteps: 1000 };

      const report = integrate(model, ctx, new Float64Array([1]), [0, 1], cfg, stepper, []);

      expect(report.status).toBe("ok");
      expect(report.yFinal[0]).toBeCloseTo(0.9 ** 10, 12);
    });
  });

  it("throws if step() is called before init()", () => {
    const stepper = new ExplicitRKStepper(
      { id: "explicit-euler-generic", order: 1, fsal: false, symplectic: false },
      EULER_TABLEAU,
    );
    expect(() => stepper.step(0, new Float64Array([1]), 0.1, createStepResult(1))).toThrow();
  });

  it("RK4 tableau: slope 4.00 +/- 0.1 on linear-drag benchmark (3.6-3.7)", () => {
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
      () =>
        new ExplicitRKStepper(
          { id: "classical-rk4-generic", order: 4, fsal: false, symplectic: false },
          RK4_TABLEAU,
        ),
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
    expect(result.slope).toBeGreaterThan(3.9);
    expect(result.slope).toBeLessThan(4.1);
  });
});
