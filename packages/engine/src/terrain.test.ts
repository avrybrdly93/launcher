import { describe, expect, it } from "vitest";
import { createGroundEventSpec, FlatTerrain, FunctionTerrain } from "./terrain.js";

describe("FlatTerrain", () => {
  it("height is 0 everywhere", () => {
    const terrain = new FlatTerrain();
    for (const x of [-100, 0, 0.5, 1000]) {
      expect(terrain.height(x)).toBe(0);
    }
  });
});

describe("createGroundEventSpec", () => {
  it("g(t,y) = y - h(x) evaluates for flat terrain", () => {
    const event = createGroundEventSpec(new FlatTerrain());
    expect(event.name).toBe("ground");
    expect(event.g(0, new Float64Array([10, 5, 0, 0]))).toBe(5);
    expect(event.g(0, new Float64Array([10, 0, 0, 0]))).toBe(0);
    expect(event.g(0, new Float64Array([10, -3, 0, 0]))).toBe(-3);
  });

  it("g(t,y) = y - h(x) evaluates for a sloped/curved terrain", () => {
    const terrain = new FunctionTerrain((x) => Math.sin(x));
    const event = createGroundEventSpec(terrain);
    const x = 1.3;
    const y = 2.1;
    expect(event.g(0, new Float64Array([x, y, 0, 0]))).toBeCloseTo(y - Math.sin(x), 14);
  });
});
