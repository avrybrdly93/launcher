import { describe, expect, it } from "vitest";

import type { SobolIndices, Tornado, TornadoBar } from "@ballista/analysis";
import type { SensitivityStudyResult } from "@ballista/runtime";

import {
  clampBaseSamples,
  formatInteractionShare,
  formatProgress,
  initialSensitivityStudyState,
  isStudying,
  progressFraction,
  sensitivityStudyReducer,
  sobolBarGeometry,
  SOBOL_SAMPLE_CHOICES,
  summarizeStudy,
  tornadoBarGeometry,
  type SensitivityStudyPanelState,
} from "./sensitivity-study-panel-logic.js";

function bar(overrides: Partial<TornadoBar> & Pick<TornadoBar, "input" | "index">): TornadoBar {
  return {
    low: 0,
    high: 0,
    span: 0,
    halfSpan: 0,
    lowShift: 0,
    highShift: 0,
    asymmetry: 0,
    monotone: true,
    censored: false,
    ...overrides,
  };
}

function tornadoOf(bars: readonly TornadoBar[]): Tornado {
  return {
    nominal: 100,
    scale: 1,
    bars,
    order: bars.map((b) => b.index),
    censored: bars.some((b) => b.censored),
  };
}

function sobolOf(
  indices: readonly {
    input: string;
    index: number;
    first: number;
    total: number;
    firstStandardError?: number;
  }[],
  overrides: Partial<SobolIndices> = {},
): SobolIndices {
  const full = indices.map((i) => ({
    input: i.input,
    index: i.index,
    first: i.first,
    total: i.total,
    interaction: i.total - i.first,
    firstStandardError: i.firstStandardError ?? 0.001,
    totalStandardError: 0.001,
  }));
  const firstOrderSum = full.reduce((s, i) => s + i.first, 0);
  return {
    baseSamples: 1024,
    evaluations: 1024 * (full.length + 2),
    failures: 0,
    censored: false,
    mean: 0,
    variance: 1,
    indices: full,
    firstOrderSum,
    totalSum: full.reduce((s, i) => s + i.total, 0),
    interactionShare: 1 - firstOrderSum,
    ...overrides,
  };
}

function resultOf(tornado: Tornado, sobol: SobolIndices): SensitivityStudyResult {
  return { tornado, sobol, evaluations: sobol.evaluations + 2 * sobol.indices.length + 1 };
}

const SAMPLE_TORNADO = tornadoOf([
  bar({ input: "v0", index: 0, span: 40, halfSpan: 20, low: 80, high: 120 }),
  bar({ input: "theta", index: 1, span: 10, halfSpan: 5, low: 95, high: 105 }),
]);

const SAMPLE_SOBOL = sobolOf([
  { input: "v0", index: 0, first: 0.7, total: 0.75 },
  { input: "theta", index: 1, first: 0.2, total: 0.25 },
]);

const SAMPLE_RESULT = resultOf(SAMPLE_TORNADO, SAMPLE_SOBOL);

describe("sensitivityStudyReducer", () => {
  it("starts from idle with nothing on screen", () => {
    expect(initialSensitivityStudyState.status).toBe("idle");
    expect(isStudying(initialSensitivityStudyState)).toBe(false);
  });

  it("drops a progress report that arrives after a cancel", () => {
    const running = sensitivityStudyReducer(initialSensitivityStudyState, { type: "start" });
    const cancelled = sensitivityStudyReducer(running, { type: "cancelled" });
    const after = sensitivityStudyReducer(cancelled, {
      type: "progress",
      progress: { stage: "sobol", completed: 900, total: 1000 },
    });
    // A bar that keeps filling after the user stopped it is a lie about what
    // is running.
    expect(after).toBe(cancelled);
    expect(after.progress).toBeUndefined();
  });

  it("drops a result that arrives after a cancel — the user's action is what is reported", () => {
    const running = sensitivityStudyReducer(initialSensitivityStudyState, { type: "start" });
    const cancelled = sensitivityStudyReducer(running, { type: "cancelled" });
    const after = sensitivityStudyReducer(cancelled, {
      type: "ready",
      result: SAMPLE_RESULT,
      baseSamples: 1024,
    });
    expect(after.status).toBe("cancelled");
    expect(after.result).toBeUndefined();
  });

  it("keeps the previous result across a cancel, and remembers the N it belongs to", () => {
    let state = sensitivityStudyReducer(initialSensitivityStudyState, { type: "start" });
    state = sensitivityStudyReducer(state, {
      type: "ready",
      result: SAMPLE_RESULT,
      baseSamples: 512,
    });
    state = sensitivityStudyReducer(state, { type: "start" });
    state = sensitivityStudyReducer(state, { type: "cancelled" });

    expect(state.status).toBe("cancelled");
    expect(state.result).toBe(SAMPLE_RESULT);
    // The regression this guards: a reader who moved N to 4096 and then
    // cancelled must not see the surviving 512-sample result labelled 4096.
    expect(state.resultBaseSamples).toBe(512);
    expect(summarizeStudy(state)).toContain("N = 512");
  });

  it("keeps the previous result across a failure and reports the reason", () => {
    let state = sensitivityStudyReducer(initialSensitivityStudyState, { type: "start" });
    state = sensitivityStudyReducer(state, {
      type: "ready",
      result: SAMPLE_RESULT,
      baseSamples: 512,
    });
    state = sensitivityStudyReducer(state, { type: "start" });
    state = sensitivityStudyReducer(state, { type: "failed", error: "no answer at nominal" });

    expect(state.status).toBe("failed");
    expect(state.result).toBe(SAMPLE_RESULT);
    expect(summarizeStudy(state)).toBe("Failed: no answer at nominal");
  });

  it("clears the previous run's progress and error when a new one starts", () => {
    let state = sensitivityStudyReducer(initialSensitivityStudyState, { type: "start" });
    state = sensitivityStudyReducer(state, {
      type: "progress",
      progress: { stage: "tornado", completed: 3, total: 100 },
    });
    state = sensitivityStudyReducer(state, { type: "failed", error: "boom" });
    state = sensitivityStudyReducer(state, { type: "start" });

    expect(state.status).toBe("running");
    expect("progress" in state).toBe(false);
    expect("error" in state).toBe(false);
  });

  it("ignores every message that does not belong to a run in flight", () => {
    const idle = initialSensitivityStudyState;
    expect(sensitivityStudyReducer(idle, { type: "cancelled" })).toBe(idle);
    expect(sensitivityStudyReducer(idle, { type: "failed", error: "x" })).toBe(idle);
    expect(
      sensitivityStudyReducer(idle, { type: "ready", result: SAMPLE_RESULT, baseSamples: 1024 }),
    ).toBe(idle);
  });

  it("is running exactly while cancel means something", () => {
    const running = sensitivityStudyReducer(initialSensitivityStudyState, { type: "start" });
    expect(isStudying(running)).toBe(true);
    expect(isStudying(sensitivityStudyReducer(running, { type: "cancelled" }))).toBe(false);
    expect(
      isStudying(
        sensitivityStudyReducer(running, {
          type: "ready",
          result: SAMPLE_RESULT,
          baseSamples: 1024,
        }),
      ),
    ).toBe(false);
  });
});

describe("clampBaseSamples", () => {
  it("offers powers of two, which is what the Sobol' sequence's uniformity is stated for", () => {
    for (const choice of SOBOL_SAMPLE_CHOICES) {
      expect(Number.isInteger(Math.log2(choice))).toBe(true);
    }
  });

  it("rounds down rather than to the nearest, so the control never doubles the work asked for", () => {
    expect(clampBaseSamples(1023)).toBe(512);
    expect(clampBaseSamples(1024)).toBe(1024);
    expect(clampBaseSamples(2047)).toBe(1024);
  });

  it("clamps at both ends and survives a non-finite request", () => {
    expect(clampBaseSamples(1)).toBe(256);
    expect(clampBaseSamples(1e9)).toBe(8192);
    expect(clampBaseSamples(Number.NaN)).toBe(256);
  });
});

describe("tornadoBarGeometry", () => {
  it("scales every bar against the widest", () => {
    const geometry = tornadoBarGeometry(SAMPLE_TORNADO);
    expect(geometry.map((g) => g.fraction)).toEqual([1, 0.25]);
    expect(geometry.map((g) => g.span)).toEqual([40, 10]);
  });

  it("keeps a censored bar as a flagged zero-width row rather than dropping it", () => {
    const geometry = tornadoBarGeometry(
      tornadoOf([
        bar({ input: "v0", index: 0, span: 40, halfSpan: 20 }),
        bar({ input: "cd", index: 1, span: null, halfSpan: null, low: null, censored: true }),
      ]),
    );
    // Omitting the row would present a two-input ranking as a one-input one.
    expect(geometry).toHaveLength(2);
    expect(geometry[1]!.censored).toBe(true);
    expect(geometry[1]!.fraction).toBe(0);
    expect(geometry[1]!.span).toBeUndefined();
  });

  it("does not divide by zero when every bar is zero-width", () => {
    const geometry = tornadoBarGeometry(
      tornadoOf([bar({ input: "v0", index: 0 }), bar({ input: "theta", index: 1 })]),
    );
    expect(geometry.map((g) => g.fraction)).toEqual([0, 0]);
    expect(geometry.every((g) => Number.isFinite(g.fraction))).toBe(true);
  });

  it("carries the monotone flag, which the bar's own width cannot show", () => {
    const geometry = tornadoBarGeometry(
      tornadoOf([bar({ input: "theta", index: 0, span: 4, monotone: false })]),
    );
    expect(geometry[0]!.monotone).toBe(false);
  });
});

describe("sobolBarGeometry", () => {
  it("draws on the fixed [0, 1] variance-share scale, not normalised to the largest", () => {
    const geometry = sobolBarGeometry(
      sobolOf([
        { input: "v0", index: 0, first: 0.4, total: 0.45 },
        { input: "theta", index: 1, first: 0.2, total: 0.25 },
      ]),
    );
    // Normalising would make this look like one dominant input; it is not.
    expect(geometry[0]!.firstWidth).toBeCloseTo(0.4);
    expect(geometry[1]!.firstWidth).toBeCloseTo(0.2);
  });

  it("clamps the bar at zero but keeps the negative estimate in the number", () => {
    const geometry = sobolBarGeometry(
      sobolOf([{ input: "cd", index: 0, first: -0.02, total: 0.01, firstStandardError: 0.03 }]),
    );
    expect(geometry[0]!.firstWidth).toBe(0);
    // The sign is the signal that N is too small to resolve the index; losing
    // it would present an unresolved index as a resolved zero.
    expect(geometry[0]!.first).toBe(-0.02);
    expect(geometry[0]!.indistinguishableFromZero).toBe(true);
  });

  it("calls an index resolved once it clears two of its own standard errors", () => {
    const geometry = sobolBarGeometry(
      sobolOf([{ input: "v0", index: 0, first: 0.4, total: 0.45, firstStandardError: 0.01 }]),
    );
    expect(geometry[0]!.indistinguishableFromZero).toBe(false);
  });

  it("clamps a total above one, which an estimator can produce", () => {
    const geometry = sobolBarGeometry(sobolOf([{ input: "v0", index: 0, first: 0.9, total: 1.4 }]));
    expect(geometry[0]!.totalWidth).toBe(1);
    expect(geometry[0]!.total).toBe(1.4);
  });
});

describe("progress and summary formatting", () => {
  const running: SensitivityStudyPanelState = {
    status: "running",
    progress: { stage: "sobol", completed: 250, total: 1000 },
  };

  it("reports a determinate fraction while running", () => {
    expect(progressFraction(running)).toBeCloseTo(0.25);
    expect(progressFraction(initialSensitivityStudyState)).toBeUndefined();
  });

  it("names the stage as well as the count, so a long Sobol' stage is not mistaken for a hang", () => {
    expect(formatProgress(running)).toBe("Sobol': 250 / 1000 evaluations (25%)");
    expect(
      formatProgress({ status: "running", progress: { stage: "tornado", completed: 1, total: 8 } }),
    ).toContain("tornado: 1 / 8");
  });

  it("says 'starting' rather than showing a bar before the first evaluation lands", () => {
    expect(summarizeStudy({ status: "running" })).toBe("Starting…");
  });

  it("distinguishes a cancel with nothing to show from one with a previous result", () => {
    expect(summarizeStudy({ status: "cancelled" })).toBe(
      "Cancelled before any result was produced.",
    );
    expect(
      summarizeStudy({ status: "cancelled", result: SAMPLE_RESULT, resultBaseSamples: 256 }),
    ).toBe("Cancelled. Showing the previous study (N = 256).");
  });

  it("flags a censored study rather than presenting conditional indices as unconditional", () => {
    const censored = resultOf(SAMPLE_TORNADO, sobolOf([], { censored: true, failures: 12 }));
    expect(
      summarizeStudy({ status: "ready", result: censored, resultBaseSamples: 1024 }),
    ).toContain("conditional");
  });

  it("states the interaction share as the quantity the tornado beside it cannot produce", () => {
    const text = formatInteractionShare(SAMPLE_SOBOL);
    expect(text).toContain("10.0%");
    expect(text).toContain("no tornado can attribute");
  });
});
