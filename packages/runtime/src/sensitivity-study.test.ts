import { describe, expect, it } from "vitest";

import {
  DEFAULT_BASE_SAMPLES,
  runSensitivityStudy,
  SensitivityStudyCancelled,
  sensitivityStudyCost,
  type SensitivityStudyProgress,
  type SensitivityStudySpec,
} from "./sensitivity-study.js";

/**
 * An additive model, chosen because both estimators have an exact answer on it
 * and neither can be flattered by a lucky sample: the tornado's ranking is the
 * coefficient ranking, and the Sobol' interaction share is zero. The tests
 * below mostly assert this module's own contract — counting, progress and
 * cancellation — but running them against a model with a known answer means a
 * wiring mistake shows up as a wrong number rather than as a plausible one.
 */
const COEFFICIENTS = [4, 2, 1] as const;

function additiveSpec(overrides: Partial<SensitivityStudySpec> = {}): SensitivityStudySpec {
  return {
    inputs: ["v0", "theta", "cd"],
    sigmas: [0.1, 0.1, 0.1],
    evaluateDisplacement: (delta) =>
      100 + COEFFICIENTS.reduce((sum, c, k) => sum + c * (delta[k] ?? 0), 0),
    evaluateUnitPoint: (u) => COEFFICIENTS.reduce((sum, c, k) => sum + c * (u[k] ?? 0), 0),
    ...overrides,
  };
}

describe("sensitivityStudyCost", () => {
  it("charges two endpoints per input plus the one nominal every bar is measured from", () => {
    expect(sensitivityStudyCost(3, 64).tornado).toBe(7);
    expect(sensitivityStudyCost(1, 64).tornado).toBe(3);
  });

  it("charges N(d+2) for the pick-and-freeze construction", () => {
    expect(sensitivityStudyCost(3, 64).sobol).toBe(64 * 5);
    expect(sensitivityStudyCost(5, 128).sobol).toBe(128 * 7);
  });

  it("totals the two stages", () => {
    const cost = sensitivityStudyCost(3, 64);
    expect(cost.total).toBe(cost.tornado + cost.sobol);
  });

  it("defaults to a base-sample count cheap enough to sit behind a UI control", () => {
    expect(sensitivityStudyCost(3).sobol).toBe(DEFAULT_BASE_SAMPLES * 5);
  });

  it("rejects an input count or base-sample count that is not a positive integer", () => {
    expect(() => sensitivityStudyCost(0, 64)).toThrow(/positive integer/);
    expect(() => sensitivityStudyCost(2.5, 64)).toThrow(/positive integer/);
    expect(() => sensitivityStudyCost(3, 0)).toThrow(/positive integer/);
    expect(() => sensitivityStudyCost(3, 1.5)).toThrow(/positive integer/);
  });
});

describe("runSensitivityStudy", () => {
  it("performs exactly the number of evaluations it predicted", () => {
    const cost = sensitivityStudyCost(3, 64);
    const result = runSensitivityStudy(additiveSpec(), { baseSamples: 64 });
    expect(result.evaluations).toBe(cost.total);
    expect(result.sobol.evaluations).toBe(cost.sobol);
  });

  it("reports progress once per evaluation, counting up to the predicted total", () => {
    const seen: SensitivityStudyProgress[] = [];
    const cost = sensitivityStudyCost(3, 64);

    runSensitivityStudy(
      additiveSpec(),
      { baseSamples: 64 },
      { onProgress: (progress) => seen.push(progress) },
    );

    expect(seen).toHaveLength(cost.total);
    // Strictly one at a time, so a progress bar can never jump or go backwards.
    expect(seen.map((p) => p.completed)).toEqual(
      Array.from({ length: cost.total }, (_, i) => i + 1),
    );
    // The denominator is fixed before the run, which is what makes the bar
    // determinate from the first frame rather than growing as it discovers work.
    expect(new Set(seen.map((p) => p.total))).toEqual(new Set([cost.total]));
  });

  it("runs the cheap tornado stage first, so a ranking is drawable almost immediately", () => {
    const seen: SensitivityStudyProgress[] = [];
    const cost = sensitivityStudyCost(3, 64);

    runSensitivityStudy(
      additiveSpec(),
      { baseSamples: 64 },
      { onProgress: (progress) => seen.push(progress) },
    );

    const stages = seen.map((p) => p.stage);
    expect(stages.slice(0, cost.tornado)).toEqual(Array(cost.tornado).fill("tornado"));
    expect(stages.slice(cost.tornado)).toEqual(Array(cost.sobol).fill("sobol"));
  });

  it("returns both answers, and they agree with the additive model they were run on", () => {
    const result = runSensitivityStudy(additiveSpec(), { baseSamples: 512, seed: 7 });

    // The tornado ranks by |coefficient| × sigma; the sigmas are equal here, so
    // it is the coefficient ranking.
    expect(result.tornado.order).toEqual([0, 1, 2]);
    expect(result.tornado.nominal).toBe(100);

    // An additive model has no interactions; every S_T_k should equal its S_k.
    expect(result.sobol.interactionShare).toBeCloseTo(0, 2);
    for (const index of result.sobol.indices) {
      expect(index.interaction).toBeCloseTo(0, 2);
    }
  });

  it("reproduces exactly on the same seed and differs on another", () => {
    const first = runSensitivityStudy(additiveSpec(), { baseSamples: 64, seed: 3 });
    const again = runSensitivityStudy(additiveSpec(), { baseSamples: 64, seed: 3 });
    const other = runSensitivityStudy(additiveSpec(), { baseSamples: 64, seed: 4 });

    expect(again.sobol.indices.map((i) => i.first)).toEqual(
      first.sobol.indices.map((i) => i.first),
    );
    expect(other.sobol.indices.map((i) => i.first)).not.toEqual(
      first.sobol.indices.map((i) => i.first),
    );
  });

  it("rejects a spec whose names and sigmas index different numbers of inputs", () => {
    expect(() => runSensitivityStudy(additiveSpec({ sigmas: [0.1, 0.1] }))).toThrow(/2 sigma\(s\)/);
  });
});

describe("runSensitivityStudy cancellation", () => {
  /** A signal that flips to aborted once `after` evaluations have been counted. */
  function signalAfter(after: number) {
    const state = { count: 0, aborted: false };
    return {
      state,
      signal: {
        get aborted() {
          return state.aborted;
        },
      },
      note() {
        state.count += 1;
        if (state.count >= after) state.aborted = true;
      },
    };
  }

  it("stops mid-tornado and reports how far it got", () => {
    const harness = signalAfter(3);
    const spec = additiveSpec({
      evaluateDisplacement: (delta) => {
        harness.note();
        return 100 + COEFFICIENTS.reduce((sum, c, k) => sum + c * (delta[k] ?? 0), 0);
      },
    });

    let thrown: unknown;
    try {
      runSensitivityStudy(spec, { baseSamples: 64 }, { signal: harness.signal });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SensitivityStudyCancelled);
    expect((thrown as SensitivityStudyCancelled).completed).toBe(3);
    // The point of a cancel is that the remaining work does not happen: the
    // tornado alone would have been 7 evaluations and Sobol' another 320.
    expect(harness.state.count).toBe(3);
  });

  it("stops mid-Sobol, after the tornado has already been paid for", () => {
    const cost = sensitivityStudyCost(3, 64);
    const harness = signalAfter(cost.tornado + 5);
    const base = additiveSpec();
    const spec = additiveSpec({
      evaluateDisplacement: (delta) => {
        harness.note();
        return base.evaluateDisplacement(delta);
      },
      evaluateUnitPoint: (u) => {
        harness.note();
        return base.evaluateUnitPoint(u);
      },
    });

    expect(() =>
      runSensitivityStudy(spec, { baseSamples: 64 }, { signal: harness.signal }),
    ).toThrow(SensitivityStudyCancelled);
    expect(harness.state.count).toBe(cost.tornado + 5);
    expect(harness.state.count).toBeLessThan(cost.total);
  });

  it("stops before the first evaluation when the signal is already aborted", () => {
    let calls = 0;
    const base = additiveSpec();
    const spec = additiveSpec({
      evaluateDisplacement: (delta) => {
        calls += 1;
        return base.evaluateDisplacement(delta);
      },
    });

    let thrown: unknown;
    try {
      runSensitivityStudy(spec, { baseSamples: 64 }, { signal: { aborted: true } });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SensitivityStudyCancelled);
    expect((thrown as SensitivityStudyCancelled).completed).toBe(0);
    expect(calls).toBe(0);
  });

  it("throws rather than returning a heavily censored result, which is a different claim", () => {
    // The regression this guards: signalling a stop by returning `null` from
    // the wrapped evaluate would leave both estimators believing the *model*
    // has no answer at those points, and `runSensitivityStudy` would return a
    // censored result that reads as a finding about the physics. A cancelled
    // study has no answer at all, and says so by throwing.
    const harness = signalAfter(4);
    const base = additiveSpec();
    const spec = additiveSpec({
      evaluateDisplacement: (delta) => {
        harness.note();
        return base.evaluateDisplacement(delta);
      },
    });

    let returned: unknown;
    let thrown: unknown;
    try {
      returned = runSensitivityStudy(spec, { baseSamples: 64 }, { signal: harness.signal });
    } catch (error) {
      thrown = error;
    }

    expect(returned).toBeUndefined();
    expect(thrown).toBeInstanceOf(SensitivityStudyCancelled);
  });

  it("runs to completion when the signal never aborts", () => {
    const cost = sensitivityStudyCost(3, 64);
    const result = runSensitivityStudy(
      additiveSpec(),
      { baseSamples: 64 },
      { signal: { aborted: false } },
    );
    expect(result.evaluations).toBe(cost.total);
  });
});
