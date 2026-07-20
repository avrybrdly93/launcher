import { describe, expect, it } from "vitest";
import { brentRoot } from "./brent-root-finder.js";

const NO_EXTRA_TOL = () => 0;

describe("brentRoot", () => {
  it("finds the root of a linear function exactly (converges in one step)", () => {
    const f = (x: number) => 2 * x - 4;
    const result = brentRoot(f, 0, 10, f(0), f(10), NO_EXTRA_TOL);
    expect(result.x).toBeCloseTo(2, 12);
    expect(result.converged).toBe(true);
  });

  it("finds a root of a smooth nonlinear function to tight tolerance", () => {
    // Root at x = sqrt(2).
    const f = (x: number) => x * x - 2;
    const result = brentRoot(f, 0, 2, f(0), f(2), () => 1e-15);
    expect(result.x).toBeCloseTo(Math.sqrt(2), 13);
    expect(result.converged).toBe(true);
  });

  it("finds a root of a transcendental function (cos(x) = x)", () => {
    const f = (x: number) => Math.cos(x) - x;
    const result = brentRoot(f, 0, 1, f(0), f(1), () => 1e-15);
    expect(Math.abs(f(result.x))).toBeLessThan(1e-13);
    expect(result.converged).toBe(true);
  });

  it("returns immediately when an endpoint is already an exact root", () => {
    const f = (x: number) => x - 3;
    const result = brentRoot(f, 3, 10, f(3), f(10), NO_EXTRA_TOL);
    expect(result.x).toBe(3);
    expect(result.iterations).toBe(0);
    expect(result.converged).toBe(true);
  });

  it("throws when the bracket does not contain a sign change", () => {
    const f = (x: number) => x * x + 1;
    expect(() => brentRoot(f, -1, 1, f(-1), f(1), NO_EXTRA_TOL)).toThrow(/bracket/);
  });

  it("handles a bracket where the sign-change endpoint order is reversed (a > b)", () => {
    const f = (x: number) => x - 5;
    const result = brentRoot(f, 10, 0, f(10), f(0), NO_EXTRA_TOL);
    expect(result.x).toBeCloseTo(5, 12);
  });

  it("respects a caller-supplied tolerance function (loose tol converges early, fewer iterations)", () => {
    const f = (x: number) => x * x * x - 2;
    const tight = brentRoot(f, 0, 2, f(0), f(2), NO_EXTRA_TOL);
    const loose = brentRoot(f, 0, 2, f(0), f(2), () => 1e-2);
    expect(loose.iterations).toBeLessThanOrEqual(tight.iterations);
    expect(Math.abs(loose.x - Math.cbrt(2))).toBeLessThan(1e-2);
  });

  it("reports non-convergence when maxIterations is exhausted before tol is met", () => {
    const f = (x: number) => x * x * x - 2;
    const result = brentRoot(f, 0, 2, f(0), f(2), NO_EXTRA_TOL, 1);
    expect(result.converged).toBe(false);
    expect(result.iterations).toBe(1);
  });
});
