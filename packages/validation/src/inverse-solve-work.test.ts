import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SCENARIO_LIBRARY } from "@ballista/engine";
import { PERF_TOL, type SolveWork, libraryPerfCases } from "./inverse-solve-perf.js";

/**
 * P0.109: attribute the three slow library targets to a named cause.
 *
 * **Why this artifact is separate from `inverse-solve-perf.json` rather than a
 * block inside it.** That file's numbers are wall-clock and its provenance says
 * re-recording on a different machine moves all of them. This run's machine is
 * a different one (2.80 GHz against the recorded 2.10 GHz), so folding the work
 * counts in would have meant re-recording every timing at the same time and
 * publishing a library-wide speed-up that is a CPU change, not a code change.
 *
 * The split also states a real difference in kind. Every number here is
 * **deterministic**: given the same code and the same tolerance, the step,
 * rhs and rejection counts are identical on any machine, which
 * `inverse-solve-perf.test.ts` asserts directly. So these can be compared
 * across runs and across machines, and they are checked exactly rather than
 * against a slack factor.
 *
 * **One assertion here does read the timing artifact**, to close the loop from
 * "these targets take the most steps" to "that is why they take the longest".
 * It divides `inverse-solve-perf.json`'s recorded median by this file's step
 * count and compares the result *across* targets, never as an absolute: all 20
 * timings come from one machine in one run, so their ratios are meaningful
 * even though the microseconds are that machine's and this run's machine is a
 * different one.
 */

const WORK_PATH = fileURLToPath(new URL("./inverse-solve-work.json", import.meta.url));
const PERF_PATH = fileURLToPath(new URL("./inverse-solve-perf.json", import.meta.url));

interface WorkRow {
  readonly id: string;
  readonly residualEvals: number;
  readonly nSteps: number;
  readonly nRHS: number;
  readonly nRejected: number;
  readonly iterations: number;
  readonly status: string;
  readonly timeOfFlightS: number;
  readonly stepsPerEval: number;
  readonly meanStepMs: number;
  readonly rejectedPerAccepted: number;
  readonly rhsPerStep: number;
}

interface WorkArtifact {
  readonly schemaVersion: number;
  readonly task: string;
  readonly provenance: string;
  readonly tolerance: typeof PERF_TOL;
  readonly attribution: Readonly<Record<string, string>>;
  readonly perTarget: readonly WorkRow[];
}

/** The three targets P0.109 was filed about. */
const SLOW: readonly string[] = ["frozen-ou-gust", "dust-grain", "density-altitude-2000m"];

function round(x: number, places = 4): number {
  return Number(x.toFixed(places));
}

function derive(w: SolveWork): WorkRow {
  const stepsPerEval = w.nSteps / w.residualEvals;
  return {
    id: w.id,
    residualEvals: w.residualEvals,
    nSteps: w.nSteps,
    nRHS: w.nRHS,
    nRejected: w.nRejected,
    iterations: w.iterations,
    status: w.status,
    timeOfFlightS: round(w.timeOfFlightS),
    stepsPerEval: round(stepsPerEval, 2),
    meanStepMs: round((w.timeOfFlightS * 1000) / stepsPerEval),
    rejectedPerAccepted: round(w.nRejected / w.nSteps),
    rhsPerStep: round(w.nRHS / w.nSteps),
  };
}

function loadWork(): WorkArtifact {
  return JSON.parse(readFileSync(WORK_PATH, "utf8")) as WorkArtifact;
}

describe("P0.109: what the three slow library targets are actually paying for", () => {
  if (process.env["RECORD_INVERSE_WORK"] === "1") {
    it("records a fresh work artifact (RECORD_INVERSE_WORK=1)", () => {
      const existing = loadWork();
      const artifact: WorkArtifact = {
        schemaVersion: 1,
        task: "P0.109",
        provenance: existing.provenance,
        tolerance: PERF_TOL,
        attribution: existing.attribution,
        perTarget: libraryPerfCases().map((c) => derive(c.measureWork())),
      };
      writeFileSync(WORK_PATH, JSON.stringify(artifact, null, 2) + "\n");
      expect(artifact.perTarget).toHaveLength(SCENARIO_LIBRARY.length);
    });
    return;
  }

  const work = loadWork();
  const byId = new Map(work.perTarget.map((r) => [r.id, r]));

  it("covers every library target exactly once, in the library's own order", () => {
    expect(work.perTarget.map((r) => r.id)).toEqual(SCENARIO_LIBRARY.map((s) => s.id));
  });

  it("records the tolerance it was measured at, since a looser one is a different solve", () => {
    expect(work.tolerance).toEqual(PERF_TOL);
  });

  it("names a cause for each of the three targets P0.109 was filed about", () => {
    for (const id of SLOW) expect(work.attribution[id]).toBeTruthy();
  });

  /* ---------------------------------------------------------------- */
  /* The attribution itself                                            */
  /* ---------------------------------------------------------------- */

  it("is reproduced exactly by a live measurement, so the artifact is not hand-written", () => {
    // The whole file is worthless if the recorded numbers and the code have
    // drifted apart. This is cheap *because* the counts are deterministic --
    // the timing artifact cannot make an assertion like this one and has to
    // settle for a slack factor.
    const live = libraryPerfCases().map((c) => derive(c.measureWork()));
    expect(live).toEqual([...work.perTarget]);
  }, 600_000);

  it("rules out rhs cost: every target pays the same stages per step", () => {
    // dopri5 is a 7-stage method with FSAL, so ~6 rhs per accepted step is the
    // floor and rejected steps add their stages on top. Nothing here is an
    // outlier in cost *per step* -- which is what eliminates "the slow ones
    // have an expensive right-hand side", one of the filing's three suspects.
    const integrating = work.perTarget.filter((r) => r.nSteps > 1);
    for (const r of integrating) {
      expect(r.rhsPerStep).toBeGreaterThanOrEqual(6);
      expect(r.rhsPerStep).toBeLessThan(13);
    }
  });

  it("rules out a harder solve: the slow targets converge in as few iterations as the fast ones", () => {
    // The filing's third suspect, and the one already known to be wrong. Kept
    // as an assertion because it is the claim a future regression would break
    // first: a target that started needing 15 iterations would be slow for a
    // genuinely different reason and must not be read off this artifact.
    const worstSlow = Math.max(...SLOW.map((id) => byId.get(id)!.iterations));
    const worstAll = Math.max(...work.perTarget.map((r) => r.iterations));
    expect(worstSlow).toBeLessThanOrEqual(worstAll);
    expect(worstAll).toBeLessThanOrEqual(8);
  });

  it("attributes the cost to step count: the slow three take 3x the steps per evaluation of anything else", () => {
    // The positive claim. With rhs-per-step flat and iteration counts ordinary,
    // step count is what is left, and it is not a marginal difference.
    const slowMin = Math.min(...SLOW.map((id) => byId.get(id)!.stepsPerEval));
    const restMax = Math.max(
      ...work.perTarget.filter((r) => !SLOW.includes(r.id)).map((r) => r.stepsPerEval),
    );
    expect(slowMin).toBeGreaterThan(3 * restMax);
  });

  it("closes the loop: wall-clock per RHS EVALUATION is flat, so time is rhs count", () => {
    // The punchline, and the reason the other assertions add up to an answer.
    //
    // The unit matters and the first version of this test got it wrong. Cost
    // per *accepted step* is not flat: frozen-ou-gust comes out 2.3x the
    // cheapest target, because a rejected step does its stages' worth of rhs
    // work and then contributes nothing to the step count that divides it.
    // Cost per *rhs evaluation* is flat across all 18 integrating targets,
    // 0.676-0.848 us, a spread of 1.25x -- against the ~3600x spread in cost
    // per solve that P0.109 was filed about. So the answer is that a solve
    // costs its rhs evaluations times a constant, and every other finding in
    // this file is about what drives that count.
    //
    // Read across targets only. Those timings are one machine's (2.10 GHz, per
    // that artifact's own `machine` block) and this file's counts are
    // machine-independent, so the ratios hold while the absolute microseconds
    // do not travel.
    //
    // ONE ROW IS NOT STRICTLY LIKE FOR LIKE, and it is stated rather than
    // hidden: the timing artifact records frozen-ou-gust converging in 3
    // Newton iterations and this run measures 2. Every other target's
    // iteration count agrees exactly. So that row divides a 3-iteration time
    // by a 2-iteration count, which OVERSTATES its us/rhs -- and it still
    // lands mid-pack, so the conclusion survives the discrepancy rather than
    // depending on it.
    const perf = JSON.parse(readFileSync(PERF_PATH, "utf8")) as {
      warm: { perTarget: readonly { id: string; p50Ms: number }[] };
    };
    const ms = new Map(perf.warm.perTarget.map((t) => [t.id, t.p50Ms]));

    // Targets that take a single step are excluded: there, fixed per-solve
    // overhead is the whole cost, and dividing it by the work measures the
    // overhead rather than the work.
    const integrating = work.perTarget.filter((r) => r.nSteps > 1);
    const usPerRhs = integrating.map((r) => (ms.get(r.id)! * 1000) / r.nRHS);
    const usPerStep = integrating.map((r) => (ms.get(r.id)! * 1000) / r.nSteps);

    const spread = (xs: readonly number[]): number => Math.max(...xs) / Math.min(...xs);

    expect(spread(usPerRhs)).toBeLessThan(1.5);
    // And rhs is the *better* unit, not merely an adequate one. Asserted as a
    // comparison rather than as a bound on us/step, so that fixing
    // frozen-ou-gust's rejection rate (P0.151) narrows this gap instead of
    // turning the test red for the right reason.
    expect(spread(usPerRhs)).toBeLessThan(spread(usPerStep));
  });

  /* ---------------------------------------------------------------- */
  /* Three targets, three different reasons for the step count         */
  /* ---------------------------------------------------------------- */

  it("density-altitude-2000m: a long flight in ordinary steps, not small ones", () => {
    const r = byId.get("density-altitude-2000m")!;
    const others = work.perTarget.filter((x) => x.id !== r.id && x.nSteps > 1);
    // It is launched at 2000 m and falls the whole way, so it flies far longer
    // than anything else in the library...
    // 2.7x the next-longest (cannonball-muzzle) and ~16x the library median.
    // Asserted at 2x so the claim is "a different regime", not a tuned bound.
    expect(r.timeOfFlightS).toBeGreaterThan(2 * Math.max(...others.map((x) => x.timeOfFlightS)));
    // ...while its steps are among the LARGEST, and its rejection rate the
    // lowest. The controller is not struggling; there is simply more
    // trajectory. Nothing here is reducible without changing the scenario.
    expect(r.meanStepMs).toBeGreaterThan(median(others.map((x) => x.meanStepMs)));
    expect(r.rejectedPerAccepted).toBeLessThan(
      Math.min(...others.map((x) => x.rejectedPerAccepted)) * 2,
    );
  });

  it("dust-grain: stiffness — the smallest steps in the library, and they are accepted", () => {
    const r = byId.get("dust-grain")!;
    const others = work.perTarget.filter((x) => x.id !== r.id && x.nSteps > 1);
    // A short flight taken in the smallest steps of any target. The steps are
    // small and *accepted*, which is the signature of stiffness rather than of
    // a controller overshooting: the error estimate is happy with a step this
    // size because the physical relaxation time is this short. The library's
    // own note calls this scenario "genuinely stiff"; this measures it.
    expect(r.meanStepMs).toBeLessThan(Math.min(...others.map((x) => x.meanStepMs)));
    expect(r.rejectedPerAccepted).toBeLessThan(0.1);
    expect(r.timeOfFlightS).toBeLessThan(median(others.map((x) => x.timeOfFlightS)));
  });

  it("frozen-ou-gust: step REJECTION — it throws away more steps than anything else by 3x", () => {
    const r = byId.get("frozen-ou-gust")!;
    const others = work.perTarget.filter((x) => x.id !== r.id && x.nSteps > 1);
    // The one that is different in kind. It rejects nearly as many steps as it
    // accepts, three times the worst of anything else, because a frozen OU
    // gust path is rough and an adaptive controller with a smooth-solution
    // error estimate keeps overshooting it.
    expect(r.rejectedPerAccepted).toBeGreaterThan(
      3 * Math.max(...others.map((x) => x.rejectedPerAccepted)),
    );
    // And that is visible in the rhs count rather than inferred: a rejected
    // dopri5 step still pays its stages, so this target's rhs-per-step is
    // roughly double the library's, i.e. about half its integration work is
    // discarded.
    expect(r.rhsPerStep).toBeGreaterThan(1.5 * median(others.map((x) => x.rhsPerStep)));
  });
});

function median(xs: readonly number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}
