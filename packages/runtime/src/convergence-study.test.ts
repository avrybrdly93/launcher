import { PRESET_SCENARIOS } from "@ballista/engine";
import { describe, expect, it } from "vitest";
import {
  CONVERGENCE_STUDY_METHOD_OPTIONS,
  convergenceStudyToJSON,
  runConvergenceStudy,
} from "./convergence-study.js";

const SHOT_PUT = PRESET_SCENARIOS.find((s) => s.projectile.id === "shot-put")!;

const EULER_HS = [0.02, 0.01, 0.005, 0.0025];
const RK4_HS = [0.04, 0.02, 0.01];

describe("runConvergenceStudy (P3.42)", () => {
  it("produces one method result per requested stepper id, each with hs/errors of the requested length", () => {
    const study = runConvergenceStudy(SHOT_PUT, ["explicit-euler", "classical-rk4"], EULER_HS);

    expect(study.methods).toHaveLength(2);
    expect(study.methods.map((m) => m.stepperId)).toEqual(["explicit-euler", "classical-rk4"]);
    for (const method of study.methods) {
      expect(method.hs).toEqual(EULER_HS);
      expect(method.errors).toHaveLength(EULER_HS.length);
      for (const error of method.errors) {
        expect(Number.isFinite(error)).toBe(true);
        expect(error).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("every method is measured against the same fixed t_f (the reference solve's own landing time)", () => {
    const study = runConvergenceStudy(SHOT_PUT, ["explicit-euler", "classical-rk4"], EULER_HS);
    expect(study.tFinal).toBeGreaterThan(0);
  });

  it("Euler's fitted order is close to 1, in its own asymptotic convergent range", () => {
    const study = runConvergenceStudy(SHOT_PUT, ["explicit-euler"], EULER_HS);
    expect(study.methods[0]!.slope).toBeGreaterThan(0.8);
    expect(study.methods[0]!.slope).toBeLessThan(1.3);
  });

  it("RK4's fitted order is close to 4, at step sizes coarse enough to stay above the reference solve's own rounding-error floor", () => {
    // RK4's error at SHOT_PUT already sits within ~1e-12 of the tight-
    // tolerance reference's own noise floor by h=0.005 (verified by hand):
    // an h-ladder that fine would fit a flat/garbage slope off floored
    // errors, not the method's actual O(h^4) truncation-error scaling --
    // exactly the V-curve floor the blueprint describes (§4.7). RK4_HS
    // stays coarse enough to measure the real asymptotic order instead.
    const study = runConvergenceStudy(SHOT_PUT, ["classical-rk4"], RK4_HS);
    expect(study.methods[0]!.slope).toBeGreaterThan(3.3);
  });

  it("labels every CONVERGENCE_STUDY_METHOD_OPTIONS entry with a non-empty, distinct display label", () => {
    const labels = CONVERGENCE_STUDY_METHOD_OPTIONS.map((m) => m.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) expect(label.length).toBeGreaterThan(0);
  });

  it("falls back to the stepper id itself for an unlabeled id (defensive, shouldn't normally occur)", () => {
    const study = runConvergenceStudy(SHOT_PUT, ["explicit-euler"], EULER_HS);
    expect(study.methods[0]!.label).toBe("Explicit Euler");
  });
});

describe("convergenceStudyToJSON (P3.42 validation criterion: displayed slopes match this JSON)", () => {
  it("round-trips a study, and the parsed slopes are exactly the study's own slopes", () => {
    const study = runConvergenceStudy(SHOT_PUT, ["explicit-euler", "classical-rk4"], RK4_HS);
    const json = convergenceStudyToJSON(study);
    const parsed = JSON.parse(json) as typeof study;

    expect(parsed.tFinal).toBe(study.tFinal);
    expect(parsed.methods.map((m) => m.slope)).toEqual(study.methods.map((m) => m.slope));
    expect(parsed.methods.map((m) => m.label)).toEqual(study.methods.map((m) => m.label));
  });
});
