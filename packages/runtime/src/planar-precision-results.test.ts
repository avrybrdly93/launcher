import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  PRECISION_SCENARIOS,
  STIFFNESS_RATIO_THRESHOLD,
  planarPi,
  planarStiffnessRatio,
} from "./planar-precision-scenarios.js";
import {
  MODEL_COVERAGE_GAPS,
  OBSERVABLE_CHANNELS,
  RELATIVE_BUDGET,
  applyBudget,
  runPrecisionScenario,
  sweepStiffness,
  ulp32,
  type ObservableChannel,
  type PrecisionVerdict,
} from "./planar-precision-study.js";

/**
 * The recorded P7.17 study, and the assertions that keep the published table
 * honest (docs/analysis/f32-precision-budget.md).
 *
 * Recorded as a golden rather than produced by a `scripts/measure-*.mjs`
 * fixture, because this study needs no device: both arms are the same reduction
 * at two `RoundFn`s. The `scripts/` fixtures exist for the things that need a
 * browser and an adapter, and they pay for it by importing deep `dist/` paths --
 * a constraint this module cannot satisfy anyway, since it reaches
 * `reducePlanarObservables`, which holds a runtime `@ballista/solverkit` import
 * on purpose.
 *
 * Re-record with `pnpm update:precision-study`.
 *
 * **The point of a committed results file is that the next person leaves it
 * alone.** These tests therefore re-derive every published claim from the
 * recorded numbers rather than trusting the verdict column: a row hand-edited to
 * say `f32-ok` while carrying an error above the budget fails here, and so does
 * a row whose class contradicts its own stiffness ratio.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS_PATH = join(HERE, "planar-precision-results.json");
const UPDATE = process.env.UPDATE_GOLDENS === "1";

interface RecordedRow {
  readonly id: string;
  readonly scenarioClass: string;
  readonly description: string;
  readonly launchSpeed: number;
  readonly pi: number;
  readonly stiffnessRatio: number;
  readonly h: number;
  readonly steps: number;
  readonly clockResolutionPerStep: number;
  readonly impactedAgrees: boolean;
  readonly worstChannel: ObservableChannel;
  readonly worstRelative: number;
  readonly channels: Readonly<
    Record<ObservableChannel, { reference: number; measured: number; relative: number }>
  >;
  readonly withinP716Family: boolean;
  readonly verdict: PrecisionVerdict;
  readonly reason: string;
}

interface RecordedSweepPoint {
  readonly v0: number;
  readonly stiffnessRatio: number;
  readonly tau: number;
  readonly h: number;
  readonly steps: number;
  readonly worstRelative: number;
  readonly f32Impacted: boolean;
}

interface RecordedStudy {
  readonly task: string;
  readonly relativeBudget: number;
  readonly stiffnessRatioThreshold: number;
  readonly notes: readonly string[];
  readonly rows: readonly RecordedRow[];
  readonly stiffnessSweep: readonly RecordedSweepPoint[];
  readonly modelCoverageGaps: readonly { readonly regimeTag: string; readonly reason: string }[];
}

const SWEEP_SPEEDS = [25, 100, 400, 1600, 6400, 25600] as const;
/**
 * `tauFraction` is the RK4 real-axis stability limit, not a comfortable step.
 *
 * That is the whole point of this sweep. A stiff caller's knob is bounded: an
 * explicit method is unstable above roughly `2.78 * tau`, so this is the
 * COARSEST march available and therefore the FEWEST steps, and therefore the
 * BEST f32 accuracy any caller can obtain for that scenario. A ratio that
 * misses the budget here misses it unconditionally -- there is no step the
 * caller could have chosen instead. That is what turns the stiff flag from an
 * assertion into a measurement.
 */
const SWEEP_OPTIONS = { degrees: 35, tauFraction: 2.78 } as const;

function measure(): RecordedStudy {
  const rows = PRECISION_SCENARIOS.map((scenario) => {
    const row = applyBudget(runPrecisionScenario(scenario));
    const v0 = Math.hypot(scenario.y0[2]!, scenario.y0[3]!);
    const tEnd = (scenario.t0 ?? 0) + scenario.h * scenario.steps;
    return {
      id: row.id,
      scenarioClass: row.scenarioClass,
      description: row.description,
      launchSpeed: v0,
      pi: planarPi(scenario.params, v0),
      stiffnessRatio: planarStiffnessRatio(scenario.params, v0),
      h: scenario.h,
      steps: scenario.steps,
      clockResolutionPerStep: ulp32(tEnd) / scenario.h,
      impactedAgrees: row.impactedAgrees,
      worstChannel: row.worstChannel,
      worstRelative: row.worstRelative,
      channels: Object.fromEntries(
        OBSERVABLE_CHANNELS.map((c) => [
          c,
          {
            reference: row.channels[c].reference,
            measured: row.channels[c].measured,
            relative: row.channels[c].relative,
          },
        ]),
      ) as RecordedRow["channels"],
      withinP716Family: row.withinP716Family,
      verdict: row.verdict,
      reason: row.reason,
    } satisfies RecordedRow;
  });

  const sweepParams = PRECISION_SCENARIOS.find((s) => s.id === "table-tennis")!.params;
  const stiffnessSweep = sweepStiffness(sweepParams, SWEEP_SPEEDS, SWEEP_OPTIONS).map((p) => ({
    v0: p.v0,
    stiffnessRatio: p.stiffnessRatio,
    tau: p.tau,
    h: p.h,
    steps: p.steps,
    worstRelative: p.worstRelative,
    f32Impacted: p.f32Impacted,
  }));

  return {
    task: "P7.17",
    relativeBudget: RELATIVE_BUDGET,
    stiffnessRatioThreshold: STIFFNESS_RATIO_THRESHOLD,
    notes: [
      "Both arms are the same reduction over the same fixed-step march at two RoundFns, so a " +
        "difference is attributable to arithmetic width alone.",
      "The f32 arm stands in for the GPU on P7.16's measured 0-ULP agreement over 50000 values. " +
        "Rows with withinP716Family false extend that licence past the ensemble it was measured " +
        "on, and say so rather than inheriting it silently.",
      "No timing, throughput or bandwidth figure appears here. P7.17 is about error; cost is " +
        "P7.20's question and needs hardware.",
    ],
    rows,
    stiffnessSweep,
    modelCoverageGaps: MODEL_COVERAGE_GAPS.map((g) => ({ ...g })),
  };
}

let recorded: RecordedStudy;

beforeAll(() => {
  if (UPDATE) writeFileSync(RESULTS_PATH, `${JSON.stringify(measure(), null, 2)}\n`);
  recorded = JSON.parse(readFileSync(RESULTS_PATH, "utf8")) as RecordedStudy;
});

describe("the recorded study still reproduces", () => {
  it("measures the same numbers the file records", () => {
    // Bit-for-bit, not approximately. Both arms are deterministic pure functions
    // of the recorded inputs; a drift here is a code change, not noise, and
    // rounding it away would hide exactly the regression this file exists for.
    const fresh = measure();
    for (const [i, row] of fresh.rows.entries()) {
      const was = recorded.rows[i]!;
      expect(row.id).toBe(was.id);
      expect(row.worstRelative).toBe(was.worstRelative);
      expect(row.worstChannel).toBe(was.worstChannel);
      expect(row.verdict).toBe(was.verdict);
      for (const channel of OBSERVABLE_CHANNELS) {
        expect(row.channels[channel].reference).toBe(was.channels[channel].reference);
        expect(row.channels[channel].measured).toBe(was.channels[channel].measured);
      }
    }
    expect(fresh.stiffnessSweep).toEqual(recorded.stiffnessSweep);
  });
});

describe("every published verdict is a consequence of the recorded numbers", () => {
  it("re-derives the verdict column rather than trusting it", () => {
    // The file is committed JSON and a derivation is only as good as the next
    // person's willingness to leave it alone. A row edited to claim f32-ok while
    // carrying an error above the budget dies here.
    for (const row of recorded.rows) {
      const expected: PrecisionVerdict = !row.impactedAgrees
        ? "cpu-only"
        : row.worstRelative <= recorded.relativeBudget
          ? "f32-ok"
          : "cpu-only";
      expect(row.verdict, `${row.id} verdict does not follow from its own numbers`).toBe(expected);
    }
  });

  it("re-derives each row's class from its own stiffness ratio", () => {
    for (const row of recorded.rows) {
      if (row.scenarioClass === "stiff") {
        expect(row.stiffnessRatio).toBeGreaterThan(recorded.stiffnessRatioThreshold);
      } else {
        expect(row.stiffnessRatio).toBeLessThanOrEqual(recorded.stiffnessRatioThreshold);
        expect(row.scenarioClass).toBe(row.pi < 0.1 ? "low-pi" : "high-pi");
      }
      // ratio == 2*Pi is the identity the stiff boundary rests on.
      expect(row.stiffnessRatio).toBeCloseTo(2 * row.pi, 10);
    }
  });

  it("keeps the recorded budget and threshold equal to the code's", () => {
    expect(recorded.relativeBudget).toBe(RELATIVE_BUDGET);
    expect(recorded.stiffnessRatioThreshold).toBe(STIFFNESS_RATIO_THRESHOLD);
  });

  it("records a worstRelative that really is the worst of its own channels", () => {
    for (const row of recorded.rows) {
      const worst = Math.max(...OBSERVABLE_CHANNELS.map((c) => row.channels[c].relative));
      expect(row.worstRelative).toBeCloseTo(worst, 15);
      expect(row.channels[row.worstChannel].relative).toBeCloseTo(worst, 15);
    }
  });
});

describe("the findings the published table states in words", () => {
  it("finds the stiff row no worse than the drag-free one, refuting the obvious hypothesis", () => {
    // The result that made this study worth running. If this ever inverts, the
    // table's central claim is wrong and the prose needs rewriting, not the row.
    const stiff = recorded.rows.find((r) => r.scenarioClass === "stiff")!;
    const vacuum = recorded.rows.find((r) => r.id === "vacuum-45deg")!;
    expect(stiff.worstRelative).toBeLessThan(vacuum.worstRelative);
  });

  it("fails the DRAG-FREE row hardest, at a common step size", () => {
    // The headline, and it is not what the task title suggests. At a common
    // h = 1e-3 the worst row is the DRAG-FREE one -- the longest flight, hence
    // the most steps to accumulate rounding over -- not the stiff one. f32
    // adequacy here is a property of the MARCH, not of the regime.
    const vacuum = recorded.rows.find((r) => r.id === "vacuum-45deg")!;
    const stiff = recorded.rows.find((r) => r.scenarioClass === "stiff")!;
    // Both miss the budget at this step, and the DRAG-FREE one misses it by
    // more -- which is the claim the task title would not have predicted.
    expect(vacuum.verdict).toBe("cpu-only");
    expect(stiff.verdict).toBe("cpu-only");
    expect(vacuum.worstRelative).toBeGreaterThan(stiff.worstRelative);
    // The two rows that pass are the ordinary sports projectiles in between.
    const passing = recorded.rows.filter((r) => r.verdict === "f32-ok").map((r) => r.id);
    expect(passing).toEqual(["shot-put", "table-tennis"]);
  });

  it("lets the caller buy the drag-free row back with a coarser step", () => {
    // The distinction the CPU-only flag actually rests on. A non-stiff scenario
    // that misses the budget can always be re-marched more coarsely: fewer steps,
    // less accumulated rounding. The knob exists because nothing pins h.
    const vacuum = PRECISION_SCENARIOS.find((s) => s.id === "vacuum-45deg")!;
    const coarser = applyBudget(
      runPrecisionScenario({ ...vacuum, h: vacuum.h * 8, steps: Math.ceil(vacuum.steps / 8) }),
    );
    expect(coarser.verdict).toBe("f32-ok");
  });

  it("bounds the stiff class's knob, which is why the flag is a measurement", () => {
    // The other half, and the reason the stiff verdict is not just the vacuum
    // verdict again. The stiff caller's step is capped at ~2.78*tau -- past it
    // the march does not merely lose accuracy, it stops being stable -- and tau
    // falls as the ratio rises, so the minimum step count climbs without the
    // caller choosing it. The sweep is marched at exactly that cap.
    const byRatio = [...recorded.stiffnessSweep].sort(
      (a, b) => a.stiffnessRatio - b.stiffnessRatio,
    );
    expect(byRatio.length).toBeGreaterThan(3);
    expect(byRatio[byRatio.length - 1]!.steps).toBeGreaterThan(byRatio[0]!.steps);
    expect(byRatio[byRatio.length - 1]!.h).toBeLessThan(byRatio[0]!.h);
  });

  it("locates the ratio beyond which f32 cannot meet the budget at any step", () => {
    // The published CPU-only boundary, re-derived from the recorded sweep rather
    // than copied from the prose. Because the sweep marches at the stability
    // limit, a failing point here cannot be rescued by a different step.
    const sweep = [...recorded.stiffnessSweep].sort((a, b) => a.stiffnessRatio - b.stiffnessRatio);
    const passing = sweep.filter((p) => p.worstRelative <= recorded.relativeBudget);
    const failing = sweep.filter((p) => p.worstRelative > recorded.relativeBudget);
    expect(passing.length, "no point passes: the sweep proves nothing").toBeGreaterThan(0);
    expect(failing.length, "no point fails: the sweep proves nothing").toBeGreaterThan(0);
    // The boundary is a boundary: everything below passes, everything above
    // fails. A sweep that interleaved would mean the ratio is not what governs.
    const lastPass = passing[passing.length - 1]!;
    const firstFail = failing[0]!;
    expect(lastPass.stiffnessRatio).toBeLessThan(firstFail.stiffnessRatio);
    for (const p of sweep) {
      if (p.stiffnessRatio <= lastPass.stiffnessRatio) {
        expect(p.worstRelative).toBeLessThanOrEqual(recorded.relativeBudget);
      } else {
        expect(p.worstRelative).toBeGreaterThan(recorded.relativeBudget);
      }
    }
    // And the boundary sits above the advisor's own stiffness threshold, which
    // is why "stiff" alone does not imply "CPU-only" and the table says so.
    expect(lastPass.stiffnessRatio).toBeGreaterThan(recorded.stiffnessRatioThreshold);
  });

  it("grows the error with the stiffness ratio, monotonically in the large", () => {
    const sweep = recorded.stiffnessSweep;
    expect(sweep.length).toBeGreaterThanOrEqual(5);
    const first = sweep[0]!;
    const last = sweep[sweep.length - 1]!;
    // Six decades of ratio, with no property of the projectile changed.
    expect(last.stiffnessRatio / first.stiffnessRatio).toBeGreaterThan(1e5);
    // The step is pinned to tau, so the ratio buys step count and nothing else.
    expect(last.steps).toBeGreaterThan(first.steps * 50);
    expect(last.worstRelative).toBeGreaterThan(first.worstRelative * 20);
  });

  it("keeps the sweep's step genuinely pinned to tau", () => {
    // If h were not tau-proportional the sweep would be measuring step choice
    // rather than stiffness, and the connection the table draws would be false.
    for (const point of recorded.stiffnessSweep) {
      expect(point.h).toBeCloseTo(SWEEP_OPTIONS.tauFraction * point.tau, 12);
    }
  });

  it("names both model-coverage gaps, and does not dress them as precision results", () => {
    const tags = recorded.modelCoverageGaps.map((g) => g.regimeTag);
    expect(tags).toContain("magnus");
    expect(tags).toContain("stiff/stokes");
    for (const gap of recorded.modelCoverageGaps) {
      expect(gap.reason.length).toBeGreaterThan(40);
    }
    // A coverage gap is not a verdict: no row may carry the model-gap verdict,
    // because every row here is a scenario that actually ran.
    for (const row of recorded.rows) {
      expect(row.verdict).not.toBe("model-gap");
    }
  });

  it("keeps every row's clock comfortably able to resolve its own step", () => {
    // The mechanism the study identified. Rows are only meaningful while
    // ulp32(t)/h is small; the control that breaks it lives in
    // planar-precision-study.test.ts.
    for (const row of recorded.rows) {
      expect(row.clockResolutionPerStep, `${row.id} clock too coarse`).toBeLessThan(1e-2);
    }
  });

  it("carries no timing, throughput or bandwidth figure", () => {
    // P7.17 is about error. The claim commit said no cost number belongs here,
    // and this is that promise made checkable rather than left as prose.
    // Scanned over the measured data only. The notes field is prose that names
    // these words precisely in order to disclaim them, so including it would
    // make the check fail on the sentence promising the thing it checks.
    const measured = JSON.stringify({
      rows: recorded.rows,
      stiffnessSweep: recorded.stiffnessSweep,
    }).toLowerCase();
    for (const word of ["throughput", "bandwidth", "millisecond", "nanosecond", "fps", "elapsed"]) {
      expect(measured, `results mention ${word}`).not.toContain(word);
    }
  });
});
