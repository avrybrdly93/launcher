/**
 * The P7.19 impact-agreement study: does the in-kernel ground-impact bisection
 * land the impact abscissa within 1e-3 m of the CPU over a batch of 1e4?
 *
 * ## What this task actually is, which is not what its title says
 *
 * P7.19's title asks for an in-kernel bisection with a fixed iteration count and
 * branch-uniform control flow. **That already exists.** It landed inside P7.16,
 * in `wgsl-observables-kernel.ts`: `WGSL_IMPACT_BISECTION_STEPS` (60) halvings,
 * hoisted out of the step loop, every conditional a `select` rather than an `if`,
 * run exactly once per thread with a trip count that does not depend on data.
 * Rebuilding it would be a rewrite of working code with no ADR behind it.
 *
 * So what P7.19 owes is the half its title does not mention: its **validation
 * criterion**, which had never been measured at any batch size. This module is
 * that measurement.
 *
 * ## Which "CPU" the criterion compares against, and why it is not the obvious one
 *
 * "Impact x within 1e-3 m of CPU" has two readings, and **only one of them is
 * falsifiable**, which is what decides it.
 *
 * No WebGPU adapter exists in CI or in the container these runs happen in, so the
 * device arm cannot be run here. On P7.16's measured 0-ULP device agreement the
 * CPU f32 reduction stands in for the device -- P7.17's `withinP716Family`
 * licence, carried per family here the same way and for the same reason.
 *
 * Under the matched-precision reading ("CPU" = the f32 reduction) the comparison
 * is then **the f32 arm against itself**, which returns exactly `0.0` on all 1e4
 * rows. That is a criterion satisfied by construction: a flat line that reads as
 * a pass while having tested nothing. It is the 103rd run's inert-instrument
 * failure wearing a new disguise, and the reason this module compares against the
 * **f64** arm instead.
 *
 * That reading does not duplicate P7.17 either. P7.17 budgeted *relative* error
 * per scenario class on four hand-picked flights. This is an *absolute* metre bar
 * on one observable over a distribution of 1e4 members, which is a different
 * question and -- as the recorded results show -- has a different answer.
 *
 * ## Why `range` is the channel, rather than an impact abscissa output
 *
 * Neither arm exposes the impact abscissa directly: the reducer returns
 * `range = |impactX - x0|`. Every batch member is therefore launched from
 * `x0 = 0` with `vx > 0`, which makes `range` and the impact abscissa the same
 * number. That is a constraint on the batch rather than a convenience -- a member
 * launched from `x0 != 0` would silently be graded on a different quantity -- so
 * `planar-impact-agreement-results.test.ts` asserts every member's `x0` is zero
 * and its `vx` positive, rather than leaving it to the grid's good behaviour.
 *
 * ## Why the maximum and not the mean
 *
 * {@link ImpactBatchSummary.worstPlainError} is a maximum across the batch. A
 * correctness bar that passes on average is not a correctness bar: the batch
 * exists to find its worst member, and a mean would describe the batch's
 * composition rather than the bisection's reach. Per-family maxima are carried
 * alongside so one bad class cannot hide inside a large batch.
 *
 * ## Why non-impacting members would be worse than useless
 *
 * A flight that never crosses the ground inside its step budget returns
 * `range === 0` on **both** arms and contributes a perfect `0.0` error while
 * testing nothing -- the same inert-instrument shape as the matched-precision
 * reading above. The batch therefore asserts every member impacts rather than
 * filtering non-impacting members out, because filtering lets the batch shrink
 * silently toward the easy members.
 *
 * `steps` per family is set from a **measured** upper bound rather than a guess:
 * each family's longest flight was integrated at f64 with a deliberately
 * oversized budget, and `steps` is that flight's step count plus roughly 8%. See
 * {@link IMPACT_BATCH_FAMILIES}.
 *
 * ## Why the compensated arm is here
 *
 * P7.18 handed forward the question of whether this bisection accumulates
 * anything across its iterations, in which case its `compensated` flag would be
 * a flag rather than a new mechanism. **It does not**: `mid = 0.5 * (lo + hi)` is
 * a contraction whose error is bounded by the current bracket width rather than
 * summed over iterations, so there is nothing there to compensate.
 *
 * But the **march that produces the bracket** does accumulate, and on an absolute
 * metre bar that is what decides the answer. So `compensated` is load-bearing for
 * P7.19 after all, by a different route than the one predicted, and measuring it
 * is what turns "the criterion fails" into "the criterion fails, and here is the
 * switch already in the tree that meets it".
 *
 * Both f32 arms are graded against **one** reference -- the plain f64 arm -- so
 * they are comparable to each other. P7.18 established that compensation moves
 * the f64 arm too (`kahanAdd` is not a plain add), so a compensated f64 reference
 * would grade the two f32 arms against two different yardsticks and the
 * difference between them would stop meaning what it looks like it means.
 */

import type { PlanarDragParams, RoundFn } from "@ballista/solverkit";
import { identity, toF32 } from "@ballista/solverkit";

import { reducePlanarObservables } from "./planar-observables-flight.js";
import { PRECISION_SCENARIOS } from "./planar-precision-scenarios.js";
import type { ScenarioClass } from "./planar-precision-study.js";

/**
 * The criterion, in metres, verbatim from P7.19's `validation` field.
 *
 * Absolute rather than relative on purpose: the task says "within 1e-3 m", and a
 * relative bar would let a long flight buy itself a proportionally larger miss.
 */
export const IMPACT_ABSOLUTE_BUDGET_M = 1e-3;

/** Grid side per family; four families of `GRID_SIDE ** 2` make the 1e4 batch. */
export const GRID_SIDE = 50;

/** The batch size P7.19's criterion names. */
export const BATCH_TARGET_SIZE = 10_000;

/** Launch-speed multipliers spanned by each family's grid. */
export const SPEED_SPAN = { lo: 0.8, hi: 1.2 } as const;

/** Launch elevations spanned by each family's grid, in degrees. */
export const DEGREE_SPAN = { lo: 25, hi: 65 } as const;

/**
 * One family of the batch: a P7.17 scenario's model, swept over launch speed and
 * elevation.
 *
 * The families are the P7.17 scenarios rather than a fresh parameter set so the
 * batch inherits that task's class coverage -- `low-pi`, `high-pi` and `stiff` --
 * and so a row here can be read against the budget row there. Only the launch
 * varies within a family; the projectile never does.
 */
export interface ImpactBatchFamily {
  readonly id: string;
  readonly scenarioClass: ScenarioClass;
  /** Nominal launch speed, from the P7.17 scenario; the grid spans it. */
  readonly nominalSpeed: number;
  readonly params: PlanarDragParams;
  readonly h: number;
  /**
   * Fixed step budget, from a measurement rather than a bound.
   *
   * The family's longest flight -- the grid corner at `SPEED_SPAN.hi` and
   * `DEGREE_SPAN.hi` -- was integrated at f64 with an oversized budget, and this
   * is its step count plus roughly 8%. A drag-free analytic bound would be a
   * valid upper bound for every family (quadratic drag strictly shortens a flight
   * from the same launch) but wildly loose for the drag-dominated ones:
   * `table-tennis` lands in 2.6 s where its vacuum bound is 6.0 s, so the bound
   * would more than double this family's cost to buy nothing.
   */
  readonly steps: number;
  /** See `PrecisionScenario.withinP716Family`: the f32-stands-in licence. */
  readonly withinP716Family: boolean;
}

function scenarioSpeed(id: string): number {
  const s = PRECISION_SCENARIOS.find((x) => x.id === id);
  if (s === undefined) throw new Error(`unknown precision scenario: ${id}`);
  return Math.hypot(s.y0[2]!, s.y0[3]!);
}

function scenarioParams(id: string): PlanarDragParams {
  const s = PRECISION_SCENARIOS.find((x) => x.id === id);
  if (s === undefined) throw new Error(`unknown precision scenario: ${id}`);
  return s.params;
}

/**
 * The four families, with the step budgets measured as
 * {@link ImpactBatchFamily.steps} describes.
 *
 * Measured longest flights, at `h = 1e-3`: `vacuum-45deg` 6655 steps, `shot-put`
 * 3095, `table-tennis` 2599, `table-tennis-cannon` 4141.
 */
export const IMPACT_BATCH_FAMILIES: readonly ImpactBatchFamily[] = [
  {
    id: "vacuum-45deg",
    scenarioClass: "low-pi",
    nominalSpeed: scenarioSpeed("vacuum-45deg"),
    params: scenarioParams("vacuum-45deg"),
    h: 0.001,
    steps: 7200,
    withinP716Family: true,
  },
  {
    id: "shot-put",
    scenarioClass: "low-pi",
    nominalSpeed: scenarioSpeed("shot-put"),
    params: scenarioParams("shot-put"),
    h: 0.001,
    steps: 3350,
    withinP716Family: true,
  },
  {
    id: "table-tennis",
    scenarioClass: "high-pi",
    nominalSpeed: scenarioSpeed("table-tennis"),
    params: scenarioParams("table-tennis"),
    h: 0.001,
    steps: 2820,
    withinP716Family: true,
  },
  {
    id: "table-tennis-cannon",
    scenarioClass: "stiff",
    nominalSpeed: scenarioSpeed("table-tennis-cannon"),
    params: scenarioParams("table-tennis-cannon"),
    h: 0.001,
    steps: 4480,
    withinP716Family: false,
  },
];

/** One batch member: a launch, and the march that observes it. */
export interface ImpactBatchMember {
  readonly familyId: string;
  /** Index within the family's grid, `0 .. GRID_SIDE ** 2 - 1`. Deterministic. */
  readonly index: number;
  readonly speed: number;
  readonly degrees: number;
  /** `[x, y, vx, vy]`, always with `x === 0` -- see the module comment. */
  readonly y0: readonly number[];
  readonly h: number;
  readonly steps: number;
}

/**
 * Evenly spaced grid coordinate, endpoints included.
 *
 * `n === 1` returns `lo` rather than dividing by zero; the study never uses that
 * case, but a grid helper that produces `NaN` for it would put `NaN` launches
 * into a batch whose whole job is to be checked member by member.
 */
function gridValue(lo: number, hi: number, i: number, n: number): number {
  if (n <= 1) return lo;
  return lo + ((hi - lo) * i) / (n - 1);
}

/**
 * Expands the families into the batch, in a fixed order.
 *
 * Deterministic and RNG-free. A seeded RNG would be reproducible too, but it
 * would put the batch's coverage at the mercy of the generator's distribution,
 * and a grid states its coverage in its own definition. P7.21 is where an RNG
 * belongs, because there the jitter *is* the subject.
 */
export function buildImpactBatch(
  families: readonly ImpactBatchFamily[] = IMPACT_BATCH_FAMILIES,
  side: number = GRID_SIDE,
): ImpactBatchMember[] {
  const members: ImpactBatchMember[] = [];
  for (const family of families) {
    for (let i = 0; i < side; i++) {
      const speed = family.nominalSpeed * gridValue(SPEED_SPAN.lo, SPEED_SPAN.hi, i, side);
      for (let j = 0; j < side; j++) {
        const degrees = gridValue(DEGREE_SPAN.lo, DEGREE_SPAN.hi, j, side);
        const theta = (degrees * Math.PI) / 180;
        members.push({
          familyId: family.id,
          index: i * side + j,
          speed,
          degrees,
          y0: [0, 0, speed * Math.cos(theta), speed * Math.sin(theta)],
          h: family.h,
          steps: family.steps,
        });
      }
    }
  }
  return members;
}

/** The three arms' answers for one member, and the two errors they imply. */
export interface ImpactAgreementRow {
  readonly familyId: string;
  readonly index: number;
  readonly speed: number;
  readonly degrees: number;
  /** f64, plain accumulator: the reference both f32 arms are graded against. */
  readonly referenceRange: number;
  /** f32, plain accumulator. */
  readonly plainRange: number;
  /** f32, two-float (P7.18) accumulator. */
  readonly compensatedRange: number;
  /** `|plainRange - referenceRange|`, in metres. */
  readonly plainError: number;
  /** `|compensatedRange - referenceRange|`, in metres. */
  readonly compensatedError: number;
  /** True only when all three arms agree the flight reached the ground. */
  readonly impactedAgrees: boolean;
}

function runArm(
  member: ImpactBatchMember,
  family: ImpactBatchFamily,
  round: RoundFn,
  compensated: boolean,
) {
  return reducePlanarObservables({
    y0: member.y0,
    h: member.h,
    steps: member.steps,
    params: family.params,
    round,
    compensated,
  });
}

/**
 * Runs one member's three arms and differences them.
 *
 * The arms share `y0`, `h`, `steps` and `params` by construction -- all read from
 * the same member and family -- so the only differences between them are `round`
 * and `compensated`.
 */
export function measureImpactMember(
  member: ImpactBatchMember,
  family: ImpactBatchFamily,
): ImpactAgreementRow {
  const reference = runArm(member, family, identity, false);
  const plain = runArm(member, family, toF32, false);
  const compensated = runArm(member, family, toF32, true);
  return {
    familyId: member.familyId,
    index: member.index,
    speed: member.speed,
    degrees: member.degrees,
    referenceRange: reference.range,
    plainRange: plain.range,
    compensatedRange: compensated.range,
    plainError: Math.abs(plain.range - reference.range),
    compensatedError: Math.abs(compensated.range - reference.range),
    impactedAgrees: reference.impacted && plain.impacted && compensated.impacted,
  };
}

/** Where a family's worst member sat, so a maximum can be reproduced. */
export interface WorstMember {
  readonly index: number;
  readonly speed: number;
  readonly degrees: number;
  readonly error: number;
}

/** Per-family roll-up. */
export interface ImpactFamilySummary {
  readonly familyId: string;
  readonly scenarioClass: ScenarioClass;
  readonly withinP716Family: boolean;
  readonly count: number;
  /** Members where all three arms agree the flight impacted. */
  readonly impactedCount: number;
  readonly worstPlain: WorstMember;
  readonly worstCompensated: WorstMember;
  readonly plainMeetsBudget: boolean;
  readonly compensatedMeetsBudget: boolean;
}

/** Whole-batch roll-up. */
export interface ImpactBatchSummary {
  readonly count: number;
  readonly impactedCount: number;
  readonly worstPlainError: number;
  readonly worstPlainFamily: string;
  readonly worstCompensatedError: number;
  readonly worstCompensatedFamily: string;
  readonly plainMeetsBudget: boolean;
  readonly compensatedMeetsBudget: boolean;
  readonly families: readonly ImpactFamilySummary[];
}

const EMPTY_WORST: WorstMember = { index: -1, speed: 0, degrees: 0, error: 0 };

/**
 * The member with the largest `pick(row)`.
 *
 * Seeded from the first row rather than from a zero, so a batch whose every
 * error is exactly zero still reports a real member rather than the
 * {@link EMPTY_WORST} sentinel -- which would be indistinguishable from an empty
 * batch, and an empty batch reporting a passing maximum is the failure mode this
 * whole module is built to avoid.
 */
function worstOf(
  rows: readonly ImpactAgreementRow[],
  pick: (r: ImpactAgreementRow) => number,
): WorstMember {
  const first = rows[0];
  if (first === undefined) return EMPTY_WORST;
  let worst: WorstMember = {
    index: first.index,
    speed: first.speed,
    degrees: first.degrees,
    error: pick(first),
  };
  for (const row of rows) {
    const error = pick(row);
    if (error > worst.error) {
      worst = { index: row.index, speed: row.speed, degrees: row.degrees, error };
    }
  }
  return worst;
}

/**
 * Rolls the rows up per family and over the whole batch.
 *
 * `impactedCount` is reported rather than used to filter: a member that did not
 * impact scores `0` on both arms and would flatter every maximum it was allowed
 * into. The tests assert `impactedCount === count`, which is what makes the
 * maxima mean something.
 */
export function summariseImpactAgreement(
  rows: readonly ImpactAgreementRow[],
  families: readonly ImpactBatchFamily[] = IMPACT_BATCH_FAMILIES,
): ImpactBatchSummary {
  const summaries = families.map((family) => {
    const own = rows.filter((r) => r.familyId === family.id);
    const worstPlain = own.length === 0 ? EMPTY_WORST : worstOf(own, (r) => r.plainError);
    const worstCompensated =
      own.length === 0 ? EMPTY_WORST : worstOf(own, (r) => r.compensatedError);
    return {
      familyId: family.id,
      scenarioClass: family.scenarioClass,
      withinP716Family: family.withinP716Family,
      count: own.length,
      impactedCount: own.filter((r) => r.impactedAgrees).length,
      worstPlain,
      worstCompensated,
      plainMeetsBudget: worstPlain.error <= IMPACT_ABSOLUTE_BUDGET_M,
      compensatedMeetsBudget: worstCompensated.error <= IMPACT_ABSOLUTE_BUDGET_M,
    } satisfies ImpactFamilySummary;
  });

  let worstPlainError = 0;
  let worstPlainFamily = "";
  let worstCompensatedError = 0;
  let worstCompensatedFamily = "";
  for (const s of summaries) {
    if (s.count > 0 && (worstPlainFamily === "" || s.worstPlain.error > worstPlainError)) {
      worstPlainError = s.worstPlain.error;
      worstPlainFamily = s.familyId;
    }
    if (
      s.count > 0 &&
      (worstCompensatedFamily === "" || s.worstCompensated.error > worstCompensatedError)
    ) {
      worstCompensatedError = s.worstCompensated.error;
      worstCompensatedFamily = s.familyId;
    }
  }

  return {
    count: rows.length,
    impactedCount: rows.filter((r) => r.impactedAgrees).length,
    worstPlainError,
    worstPlainFamily,
    worstCompensatedError,
    worstCompensatedFamily,
    plainMeetsBudget: worstPlainError <= IMPACT_ABSOLUTE_BUDGET_M,
    compensatedMeetsBudget: worstCompensatedError <= IMPACT_ABSOLUTE_BUDGET_M,
    families: summaries,
  };
}

/**
 * Runs the whole batch.
 *
 * Separate from {@link summariseImpactAgreement} so a caller can hold the rows --
 * the recording script writes summaries only, but the reproducibility test needs
 * individual rows to compare against.
 */
export function runImpactAgreementBatch(
  families: readonly ImpactBatchFamily[] = IMPACT_BATCH_FAMILIES,
  side: number = GRID_SIDE,
): ImpactAgreementRow[] {
  const byId = new Map(families.map((f) => [f.id, f]));
  return buildImpactBatch(families, side).map((m) => measureImpactMember(m, byId.get(m.familyId)!));
}
