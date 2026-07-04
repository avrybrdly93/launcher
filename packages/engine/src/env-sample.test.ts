import { describe, expect, it } from "vitest";
import { EnvSample } from "./env-sample.js";

describe("EnvSample", () => {
  it("is a reusable buffer: mutating fields does not allocate a new instance", () => {
    const sample = new EnvSample();
    const before = sample;
    for (let i = 0; i < 1e4; i++) {
      sample.rho = 1.225;
      sample.T = 288.15 + i * 1e-6;
      sample.wx = 0;
      sample.wy = 0;
    }
    expect(sample).toBe(before);
    expect(sample.rho).toBe(1.225);
  });
});
