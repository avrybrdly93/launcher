import { newtonShooting, type NewtonShootingOptions } from "./newton-shooting.js";
import { PLANAR_LAYOUT, type TrajectoryLayout } from "./observables.js";
import type { Aim, ResidualFunction } from "./shooting-residual.js";

/**
 * Basins of attraction for P5.06's Newton shooting solve (P5.20): sweep a grid
 * of *initial guesses*, run the solver from each, and label the cell by which
 * of the two arcs it landed on.
 *
 * **What the picture is actually of.** P5.08 established that a reachable
 * target is hit by two aims — a flat, fast **low** arc and a lofted **high**
 * one. Newton's method does not choose between them on merit; it converges to
 * whichever root the starting guess happens to fall into the neighbourhood of.
 * The map from starting guess to converged root is the basin structure, and it
 * is the honest answer to "why did the solver give me *that* shot?" — the
 * initializer (P5.07) is what decides, not the solver.
 *
 * **The classification rule, and why it is not a second solve.** A converged
 * aim `(θ*, v*)` is on the low branch iff downrange is still *increasing* in
 * elevation there:
 *
 *     ∂R/∂θ (θ*, v*) > 0  ⟹  low        ∂R/∂θ (θ*, v*) < 0  ⟹  high
 *
 * because the branch boundary *is* the maximum-range elevation, the point where
 * that derivative changes sign — the same peak {@link locatePeakAngle} spends a
 * 24-sample sweep plus a refinement to find. Reading the sign at the converged
 * aim is therefore the definition of the label rather than an approximation of
 * it, and it costs one central difference (two residual evaluations) per cell
 * instead of a full {@link solveArcs} per cell. On a 21×21 grid that is the
 * difference between roughly 900 extra integrations and roughly 20 000.
 *
 * The derivative is taken **at fixed speed**, which is the only reading that
 * means anything: "low" and "high" are the two roots of `R(θ; v) = R*` at one
 * speed, so the branch a point sits on is a statement about the `θ` direction
 * alone. It is also why {@link BasinCell} reports the converged *speed* — the
 * rank deficiency (P5.05) means the solver may have moved `v₀` on the way, so
 * the cell's own label is about a different speed than its neighbour's, and a
 * reader comparing two cells needs to see that.
 *
 * **Ground-impact shots make "converged" a narrower word than usual.** The
 * shooting Jacobian's vertical row is zero for every aim, so against a target
 * *above* the ground the vertical miss cannot be nulled by any aim and the
 * solver's expected terminal state is `"stalled"` with a residual that is
 * honestly non-zero — see {@link NewtonShootingStatus}. A basin map of such a
 * problem would be a uniform sheet of failures and would show nothing. So the
 * label a cell gets is driven by the **downrange** miss against
 * {@link BasinOptions.downrangeTolerance}, not by
 * {@link NewtonShootingResult.converged}: a solve that nulled the reachable
 * component of `F` has found its root in the only sense this problem has one.
 *
 * **The fractal-ish boundary is measured, not asserted.** P5.20's criterion
 * asks that the boundary structure be *noted*; a sentence in a doc comment is
 * not a note, it is a claim. {@link refineBoundaryFraction} measures the share
 * of cells that touch a differently-labelled neighbour as the grid is refined.
 * A smooth boundary curve is a one-dimensional set in a two-dimensional grid,
 * so its cell count grows like `n` against `n²` cells and the fraction falls
 * like `1/n`; a boundary with structure at every scale keeps finding new
 * detail as `n` grows and the fraction falls more slowly, or not at all.
 * `basin-of-attraction.test.ts` reports both numbers rather than asserting a
 * fractal dimension, because one refinement pair is a measurement and not a
 * proof, and claiming otherwise would be exactly the overreach §8.4 warns of.
 */

/**
 * What one starting guess converged to.
 *
 * The two failure outcomes are kept apart because they mean different things
 * to a reader of the map. `"unconverged"` is a solve that ran and did not get
 * the downrange miss down — a genuine feature of the basin structure, usually
 * a starting guess sitting on the boundary. `"failed"` is a solve that could
 * not be evaluated at all, which says the *grid* strays outside the reachable
 * set and is a statement about the axes, not about Newton.
 */
export type BasinOutcome = "low" | "high" | "unconverged" | "failed";

/** One grid cell: a starting guess and what the solver did with it. */
export interface BasinCell {
  /** Column index into {@link BasinGrid.thetas}. */
  readonly column: number;
  /** Row index into {@link BasinGrid.speeds}. */
  readonly row: number;
  /** The starting guess this cell was solved from. */
  readonly start: Aim;
  /** Which arc it landed on, or why it did not. See {@link BasinOutcome}. */
  readonly outcome: BasinOutcome;
  /** The converged aim. `null` when {@link outcome} is `"failed"`. */
  readonly solution: Aim | null;
  /**
   * Signed downrange miss at {@link solution}, metres — negative short,
   * positive long. `null` when the solve could not be evaluated.
   *
   * Reported rather than thresholded away so a caller can see *how* close an
   * `"unconverged"` cell got; a cell that missed by a millimetre and one that
   * missed by a kilometre are both outside tolerance and are not the same.
   */
  readonly downrangeMiss: number | null;
  /**
   * `∂R/∂θ` at {@link solution}, m/rad — the quantity whose sign is the label.
   * `null` when there is no converged aim to differentiate at.
   *
   * Near the branch boundary this goes to zero, which is the analytic reason
   * the labels are least trustworthy exactly where the picture is most
   * interesting. A caller drawing the map can use `|∂R/∂θ|` as a confidence.
   */
  readonly rangeSlope: number | null;
  /** Newton iterations spent. */
  readonly iterations: number;
}

/** Axis definition for one side of the starting-guess grid. */
export interface BasinAxis {
  /** Inclusive lower bound. */
  readonly min: number;
  /** Inclusive upper bound. */
  readonly max: number;
  /** Number of samples, at least 2. Endpoints included. */
  readonly samples: number;
}

/** Tuning for {@link sweepBasins}. */
export interface BasinOptions {
  /**
   * Downrange miss, metres, below which a cell counts as having found its
   * root. Default `1e-3` — a millimetre, far tighter than any target and far
   * looser than {@link NewtonShootingOptions.residualTolerance}'s default.
   *
   * The gap is deliberate: this threshold is asked to accept a solve whose
   * *vertical* residual is irreducible (see the module docstring), and reusing
   * the solver's own tolerance would reject exactly the solves the map is made
   * of.
   */
  readonly downrangeTolerance?: number;
  /**
   * Central-difference step in `θ`, radians, for the branch derivative.
   * Default `1e-4`.
   *
   * Sized against the residual's own accuracy rather than against `√ε`: the
   * range comes out of an adaptive integration, so differencing at `1e-8` would
   * measure the integrator's error tolerance instead of the physics. `1e-4` rad
   * is about 0.006°, small against the width of the range peak and large enough
   * that the difference is signal.
   */
  readonly slopeStep?: number;
  /** Passed through to every {@link newtonShooting} call. */
  readonly newton?: NewtonShootingOptions;
  /** Channel layout of the model's state. Defaults to {@link PLANAR_LAYOUT}. */
  readonly layout?: TrajectoryLayout;
}

/** The completed sweep. */
export interface BasinGrid {
  /** Elevation samples, ascending — the map's x axis, radians. */
  readonly thetas: readonly number[];
  /** Speed samples, ascending — the map's y axis, m/s. */
  readonly speeds: readonly number[];
  /**
   * Outcomes as `outcomes[row][column]`, `row` indexing {@link speeds} and
   * `column` indexing {@link thetas}.
   *
   * Row-major in that order because it is the shape Plotly's heatmap `z`
   * wants, and the same shape `PlotlyContourTrace` already documents for the
   * stability-region grid — one convention for 2D data across the repo.
   */
  readonly outcomes: readonly (readonly BasinOutcome[])[];
  /** Every cell, row-major, for callers that want the detail behind a colour. */
  readonly cells: readonly BasinCell[];
  /** Residual evaluations spent across the whole sweep, slopes included. */
  readonly evaluations: number;
}

/** How many cells each outcome claimed. */
export interface BasinCensus {
  readonly low: number;
  readonly high: number;
  readonly unconverged: number;
  readonly failed: number;
  readonly total: number;
}

const ARC_OUTCOMES: readonly BasinOutcome[] = ["low", "high"];

function downrangeAxisOf(layout: TrajectoryLayout): number {
  return layout.vertical === 0 ? 1 : 0;
}

/**
 * `samples` evenly spaced values from `min` to `max` inclusive.
 *
 * The last value is assigned from `max` rather than accumulated, so an axis
 * that a caller specified as ending at π/2 ends at exactly π/2 and not at
 * π/2 − 2e-16. Grid axes get compared against bounds by callers and by tests.
 */
export function linearSamples(axis: BasinAxis): number[] {
  const { min, max, samples } = axis;
  if (!Number.isInteger(samples) || samples < 2) {
    throw new Error(`linearSamples: samples must be an integer ≥ 2; got ${samples}`);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new Error(`linearSamples: bounds must be finite; got [${min}, ${max}]`);
  }
  if (!(max > min)) {
    throw new Error(`linearSamples: max must exceed min; got [${min}, ${max}]`);
  }
  const step = (max - min) / (samples - 1);
  const values: number[] = [];
  for (let i = 0; i < samples; i += 1) values.push(min + i * step);
  values[samples - 1] = max;
  return values;
}

/**
 * Sweeps a grid of initial guesses through {@link newtonShooting} and labels
 * each by the arc it converged to.
 *
 * `residual` is P5.04's residual function for the problem being studied, and
 * `targetDownrange` is the downrange the solve is trying to hit, measured from
 * the launch point in metres — passed in rather than re-derived from the
 * problem, because the caller already computed it to build the residual and
 * two derivations of the same number are two chances to disagree.
 *
 * Cost is one Newton solve plus two residual evaluations per cell, so it grows
 * as the product of the two axes' `samples`. A caller refining a boundary
 * should shrink the axes rather than raise the counts.
 */
export function sweepBasins(
  residual: ResidualFunction,
  targetDownrange: number,
  thetaAxis: BasinAxis,
  speedAxis: BasinAxis,
  options: BasinOptions = {},
): BasinGrid {
  const downrangeTolerance = options.downrangeTolerance ?? 1e-3;
  const slopeStep = options.slopeStep ?? 1e-4;
  const layout = options.layout ?? PLANAR_LAYOUT;
  const downrangeAxis = downrangeAxisOf(layout);

  if (!(slopeStep > 0) || !Number.isFinite(slopeStep)) {
    throw new Error(`sweepBasins: slopeStep must be finite and positive; got ${slopeStep}`);
  }
  if (!(downrangeTolerance > 0) || !Number.isFinite(downrangeTolerance)) {
    throw new Error(
      `sweepBasins: downrangeTolerance must be finite and positive; got ${downrangeTolerance}`,
    );
  }

  const thetas = linearSamples(thetaAxis);
  const speeds = linearSamples(speedAxis);

  let evaluations = 0;
  /** Downrange reached by `at`, or `undefined` if that aim never impacted. */
  const downrangeAt = (at: Aim): number | undefined => {
    evaluations += 1;
    const evaluation = residual(at);
    if (!evaluation.ok || evaluation.impact === null) return undefined;
    return evaluation.impact[downrangeAxis]!;
  };

  const cells: BasinCell[] = [];
  const outcomes: BasinOutcome[][] = [];

  for (let row = 0; row < speeds.length; row += 1) {
    const rowOutcomes: BasinOutcome[] = [];
    for (let column = 0; column < thetas.length; column += 1) {
      const start: Aim = { theta: thetas[column]!, speed: speeds[row]! };
      const cell = solveCell(
        residual,
        downrangeAt,
        start,
        column,
        row,
        targetDownrange,
        downrangeTolerance,
        slopeStep,
        downrangeAxis,
        options.newton,
      );
      // The solver's own evaluation count is separate from `downrangeAt`'s,
      // and both are real integrations the sweep paid for.
      evaluations += cell.solverEvaluations;
      cells.push(cell.cell);
      rowOutcomes.push(cell.cell.outcome);
    }
    outcomes.push(rowOutcomes);
  }

  return { thetas, speeds, outcomes, cells, evaluations };
}

function solveCell(
  residual: ResidualFunction,
  downrangeAt: (at: Aim) => number | undefined,
  start: Aim,
  column: number,
  row: number,
  targetDownrange: number,
  downrangeTolerance: number,
  slopeStep: number,
  downrangeAxis: number,
  newtonOptions: NewtonShootingOptions | undefined,
): { cell: BasinCell; solverEvaluations: number } {
  const result = newtonShooting(residual, start, newtonOptions);
  const solverEvaluations = result.evaluations;

  if (result.residual.impact === null) {
    return {
      cell: {
        column,
        row,
        start,
        outcome: "failed",
        solution: null,
        downrangeMiss: null,
        rangeSlope: null,
        iterations: result.iterations,
      },
      solverEvaluations,
    };
  }

  const solution = result.aim;
  const downrangeMiss = result.residual.impact[downrangeAxis]! - targetDownrange;

  if (!(Math.abs(downrangeMiss) <= downrangeTolerance)) {
    return {
      cell: {
        column,
        row,
        start,
        outcome: "unconverged",
        solution,
        downrangeMiss,
        rangeSlope: null,
        iterations: result.iterations,
      },
      solverEvaluations,
    };
  }

  const slope = rangeSlopeAt(downrangeAt, solution, slopeStep);
  return {
    cell: {
      column,
      row,
      start,
      // A slope that could not be measured, or one that is exactly zero, is
      // not a branch. Reporting it as "unconverged" would be wrong — the solve
      // did find a root — but so would guessing a label; a cell sitting on the
      // peak genuinely belongs to neither arc.
      outcome: slope === undefined || slope === 0 ? "unconverged" : slope > 0 ? "low" : "high",
      solution,
      downrangeMiss,
      rangeSlope: slope ?? null,
      iterations: result.iterations,
    },
    solverEvaluations,
  };
}

/**
 * Central difference of downrange with respect to elevation, at fixed speed.
 *
 * `undefined` when either probe aim fails to impact, which happens when the
 * converged aim sits within `slopeStep` of the edge of the reachable set. A
 * one-sided difference would be the tempting fallback and is refused: it is
 * biased by `O(h)` rather than `O(h²)`, and the whole use of this number is
 * the *sign* of a quantity that is passing through zero nearby.
 */
export function rangeSlopeAt(
  downrangeAt: (at: Aim) => number | undefined,
  aim: Aim,
  slopeStep: number,
): number | undefined {
  const forward = downrangeAt({ theta: aim.theta + slopeStep, speed: aim.speed });
  const backward = downrangeAt({ theta: aim.theta - slopeStep, speed: aim.speed });
  if (forward === undefined || backward === undefined) return undefined;
  return (forward - backward) / (2 * slopeStep);
}

/** Counts each outcome across the grid. */
export function censusOf(grid: BasinGrid): BasinCensus {
  const census = { low: 0, high: 0, unconverged: 0, failed: 0, total: grid.cells.length };
  for (const cell of grid.cells) census[cell.outcome] += 1;
  return census;
}

/**
 * True when both arcs claimed at least one cell — P5.20's "two-arc basins"
 * half, as a predicate rather than as an eyeball.
 */
export function hasTwoArcBasins(grid: BasinGrid): boolean {
  const census = censusOf(grid);
  return census.low > 0 && census.high > 0;
}

/**
 * Fraction of *arc-labelled* cells that touch a differently-labelled arc cell
 * in the 4-neighbourhood — the boundary's share of the map.
 *
 * Cells that are `"unconverged"` or `"failed"` are excluded from both the
 * numerator and the denominator rather than counted as "different". They are
 * not the far side of a basin boundary; including them would let a band of
 * failures along the edge of the reachable set masquerade as boundary
 * structure, which is the one thing this measurement must not do.
 *
 * Compare across refinements with {@link refineBoundaryFraction}; a single
 * value is not interpretable on its own.
 */
export function boundaryFraction(grid: BasinGrid): number {
  const rows = grid.outcomes.length;
  const columns = rows === 0 ? 0 : grid.outcomes[0]!.length;
  let labelled = 0;
  let onBoundary = 0;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const here = grid.outcomes[row]![column]!;
      if (!ARC_OUTCOMES.includes(here)) continue;
      labelled += 1;
      const neighbours: (BasinOutcome | undefined)[] = [
        grid.outcomes[row - 1]?.[column],
        grid.outcomes[row + 1]?.[column],
        grid.outcomes[row]![column - 1],
        grid.outcomes[row]![column + 1],
      ];
      if (
        neighbours.some(
          (other) => other !== undefined && ARC_OUTCOMES.includes(other) && other !== here,
        )
      ) {
        onBoundary += 1;
      }
    }
  }

  return labelled === 0 ? 0 : onBoundary / labelled;
}

/** One refinement level's boundary measurement. */
export interface BoundaryRefinement {
  /** Samples per axis at this level. */
  readonly samples: number;
  /** {@link boundaryFraction} measured there. */
  readonly fraction: number;
  /** Arc-labelled cells the fraction was taken over. */
  readonly labelled: number;
}

/**
 * Runs the same sweep at several grid resolutions and reports
 * {@link boundaryFraction} at each — the evidence behind P5.20's "boundary
 * fractal-ish structure noted".
 *
 * **How to read the numbers.** Halving the cell size doubles `n`. A boundary
 * that is a smooth curve is covered by `O(n)` cells out of `O(n²)`, so the
 * fraction should roughly halve each time `n` doubles. A fraction that falls
 * markedly slower than `1/n` means the refinement keeps finding boundary that
 * the coarser grid had averaged away — structure at the smaller scale. This
 * is a *scaling observation*, not a box-counting dimension: it is taken over a
 * handful of levels on a grid whose cells each cost a Newton solve, and it
 * would be dishonest to report a fitted exponent from that.
 */
export function refineBoundaryFraction(
  residual: ResidualFunction,
  targetDownrange: number,
  thetaAxis: Omit<BasinAxis, "samples">,
  speedAxis: Omit<BasinAxis, "samples">,
  sampleCounts: readonly number[],
  options: BasinOptions = {},
): BoundaryRefinement[] {
  return sampleCounts.map((samples) => {
    const grid = sweepBasins(
      residual,
      targetDownrange,
      { ...thetaAxis, samples },
      { ...speedAxis, samples },
      options,
    );
    const census = censusOf(grid);
    return { samples, fraction: boundaryFraction(grid), labelled: census.low + census.high };
  });
}
