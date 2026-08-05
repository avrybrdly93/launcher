import { describe, expect, it } from "vitest";
import { PRESET_SCENARIOS } from "@ballista/engine";
import { resolveModel } from "@ballista/runtime";
import {
  BackwardEulerStepper,
  ClassicalRK4Stepper,
  TrajectoryRecorder,
  integrate,
  type SolverConfig,
  type Stepper,
  type Trajectory,
} from "@ballista/solverkit";
import {
  computeForceShareSeries,
  computeForceShareValueRange,
  drawForceShareStack,
  forceShareClosureResidual,
  resultantMagnitudeSeries,
  type ForceShareCanvas,
  type ForceShareSeries,
} from "./force-share-series.js";

const SHOT_PUT = PRESET_SCENARIOS.find((s) => s.projectile.id === "shot-put")!;
const GOLF_DRIVE = PRESET_SCENARIOS.find((s) => s.model.forceIds.includes("magnus"))!;
const DUST_GRAIN = PRESET_SCENARIOS.find((s) => s.model.forceIds.includes("drag-linear"))!;

/** Solves `preset` over [0, tEnd] and returns the recorded trajectory alongside the live model/forces the shares must agree with. */
function solve(preset: (typeof PRESET_SCENARIOS)[number], tEnd = 2, h = 0.01) {
  const { model, ctx, y0, forces } = resolveModel(preset);
  const cfg: SolverConfig = { stepper: "classical-rk4", h, maxSteps: 100_000 };
  const recorder = new TrajectoryRecorder();
  integrate(model, ctx, y0, [0, tEnd], cfg, new ClassicalRK4Stepper(), [recorder]);
  return { model, ctx, forces, trajectory: recorder.trajectory as Trajectory };
}

/**
 * The dust grain is the platform's stiff scenario -- explicit RK4 at
 * h = 0.01 is past its stability limit there and overflows to `Infinity`
 * (exercised deliberately below). Backward Euler is the blueprint's own
 * answer for it (§ "the implicit outlook"), and being implicit-but-not-
 * symplectic it is the correct family for a dissipative linear-drag path.
 */
function solveStiff(preset: (typeof PRESET_SCENARIOS)[number], tEnd = 2, h = 0.01) {
  const { model, ctx, y0, forces } = resolveModel(preset);
  const cfg: SolverConfig = { stepper: "backward-euler", h, maxSteps: 100_000 };
  const recorder = new TrajectoryRecorder();
  const stepper: Stepper = new BackwardEulerStepper();
  integrate(model, ctx, y0, [0, tEnd], cfg, stepper, [recorder]);
  return { model, ctx, forces, trajectory: recorder.trajectory as Trajectory };
}

describe("computeForceShareSeries: shares sum to |ΣF| within 1e-12 (P4.35 validation criterion)", () => {
  for (const [label, preset, solver] of [
    ["shot put (gravity + quadratic drag)", SHOT_PUT, solve],
    ["golf drive (gravity + quadratic drag + Magnus)", GOLF_DRIVE, solve],
    ["dust grain (gravity + linear drag, backward Euler)", DUST_GRAIN, solveStiff],
  ] as const) {
    it(`${label}: closure residual under 1e-12 at every recorded row`, () => {
      const { model, ctx, forces, trajectory } = solver(preset);
      const series = computeForceShareSeries(model, forces, trajectory, ctx);

      expect(series.bands).toHaveLength(forces.length);
      expect(series.t.length).toBeGreaterThan(100);
      expect(series.resultantMagnitude.every((m) => Number.isFinite(m))).toBe(true);

      // Row-by-row rather than only via the aggregate helper, so a single
      // bad row cannot hide behind an average.
      for (let i = 0; i < series.resultantMagnitude.length; i++) {
        const sum = series.bands.reduce((acc, band) => acc + band.share[i]!, 0);
        expect(Math.abs(sum - series.resultantMagnitude[i]!)).toBeLessThan(1e-12);
      }

      expect(forceShareClosureResidual(series)).toBeLessThan(1e-12);
    });
  }

  it("closure holds relative to the scale of the forces being added, so it is not an artifact of the dust grain's tiny numbers", () => {
    // The dust grain's forces are ~1e-11 N, so a purely absolute 1e-12
    // bound would pass there even if the decomposition were badly wrong.
    // The denominator has to be chosen carefully though: normalizing by
    // |ΣF| itself does NOT work on this scenario, and the reason is
    // physics rather than a defect. At terminal velocity drag cancels
    // gravity almost exactly, so |ΣF| decays to ~1e-64 -- far below the
    // ~1e-27 rounding floor of the ~1e-11 quantities it was formed from.
    // |ΣF| has no significant digits left of its own, and a ratio against
    // it measures that cancellation, not this module's error (measured:
    // ~0.28 relative, from a residual of ~2e-25 absolute).
    //
    // Nor does Σ|share_i| work, for a related reason: at terminal velocity
    // the resultant is purely horizontal, so gravity's *projection* is
    // exactly 0 even though gravity itself is still mg. The projections are
    // as cancellation-damaged as |ΣF| is.
    //
    // max_i |F_i| is the right denominator -- the scale of the forces
    // actually entering the sum, undamaged by any cancellation, which is
    // what a floating-point roundoff bound should be judged against.
    const { model, ctx, forces, trajectory } = solveStiff(DUST_GRAIN);
    const series = computeForceShareSeries(model, forces, trajectory, ctx);

    let worstRelative = 0;
    let checkedRows = 0;
    for (let i = 0; i < series.resultantMagnitude.length; i++) {
      const scale = series.bands.reduce((acc, band) => Math.max(acc, band.magnitude[i]!), 0);
      if (scale === 0) continue;
      const sum = series.bands.reduce((acc, band) => acc + band.share[i]!, 0);
      worstRelative = Math.max(
        worstRelative,
        Math.abs(sum - series.resultantMagnitude[i]!) / scale,
      );
      checkedRows++;
    }
    expect(checkedRows).toBeGreaterThan(100);
    expect(worstRelative).toBeLessThan(1e-12);
  });

  it("naive |F_i| magnitudes would NOT satisfy the criterion — the projection is load-bearing", () => {
    // Guards the decomposition itself: if someone 'simplifies' share_i to
    // |F_i|, this documents by how much that breaks the criterion rather
    // than leaving the choice looking arbitrary.
    const { model, ctx, forces, trajectory } = solve(SHOT_PUT);
    const series = computeForceShareSeries(model, forces, trajectory, ctx);

    const scratchSeries = computeForceShareSeries(model, forces, trajectory, ctx);
    expect(forceShareClosureResidual(scratchSeries)).toBeLessThan(1e-12);

    // Σ|F_i| >= |ΣF| always, and here it is off by a wide, physical margin.
    let worstMagnitudeGap = 0;
    for (let i = 0; i < series.resultantMagnitude.length; i++) {
      const sumOfMagnitudes = series.bands.reduce((acc, band) => acc + Math.abs(band.share[i]!), 0);
      worstMagnitudeGap = Math.max(
        worstMagnitudeGap,
        sumOfMagnitudes - series.resultantMagnitude[i]!,
      );
    }
    expect(worstMagnitudeGap).toBeGreaterThan(1e-6);
  });
});

describe("computeForceShareSeries: physical reading of the bands", () => {
  it("drag's share flips sign at apex: it reinforces the resultant on the way up and opposes it on the way down (shot put)", () => {
    // The sign flip is the whole reason the stack has to diverge about
    // zero. Climbing, drag points down-and-back and gravity points down,
    // so both project *positively* onto the resultant they jointly make.
    // Falling, velocity has turned downward, so drag now points up-and-back
    // against a still-downward resultant and its projection goes negative.
    const { model, ctx, forces, trajectory } = solve(SHOT_PUT);
    const series = computeForceShareSeries(model, forces, trajectory, ctx);

    const gravity = series.bands.find((b) => b.id === "gravity")!;
    const drag = series.bands.find((b) => b.id.startsWith("drag-"))!;
    const VY = 3;
    const vy = trajectory.channels[VY]!;

    // Gravity is the resultant's dominant along-direction term throughout.
    for (let i = 0; i < series.t.length; i++) {
      expect(gravity.share[i]!).toBeGreaterThan(0);
    }

    expect(drag.share[0]!).toBeGreaterThan(0);
    expect(drag.share[series.t.length - 1]!).toBeLessThan(0);

    let apexRow = -1;
    let flipRow = -1;
    let signChanges = 0;
    for (let i = 1; i < series.t.length; i++) {
      if (apexRow < 0 && vy[i]! <= 0 && vy[i - 1]! > 0) apexRow = i;
      if (Math.sign(drag.share[i]!) !== Math.sign(drag.share[i - 1]!)) {
        signChanges++;
        if (flipRow < 0) flipRow = i;
      }
    }

    // Both regimes are actually present, and the flip is a single clean
    // crossing rather than chatter.
    expect(apexRow).toBeGreaterThan(10);
    expect(series.t.length - apexRow).toBeGreaterThan(10);
    expect(signChanges).toBe(1);

    // The flip *lags* apex and never leads it. Right after vy turns
    // negative the vertical drag component is still ~0, while the
    // horizontal component -- which always projects positively, since the
    // resultant's own x-component is drag's x-component (gravity has none)
    // -- still dominates. Only once the fall builds does the vertical term
    // take over and the projection go negative. Measured here: apex at row
    // 83, flip at row 84.
    expect(flipRow).toBeGreaterThanOrEqual(apexRow);
    expect(flipRow - apexRow).toBeLessThanOrEqual(2);
  });

  it("a diverged solve yields NaN shares, not a tidy zero that would fake closure", () => {
    // The dust grain under explicit RK4 at h=0.01 is past the stability
    // limit and overflows. Zeroing the shares there would report
    // Σ share = 0 against |ΣF| = Infinity — a broken identity dressed up
    // as a satisfied one — so the module refuses to decompose instead.
    const { model, ctx, forces, trajectory } = solve(DUST_GRAIN);
    const series = computeForceShareSeries(model, forces, trajectory, ctx);

    const diverged = [...series.resultantMagnitude].filter((m) => !Number.isFinite(m));
    expect(diverged.length).toBeGreaterThan(0);

    const row = series.resultantMagnitude.findIndex((m) => !Number.isFinite(m));
    for (const band of series.bands) {
      expect(Number.isNaN(band.share[row]!)).toBe(true);
    }
    expect(Number.isNaN(forceShareClosureResidual(series))).toBe(true);
  });

  it("magnitude and share diverge at terminal velocity: gravity's share collapses to 0 while |F_g| stays mg (dust grain)", () => {
    // The case the ForceShareBand.magnitude doc calls out. Once the grain
    // reaches terminal velocity the resultant is purely horizontal, so
    // gravity — still pulling at full strength — projects to nothing.
    const { model, ctx, forces, trajectory } = solveStiff(DUST_GRAIN);
    const series = computeForceShareSeries(model, forces, trajectory, ctx);
    const gravity = series.bands.find((b) => b.id === "gravity")!;

    const weight = ctx.params.mass * ctx.env.g;
    expect(weight).toBeGreaterThan(0);

    // |F_g| is constant at mg across the whole flight...
    for (let i = 0; i < gravity.magnitude.length; i++) {
      expect(gravity.magnitude[i]!).toBeCloseTo(weight, 20);
    }

    // ...while its share has collapsed by the final row.
    const last = series.t.length - 1;
    expect(Math.abs(gravity.share[last]!)).toBeLessThan(weight * 1e-6);
  });

  it("a Magnus band is present and non-trivial when spin is wired (golf drive)", () => {
    const { model, ctx, forces, trajectory } = solve(GOLF_DRIVE);
    const series = computeForceShareSeries(model, forces, trajectory, ctx);

    const magnus = series.bands.find((b) => b.id === "magnus");
    expect(magnus).toBeDefined();
    expect(magnus!.share.some((v) => Math.abs(v) > 0)).toBe(true);
  });
});

describe("stacking layout", () => {
  it("each band's height is |share|, with lower <= upper even for a negative share", () => {
    const { model, ctx, forces, trajectory } = solve(GOLF_DRIVE);
    const series = computeForceShareSeries(model, forces, trajectory, ctx);

    for (const band of series.bands) {
      for (let i = 0; i < band.share.length; i++) {
        expect(band.lower[i]!).toBeLessThanOrEqual(band.upper[i]!);
        expect(band.upper[i]! - band.lower[i]!).toBeCloseTo(Math.abs(band.share[i]!), 12);
      }
    }
  });

  it("the diverging stack's net top equals |ΣF| — sign-splitting reorders but never drops a term", () => {
    const { model, ctx, forces, trajectory } = solve(SHOT_PUT);
    const series = computeForceShareSeries(model, forces, trajectory, ctx);

    for (let i = 0; i < series.t.length; i++) {
      let positiveTop = 0;
      let negativeBottom = 0;
      for (const band of series.bands) {
        const value = band.share[i]!;
        if (value >= 0) positiveTop += value;
        else negativeBottom += value;
      }
      expect(Math.abs(positiveTop + negativeBottom - series.resultantMagnitude[i]!)).toBeLessThan(
        1e-12,
      );
    }
  });

  it("bands of the same sign do not overlap and are contiguous at a given row", () => {
    const { model, ctx, forces, trajectory } = solve(GOLF_DRIVE);
    const series = computeForceShareSeries(model, forces, trajectory, ctx);

    const row = Math.floor(series.t.length / 2);
    let positiveCursor = 0;
    let negativeCursor = 0;
    for (const band of series.bands) {
      const value = band.share[row]!;
      if (value >= 0) {
        expect(band.lower[row]!).toBeCloseTo(positiveCursor, 12);
        positiveCursor += value;
        expect(band.upper[row]!).toBeCloseTo(positiveCursor, 12);
      } else {
        expect(band.upper[row]!).toBeCloseTo(negativeCursor, 12);
        negativeCursor += value;
        expect(band.lower[row]!).toBeCloseTo(negativeCursor, 12);
      }
    }
  });

  it("the value range always contains zero, the baseline the stack is measured from", () => {
    const { model, ctx, forces, trajectory } = solve(SHOT_PUT);
    const series = computeForceShareSeries(model, forces, trajectory, ctx);
    const range = computeForceShareValueRange(series);

    expect(range.min).toBeLessThanOrEqual(0);
    expect(range.max).toBeGreaterThanOrEqual(0);
    expect(range.max).toBeGreaterThan(range.min);
  });
});

describe("resultantMagnitudeSeries / drawForceShareStack", () => {
  it("exposes |ΣF| verbatim as a PlotSeries, sharing the trajectory's own time array", () => {
    const { model, ctx, forces, trajectory } = solve(SHOT_PUT);
    const series = computeForceShareSeries(model, forces, trajectory, ctx);
    const plot = resultantMagnitudeSeries(series);

    expect(plot.unit).toBe("N");
    expect(plot.t).toBe(series.t);
    expect(plot.values).toBe(series.resultantMagnitude);
  });

  it("fills one closed polygon per band and strokes the resultant only when asked", () => {
    const { model, ctx, forces, trajectory } = solve(SHOT_PUT, 0.5, 0.05);
    const series = computeForceShareSeries(model, forces, trajectory, ctx);
    const layout = { x: 0, y: 0, width: 200, height: 100 };

    const calls: string[] = [];
    const canvas: ForceShareCanvas = {
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 0,
      beginPath: () => calls.push("begin"),
      moveTo: () => calls.push("move"),
      lineTo: () => calls.push("line"),
      closePath: () => calls.push("close"),
      fill: () => calls.push("fill"),
      stroke: () => calls.push("stroke"),
    };

    drawForceShareStack(canvas, series, layout);
    expect(calls.filter((c) => c === "fill")).toHaveLength(series.bands.length);
    expect(calls.filter((c) => c === "close")).toHaveLength(series.bands.length);
    expect(calls).not.toContain("stroke");

    calls.length = 0;
    drawForceShareStack(canvas, series, layout, { resultantColor: "#212529" });
    expect(calls.filter((c) => c === "stroke")).toHaveLength(1);
  });

  it("draws nothing for an empty series rather than throwing", () => {
    const empty: ForceShareSeries = {
      t: new Float64Array(0),
      bands: [],
      resultantMagnitude: new Float64Array(0),
      unit: "N",
    };
    const calls: string[] = [];
    const canvas: ForceShareCanvas = {
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 0,
      beginPath: () => calls.push("begin"),
      moveTo: () => calls.push("move"),
      lineTo: () => calls.push("line"),
      closePath: () => calls.push("close"),
      fill: () => calls.push("fill"),
      stroke: () => calls.push("stroke"),
    };

    expect(() =>
      drawForceShareStack(canvas, empty, { x: 0, y: 0, width: 10, height: 10 }),
    ).not.toThrow();
    expect(calls).toHaveLength(0);
    expect(forceShareClosureResidual(empty)).toBe(0);
  });
});
