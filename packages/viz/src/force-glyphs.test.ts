import { describe, expect, it } from "vitest";
import { PRESET_SCENARIOS } from "@ballista/engine";
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
  computeForceGlyphs,
  createForceGlyphScratch,
  DEFAULT_FORCE_GLYPH_SCALE,
  forceGlyphLegendTicks,
  forceGlyphsAtPlayhead,
  logScaleGlyphLength,
  worldForceDirectionToScreen,
} from "./force-glyphs.js";

/** cos/sin of the angle between (ax,ay) and (bx,by), via the normalized dot/cross -- scale-invariant, so a tiny-magnitude force (e.g. the dust grain's) is checked exactly as strictly as a large one. */
function normalizedDot(ax: number, ay: number, bx: number, by: number): number {
  const denom = Math.hypot(ax, ay) * Math.hypot(bx, by);
  return denom === 0 ? 0 : (ax * bx + ay * by) / denom;
}
function normalizedCross(ax: number, ay: number, bx: number, by: number): number {
  const denom = Math.hypot(ax, ay) * Math.hypot(bx, by);
  return denom === 0 ? 0 : (ax * by - ay * bx) / denom;
}

const SHOT_PUT = PRESET_SCENARIOS.find((s) => s.projectile.id === "shot-put")!;
const GOLF_DRIVE = PRESET_SCENARIOS.find((s) => s.model.forceIds.includes("magnus"))!;
const DUST_GRAIN = PRESET_SCENARIOS.find((s) => s.model.forceIds.includes("drag-linear"))!;

describe("computeForceGlyphs: glyph directions verified against rhs (P3.14 validation criterion)", () => {
  for (const [label, preset] of [
    ["shot put (gravity + quadratic drag)", SHOT_PUT],
    ["golf drive (gravity + quadratic drag + Magnus)", GOLF_DRIVE],
    ["dust grain (gravity + linear drag)", DUST_GRAIN],
  ] as const) {
    it(`${label}: gravity straight down, drag antiparallel to v_rel, Magnus (if present) perpendicular, sum == resultant == rhs`, () => {
      const { model, ctx, y0, forces } = resolveModel(preset);
      const scratch = createForceGlyphScratch(model.dim);

      const t = 0;
      const glyphSet = computeForceGlyphs(model, forces, t, y0, ctx, scratch);

      // Gravity is exactly straight down: no horizontal component, and its
      // magnitude is exactly m*g (ctx.env.g was refreshed by the rhs call
      // computeForceGlyphs makes internally).
      const gravity = glyphSet.forces.find((f) => f.id === "gravity")!;
      expect(gravity.fx).toBe(0);
      expect(gravity.fy).toBeCloseTo(-ctx.params.mass * ctx.env.g, 10);

      // Drag (whichever kind is wired) is antiparallel to v_rel: normalized
      // cross ~0 (parallel line) and normalized dot ~ -1 (opposite sense).
      const drag = glyphSet.forces.find((f) => f.id.startsWith("drag-"))!;
      expect(drag).toBeDefined();
      const dragCross = normalizedCross(drag.fx, drag.fy, ctx.vRel[0]!, ctx.vRel[1]!);
      const dragDot = normalizedDot(drag.fx, drag.fy, ctx.vRel[0]!, ctx.vRel[1]!);
      expect(Math.abs(dragCross)).toBeLessThan(1e-9);
      expect(dragDot).toBeCloseTo(-1, 9);

      // Magnus, when wired, is perpendicular to v_rel: normalized dot ~0.
      const magnus = glyphSet.forces.find((f) => f.id === "magnus");
      if (magnus) {
        const magnusDot = normalizedDot(magnus.fx, magnus.fy, ctx.vRel[0]!, ctx.vRel[1]!);
        expect(Math.abs(magnusDot)).toBeLessThan(1e-9);
      }

      // Every individual force sums exactly to the resultant...
      const sumFx = glyphSet.forces.reduce((sum, f) => sum + f.fx, 0);
      const sumFy = glyphSet.forces.reduce((sum, f) => sum + f.fy, 0);
      expect(sumFx).toBeCloseTo(glyphSet.resultant.fx, 10);
      expect(sumFy).toBeCloseTo(glyphSet.resultant.fy, 10);

      // ...and the resultant, divided by mass, is exactly what model.rhs
      // reports as the acceleration (this task's "verified against rhs").
      const rhsOut = new Float64Array(model.dim);
      model.rhs(t, y0, rhsOut, ctx);
      expect(rhsOut[2]).toBeCloseTo(glyphSet.resultant.fx / ctx.params.mass, 10);
      expect(rhsOut[3]).toBeCloseTo(glyphSet.resultant.fy / ctx.params.mass, 10);
    });
  }

  it("a force absent from the wired set (e.g. Magnus on a non-Magnus preset) never appears in the glyph list", () => {
    const { model, ctx, y0, forces } = resolveModel(SHOT_PUT);
    const scratch = createForceGlyphScratch(model.dim);
    const glyphSet = computeForceGlyphs(model, forces, 0, y0, ctx, scratch);
    expect(glyphSet.forces.some((f) => f.id === "magnus")).toBe(false);
  });

  it("repeated calls do not accumulate state in the caller-owned scratch (zero-alloc-style reuse)", () => {
    const { model, ctx, y0, forces } = resolveModel(SHOT_PUT);
    const scratch = createForceGlyphScratch(model.dim);

    const first = computeForceGlyphs(model, forces, 0, y0, ctx, scratch);
    const second = computeForceGlyphs(model, forces, 0, y0, ctx, scratch);

    expect(second.resultant.fx).toBe(first.resultant.fx);
    expect(second.resultant.fy).toBe(first.resultant.fy);
  });
});

describe("forceGlyphsAtPlayhead: badge equals |F| channel at playhead (P3.22 validation criterion)", () => {
  it("at a playbackTime exactly on a recorded row, reproduces computeForceGlyphs run directly on that row's own channels", () => {
    const { model, ctx, y0, forces } = resolveModel(GOLF_DRIVE);
    const stepper: Stepper = new HermiteDenseOutputStepper(new ClassicalRK4Stepper());
    const cfg: SolverConfig = { stepper: "classical-rk4", h: 0.01, maxSteps: 100_000 };
    const recorder = new TrajectoryRecorder();
    integrate(model, ctx, y0, [0, 2], cfg, stepper, [recorder]);
    const trajectory = recorder.trajectory;

    expect(trajectory.nSteps).toBeGreaterThan(10);
    const rowIndex = Math.floor(trajectory.nSteps / 3);
    const playbackTime = trajectory.t[rowIndex]!;

    const scratchA = createForceGlyphScratch(model.dim);
    const viaPlayhead = forceGlyphsAtPlayhead(
      model,
      forces,
      trajectory,
      playbackTime,
      ctx,
      scratchA,
    );

    const rowState = new Float64Array([
      trajectory.channels[0]![rowIndex]!,
      trajectory.channels[1]![rowIndex]!,
      trajectory.channels[2]![rowIndex]!,
      trajectory.channels[3]![rowIndex]!,
    ]);
    const scratchB = createForceGlyphScratch(model.dim);
    const direct = computeForceGlyphs(model, forces, playbackTime, rowState, ctx, scratchB);

    expect(viaPlayhead).toEqual(direct);
  });

  it("a playbackTime between recorded rows snaps to (never interpolates past) the nearer row's exact magnitude", () => {
    const { model, ctx, y0, forces } = resolveModel(SHOT_PUT);
    const stepper: Stepper = new HermiteDenseOutputStepper(new ClassicalRK4Stepper());
    const cfg: SolverConfig = { stepper: "classical-rk4", h: 0.05, maxSteps: 100_000 };
    const recorder = new TrajectoryRecorder();
    integrate(model, ctx, y0, [0, 2], cfg, stepper, [recorder]);
    const trajectory = recorder.trajectory;

    const rowIndex = 5;
    const nearTime = trajectory.t[rowIndex]! + 1e-4; // well within [t[5], t[6]), closer to row 5

    const scratch = createForceGlyphScratch(model.dim);
    const glyphSet = forceGlyphsAtPlayhead(model, forces, trajectory, nearTime, ctx, scratch);

    const rowState = new Float64Array([
      trajectory.channels[0]![rowIndex]!,
      trajectory.channels[1]![rowIndex]!,
      trajectory.channels[2]![rowIndex]!,
      trajectory.channels[3]![rowIndex]!,
    ]);
    const directScratch = createForceGlyphScratch(model.dim);
    const direct = computeForceGlyphs(
      model,
      forces,
      trajectory.t[rowIndex]!,
      rowState,
      ctx,
      directScratch,
    );

    expect(glyphSet.resultant.magnitude).toBe(direct.resultant.magnitude);
    for (const glyph of glyphSet.forces) {
      const directGlyph = direct.forces.find((f) => f.id === glyph.id)!;
      expect(glyph.magnitude).toBe(directGlyph.magnitude);
    }
  });
});

describe("logScaleGlyphLength", () => {
  it("maps exactly 0 magnitude to 0 length (nothing to draw)", () => {
    expect(logScaleGlyphLength(0)).toBe(0);
    expect(logScaleGlyphLength(-1)).toBe(0);
  });

  it("clamps to [minLengthPx, maxLengthPx] outside the configured magnitude range", () => {
    expect(logScaleGlyphLength(1e-9)).toBe(DEFAULT_FORCE_GLYPH_SCALE.minLengthPx);
    expect(logScaleGlyphLength(1e9)).toBe(DEFAULT_FORCE_GLYPH_SCALE.maxLengthPx);
  });

  it("is monotonically increasing with magnitude", () => {
    const magnitudes = [1e-3, 1e-2, 1e-1, 1, 10, 100, 1000, 1e4];
    const lengths = magnitudes.map((m) => logScaleGlyphLength(m));
    for (let i = 1; i < lengths.length; i++) {
      expect(lengths[i]!).toBeGreaterThanOrEqual(lengths[i - 1]!);
    }
  });

  it("maps equal magnitude ratios to equal length increments (true log scale, not linear)", () => {
    // Each successive magnitude is 10x the last -- a log scale spaces these
    // evenly; a linear scale would not.
    const l1 = logScaleGlyphLength(1);
    const l2 = logScaleGlyphLength(10);
    const l3 = logScaleGlyphLength(100);
    expect(l2 - l1).toBeCloseTo(l3 - l2, 10);
  });
});

describe("forceGlyphLegendTicks", () => {
  it("returns ticks spanning the configured magnitude range with matching lengths", () => {
    const ticks = forceGlyphLegendTicks();
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks[0]!.magnitude).toBeCloseTo(DEFAULT_FORCE_GLYPH_SCALE.minMagnitude, 12);
    expect(ticks.at(-1)!.magnitude).toBeCloseTo(DEFAULT_FORCE_GLYPH_SCALE.maxMagnitude, 6);
    for (const tick of ticks) {
      expect(tick.lengthPx).toBeCloseTo(logScaleGlyphLength(tick.magnitude), 10);
    }
  });
});

describe("worldForceDirectionToScreen", () => {
  it("preserves x, flips y (world y-up -> screen y-down)", () => {
    expect(worldForceDirectionToScreen(1, 0)).toEqual({ dx: 1, dy: -0 });
    const { dx, dy } = worldForceDirectionToScreen(0, -1);
    expect(dx).toBe(0);
    expect(dy).toBe(1);
  });

  it("normalizes to a unit vector", () => {
    const { dx, dy } = worldForceDirectionToScreen(3, 4);
    expect(Math.hypot(dx, dy)).toBeCloseTo(1, 12);
  });

  it("maps zero magnitude to (0, 0)", () => {
    expect(worldForceDirectionToScreen(0, 0)).toEqual({ dx: 0, dy: 0 });
  });
});
