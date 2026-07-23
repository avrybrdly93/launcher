import { describe, expect, it } from "vitest";
import {
  PRESET_SCENARIOS,
  dimensionlessPi,
  mechanicalEnergy,
  spinParameter,
} from "@ballista/engine";
import { resolveModel } from "@ballista/runtime";
import {
  ClassicalRK4Stepper,
  HermiteDenseOutputStepper,
  TrajectoryRecorder,
  integrate,
  type SolverConfig,
  type Stepper,
} from "@ballista/solverkit";
import {
  computeHudReadout,
  createHudReadoutScratch,
  hudReadoutAtPlayhead,
  nearestRowIndex,
} from "./hud-readout.js";

const GOLF_DRIVE = PRESET_SCENARIOS.find((s) => s.model.forceIds.includes("magnus"))!;
const SHOT_PUT = PRESET_SCENARIOS.find((s) => s.projectile.id === "shot-put")!;

describe("computeHudReadout: values match independently-computed physics (P3.15 validation criterion)", () => {
  it("golf drive at launch: speed/energy/reynolds/spinRatio/pi all cross-check against their own formulas", () => {
    const { model, ctx, y0 } = resolveModel(GOLF_DRIVE);
    const scratch = createHudReadoutScratch(model.dim);

    const readout = computeHudReadout(model, 0, y0, ctx, scratch);

    expect(readout.t).toBe(0);
    expect(readout.speed).toBeCloseTo(Math.hypot(y0[2]!, y0[3]!), 12);
    expect(readout.energy).toBeCloseTo(mechanicalEnergy(y0, ctx), 12);
    // ctx was refreshed by computeHudReadout's internal model.rhs call, so
    // ctx.re/ctx.speedRel/ctx.env now reflect this exact (t, y0) state.
    expect(readout.reynolds).toBe(ctx.re);
    expect(readout.spinRatio).toBeCloseTo(
      spinParameter(ctx.params.spin, ctx.params.radius, ctx.speedRel),
      12,
    );
    expect(readout.pi).toBeCloseTo(dimensionlessPi(ctx.params, ctx.env, ctx.speedRel), 12);

    // Golf drive is spinning: spinRatio must be genuinely nonzero, not just
    // trivially matching a formula that always returns 0.
    expect(readout.spinRatio).toBeGreaterThan(0);
  });

  it("shot put (no spin): spinRatio is exactly 0", () => {
    const { model, ctx, y0 } = resolveModel(SHOT_PUT);
    const scratch = createHudReadoutScratch(model.dim);

    const readout = computeHudReadout(model, 0, y0, ctx, scratch);

    expect(readout.spinRatio).toBe(0);
  });
});

describe("nearestRowIndex", () => {
  const t = [0, 1, 2, 3, 5];

  it("snaps to the closer endpoint of the bracketing interval", () => {
    expect(nearestRowIndex(t, 0.4)).toBe(0);
    expect(nearestRowIndex(t, 0.6)).toBe(1);
    expect(nearestRowIndex(t, 3.4)).toBe(3);
    expect(nearestRowIndex(t, 4.6)).toBe(4);
  });

  it("lands exactly on a recorded sample", () => {
    expect(nearestRowIndex(t, 2)).toBe(2);
  });

  it("clamps to the first/last row outside the recorded span", () => {
    expect(nearestRowIndex(t, -1)).toBe(0);
    expect(nearestRowIndex(t, 10)).toBe(4);
  });
});

describe("hudReadoutAtPlayhead: values equal recorder channels at playhead (P3.15 validation criterion)", () => {
  it("at a playbackTime exactly on a recorded row, reproduces computeHudReadout run directly on that row's own channels", () => {
    const { model, ctx, y0 } = resolveModel(GOLF_DRIVE);
    const stepper: Stepper = new HermiteDenseOutputStepper(new ClassicalRK4Stepper());
    const cfg: SolverConfig = { stepper: "classical-rk4", h: 0.01, maxSteps: 100_000 };
    const recorder = new TrajectoryRecorder();
    integrate(model, ctx, y0, [0, 2], cfg, stepper, [recorder]);
    const trajectory = recorder.trajectory;

    expect(trajectory.nSteps).toBeGreaterThan(10);
    const rowIndex = Math.floor(trajectory.nSteps / 3);
    const playbackTime = trajectory.t[rowIndex]!;

    const scratchA = createHudReadoutScratch(model.dim);
    const viaPlayhead = hudReadoutAtPlayhead(model, trajectory, playbackTime, ctx, scratchA);

    const rowState = new Float64Array([
      trajectory.channels[0]![rowIndex]!,
      trajectory.channels[1]![rowIndex]!,
      trajectory.channels[2]![rowIndex]!,
      trajectory.channels[3]![rowIndex]!,
    ]);
    const scratchB = createHudReadoutScratch(model.dim);
    const direct = computeHudReadout(model, playbackTime, rowState, ctx, scratchB);

    expect(viaPlayhead).toEqual(direct);
  });

  it("a playbackTime between recorded rows snaps to (never interpolates past) the nearer row's exact channel values", () => {
    const { model, ctx, y0 } = resolveModel(SHOT_PUT);
    const stepper: Stepper = new HermiteDenseOutputStepper(new ClassicalRK4Stepper());
    const cfg: SolverConfig = { stepper: "classical-rk4", h: 0.05, maxSteps: 100_000 };
    const recorder = new TrajectoryRecorder();
    integrate(model, ctx, y0, [0, 2], cfg, stepper, [recorder]);
    const trajectory = recorder.trajectory;

    const rowIndex = 5;
    const nearTime = trajectory.t[rowIndex]! + 1e-4; // well within [t[5], t[6]), closer to row 5

    const scratch = createHudReadoutScratch(model.dim);
    const readout = hudReadoutAtPlayhead(model, trajectory, nearTime, ctx, scratch);

    expect(readout.t).toBe(trajectory.t[rowIndex]);
    expect(readout.speed).toBe(
      Math.hypot(trajectory.channels[2]![rowIndex]!, trajectory.channels[3]![rowIndex]!),
    );
  });
});
