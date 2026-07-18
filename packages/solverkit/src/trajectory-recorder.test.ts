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
import { TrajectoryRecorder } from "./trajectory-recorder.js";
import type { SolverConfig, Stepper } from "./types.js";

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

function createMockEulerStepper(): Stepper {
  let model: Model | undefined;
  let ctx: EvalContext | undefined;
  let scratch: Float64Array | undefined;

  return {
    info: { id: "mock-euler", order: 1, fsal: false, symplectic: false },
    init(m: Model, c: EvalContext): void {
      model = m;
      ctx = c;
      scratch = new Float64Array(m.dim);
    },
    step(t, y, h, out): void {
      model!.rhs(t, y, scratch!, ctx!);
      for (let i = 0; i < y.length; i++) {
        out.yNext[i] = y[i]! + h * scratch![i]!;
      }
      out.accepted = true;
      out.h = h;
      out.errorEstimate = 0;
      out.nRHS = 1;
    },
  };
}

describe("TrajectoryRecorder (P2.04)", () => {
  it("records every accepted step (plus the initial state) across 1e4 steps and freezes zero-copy views on finish", () => {
    const model = createDecayModel();
    const ctx = createEvalContextFixture();
    const stepper = createMockEulerStepper();
    const recorder = new TrajectoryRecorder();
    const cfg: SolverConfig = { stepper: "mock-euler", h: 1e-4, maxSteps: 1_000_000 };

    const report = integrate(model, ctx, new Float64Array([1]), [0, 1], cfg, stepper, [recorder]);

    expect(report.status).toBe("ok");
    expect(report.nSteps).toBe(10_000);

    const traj = recorder.trajectory;
    // +1 for the initial state recorded in start(), before any accepted step.
    expect(traj.nSteps).toBe(10_001);
    expect(traj.t.length).toBe(10_001);
    expect(traj.channels.length).toBe(1);
    expect(traj.channels[0]!.length).toBe(10_001);
    expect(traj.t[0]).toBe(0);
    expect(traj.t[traj.nSteps - 1]).toBe(1);
    expect(traj.channels[0]![0]).toBe(1);

    // Zero-copy: `subarray` windows the same backing buffer rather than
    // copying, so the exposed views' buffers are larger than the trimmed
    // row count once the doubling growth has overshot it (a copy would be
    // sized exactly to the data instead).
    expect(traj.t.buffer.byteLength).toBeGreaterThan(traj.nSteps * Float64Array.BYTES_PER_ELEMENT);

    // Identity check: repeated reads after finish return the same frozen
    // object and the same underlying typed-array views, not fresh slices.
    const traj2 = recorder.trajectory;
    expect(traj2).toBe(traj);
    expect(traj2.t).toBe(traj.t);
    expect(traj2.channels[0]).toBe(traj.channels[0]);
  });

  it("throws if read before finish()", () => {
    const recorder = new TrajectoryRecorder();
    expect(() => recorder.trajectory).toThrow();
  });

  it("grows correctly across many doublings from a tiny initial capacity", () => {
    const model = createDecayModel();
    const ctx = createEvalContextFixture();
    const stepper = createMockEulerStepper();
    const recorder = new TrajectoryRecorder(1);
    const cfg: SolverConfig = { stepper: "mock-euler", h: 0.01, maxSteps: 10_000 };

    integrate(model, ctx, new Float64Array([1]), [0, 1], cfg, stepper, [recorder]);

    const traj = recorder.trajectory;
    expect(traj.nSteps).toBe(101);
    // No dropped/duplicated/corrupted rows across growth boundaries.
    for (let i = 1; i < traj.nSteps; i++) {
      expect(traj.t[i]!).toBeGreaterThan(traj.t[i - 1]!);
    }
    expect(traj.t[traj.nSteps - 1]).toBe(1);
  });
});
