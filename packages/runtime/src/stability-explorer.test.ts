import { describe, expect, it } from "vitest";
import { PRESET_SCENARIOS } from "@ballista/engine";
import {
  sampleTrajectoryEigenvalues,
  STABILITY_EXPLORER_METHOD_OPTIONS,
} from "./stability-explorer.js";

const SHOT_PUT = PRESET_SCENARIOS.find((s) => s.projectile.id === "shot-put")!;
const DRAG_FREE = PRESET_SCENARIOS.find((s) => s.projectile.id === "smooth-sphere")!;
const GOLF_DRIVE = PRESET_SCENARIOS.find((s) => s.model.forceIds.includes("magnus"))!;

describe("STABILITY_EXPLORER_METHOD_OPTIONS", () => {
  it("covers exactly the four methods whose stage count equals their order (eq. 4.11's exact scope)", () => {
    expect(STABILITY_EXPLORER_METHOD_OPTIONS.map((o) => o.id)).toEqual([
      "explicit-euler",
      "midpoint-rk2",
      "heun-rk2",
      "classical-rk4",
    ]);
    expect(STABILITY_EXPLORER_METHOD_OPTIONS.map((o) => o.order)).toEqual([1, 2, 2, 4]);
  });
});

describe("sampleTrajectoryEigenvalues", () => {
  it("returns sampleCount samples spanning t=0 to the reported tFinal", () => {
    const result = sampleTrajectoryEigenvalues(SHOT_PUT, 20);
    expect(result.samples).toHaveLength(20);
    expect(result.samples[0]!.t).toBe(0);
    expect(result.samples.at(-1)!.t).toBeCloseTo(result.tFinal, 9);
  });

  it("eigenvalues move as the projectile decelerates: |lambda| at the slowest sampled point is well below |lambda| at launch (P3.43 validation criterion)", () => {
    const result = sampleTrajectoryEigenvalues(SHOT_PUT, 40);

    const launch = result.samples[0]!;
    const slowest = result.samples.reduce((min, s) => (s.speed < min.speed ? s : min));

    expect(slowest.speed).toBeLessThan(launch.speed);

    const magnitudeAt = (s: (typeof result.samples)[number]) =>
      Math.max(
        Math.hypot(s.lambda[0].re, s.lambda[0].im),
        Math.hypot(s.lambda[1].re, s.lambda[1].im),
      );

    expect(magnitudeAt(slowest)).toBeLessThan(magnitudeAt(launch));
  });

  it("velocity-block eigenvalues are exactly {0, 0} for a drag-free (gravity-only) scenario at every sample", () => {
    const result = sampleTrajectoryEigenvalues(DRAG_FREE, 10);
    for (const sample of result.samples) {
      expect(sample.lambda[0]).toEqual({ re: 0, im: 0 });
      expect(sample.lambda[1]).toEqual({ re: 0, im: 0 });
    }
  });

  it("produces finite eigenvalues via the finite-difference fallback for a Magnus-bearing scenario (no analytic jacobian)", () => {
    const result = sampleTrajectoryEigenvalues(GOLF_DRIVE, 15);
    for (const sample of result.samples) {
      for (const lambda of sample.lambda) {
        expect(Number.isFinite(lambda.re)).toBe(true);
        expect(Number.isFinite(lambda.im)).toBe(true);
      }
    }
  });

  it("rejects a sampleCount below 2", () => {
    expect(() => sampleTrajectoryEigenvalues(SHOT_PUT, 1)).toThrow();
  });
});
