# ADR-014: Float64 as the Numerics Core, with an Explicit Float32 Mode

**Status:** Accepted
**Date:** 2026-07-17

## Context

The engine and solver core run entirely in JavaScript/TypeScript (§6.4:
"Numerics language: TypeScript now; AS/Rust-WASM Phase 7"), which offers a
few candidate numeric representations for state, parameters, and trajectory
storage:

- Plain `number` / `Float64Array` — IEEE 754 double precision, JS's native
  numeric type.
- `BigInt` or an arbitrary-precision decimal library, for exact or
  higher-than-double precision.
- `Float32Array` throughout, trading precision for half the memory
  footprint and (on some backends) faster arithmetic.

The platform's accuracy budget (default solver global error $< 10^{-6}$
relative, §2.6) and determinism budget (cross-platform drift documented and
$\lesssim 10^{-13}$ relative over a standard flight, §4 note) both assume an
IEEE 754 double-precision baseline: every convergence-order test (Euler
slope 1, RK4 slope 4, DOPRI5 slope 5, ...), the analytic-vs-finite-difference
Jacobian cross-checks (P1.22/P1.23, tolerance $10^{-7}$), and the golden
trajectory hashes (P2.52) are all calibrated against double precision's
~15–17 significant decimal digits and $\varepsilon \approx 2.2\times
10^{-16}$ machine epsilon.

## Decision

- The numerics core (`engine`, `solverkit`, state vectors, `Float64Array`
  columnar storage, P2.04) uses IEEE 754 double precision (`number` /
  `Float64Array`) as its one and only representation by default. No
  `BigInt`/decimal path exists anywhere on the hot path — arbitrary
  precision is unneeded at these budgets and would forfeit both the raw
  throughput target ($\geq 10^4$ trajectories/s CPU, §2.6) and native typed-
  array GPU-upload compatibility (§2.3, Phase 7).
- `Float32` support is not rejected outright — it is an explicit, opt-in
  **mode flag** on the solver core (P2.21), not the default representation.
  It exists specifically to demonstrate, pedagogically and practically, how
  step-size/precision tradeoffs shift under reduced precision (§4.7's V-curve
  minimum shifting to larger $h$) and as a preview of the reduced-precision
  path a future WebGPU backend (Phase 7) may need for throughput. Every
  numerical-method correctness claim (order conditions, convergence slopes,
  golden trajectories) is made and tested against the Float64 default; the
  Float32 mode is validated only for its own, separately stated qualitative
  claim (P2.21's V-curve-shape assertion), not held to the same absolute
  error bounds.
- Kahan compensated summation (P2.20) is provided as an opt-in refinement
  _within_ the Float64 core for the regime where accumulated rounding error
  in long state-update sums becomes the dominant error source (flattening
  the V-curve's floating-point-error branch), rather than as a reason to
  reach for higher precision.

## Consequences

- Determinism and accuracy testing has one calibrated baseline
  (Float64/$\varepsilon\approx2.2\times10^{-16}$) instead of needing to
  express every tolerance parametrically over a representation choice.
- The eventual WASM/GPU backend (Phase 7, §10.1) can target Float64 (WASM,
  full precision, matching the reference implementation for validation) or
  Float32 (WebGPU, throughput-oriented) as separate, independently-tested
  backends, because the mode flag and its qualitative-only validation bar
  were established here rather than retrofitted under throughput pressure.
- No code path anywhere needs to reason about mixed precision within a
  single integration: a run is either the Float64 core or explicitly the
  Float32 mode, never both in the same trajectory.
