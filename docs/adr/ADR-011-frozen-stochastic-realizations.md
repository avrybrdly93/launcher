# ADR-011: Stochastic Wind as Frozen, Precomputed Sample Paths

**Status:** Accepted
**Date:** 2026-07-17

## Context

Phase 4/6 wind models add stochastic gust structure — discrete "1-cosine"
gust events and an Ornstein–Uhlenbeck fluctuation

$$dw' = -\frac{w'}{\tau_g}\,dt + \sigma_g \sqrt{\frac{2}{\tau_g}}\, dW_t \tag{3.14}$$

(§3.5). Taken literally, (3.14) makes the projectile's equation of motion a
_stochastic_ differential equation: the wind term is itself a random process,
not a deterministic function of $(t, \mathbf{r})$.

SolverKit (L1) is built as a deterministic ODE integrator: `Model.rhs(t, y,
out, ctx)` is a pure function of its arguments, steppers assume a fixed
right-hand side, and the platform's determinism budget (§2.6) requires that
an identical `ScenarioSpec` (including seed) produce a bit-identical
trajectory. Wiring an actual SDE solver (Euler–Maruyama, Milstein, ...)
into SolverKit — or letting `WindModel.sample` draw fresh randomness on
every call — would break both: it would require a second numerical method
family with its own convergence theory living alongside the ODE steppers,
and repeated calls to the same `(t, x, y)` within or across rhs evaluations
(which the analytic Jacobian and dense-output interpolants both do) would
observe different noise, corrupting exactly the invariants those features
depend on.

## Decision

Stochastic wind is never sampled live inside the integration loop. Instead:

- A **frozen realization** $w'(t)$ of the stochastic process is precomputed
  once, before integration starts, from the scenario's seed (drawn via a
  dedicated `PCG32` substream, per ADR-004's determinism discipline) — an
  OU path or gust-event sequence evaluated on a fixed time grid.
- That discrete sample path is wrapped in a piecewise-cubic (PCHIP, P1.11)
  interpolant, exposed as an ordinary `WindModel` (P4.17): `sample(t, x, y,
out)` is a deterministic, repeatable-call-safe function of `t`, exactly
  like `UniformWind` or `LogProfileWind`.
- Each Monte Carlo replicate (P6.16) draws one such frozen path from its own
  RNG substream and integrates it with the ordinary deterministic ODE
  machinery. Ensemble statistics are computed _across_ replicates' frozen
  outcomes, not by propagating a probability distribution through the
  dynamics online.

In effect, the "randomness" is fully resolved into an ordinary function
before it ever reaches `Model.rhs` — SolverKit only ever sees deterministic
`WindModel`s, regardless of whether the wind was authored as a slider value
or sampled from an OU process.

## Consequences

- SolverKit stays entirely free of stochastic-calculus machinery: no SDE
  solver family, no Wiener-process bookkeeping, no risk of an rhs call
  observing different noise on repeated evaluation at the same $(t,x,y)$
  (which dense output, event root-finding, and the analytic/FD Jacobian all
  rely on _not_ happening).
- The determinism contract extends to stochastic scenarios for free: same
  seed ⇒ same frozen path ⇒ bit-identical trajectory (P4.17's validation
  criterion), and MC replicate pools reduce in a fixed, seed-indexed order
  (P6.05) rather than depending on scheduling.
- Cost: the precomputed path only has resolution up to its sampling grid: it
  cannot represent noise at frequencies the grid doesn't resolve, and an
  adaptive stepper that takes much finer steps than the gust grid sees a
  smooth (PCHIP-interpolated) wind rather than "true" high-frequency OU
  noise between grid points. This is judged acceptable — the interpolated
  path is smooth by construction, which is also what keeps convergence
  studies clean (§3.5) — and the grid can be refined per-scenario if a
  future exhibit needs finer gust resolution.
- Anything downstream that wants the _distribution_ of outcomes (not one
  path) must run multiple replicates with distinct substream seeds and
  aggregate afterward; there is deliberately no single-run "expected
  trajectory under stochastic wind" API.
