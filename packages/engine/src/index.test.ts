import { describe, expect, it } from "vitest";
import { add, crossZ, dot, norm, scale, zero } from "./vec2.js";
import { degToRad, ftToM, mToFt, radToDeg, SUTHERLAND, sutherlandViscosity } from "./units.js";
import { PCG32 } from "./random.js";

describe("vec2", () => {
  it("norm of the zero vector is zero", () => {
    expect(norm(zero())).toBe(0);
  });

  it("add/scale/dot/crossZ compute component-wise as expected", () => {
    const a = [3, 4] as const;
    const b = [1, 2] as const;
    expect(add(a, b, zero())).toEqual([4, 6]);
    expect(scale(a, 2, zero())).toEqual([6, 8]);
    expect(dot(a, b)).toBe(11);
    expect(crossZ(a, b)).toBe(2);
    expect(norm(a)).toBe(5);
  });
});

describe("units", () => {
  it("deg/rad and m/ft conversions round-trip", () => {
    for (const deg of [0, 45, 90, 180, 270]) {
      expect(radToDeg(degToRad(deg))).toBeCloseTo(deg, 10);
    }
    for (const m of [0, 1, 100, 1609.34]) {
      expect(ftToM(mToFt(m))).toBeCloseTo(m, 9);
    }
  });
});

describe("sutherlandViscosity", () => {
  it("matches the reference value at Tref = 288.15 K to 1% (validation criterion)", () => {
    const eta = sutherlandViscosity(288.15);
    expect(Math.abs(eta - 1.789e-5) / 1.789e-5).toBeLessThan(0.01);
  });

  it("equals etaRef exactly at Tref by construction", () => {
    expect(sutherlandViscosity(SUTHERLAND.Tref)).toBe(SUTHERLAND.etaRef);
  });

  it("increases monotonically with temperature over the ISA troposphere range", () => {
    const temps = [220, 250, 280, 288.15, 300, 320];
    for (let i = 1; i < temps.length; i++) {
      expect(sutherlandViscosity(temps[i]!)).toBeGreaterThan(sutherlandViscosity(temps[i - 1]!));
    }
  });
});

describe("PCG32", () => {
  it("is deterministic: same seed and stream produce the same sequence", () => {
    const a = new PCG32(42n, 1n);
    const b = new PCG32(42n, 1n);
    const seqA = Array.from({ length: 10 }, () => a.nextU32());
    const seqB = Array.from({ length: 10 }, () => b.nextU32());
    expect(seqA).toEqual(seqB);
  });

  it("different streams from the same seed diverge", () => {
    const a = new PCG32(42n, 1n);
    const b = new PCG32(42n, 2n);
    expect(a.nextU32()).not.toBe(b.nextU32());
  });

  it("nextF64 draws are uniform on [0,1) to a coarse bucket tolerance", () => {
    const rng = new PCG32(1234n);
    const n = 20000;
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < n; i++) {
      const x = rng.nextF64();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      buckets[Math.min(9, Math.floor(x * 10))]++;
    }
    const expected = n / 10;
    for (const count of buckets) {
      expect(Math.abs(count - expected) / expected).toBeLessThan(0.1);
    }
  });
});
