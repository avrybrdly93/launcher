/**
 * P5.20's validation criterion is "two-arc basins render; boundary fractal-ish
 * structure noted". The last describe block is that criterion, measured on real
 * `newtonShooting` solves.
 *
 * **The measurement contradicts half of the criterion's wording, and the
 * contradiction is the finding.** The boundary between the two basins is not
 * fractal-ish for the solver this repo actually ships; it is a single smooth
 * curve, and the numbers below say so to three digits. It *is* fractal-ish for
 * an unguarded Newton — which is what P5.06's truncated-SVD step exists to
 * avoid, so the smoothness is that design decision showing up in a picture.
 * Both are tested, because a criterion is worth more when the test can tell you
 * which way it came out than when it can only agree.
 *
 * The synthetic tests come first and pin the grid arithmetic to cases whose
 * answers are countable by hand. A test that only ever sees a real sweep cannot
 * tell "the boundary counter is right" from "the solver happened to converge".
 */

import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  G_STD,
  GravityForce,
  QuadraticDragForce,
  UniformGravity,
  UniformWind,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
} from "@ballista/engine";
import { createDormandPrince54Stepper } from "@ballista/solverkit";
import { describe, expect, it } from "vitest";
import {
  boundaryFraction,
  censusOf,
  hasTwoArcBasins,
  linearSamples,
  rangeSlopeAt,
  refineBoundaryFraction,
  sweepBasins,
  type BasinCell,
  type BasinGrid,
  type BasinOutcome,
} from "./basin-of-attraction.js";
import { PLANAR_LAYOUT } from "./observables.js";
import { type Aim, type ShootingProblem, createShootingResidual } from "./shooting-residual.js";
import type { PointTarget } from "./targets.js";

const GLYPHS: Record<string, BasinOutcome> = {
  L: "low",
  H: "high",
  ".": "unconverged",
  x: "failed",
};

/** Builds a {@link BasinGrid} from a picture of it, one string per row. */
function gridOf(...rows: readonly string[]): BasinGrid {
  const outcomes = rows.map((row) => [...row].map((glyph) => GLYPHS[glyph]!));
  const cells: BasinCell[] = [];
  outcomes.forEach((row, rowIndex) =>
    row.forEach((outcome, column) =>
      cells.push({
        column,
        row: rowIndex,
        start: { theta: column, speed: rowIndex },
        outcome,
        solution: null,
        downrangeMiss: null,
        rangeSlope: null,
        iterations: 0,
      }),
    ),
  );
  return {
    thetas: outcomes[0]!.map((_, index) => index),
    speeds: outcomes.map((_, index) => index),
    outcomes,
    cells,
    evaluations: 0,
  };
}

describe("linearSamples", () => {
  it("includes both endpoints", () => {
    expect(linearSamples({ min: 0, max: 1, samples: 5 })).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it("lands on the requested upper bound exactly, not one ulp below it", () => {
    // Assigned rather than accumulated: 0.1 * 3 is not 0.3 in binary, and a
    // caller comparing the last sample against its own bound would be surprised.
    const samples = linearSamples({ min: 0, max: 0.3, samples: 4 });

    expect(samples[3]).toBe(0.3);
  });

  it("rejects a degenerate or inverted axis rather than producing NaN", () => {
    expect(() => linearSamples({ min: 0, max: 1, samples: 1 })).toThrow(/samples must be/);
    expect(() => linearSamples({ min: 1, max: 0, samples: 5 })).toThrow(/max must exceed min/);
    expect(() => linearSamples({ min: 0, max: Number.NaN, samples: 5 })).toThrow(/finite/);
  });
});

describe("censusOf", () => {
  it("counts every outcome and totals to the cell count", () => {
    const census = censusOf(gridOf("LLH", "L.x"));

    expect(census).toEqual({ low: 3, high: 1, unconverged: 1, failed: 1, total: 6 });
  });
});

describe("hasTwoArcBasins", () => {
  it("is true only when both arcs claimed ground", () => {
    expect(hasTwoArcBasins(gridOf("LLH"))).toBe(true);
    expect(hasTwoArcBasins(gridOf("LLL"))).toBe(false);
    expect(hasTwoArcBasins(gridOf("HH."))).toBe(false);
  });
});

describe("boundaryFraction", () => {
  it("counts a cell as boundary when a 4-neighbour carries the other label", () => {
    // One vertical seam down the middle of a 4x4: two cells per row touch it,
    // so 8 of 16 labelled cells are on the boundary.
    expect(boundaryFraction(gridOf("LLHH", "LLHH", "LLHH", "LLHH"))).toBeCloseTo(0.5, 12);
  });

  it("is zero for a map with no boundary at all", () => {
    expect(boundaryFraction(gridOf("LLL", "LLL"))).toBe(0);
  });

  it("ignores diagonal neighbours, so a corner touch is not a boundary", () => {
    // The two H cells meet the L block only diagonally.
    expect(boundaryFraction(gridOf("LL.", "L..", "..H"))).toBe(0);
  });

  it("excludes unconverged and failed cells from both numerator and denominator", () => {
    // The point of the exclusion: a band of failures along the edge of the
    // reachable set must not be able to masquerade as basin structure.
    const grid = gridOf("LLxx", "LL..");

    // Four labelled cells, none adjacent to a differently-labelled arc cell.
    expect(boundaryFraction(grid)).toBe(0);
  });

  it("has nothing to report when no cell converged", () => {
    expect(boundaryFraction(gridOf("..", "xx"))).toBe(0);
  });
});

describe("rangeSlopeAt", () => {
  const aim: Aim = { theta: 0.5, speed: 60 };

  it("differences downrange in theta at fixed speed", () => {
    // R(θ) = 100 θ, so the slope is 100 whatever the step is.
    const slope = rangeSlopeAt((at) => 100 * at.theta, aim, 1e-3);

    expect(slope).toBeCloseTo(100, 9);
  });

  it("holds the speed fixed, so a speed-dependent range does not leak in", () => {
    const slope = rangeSlopeAt((at) => 100 * at.theta + 7 * at.speed, aim, 1e-3);

    expect(slope).toBeCloseTo(100, 9);
  });

  it("reports no measurement rather than falling back to a one-sided difference", () => {
    // A one-sided difference is biased O(h) instead of O(h²), and the only use
    // of this number is the sign of a quantity passing through zero nearby.
    const slope = rangeSlopeAt(
      (at) => (at.theta > aim.theta ? undefined : 100 * at.theta),
      aim,
      1e-3,
    );

    expect(slope).toBeUndefined();
  });
});

// --------------------------------------------------------------------------
// The criterion, on real solves.
// --------------------------------------------------------------------------

const TOL = { stepper: "dopri5" as const, rtol: 1e-10, atol: 1e-12, maxSteps: 200_000 };

/** Matches the inner solve's tolerance, per `JacobianOptions.noiseFloor`. */
const NOISE_FLOOR = 1e-10;

function context(dragCoefficient: number, wind: number) {
  return createEvalContext(
    new Environment(
      new ConstantAtmosphere(),
      new UniformGravity(G_STD, false),
      wind === 0 ? new ZeroWind() : new UniformWind(wind),
    ),
    createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(dragCoefficient),
    }),
  );
}

function problem(target: PointTarget, dragCoefficient: number, wind = 0): ShootingProblem {
  const forces =
    dragCoefficient === 0 ? [new GravityForce()] : [new GravityForce(), new QuadraticDragForce()];
  return {
    model: createPlanarProjectileModel(forces),
    ctx: context(dragCoefficient, wind),
    target,
    config: TOL,
    stepper: createDormandPrince54Stepper(),
    tspan: [0, 120],
    layout: PLANAR_LAYOUT,
  };
}

describe("basins of a real Newton shooting solve (P5.20 criterion)", () => {
  const DOWNRANGE = 140;
  const residual = createShootingResidual(
    problem({ kind: "point", center: [DOWNRANGE, 0] }, 0.47, 5),
  );

  const THETA_AXIS = { min: 0.05, max: 1.5 } as const;
  const SPEED_AXIS = { min: 40, max: 80 } as const;
  const LEVELS = [9, 17, 33] as const;

  /**
   * Boundary cells *per row* — the scale-free form of {@link boundaryFraction}.
   *
   * An `n x n` grid has `n²` cells, so a boundary covered by `k` cells in each
   * of `n` rows has fraction `kn/n² = k/n`. Multiplying back by `n` therefore
   * reports `k` directly, and `k` is what distinguishes the two cases: a single
   * smooth curve crossed once per row gives a constant `k = 2` (the pair of
   * cells straddling it), while a boundary that keeps revealing detail as the
   * cells shrink gives a `k` that grows with `n`.
   */
  function boundaryCellsPerRow(rankTolerance?: number): number[] {
    const refinements = refineBoundaryFraction(
      residual,
      DOWNRANGE,
      THETA_AXIS,
      SPEED_AXIS,
      LEVELS,
      {
        newton: {
          jacobian: { noiseFloor: NOISE_FLOOR },
          ...(rankTolerance === undefined ? {} : { rankTolerance }),
        },
      },
    );
    // Every level must have had both basins to measure a boundary between.
    for (const level of refinements) expect(level.labelled).toBeGreaterThan(0);
    return refinements.map((level) => level.samples * level.fraction);
  }

  it("renders two arc basins, with every cell of a reachable grid accounted for", () => {
    const grid = sweepBasins(
      residual,
      DOWNRANGE,
      { ...THETA_AXIS, samples: 17 },
      { ...SPEED_AXIS, samples: 17 },
      { newton: { jacobian: { noiseFloor: NOISE_FLOOR } } },
    );
    const census = censusOf(grid);

    // Measured: 136 low, 153 high, nothing unconverged or failed.
    expect(census.total).toBe(17 * 17);
    expect(census.low).toBeGreaterThan(0);
    expect(census.high).toBeGreaterThan(0);
    expect(census.failed).toBe(0);
    expect(census.unconverged).toBe(0);
    // Neither basin is a sliver: the map is genuinely two regions.
    expect(census.low / census.total).toBeGreaterThan(0.25);
    expect(census.high / census.total).toBeGreaterThan(0.25);
  });

  it("labels the low basin below the high one in elevation, at fixed speed", () => {
    const grid = sweepBasins(
      residual,
      DOWNRANGE,
      { ...THETA_AXIS, samples: 9 },
      { ...SPEED_AXIS, samples: 9 },
      { newton: { jacobian: { noiseFloor: NOISE_FLOOR } } },
    );

    // The physical claim behind the colours: within any row, every "low" cell
    // starts from a shallower guess than every "high" cell. A swap of the two
    // labels could not pass this, because it is checked against the elevation
    // ordering rather than against the sign convention that produced it.
    for (const speed of grid.speeds) {
      const row = grid.cells.filter((cell) => cell.start.speed === speed);
      const lows = row.filter((cell) => cell.outcome === "low").map((cell) => cell.start.theta);
      const highs = row.filter((cell) => cell.outcome === "high").map((cell) => cell.start.theta);
      if (lows.length === 0 || highs.length === 0) continue;
      expect(Math.max(...lows)).toBeLessThan(Math.min(...highs));
    }
  });

  it("solves each cell to the target downrange, so a colour means a real solution", () => {
    const grid = sweepBasins(
      residual,
      DOWNRANGE,
      { ...THETA_AXIS, samples: 9 },
      { ...SPEED_AXIS, samples: 9 },
      { newton: { jacobian: { noiseFloor: NOISE_FLOOR } } },
    );

    for (const cell of grid.cells) {
      if (cell.outcome !== "low" && cell.outcome !== "high") continue;
      expect(Math.abs(cell.downrangeMiss!)).toBeLessThanOrEqual(1e-3);
      // The label is the sign of this, so it must not be a rounding artefact.
      expect(Math.abs(cell.rangeSlope!)).toBeGreaterThan(1);
    }
  });

  /**
   * **The "boundary fractal-ish structure noted" half, and it comes out the
   * other way.** Measured `boundaryCellsPerRow` for the shipped solver:
   *
   *     n =  9  ->  2.000   (fraction 0.222222 = 2/9)
   *     n = 17  ->  2.000   (fraction 0.117647 = 2/17)
   *     n = 33  ->  2.000   (fraction 0.060606 = 2/33)
   *
   * Exactly two boundary cells per row at every refinement: the pair that
   * straddles a single curve crossed once. There is no structure at the finer
   * scales to find, because there is nothing there but a curve — the locus of
   * starting guesses whose elevation sits on the maximum-range angle.
   */
  it("has a smooth boundary — two cells per row at every refinement, not a fractal", () => {
    const measured = boundaryCellsPerRow();

    for (const perRow of measured) expect(perRow).toBeCloseTo(2, 6);
  });

  /**
   * **Where the fractal-ish structure the criterion expected actually lives.**
   * Set `rankTolerance` below the ground-impact rank deficiency (which P5.05
   * measured at around `1e-11`) and the near-null singular value is retained
   * rather than truncated, so the step divides by a pivot of order `1e-11` and
   * the iterate is thrown an arbitrary distance along the null direction. Same
   * problem, same grid, same labels — only the solver's globalization changes.
   * Measured `boundaryCellsPerRow`:
   *
   *     n =  9  ->  1.823
   *     n = 17  ->  2.556
   *     n = 33  ->  3.432
   *
   * Growing rather than constant: each refinement finds boundary the coarser
   * grid had averaged away, which is the signature the criterion was reaching
   * for. Speckle appears in the map too — isolated cells of the opposite label
   * well inside the other basin.
   *
   * This is a *scaling observation over three levels*, not a box-counting
   * dimension, and it is deliberately not reported as one (§8.4). What it does
   * establish is the comparison: the shipped solver's boundary is flat at 2.000
   * across the same three levels, so the difference between the two rows of
   * numbers is attributable to the truncation and to nothing else in the setup.
   */
  it("does develop a structured boundary once the rank truncation is disabled", () => {
    const measured = boundaryCellsPerRow(1e-14);

    // Strictly growing with refinement — the property that distinguishes it
    // from a curve, asserted rather than the individual values, which carry
    // the solver's chaotic detail and should not be pinned to three digits.
    expect(measured[1]!).toBeGreaterThan(measured[0]!);
    expect(measured[2]!).toBeGreaterThan(measured[1]!);
    // And by the finest level it is well clear of the smooth case's 2.
    expect(measured[2]!).toBeGreaterThan(2.5);
  });
});
