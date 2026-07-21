/**
 * Solves the dense linear system `A x = b` in place via Gaussian
 * elimination with partial pivoting: `A` (row-major, `dim*dim`) is
 * overwritten with its eliminated form and `b` is overwritten with the
 * solution `x` on return. Used by {@link BackwardEulerStepper}'s damped
 * Newton iteration (§4.6) to solve the `(I - h*J) * delta = -F(y)` system
 * every iteration without allocating (ADR-004) -- `dim` is small (the
 * model's state dimension, e.g. 4 for the planar projectile), so the
 * $O(\text{dim}^3)$ elimination cost is negligible next to a single rhs
 * evaluation.
 *
 * Returns `false` (leaving `A`/`b` in a partially eliminated, meaningless
 * state) the moment every candidate pivot in some column is smaller in
 * magnitude than `pivotEps` -- a numerically singular system, which the
 * caller should treat as a solve failure rather than trust the divide
 * against a near-zero pivot it would otherwise produce.
 */
export function solveLinearSystemInPlace(
  A: Float64Array,
  b: Float64Array,
  dim: number,
  pivotEps = 1e-12,
): boolean {
  for (let k = 0; k < dim; k++) {
    let pivotRow = k;
    let pivotMagnitude = Math.abs(A[k * dim + k]!);
    for (let i = k + 1; i < dim; i++) {
      const magnitude = Math.abs(A[i * dim + k]!);
      if (magnitude > pivotMagnitude) {
        pivotMagnitude = magnitude;
        pivotRow = i;
      }
    }
    if (pivotMagnitude < pivotEps) return false;

    if (pivotRow !== k) {
      for (let j = 0; j < dim; j++) {
        const tmp = A[k * dim + j]!;
        A[k * dim + j] = A[pivotRow * dim + j]!;
        A[pivotRow * dim + j] = tmp;
      }
      const tmpB = b[k]!;
      b[k] = b[pivotRow]!;
      b[pivotRow] = tmpB;
    }

    const pivotValue = A[k * dim + k]!;
    for (let i = k + 1; i < dim; i++) {
      const factor = A[i * dim + k]! / pivotValue;
      if (factor === 0) continue;
      for (let j = k; j < dim; j++) {
        A[i * dim + j] = A[i * dim + j]! - factor * A[k * dim + j]!;
      }
      b[i] = b[i]! - factor * b[k]!;
    }
  }

  for (let i = dim - 1; i >= 0; i--) {
    let sum = b[i]!;
    for (let j = i + 1; j < dim; j++) {
      sum -= A[i * dim + j]! * b[j]!;
    }
    b[i] = sum / A[i * dim + i]!;
  }

  return true;
}
