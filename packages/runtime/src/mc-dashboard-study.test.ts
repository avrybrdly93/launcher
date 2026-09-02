import { describe, expect, it } from "vitest";
import {
  PRESET_SCENARIOS,
  generateReplicate,
  uncertainScenarioSpecSchema,
  type ScenarioSpec,
  type UncertainScenarioSpec,
} from "@ballista/engine";
import { PLANAR_LAYOUT, range, resampleOnGrid, type Target } from "@ballista/analysis";
import {
  HermiteDenseOutputStepper,
  TrajectoryRecorder,
  integrate,
  type Trajectory,
} from "@ballista/solverkit";
import { MC_T_MAX_SECONDS } from "./mc-job.js";
import { resolveModel, resolveSolverConfig, resolveStepper } from "./scenario-resolver.js";
import {
  DEFAULT_FAN_REPLICATES,
  McDashboardStudyCancelled,
  mcDashboardCost,
  mcDashboardStudySteps,
  runMcDashboardStudy,
  type McDashboardProgress,
  type McDashboardStage,
} from "./mc-dashboard-study.js";

const GOLF_DRIVE = PRESET_SCENARIOS.find((s) => s.model.forceIds.includes("magnus"))!;

/** The golf drive the P6.24 criterion names, launched from the origin. */
const BASE: ScenarioSpec = {
  ...GOLF_DRIVE,
  initialConditions: { ...GOLF_DRIVE.initialConditions, x0: 0, y0: 0 },
};

function study(overrides: Partial<UncertainScenarioSpec> = {}): UncertainScenarioSpec {
  return uncertainScenarioSpecSchema.parse({
    schemaVersion: 1,
    base: BASE,
    overlays: [
      {
        path: "initialConditions.vx0",
        distribution: { kind: "normal", mean: BASE.initialConditions.vx0, stdDev: 1.5 },
      },
      {
        path: "initialConditions.vy0",
        distribution: { kind: "normal", mean: BASE.initialConditions.vy0, stdDev: 1.0 },
      },
    ],
    replicates: 24,
    seed: 20260902,
    ...overrides,
  });
}

/** A ground target far enough downrange that roughly half the ensemble reaches it. */
function pointTarget(x: number, tolerance: number): Target {
  return { kind: "point", center: [x, 0], tolerance };
}

/** Everything a caller could want, at a size a unit test can afford. */
function run(overrides: Partial<UncertainScenarioSpec> = {}, fanReplicates = 8) {
  return runMcDashboardStudy(
    { study: study(overrides), target: pointTarget(180, 1e4) },
    { fanReplicates, fanGridPoints: 24 },
  );
}

describe("P6.24 mcDashboardCost is arithmetic, not an estimate", () => {
  it("counts one integration per replicate plus one per retained trajectory", () => {
    expect(mcDashboardCost(500, 32)).toEqual({ ensemble: 500, fan: 32, total: 532 });
  });

  it("clamps the fan to the ensemble, so a small study cannot promise more than it has", () => {
    expect(mcDashboardCost(4, 32)).toEqual({ ensemble: 4, fan: 4, total: 8 });
  });

  it("agrees with what the run actually reports", () => {
    const reports: McDashboardProgress[] = [];
    const result = runMcDashboardStudy(
      { study: study(), target: pointTarget(180, 1e4) },
      { fanReplicates: 8, fanGridPoints: 24 },
      { onProgress: (p) => reports.push(p) },
    );
    expect(result.cost).toEqual(mcDashboardCost(24, 8));
    expect(reports).toHaveLength(result.cost.total);
    expect(reports.at(-1)?.completed).toBe(result.cost.total);
  });
});

describe("P6.24 the fan and the columns describe the SAME ensemble", () => {
  /**
   * The claim this suite exists for. P6.04's batch retains no trajectories, so
   * the fan has to integrate its replicates a second time; the design choice
   * is that it re-runs indices `[0, fanReplicates)` of the *same study* rather
   * than drawing a fresh sample. P6.03 makes replicate `i` a pure function of
   * the study seed and `i`, so those are the same flights -- but "so it should
   * be" is not evidence, and a fan quietly built from a different seed, a
   * different base, or a different horizon would still produce a plausible
   * picture. This measures it: the retained trajectory's own range, computed
   * by `observables.ts` the ordinary way, against the batch's `range` column.
   */
  it("a retained trajectory's range is the batch's own range for that replicate", () => {
    // The most direct form of the claim, and the one that would catch a fan
    // built from a different seed, base or horizon: re-derive the prefix the
    // ordinary way -- draw, integrate, ask `observables.ts` -- and require it
    // to reproduce the column the batch wrote.
    const fanReplicates = 4;
    const spec = study();
    const result = runMcDashboardStudy(
      { study: spec, target: pointTarget(180, 1e4) },
      { fanReplicates, fanGridPoints: 16 },
    );
    for (let i = 0; i < fanReplicates; i += 1) {
      expect(range(referenceTrajectory(spec, i), PLANAR_LAYOUT)).toBeCloseTo(
        result.columns.range[i] as number,
        9,
      );
    }
  });

  it("the fan spans exactly the prefix it retained, not the whole batch", () => {
    // buildCommonGrid spans the union of the retained flights, so its right
    // endpoint is the longest of *those*: the maximum over the first
    // `fanReplicates` times of flight, not over all N. A fan that quietly
    // recorded a different set of indices would fail here even though its
    // bands still looked like a fan.
    const fanReplicates = 8;
    const result = run({}, fanReplicates);
    const prefix = Array.from(result.columns.timeOfFlight).slice(0, fanReplicates);
    expect(result.fan.grid[result.fan.grid.length - 1]).toBeCloseTo(Math.max(...prefix), 6);
    expect(result.fan.grid[0]).toBeCloseTo(0, 12);
  });

  it("the bands themselves are those replicates' heights, resampled", () => {
    // The strongest form of the claim, and the one that pins the *bands*
    // rather than the grid they sit on. With two retained replicates and
    // levels {0, 1} the bands are exactly the pointwise min and max of the
    // two flights, so they can be reconstructed here from trajectories
    // re-derived through `generateReplicate` + `integrate` + `resampleOnGrid`
    // -- none of which this module's fan path is allowed to influence.
    const spec = study();
    const result = runMcDashboardStudy(
      { study: spec, target: pointTarget(180, 1e4) },
      { fanReplicates: 2, fanGridPoints: 16, fanLevels: [0, 1] },
    );
    const resampled = [0, 1].map((i) =>
      resampleOnGrid(referenceTrajectory(spec, i), result.fan.grid, {
        valueChannel: PLANAR_LAYOUT.position[PLANAR_LAYOUT.vertical] as number,
        derivativeChannel: PLANAR_LAYOUT.velocity[PLANAR_LAYOUT.vertical] as number,
      }),
    );
    for (let g = 0; g < result.fan.grid.length; g += 1) {
      const finite = resampled.map((s) => s[g] as number).filter(Number.isFinite);
      if (finite.length === 0) continue;
      expect(result.fan.bands[0]?.[g]).toBe(Math.min(...finite));
      expect(result.fan.bands[1]?.[g]).toBe(Math.max(...finite));
    }
  });

  it("the fan's bands at t=0 are the launch height every replicate shares", () => {
    const result = run();
    const medianIndex = result.fan.levels.indexOf(0.5);
    expect(medianIndex).toBeGreaterThanOrEqual(0);
    // Every replicate launches from y0 = 0 -- the overlays move vx0 and vy0,
    // not the launch point -- so the first grid point has zero spread and
    // every band must agree there. A fan built from some other ensemble would
    // have no reason to.
    for (const band of result.fan.bands) {
      expect(band[0]).toBeCloseTo(BASE.initialConditions.y0, 12);
    }
  });

  it("the fan is a sub-sample, so its replicate count is min(request, N)", () => {
    expect(run({}, 8).fanReplicates).toBe(8);
    expect(run({ replicates: 6 }, 32).fanReplicates).toBe(6);
  });

  it("has teeth: a different study seed moves the ensemble it would describe", () => {
    // Without this the agreement above could hold for a fan built from any
    // ensemble at all -- including one whose seed was ignored.
    const a = run();
    const b = run({ seed: 777 });
    expect(a.columns.range[0]).not.toBeCloseTo(b.columns.range[0]!, 6);
  });
});

/**
 * A study in which roughly half the replicates never reach the ground inside
 * `MC_T_MAX_SECONDS`, so the landed-subset filter is not a no-op.
 *
 * It exists because the golf-drive fixture cannot exercise it: every golf
 * drive lands in about six seconds, so `unlandedCount` is 0 and a build that
 * scored *every* replicate would agree with one that scored only the landed
 * ones. Drag-free flight has `T = 2·vy0/g`, so `T > 60 s` is exactly
 * `vy0 > 294.3 m/s`; centring the overlay there splits the ensemble.
 */
const DRAG_FREE = PRESET_SCENARIOS.find((s) => s.model.forceIds.length === 1)!;

function halfLandingStudy(): UncertainScenarioSpec {
  return uncertainScenarioSpecSchema.parse({
    schemaVersion: 1,
    base: { ...DRAG_FREE, initialConditions: { ...DRAG_FREE.initialConditions, x0: 0, y0: 0 } },
    overlays: [
      { path: "initialConditions.vy0", distribution: { kind: "normal", mean: 294, stdDev: 15 } },
    ],
    replicates: 24,
    seed: 4242,
  });
}

describe("P6.24 replicates that never landed are excluded, not scored as misses", () => {
  it("the fixture really does strand some replicates, or the rest of this proves nothing", () => {
    const result = runMcDashboardStudy(
      { study: halfLandingStudy(), target: pointTarget(5000, 1e6) },
      { fanReplicates: 4, fanGridPoints: 16 },
    );
    expect(result.unlandedCount).toBeGreaterThan(0);
    expect(result.unlandedCount).toBeLessThan(result.stats.count);
  });

  it("scores the landed subset and nothing else", () => {
    // This is the assertion the golf-drive fixture cannot make: with every
    // replicate landing, `shots === landedCount` and `shots === count` are the
    // same statement. Here they are not, and only the first is true.
    const result = runMcDashboardStudy(
      { study: halfLandingStudy(), target: pointTarget(5000, 1e6) },
      { fanReplicates: 4, fanGridPoints: 16 },
    );
    expect(result.hit.shots).toBe(result.stats.landedCount);
    expect(result.hit.shots).toBeLessThan(result.stats.count);
    expect(result.stats.landedCount + result.unlandedCount).toBe(result.stats.count);
  });

  it("so p̂ is conditional on landing, and differs from the unconditional rate", () => {
    // Worth stating as a number rather than only in a doc comment: the reported
    // p̂ is `hits / landed`, which is strictly larger than `hits / N` whenever
    // anything failed to land. Neither is wrong; they answer different
    // questions, and `unlandedCount` is reported so a reader can tell which one
    // is on the screen.
    const result = runMcDashboardStudy(
      { study: halfLandingStudy(), target: pointTarget(5000, 1e6) },
      { fanReplicates: 4, fanGridPoints: 16 },
    );
    const unconditional = result.hit.successes / result.stats.count;
    expect(result.hit.pHat).toBeGreaterThan(unconditional);
    expect(result.hit.pHat).toBe(result.hit.successes / result.stats.landedCount);
  });
});

describe("P6.24 hit probability is scored on the landed subset, and says so", () => {
  it("scores exactly the replicates that landed", () => {
    const result = run();
    expect(result.hit.shots).toBe(result.stats.landedCount);
    expect(result.unlandedCount).toBe(result.stats.count - result.stats.landedCount);
  });

  it("a golf drive over 60 s lands every replicate, so the conditioning is vacuous", () => {
    const result = run();
    expect(result.unlandedCount).toBe(0);
    expect(result.hit.shots).toBe(result.stats.count);
  });

  it("a target the whole ensemble reaches gives p̂ = 1 with an upper bound of exactly 1", () => {
    // Tolerance 1e4 m swallows the entire spread, so every impact is a hit.
    // The Wilson interval's upper bound is pinned to exactly 1 at k = n
    // (hit-probability.ts), which is a claim worth asserting from a consumer.
    const result = runMcDashboardStudy(
      { study: study(), target: pointTarget(180, 1e4) },
      { fanReplicates: 4, fanGridPoints: 16 },
    );
    expect(result.hit.pHat).toBe(1);
    expect(result.hit.upper).toBe(1);
    expect(result.hit.lower).toBeLessThan(1);
  });

  it("a target nothing reaches gives p̂ = 0 with a lower bound of exactly 0", () => {
    const result = runMcDashboardStudy(
      { study: study(), target: pointTarget(1e6, 1) },
      { fanReplicates: 4, fanGridPoints: 16 },
    );
    expect(result.hit.pHat).toBe(0);
    expect(result.hit.lower).toBe(0);
    expect(result.hit.upper).toBeGreaterThan(0);
  });

  it("a target only part of the ensemble reaches gives an interval that is not degenerate", () => {
    // The control on the two saturated cases above: an estimator returning a
    // constant 0 or 1 would pass both of them.
    const result = run();
    const median = quantile(landedRanges(result.columns), 0.5);
    const partial = runMcDashboardStudy(
      { study: study(), target: pointTarget(median, 1) },
      { fanReplicates: 4, fanGridPoints: 16 },
    );
    expect(partial.hit.pHat).toBeGreaterThan(0);
    expect(partial.hit.pHat).toBeLessThan(1);
    expect(partial.hit.lower).toBeGreaterThan(0);
    expect(partial.hit.upper).toBeLessThan(1);
  });
});

describe("P6.24 the study is reproducible", () => {
  it("two runs of the same spec agree bit for bit on every column", () => {
    const a = run();
    const b = run();
    expect(Array.from(a.columns.range)).toEqual(Array.from(b.columns.range));
    expect(Array.from(a.columns.timeOfFlight)).toEqual(Array.from(b.columns.timeOfFlight));
    expect(Array.from(a.columns.landed)).toEqual(Array.from(b.columns.landed));
  });

  it("and on every fan band, which is the half that re-integrates", () => {
    const a = run();
    const b = run();
    expect(a.fan.bands.map((band) => Array.from(band))).toEqual(
      b.fan.bands.map((band) => Array.from(band)),
    );
  });
});

describe("P6.24 the ensemble actually varies", () => {
  it("the overlays produce a spread, so the histogram has something to show", () => {
    const result = run();
    expect(result.stats.range.variance).toBeGreaterThan(0);
    expect(result.stats.range.max).toBeGreaterThan(result.stats.range.min);
  });

  it("the fan's bands are ordered wherever they are finite", () => {
    const result = run();
    for (let g = 0; g < result.fan.grid.length; g += 1) {
      const column = result.fan.bands.map((band) => band[g] as number).filter(Number.isFinite);
      for (let k = 1; k < column.length; k += 1) {
        expect(column[k]).toBeGreaterThanOrEqual(column[k - 1] as number);
      }
    }
  });

  it("reports a finite common support end, so a chart can say where the bands stop meaning one thing", () => {
    const result = run();
    expect(Number.isFinite(result.fan.commonSupportEnd)).toBe(true);
    expect(result.fan.commonSupportEnd).toBeGreaterThan(0);
  });
});

describe("P6.24 progress is reported per replicate, in two named stages", () => {
  it("reports the ensemble stage first and the fan stage second, never interleaved", () => {
    const reports: McDashboardProgress[] = [];
    runMcDashboardStudy(
      { study: study(), target: pointTarget(180, 1e4) },
      { fanReplicates: 5, fanGridPoints: 16 },
      { onProgress: (p) => reports.push(p) },
    );
    const stages = reports.map((r) => r.stage);
    expect(stages.filter((s) => s === "ensemble")).toHaveLength(24);
    expect(stages.filter((s) => s === "fan")).toHaveLength(5);
    expect(stages.indexOf("fan")).toBe(24);
  });

  it("counts monotonically across both stages against one total", () => {
    const reports: McDashboardProgress[] = [];
    runMcDashboardStudy(
      { study: study(), target: pointTarget(180, 1e4) },
      { fanReplicates: 5, fanGridPoints: 16 },
      { onProgress: (p) => reports.push(p) },
    );
    reports.forEach((report, index) => {
      expect(report.completed).toBe(index + 1);
      expect(report.total).toBe(29);
    });
  });
});

describe("P6.24 cancellation is cooperative and reports how far it got", () => {
  it("stops inside the ensemble stage", () => {
    const signal = { aborted: false };
    let seen = 0;
    expect(() =>
      runMcDashboardStudy(
        { study: study(), target: pointTarget(180, 1e4) },
        { fanReplicates: 8, fanGridPoints: 16 },
        {
          signal,
          onProgress: (p) => {
            seen = p.completed;
            if (p.completed === 5) signal.aborted = true;
          },
        },
      ),
    ).toThrow(McDashboardStudyCancelled);
    expect(seen).toBe(5);
  });

  it("stops inside the fan stage too, which is the half a naive check would miss", () => {
    // A signal read only at the top of the ensemble loop would let a cancelled
    // study run every retained trajectory to completion before noticing.
    const signal = { aborted: false };
    let error: unknown;
    try {
      runMcDashboardStudy(
        { study: study(), target: pointTarget(180, 1e4) },
        { fanReplicates: 8, fanGridPoints: 16 },
        {
          signal,
          onProgress: (p) => {
            if (p.stage === "fan" && p.completed === 26) signal.aborted = true;
          },
        },
      );
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(McDashboardStudyCancelled);
    expect((error as McDashboardStudyCancelled).completed).toBe(26);
  });

  it("a signal that never aborts changes nothing", () => {
    const withSignal = runMcDashboardStudy(
      { study: study(), target: pointTarget(180, 1e4) },
      { fanReplicates: 8, fanGridPoints: 24 },
      { signal: { aborted: false } },
    );
    expect(Array.from(withSignal.columns.range)).toEqual(Array.from(run().columns.range));
  });
});

describe("P6.24 refuses inputs it cannot answer for", () => {
  it("rejects a fan of fewer than two replicates", () => {
    expect(() =>
      runMcDashboardStudy({ study: study(), target: pointTarget(180, 1e4) }, { fanReplicates: 1 }),
    ).toThrow(/fanReplicates must be an integer >= 2/);
  });

  it("rejects a non-integer fan size rather than rounding it", () => {
    expect(() =>
      runMcDashboardStudy(
        { study: study(), target: pointTarget(180, 1e4) },
        { fanReplicates: 4.5 },
      ),
    ).toThrow(/fanReplicates must be an integer >= 2/);
  });

  it("defaults the fan to a size at which the outer bands are interpolated, not a single point", () => {
    expect(DEFAULT_FAN_REPLICATES).toBeGreaterThanOrEqual(32);
  });
});

/** The landed subset of the range column, ascending. */
function landedRanges(columns: { range: Float64Array; landed: Uint8Array }): number[] {
  const kept: number[] = [];
  for (let i = 0; i < columns.range.length; i += 1) {
    if (columns.landed[i] === 1) kept.push(columns.range[i] as number);
  }
  return kept.sort((a, b) => a - b);
}

/** Nearest-rank quantile of an ascending array; enough for choosing a test target. */
function quantile(sorted: readonly number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] as number;
}

/**
 * Re-derives one replicate's trajectory the ordinary way -- draw the spec,
 * resolve it, integrate with a recorder -- so an assertion can compare the
 * module's output against `observables.ts` rather than against the module's
 * own bookkeeping. Mirrors `mc-job.test.ts`'s `reference` helper.
 */
function referenceTrajectory(spec: UncertainScenarioSpec, index: number): Trajectory {
  const { spec: drawn } = generateReplicate(spec, index);
  const { model, ctx, y0 } = resolveModel(drawn);
  const resolved = resolveStepper(drawn.solver.stepper);
  const stepper = resolved.interpolant ? resolved : new HermiteDenseOutputStepper(resolved);
  const recorder = new TrajectoryRecorder();
  integrate(model, ctx, y0, [0, MC_T_MAX_SECONDS], resolveSolverConfig(drawn), stepper, [recorder]);
  return recorder.trajectory;
}

describe("P6.24 the generator is what makes a UI Cancel button real", () => {
  it("yields once per replicate and returns the same result the drain does", () => {
    // One implementation, not two: runMcDashboardStudy is this generator
    // drained, so a divergence here would mean the synchronous path and the
    // UI path disagree about the same study.
    const spec = { study: study(), target: pointTarget(180, 1e4) } as const;
    const options = { fanReplicates: 4, fanGridPoints: 16 } as const;

    const steps = mcDashboardStudySteps(spec, options);
    const yielded: McDashboardProgress[] = [];
    let next = steps.next();
    while (next.done !== true) {
      yielded.push(next.value);
      next = steps.next();
    }

    const drained = runMcDashboardStudy(spec, options);
    expect(yielded).toHaveLength(drained.cost.total);
    expect(Array.from(next.value.columns.range)).toEqual(Array.from(drained.columns.range));
    expect(next.value.fan.bands.map((b) => Array.from(b))).toEqual(
      drained.fan.bands.map((b) => Array.from(b)),
    );
  });

  it("stops doing work the moment the caller stops asking", () => {
    // The property the route depends on: abandoning the generator after k
    // steps costs k integrations, not N. A driver that awaited the event loop
    // between steps and then walked away must not leave the study running.
    const spec = { study: study({ replicates: 40 }), target: pointTarget(180, 1e4) } as const;
    const steps = mcDashboardStudySteps(spec, { fanReplicates: 4, fanGridPoints: 16 });

    for (let i = 0; i < 3; i += 1) steps.next();
    expect(steps.return(undefined as never).done).toBe(true);
    // Once returned, the generator is finished and cannot be resumed.
    expect(steps.next().done).toBe(true);
  });

  it("validates its options before the first yield, not partway through", () => {
    // A caller that received three progress reports and then a RangeError
    // would have painted a bar for a study that was never going to finish.
    const steps = mcDashboardStudySteps(
      { study: study(), target: pointTarget(180, 1e4) },
      { fanReplicates: 1 },
    );
    expect(() => steps.next()).toThrow(/fanReplicates must be an integer >= 2/);
  });
});

describe("P6.25 steps carry partial estimates, so the interval narrows during the run", () => {
  /** Every partial a run emitted, in order. */
  function partialsOf(
    spec: Parameters<typeof mcDashboardStudySteps>[0],
    options: Parameters<typeof mcDashboardStudySteps>[1] = {},
  ) {
    const steps = mcDashboardStudySteps(spec, options);
    const partials: NonNullable<McDashboardProgress["partial"]>[] = [];
    const stages: McDashboardStage[] = [];
    for (;;) {
      const next = steps.next();
      if (next.done === true) return { partials, stages, result: next.value };
      if (next.value.partial !== undefined) {
        partials.push(next.value.partial);
        stages.push(next.value.stage);
      }
    }
  }

  const SPEC = { study: study({ replicates: 32 }), target: pointTarget(180, 1e4) } as const;
  const OPTS = { fanReplicates: 4, fanGridPoints: 16, partialEvery: 8 } as const;

  it("emits one partial per cadence step, and none in between", () => {
    const { partials } = partialsOf(SPEC, OPTS);
    // 32 replicates every 8 -> after 8, 16, 24, 32. The last is both on the
    // cadence and the final replicate, and must not be emitted twice.
    expect(partials.map((p) => p.sampled)).toEqual([8, 16, 24, 32]);
  });

  it("always takes a final partial even when the cadence would not land on it", () => {
    // 30 is not a multiple of 8, so without the end-of-stage rule the last
    // partial a caller saw would cover 24 of 30 replicates while the result
    // beside it covered all 30 — two different numbers, no way to tell why.
    const { partials, result } = partialsOf(
      { study: study({ replicates: 30 }), target: pointTarget(180, 1e4) },
      OPTS,
    );
    expect(partials.at(-1)!.sampled).toBe(30);
    expect(partials.at(-1)!.hit).toEqual(result.hit);
  });

  it("the last partial IS the final result, not a second reduction that agrees", () => {
    // One implementation reported twice. If these ever diverge, the dashboard
    // would show an interval that jumps at the instant the run completes.
    const { partials, result } = partialsOf(SPEC, OPTS);
    const last = partials.at(-1)!;
    expect(last.sampled).toBe(32);
    expect(last.hit).toEqual(result.hit);
    expect(last.unlandedCount).toBe(result.unlandedCount);
  });

  it("never emits a partial on a fan step", () => {
    // The fan re-runs replicates the ensemble already scored, so a partial
    // there would restate the final estimate while appearing to refine it.
    const { stages } = partialsOf(SPEC, OPTS);
    expect(stages.every((s) => s === "ensemble")).toBe(true);
  });

  it("the interval narrows across the run — the task's validation criterion", () => {
    // The criterion is "CI band visibly narrows during run", made mechanical:
    // the Wilson half-width at the end is materially smaller than at the first
    // partial. Asserted end-to-end rather than step-to-step because the
    // partials are nested prefixes of one ensemble and therefore correlated —
    // a later replicate that disagrees can widen the band momentarily, and a
    // monotonic assertion would encode a belief about confidence intervals
    // that is simply false.
    const { partials } = partialsOf(
      { study: study({ replicates: 64 }), target: pointTarget(180, 1e4) },
      { fanReplicates: 4, fanGridPoints: 16, partialEvery: 8 },
    );
    const width = (p: (typeof partials)[number]) => p.hit.upper - p.hit.lower;
    expect(partials.length).toBeGreaterThan(4);
    expect(width(partials.at(-1)!)).toBeLessThan(width(partials[0]!));
  });

  it("has teeth: the first partial really is drawn from fewer replicates", () => {
    // Guards the test above against passing on a stream that emitted the same
    // finished estimate every time — which would also show a narrowing of zero.
    const { partials } = partialsOf(SPEC, OPTS);
    expect(partials[0]!.hit.shots).toBeLessThan(partials.at(-1)!.hit.shots);
  });

  it("a partial is scored on the landed prefix, exactly as the final result is", () => {
    const { partials } = partialsOf(
      { study: halfLandingStudy(), target: pointTarget(5000, 1e6) },
      { fanReplicates: 4, fanGridPoints: 16, partialEvery: 4 },
    );
    for (const p of partials) {
      expect(p.hit.shots + p.unlandedCount).toBe(p.sampled);
      expect(p.hit.shots).toBeGreaterThan(0);
    }
  });

  it("reports not knowing by absence rather than by a fabricated zero", () => {
    // Nothing lands inside the horizon here, so there is no ensemble to score.
    // `hitProbability` throws on that rather than reporting p̂ = 0, and the
    // stream must not turn that into a crash — or into a zero.
    const nothingLands = uncertainScenarioSpecSchema.parse({
      schemaVersion: 1,
      base: { ...DRAG_FREE, initialConditions: { ...DRAG_FREE.initialConditions, x0: 0, y0: 0 } },
      overlays: [
        { path: "initialConditions.vy0", distribution: { kind: "normal", mean: 600, stdDev: 1 } },
      ],
      replicates: 8,
      seed: 99,
    });
    const steps = mcDashboardStudySteps(
      { study: nothingLands, target: pointTarget(5000, 1e6) },
      { fanReplicates: 4, fanGridPoints: 16, partialEvery: 1 },
    );
    const seen: McDashboardProgress[] = [];
    // The study itself still fails at the end — an ensemble with nothing in it
    // cannot be scored — but it must stream progress up to that point without
    // inventing an estimate.
    expect(() => {
      for (;;) {
        const next = steps.next();
        if (next.done === true) return;
        seen.push(next.value);
      }
    }).toThrow(RangeError);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s.partial === undefined)).toBe(true);
  });

  it("takes no partial at all when the cadence is coarser than the study", () => {
    // partialEvery beyond N leaves only the end-of-stage rule, which is the
    // one partial a caller is always entitled to.
    const { partials } = partialsOf(SPEC, { ...OPTS, partialEvery: 1000 });
    expect(partials.map((p) => p.sampled)).toEqual([32]);
  });

  it("rejects a partialEvery it cannot honour, before the first yield", () => {
    const steps = mcDashboardStudySteps(SPEC, { ...OPTS, partialEvery: 0 });
    expect(() => steps.next()).toThrow(/partialEvery must be an integer >= 1/);
  });

  it("does not change what the study computes", () => {
    // A stream that altered the answer would be a bug dressed as a feature.
    // Two cadences, same seed, identical result.
    const a = runMcDashboardStudy(SPEC, { ...OPTS, partialEvery: 1 });
    const b = runMcDashboardStudy(SPEC, { ...OPTS, partialEvery: 1000 });
    expect(a.hit).toEqual(b.hit);
    expect(Array.from(a.columns.range)).toEqual(Array.from(b.columns.range));
  });

  it("reaches the synchronous runner's onProgress too", () => {
    // runMcDashboardStudy is the generator drained; partials must survive that
    // path as well, or a worker entry using it would stream counts only.
    const seen: McDashboardProgress[] = [];
    runMcDashboardStudy(SPEC, OPTS, { onProgress: (p) => seen.push(p) });
    expect(seen.filter((s) => s.partial !== undefined).length).toBe(4);
  });
});
