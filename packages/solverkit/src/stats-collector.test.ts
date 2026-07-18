import { describe, expect, it } from "vitest";
import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createSphericalProjectileParams,
  type ChannelMeta,
  type EvalContext,
  type Model,
} from "@ballista/engine";
import { integrate } from "./integrate.js";
import { StatsCollector } from "./stats-collector.js";
import type { SolverConfig, Stepper } from "./types.js";

const DECAY_CHANNELS: readonly ChannelMeta[] = [{ name: "y", unit: "1" }];

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

/** Instrumented mock: every step reports a fixed, known nRHS (simulating a multi-stage method). */
function createInstrumentedStepper(nRHSPerStep: number): Stepper {
  return {
    info: { id: "instrumented-mock", order: 1, fsal: false, symplectic: false },
    init(): void {},
    step(_t, y, h, out): void {
      for (let i = 0; i < y.length; i++) out.yNext[i] = y[i]!;
      out.accepted = true;
      out.h = h;
      out.errorEstimate = 0;
      out.nRHS = nRHSPerStep;
    },
  };
}

describe("StatsCollector (P2.05)", () => {
  it("counts match an instrumented mock stepper over uniform-h steps", () => {
    const model = createDecayModel();
    const ctx = createEvalContextFixture();
    const stepper = createInstrumentedStepper(3);
    const stats = new StatsCollector();
    const cfg: SolverConfig = { stepper: "instrumented-mock", h: 0.1, maxSteps: 1000 };

    const report = integrate(model, ctx, new Float64Array([1]), [0, 1], cfg, stepper, [stats]);

    expect(report.nSteps).toBe(10);
    expect(stats.stats.nSteps).toBe(10);
    expect(stats.stats.nRHS).toBe(30); // 3 rhs evals/step * 10 steps
    expect(stats.stats.nRejected).toBe(0);
    expect(stats.stats.hMin).toBeCloseTo(0.1, 15);
    expect(stats.stats.hMax).toBeCloseTo(0.1, 15);
    expect(stats.stats.histogramCounts.reduce((a, b) => a + b, 0)).toBe(10);
  });

  it("hMin/hMax and histogram totals stay correct when step size varies (t_f clamp shrinks the last step)", () => {
    const model = createDecayModel();
    const ctx = createEvalContextFixture();
    const stepper = createInstrumentedStepper(1);
    const stats = new StatsCollector();
    const cfg: SolverConfig = { stepper: "instrumented-mock", h: 0.3, maxSteps: 1000 };

    integrate(model, ctx, new Float64Array([1]), [0, 1], cfg, stepper, [stats]);

    expect(stats.stats.nSteps).toBe(4); // 0.3, 0.3, 0.3, clamped 0.1
    expect(stats.stats.hMax).toBeCloseTo(0.3, 10);
    expect(stats.stats.hMin).toBeCloseTo(0.1, 10);
    expect(stats.stats.histogramCounts.reduce((a, b) => a + b, 0)).toBe(4);
    expect(stats.stats.histogramBinEdges.length).toBe(stats.stats.histogramCounts.length + 1);
  });

  it("throws if read before finish()", () => {
    const stats = new StatsCollector();
    expect(() => stats.stats).toThrow();
  });
});
