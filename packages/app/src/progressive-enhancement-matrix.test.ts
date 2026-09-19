import { describe, expect, it } from "vitest";

import {
  SUPPRESSIBLE_FEATURES,
  enumerateSuppressionCombinations,
  suppressionInitScript,
  type FeatureSuppression,
} from "./progressive-enhancement-matrix.js";

/**
 * The browser-free half of P7.29.
 *
 * `progressive-enhancement.e2e.test.ts` answers "does the app work in each
 * combination", and it needs a browser binary to do it. This file answers "is
 * the matrix the matrix the criterion asks for" — every subset of no-WASM,
 * no-GPU and no-SAB, each exactly once, with a control — and it needs nothing.
 * Splitting them means the coverage claim is not hostage to the environment:
 * where the browser suite skips, this one still fails if a cell goes missing.
 */

describe("P7.29 suppression matrix — completeness", () => {
  it("enumerates every subset of the three features, and no more", () => {
    const combinations = enumerateSuppressionCombinations();
    expect(SUPPRESSIBLE_FEATURES).toHaveLength(3);
    expect(combinations).toHaveLength(2 ** SUPPRESSIBLE_FEATURES.length);
  });

  it("contains each subset exactly once, compared as sets rather than as names", () => {
    const keys = enumerateSuppressionCombinations().map((combination) =>
      combination.features
        .map((feature) => feature.id)
        .slice()
        .sort()
        .join(","),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("includes the empty set as the control, named so a report can tell it apart", () => {
    const combinations = enumerateSuppressionCombinations();
    const baseline = combinations.filter((combination) => combination.features.length === 0);
    expect(baseline).toHaveLength(1);
    expect(baseline[0]?.name).toBe("baseline");
  });

  it("includes the all-off corner, which is the one the fallback story rests on", () => {
    const combinations = enumerateSuppressionCombinations();
    const allOff = combinations.find(
      (combination) => combination.features.length === SUPPRESSIBLE_FEATURES.length,
    );
    expect(allOff?.name).toBe("no-WASM + no-GPU + no-SAB");
  });

  it("covers each individual feature in exactly half the cells", () => {
    const combinations = enumerateSuppressionCombinations();
    for (const feature of SUPPRESSIBLE_FEATURES) {
      const cells = combinations.filter((combination) =>
        combination.features.some((selected) => selected.id === feature.id),
      );
      expect(cells).toHaveLength(combinations.length / 2);
    }
  });

  it("grows with the feature list rather than being written out, so a fourth feature is not forgotten", () => {
    // The same enumeration over a synthetic four-feature list. If the matrix
    // were a hand-written literal, this would still return 8.
    const fourth: FeatureSuppression = {
      id: "wasm",
      label: "no-FOURTH",
      initScript: "",
      absenceProbe: "true",
    };
    expect(enumerateSuppressionCombinations([...SUPPRESSIBLE_FEATURES, fourth])).toHaveLength(16);
  });

  it("orders each cell's features in matrix order, so a cell's name is stable", () => {
    for (const combination of enumerateSuppressionCombinations()) {
      const positions = combination.features.map((feature) =>
        SUPPRESSIBLE_FEATURES.findIndex((candidate) => candidate.id === feature.id),
      );
      expect(positions).toStrictEqual([...positions].sort((a, b) => a - b));
    }
  });
});

describe("P7.29 suppression matrix — the scripts themselves", () => {
  it("names the three features the criterion names", () => {
    expect(SUPPRESSIBLE_FEATURES.map((feature) => feature.id)).toStrictEqual([
      "wasm",
      "webgpu",
      "sharedArrayBuffer",
    ]);
    expect(SUPPRESSIBLE_FEATURES.map((feature) => feature.label)).toStrictEqual([
      "no-WASM",
      "no-GPU",
      "no-SAB",
    ]);
  });

  it("leaves every suppressed global configurable, so a page can be reset and a probe can re-run", () => {
    for (const feature of SUPPRESSIBLE_FEATURES) {
      expect(feature.initScript).toContain("configurable: true");
    }
  });

  it("shadows navigator.gpu with an own property rather than deleting an inherited accessor", () => {
    // The distinction this asserts is the one that makes the difference between
    // a matrix that tests three fallbacks and one that tests none: `gpu` lives
    // on Navigator.prototype, so `delete navigator.gpu` succeeds and removes
    // nothing.
    const webgpu = SUPPRESSIBLE_FEATURES.find((feature) => feature.id === "webgpu");
    expect(webgpu?.initScript).toContain("Object.defineProperty(navigator");
    expect(webgpu?.initScript).not.toContain("delete ");
  });

  it("takes crossOriginIsolated down with SharedArrayBuffer, because the pair cannot disagree", () => {
    const sab = SUPPRESSIBLE_FEATURES.find((feature) => feature.id === "sharedArrayBuffer");
    expect(sab?.initScript).toContain("crossOriginIsolated");
    expect(sab?.absenceProbe).toContain("crossOriginIsolated");
  });

  it("gives every feature a non-empty absence probe, so no suppression is taken on trust", () => {
    for (const feature of SUPPRESSIBLE_FEATURES) {
      expect(feature.absenceProbe.trim().length).toBeGreaterThan(0);
    }
  });

  it("concatenates exactly the selected features' scripts, and returns empty for the control", () => {
    const combinations = enumerateSuppressionCombinations();
    for (const combination of combinations) {
      const script = suppressionInitScript(combination);
      for (const feature of SUPPRESSIBLE_FEATURES) {
        const selected = combination.features.some((entry) => entry.id === feature.id);
        expect(script.includes(feature.initScript)).toBe(selected);
      }
    }
    expect(suppressionInitScript(combinations[0] as (typeof combinations)[number])).toBe("");
  });
});

describe("P7.29 suppression scripts run, in this process, against a stand-in global", () => {
  /**
   * The scripts are strings handed to a browser, which means nothing in the
   * unit layer would otherwise catch a syntax error in one of them — the
   * failure would surface only where a browser exists, which is precisely where
   * this repo's e2e suites are allowed to skip. Evaluating them here against a
   * fake `globalThis`/`navigator` is not a substitute for the browser run; it
   * is the check that they are valid JavaScript that does what it says.
   */
  function runInSandbox(feature: FeatureSuppression): boolean {
    const fakeGlobal: Record<string, unknown> = {
      WebAssembly: {},
      SharedArrayBuffer: function SharedArrayBuffer() {},
      crossOriginIsolated: true,
    };
    const fakeNavigator: Record<string, unknown> = { gpu: {} };
    const run = new Function(
      "globalThis",
      "navigator",
      `${feature.initScript}\nreturn (${feature.absenceProbe});`,
    ) as (globalObject: unknown, navigatorObject: unknown) => boolean;
    return run(fakeGlobal, fakeNavigator);
  }

  for (const feature of SUPPRESSIBLE_FEATURES) {
    it(`${feature.label}: the script parses, removes the feature, and the probe then reports it absent`, () => {
      expect(runInSandbox(feature)).toBe(true);
    });
  }

  it("every probe reports PRESENT before its own script runs, so a probe cannot pass vacuously", () => {
    for (const feature of SUPPRESSIBLE_FEATURES) {
      const fakeGlobal: Record<string, unknown> = {
        WebAssembly: {},
        SharedArrayBuffer: function SharedArrayBuffer() {},
        crossOriginIsolated: true,
      };
      const fakeNavigator: Record<string, unknown> = { gpu: {} };
      const probe = new Function(
        "globalThis",
        "navigator",
        `return (${feature.absenceProbe});`,
      ) as (globalObject: unknown, navigatorObject: unknown) => boolean;
      expect(probe(fakeGlobal, fakeNavigator)).toBe(false);
    }
  });
});
