import { describe, expect, it } from "vitest";
import { solveLinearSystemInPlace } from "./dense-linear-solve.js";

describe("solveLinearSystemInPlace", () => {
  it("solves a 2x2 system exactly", () => {
    // [2 1][x] = [5]   x=2, y=1
    // [1 3][y] = [5]
    const A = new Float64Array([2, 1, 1, 3]);
    const b = new Float64Array([5, 5]);

    const ok = solveLinearSystemInPlace(A, b, 2);

    expect(ok).toBe(true);
    expect(b[0]).toBeCloseTo(2, 12);
    expect(b[1]).toBeCloseTo(1, 12);
  });

  it("solves a 3x3 system that requires a pivot swap (zero on the diagonal)", () => {
    // A permutation-like system with a zero in the (0,0) position, forcing
    // the partial-pivoting search to swap rows before eliminating.
    // [0 1 0][x]   [3]
    // [1 0 0][y] = [5]
    // [0 0 1][z]   [7]
    const A = new Float64Array([0, 1, 0, 1, 0, 0, 0, 0, 1]);
    const b = new Float64Array([3, 5, 7]);
    const expected = new Float64Array(A);
    const expectedB = new Float64Array(b);

    const ok = solveLinearSystemInPlace(A, b, 3);
    expect(ok).toBe(true);

    // Verify by substituting the returned solution back into the original system.
    for (let i = 0; i < 3; i++) {
      let sum = 0;
      for (let j = 0; j < 3; j++) sum += expected[i * 3 + j]! * b[j]!;
      expect(sum).toBeCloseTo(expectedB[i]!, 10);
    }
  });

  it("returns false for a singular matrix instead of dividing by a near-zero pivot", () => {
    // Row 2 = 2*Row 1: singular.
    const A = new Float64Array([1, 2, 2, 4]);
    const b = new Float64Array([1, 2]);

    const ok = solveLinearSystemInPlace(A, b, 2);

    expect(ok).toBe(false);
  });

  it("solves the identity system as a no-op sanity check", () => {
    const A = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const b = new Float64Array([3, -2, 7]);

    const ok = solveLinearSystemInPlace(A, b, 3);

    expect(ok).toBe(true);
    expect(b[0]).toBeCloseTo(3, 14);
    expect(b[1]).toBeCloseTo(-2, 14);
    expect(b[2]).toBeCloseTo(7, 14);
  });
});
