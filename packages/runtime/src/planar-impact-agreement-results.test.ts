import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  BATCH_TARGET_SIZE,
  DEGREE_SPAN,
  GRID_SIDE,
  IMPACT_ABSOLUTE_BUDGET_M,
  IMPACT_BATCH_FAMILIES,
  SPEED_SPAN,
  buildImpactBatch,
  measureImpactMember,
  runImpactAgreementBatch,
  summariseImpactAgreement,
  type ImpactBatchSummary,
} from "./planar-impact-agreement-study.js";

/**
 * The recorded P7.19 study, and the assertions that keep its published claim
 * honest.
 *
 * Recorded as a golden rather than recomputed in-test for a reason the P7.17
 * study did not have: this batch is 1e4 members over three arms, roughly five
 * minutes of integration. The precision study is four rows and a six-point sweep
 * and can afford to re-derive itself on every run; this cannot, and a five-minute
 * test in a suite of 4000 would be deleted by the third person who hit it.
 *
 * Re-record with `pnpm update:impact-agreement`.
 *
 * **The point of a committed results file is that the next person leaves it
 * alone**, so as in `planar-precision-results.test.ts` these tests re-derive
 * every published claim from the recorded numbers rather than trusting the
 * verdict fields: a family hand-edited to say it meets the budget while carrying
 * an error above it fails here, and so does a batch maximum that does not match
 * the family maxima it is supposed to be the largest of.
 *
 * What a golden cannot check on its own is whether the numbers were ever real,
 * so two things are recomputed live and cheaply:
 *
 * 1. **The worst member of each family is re-run and must reproduce exactly.**
 *    The recording stores each worst member's grid coordinates, so this is eight
 *    flights rather than ten thousand, and `toBe` rather than a tolerance --
 *    same code, same inputs, deterministic.
 *
 * 2. **The compensated arm is proved not to be the plain arm.** This is the test
 *    that makes the rest mean something. The study's headline is that
 *    compensation is what carries the drag-free family across the budget; if
 *    `compensated` were ever made inert, both arms would return the same number,
 *    every error would be equal, and the study would go on reporting an
 *    improvement that no longer happened. That is the 103rd run's inert-instrument
 *    failure, and it is the one failure a golden is structurally unable to catch.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS_PATH = join(HERE, "planar-impact-agreement-results.json");
const UPDATE = process.env.UPDATE_GOLDENS === "1";

interface RecordedWorst {
  readonly index: number;
  readonly speed: number;
  readonly degrees: number;
  readonly error: number;
}

interface RecordedFamily {
  readonly familyId: string;
  readonly scenarioClass: string;
  readonly withinP716Family: boolean;
  readonly h: number;
  readonly steps: number;
  readonly count: number;
  readonly impactedCount: number;
  readonly worstPlain: RecordedWorst;
  readonly worstCompensated: RecordedWorst;
  readonly plainMeetsBudget: boolean;
  readonly compensatedMeetsBudget: boolean;
}

interface RecordedStudy {
  readonly task: string;
  readonly absoluteBudgetMetres: number;
  readonly gridSide: number;
  readonly speedSpan: { readonly lo: number; readonly hi: number };
  readonly degreeSpan: { readonly lo: number; readonly hi: number };
  readonly count: number;
  readonly impactedCount: number;
  readonly worstPlainError: number;
  readonly worstPlainFamily: string;
  readonly worstCompensatedError: number;
  readonly worstCompensatedFamily: string;
  readonly plainMeetsBudget: boolean;
  readonly compensatedMeetsBudget: boolean;
  readonly notes: readonly string[];
  readonly families: readonly RecordedFamily[];
}

const NOTES = [
  "P7.19's criterion is 'impact x within 1e-3 m of CPU on 1e4 batch'. 'CPU' is read as the f64 arm, not the f32 one: no WebGPU adapter runs here, so the CPU f32 reduction stands in for the device on P7.16's measured 0-ULP agreement, and comparing that stand-in against itself would return exactly 0.0 on every row -- a criterion satisfied by construction.",
  "The mechanism P7.19's title asks for already existed before this task was started: the fixed-count, branch-uniform in-kernel bisection landed inside P7.16. What was missing was this measurement.",
  "Errors are maximum absolute metres across the batch, never a mean. Per-family maxima are carried so one class cannot hide inside the batch.",
  "The device arm was NOT run. These are CPU f32 numbers standing in for it under the withinP716Family licence, which table-tennis-cannon is explicitly outside.",
  "The plain-accumulator arm MISSES the budget, and it misses it only on the drag-free family -- the one with no drag, no stiffness and the longest flight, hence the most steps to accumulate rounding over. That is P7.17's finding reproduced over a distribution rather than a single flight.",
  "The compensated arm (P7.18, default off) meets the budget on every family. The bisection itself accumulates nothing -- mid = 0.5*(lo+hi) is a contraction -- but the march that produces its bracket does, and that is what decides this criterion.",
];

function record(): RecordedStudy {
  const rows = runImpactAgreementBatch();
  const summary = summariseImpactAgreement(rows);
  const byId = new Map(IMPACT_BATCH_FAMILIES.map((f) => [f.id, f]));
  return {
    task: "P7.19",
    absoluteBudgetMetres: IMPACT_ABSOLUTE_BUDGET_M,
    gridSide: GRID_SIDE,
    speedSpan: { lo: SPEED_SPAN.lo, hi: SPEED_SPAN.hi },
    degreeSpan: { lo: DEGREE_SPAN.lo, hi: DEGREE_SPAN.hi },
    count: summary.count,
    impactedCount: summary.impactedCount,
    worstPlainError: summary.worstPlainError,
    worstPlainFamily: summary.worstPlainFamily,
    worstCompensatedError: summary.worstCompensatedError,
    worstCompensatedFamily: summary.worstCompensatedFamily,
    plainMeetsBudget: summary.plainMeetsBudget,
    compensatedMeetsBudget: summary.compensatedMeetsBudget,
    notes: NOTES,
    families: summary.families.map((f) => ({
      familyId: f.familyId,
      scenarioClass: f.scenarioClass,
      withinP716Family: f.withinP716Family,
      h: byId.get(f.familyId)!.h,
      steps: byId.get(f.familyId)!.steps,
      count: f.count,
      impactedCount: f.impactedCount,
      worstPlain: f.worstPlain,
      worstCompensated: f.worstCompensated,
      plainMeetsBudget: f.plainMeetsBudget,
      compensatedMeetsBudget: f.compensatedMeetsBudget,
    })),
  };
}

let study: RecordedStudy;

beforeAll(() => {
  if (UPDATE) {
    study = record();
    writeFileSync(RESULTS_PATH, `${JSON.stringify(study, null, 2)}\n`);
    return;
  }
  study = JSON.parse(readFileSync(RESULTS_PATH, "utf8")) as RecordedStudy;
}, 900_000);

describe("P7.19 impact agreement: the batch the criterion is read over", () => {
  it("is the 1e4 the criterion names, and is what the study's own constants describe", () => {
    expect(study.count).toBe(BATCH_TARGET_SIZE);
    expect(study.gridSide).toBe(GRID_SIDE);
    expect(IMPACT_BATCH_FAMILIES.length * GRID_SIDE ** 2).toBe(BATCH_TARGET_SIZE);
    expect(study.families).toHaveLength(IMPACT_BATCH_FAMILIES.length);
    expect(study.families.reduce((n, f) => n + f.count, 0)).toBe(BATCH_TARGET_SIZE);
  });

  it("launches every member from x = 0 with vx > 0, which is what makes range the impact abscissa", () => {
    const members = buildImpactBatch();
    expect(members).toHaveLength(BATCH_TARGET_SIZE);
    for (const m of members) {
      expect(m.y0[0]).toBe(0);
      expect(m.y0[1]).toBe(0);
      expect(m.y0[2]!).toBeGreaterThan(0);
      expect(m.y0[3]!).toBeGreaterThan(0);
    }
  });

  it("reaches the ground on every member, so no row scores a free zero", () => {
    expect(study.impactedCount).toBe(study.count);
    for (const f of study.families) {
      expect(f.impactedCount).toBe(f.count);
    }
  });

  it("covers the three scenario classes P7.17 defined", () => {
    const classes = new Set(study.families.map((f) => f.scenarioClass));
    expect(classes).toEqual(new Set(["low-pi", "high-pi", "stiff"]));
  });
});

describe("P7.19 impact agreement: the recorded claims, re-derived rather than trusted", () => {
  it("derives every family's budget verdict from its own recorded error", () => {
    for (const f of study.families) {
      expect(f.plainMeetsBudget).toBe(f.worstPlain.error <= study.absoluteBudgetMetres);
      expect(f.compensatedMeetsBudget).toBe(f.worstCompensated.error <= study.absoluteBudgetMetres);
    }
  });

  it("derives the batch maxima from the family maxima they are supposed to be the largest of", () => {
    const plain = Math.max(...study.families.map((f) => f.worstPlain.error));
    const compensated = Math.max(...study.families.map((f) => f.worstCompensated.error));
    expect(study.worstPlainError).toBe(plain);
    expect(study.worstCompensatedError).toBe(compensated);
    expect(
      study.families.find((f) => f.familyId === study.worstPlainFamily)!.worstPlain.error,
    ).toBe(plain);
    expect(
      study.families.find((f) => f.familyId === study.worstCompensatedFamily)!.worstCompensated
        .error,
    ).toBe(compensated);
  });

  it("derives the batch verdicts from the batch maxima", () => {
    expect(study.plainMeetsBudget).toBe(study.worstPlainError <= study.absoluteBudgetMetres);
    expect(study.compensatedMeetsBudget).toBe(
      study.worstCompensatedError <= study.absoluteBudgetMetres,
    );
    expect(study.absoluteBudgetMetres).toBe(IMPACT_ABSOLUTE_BUDGET_M);
  });

  it("keeps each worst member inside the grid it claims to come from", () => {
    for (const f of study.families) {
      const family = IMPACT_BATCH_FAMILIES.find((x) => x.id === f.familyId)!;
      for (const worst of [f.worstPlain, f.worstCompensated]) {
        expect(worst.index).toBeGreaterThanOrEqual(0);
        expect(worst.index).toBeLessThan(GRID_SIDE ** 2);
        expect(worst.degrees).toBeGreaterThanOrEqual(DEGREE_SPAN.lo);
        expect(worst.degrees).toBeLessThanOrEqual(DEGREE_SPAN.hi);
        expect(worst.speed).toBeGreaterThanOrEqual(family.nominalSpeed * SPEED_SPAN.lo - 1e-9);
        expect(worst.speed).toBeLessThanOrEqual(family.nominalSpeed * SPEED_SPAN.hi + 1e-9);
      }
    }
  });
});

describe("P7.19 impact agreement: the published result", () => {
  it("misses the 1e-3 m budget on the plain f32 accumulator", () => {
    expect(study.plainMeetsBudget).toBe(false);
    expect(study.worstPlainError).toBeGreaterThan(IMPACT_ABSOLUTE_BUDGET_M);
  });

  it("misses it only on the drag-free family, which is the longest flight and not the hardest dynamics", () => {
    expect(study.worstPlainFamily).toBe("vacuum-45deg");
    for (const f of study.families) {
      if (f.familyId === "vacuum-45deg") expect(f.plainMeetsBudget).toBe(false);
      else expect(f.plainMeetsBudget).toBe(true);
    }
  });

  it("meets the budget on every family once P7.18's accumulator is switched on", () => {
    expect(study.compensatedMeetsBudget).toBe(true);
    for (const f of study.families) {
      expect(f.compensatedMeetsBudget).toBe(true);
    }
    expect(study.worstCompensatedError).toBeLessThan(IMPACT_ABSOLUTE_BUDGET_M);
  });

  it("does not claim a device measurement, because none was run", () => {
    const cannon = study.families.find((f) => f.familyId === "table-tennis-cannon")!;
    expect(cannon.withinP716Family).toBe(false);
    expect(study.notes.some((n) => n.includes("device arm was NOT run"))).toBe(true);
  });
});

describe("P7.19 impact agreement: the instruments are connected", () => {
  it("reproduces each family's worst recorded member exactly, on a live re-run", () => {
    const members = buildImpactBatch();
    for (const f of study.families) {
      const family = IMPACT_BATCH_FAMILIES.find((x) => x.id === f.familyId)!;
      const plainMember = members.find(
        (m) => m.familyId === f.familyId && m.index === f.worstPlain.index,
      )!;
      expect(measureImpactMember(plainMember, family).plainError).toBe(f.worstPlain.error);

      const compMember = members.find(
        (m) => m.familyId === f.familyId && m.index === f.worstCompensated.index,
      )!;
      expect(measureImpactMember(compMember, family).compensatedError).toBe(
        f.worstCompensated.error,
      );
    }
  });

  /**
   * The test the whole study rests on.
   *
   * Every other assertion here would still pass if `compensated` were made
   * inert: both f32 arms would return the same number, both errors would be
   * equal, and the recorded file would keep reporting an improvement that had
   * stopped happening. Asserting the two arms actually differ -- on the family
   * where the improvement is the study's headline -- is what makes the
   * comparison a measurement rather than a pair of identical runs.
   */
  it("proves the compensated arm is not the plain arm on the family the result turns on", () => {
    const family = IMPACT_BATCH_FAMILIES.find((x) => x.id === "vacuum-45deg")!;
    const worstIndex = study.families.find((f) => f.familyId === "vacuum-45deg")!.worstPlain.index;
    const member = buildImpactBatch().find(
      (m) => m.familyId === "vacuum-45deg" && m.index === worstIndex,
    )!;
    const row = measureImpactMember(member, family);

    expect(row.compensatedRange).not.toBe(row.plainRange);
    expect(row.compensatedError).toBeLessThan(row.plainError);
    // And the improvement is a real one rather than a last-digit wobble.
    expect(row.plainError / row.compensatedError).toBeGreaterThan(10);
  });
});
