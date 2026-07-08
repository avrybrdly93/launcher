import { describe, expect, it } from "vitest";
import { EnvSample } from "./env-sample.js";
import { UniformWind } from "./wind.js";

describe("UniformWind", () => {
  it("is constant everywhere: position, height, and time do not matter", () => {
    const wind = new UniformWind(5, -2);
    const out = new EnvSample();
    for (const [t, x, y] of [
      [0, 0, 0],
      [10, 100, 50],
      [-5, -1000, 2000],
      [3.14, 0.001, -0.001],
    ] as const) {
      wind.sample(t, x, y, out);
      expect(out.wx).toBe(5);
      expect(out.wy).toBe(-2);
    }
  });

  it("defaults wy to 0", () => {
    const wind = new UniformWind(3);
    const out = new EnvSample();
    wind.sample(0, 0, 0, out);
    expect(out.wx).toBe(3);
    expect(out.wy).toBe(0);
  });
});
