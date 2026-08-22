# ADR-017: Coupling the Inner IVP Tolerance to the Outer Optimizer — and Why the Square Is the Wrong Exponent Here

**Status:** Accepted — the rule is implemented in
`packages/analysis/src/tolerance-coupling.ts` and measured in its test
**Date:** 2026-08-22
**Task:** P5.31

## Context

Every inverse solve in this repo is two nested numerical methods. An **outer**
optimizer — `newtonShooting`, `levenbergMarquardt`, `brentMinimize`,
`nelderMead` — drives a residual toward zero. An **inner** initial-value
problem — `integrate` — evaluates that residual by flying a trajectory.

The two carry entirely separate tolerances:

|       | knob                                      | units               |
| ----- | ----------------------------------------- | ------------------- |
| outer | `NewtonShootingOptions.residualTolerance` | metres of miss      |
| outer | `JacobianOptions.noiseFloor`              | relative            |
| inner | `SolverConfig.rtol` / `atol`              | relative / absolute |

Nothing relates them. `ShootingProblem` carries a `SolverConfig` and
`newtonShooting` carries a `residualTolerance`, and the two are set at
different call sites, usually by different tasks, and never compared.

### What actually goes wrong

The obvious guess — a loose inner solve makes the outer one thrash, stall or
fail to converge — is **wrong**, and it is worth stating plainly because it is
what a reader expects and what the naive test would have asserted.

Measured on a drag-and-wind planar shot, `Cd = 0.47`, 3 m/s wind, target at
295.32 m built to be reachable by construction, started from a deliberately
rough aim (`tolerance-coupling.test.ts`):

| inner `rtol` | outer status | iterations | residual it **reports** | miss it **actually has** |
| ------------ | ------------ | ---------- | ----------------------- | ------------------------ |
| `1e-3`       | `converged`  | 3          | `2.148e-07` m           | **`4.392e-02` m**        |
| `1e-4`       | `converged`  | 3          | `7.419e-08` m           | `2.547e-03` m            |
| `1e-5`       | `converged`  | 3          | `1.370e-08` m           | `3.053e-04` m            |
| `1e-6`       | `converged`  | 3          | `2.386e-09` m           | `7.536e-06` m            |
| `1e-7`       | `converged`  | 3          | `2.568e-10` m           | `4.732e-07` m            |
| `1e-8`       | `converged`  | 3          | `7.427e-10` m           | `1.144e-07` m            |

("Actually has" is the returned aim re-flown at `rtol = 1e-13`.)

**The status is `converged` on every row, in three iterations, at every
tolerance.** At the top row the solve reports a two-hundred-nanometre miss and
misses by four centimetres — a discrepancy of 2.0e5. Nothing in the outer
solve's report, history, iteration count or residual gives any sign of it.

The reason is that **the residual is a smooth, deterministic function of the
aim at any fixed `rtol`**. An adaptive integrator's step sequence is a function
of the initial condition, so the bias it introduces varies smoothly with the
aim rather than jittering. The outer solver therefore finds an _exact root of
the wrong function_, not an approximate root of the right one — and an exact
root looks exactly like success. This is the same shape of defect as P0.97 and
ADR-016: a wrong answer with `ok: true` and no diagnostic.

## Decision

Implement the coupling as an explicit, exported rule with **two independent
clauses**, and audit rather than enforce.

### Clause 1 — the residual's noise floor must sit below the tolerance being tested

An inner solve at relative tolerance `rtol` returns a residual carrying
absolute error of order `rtol · L`, where `L` is the trajectory's own scale.
Asking the outer solver for `‖F‖ < τ` is meaningless unless that error is well
below `τ`:

```
rtol ≤ noiseMargin · τ / L            (noiseMargin = 0.1)
```

This clause is **linear** in `τ`, and it involves `L`. Dropping `L` — treating
the outer tolerance as if it were relative — is not a simplification; the test
injects exactly that change and the rule stops delivering.

The table above is this clause, measured: across six decades the true miss
stays between `1.6e-2` and `1.5e-1` times `rtol · L`, never above it and never
near zero. So `rtol · L` is a real bound and a tight one.

### Clause 2 — the finite-difference Jacobian must be accurate enough to step with

This is where the "inner tolerance is the square of the outer" heuristic comes
from, and where this ADR disagrees with how it is usually quoted.

`finiteDifferenceStep` already derives the optimal step for a scheme of
truncation order `p` against a relative noise floor `ε`, from the error model
`E(h) ≈ C hᵖ + ε/h`:

```
h* ∝ ε^{1/(p+1)}
```

Substituting `h*` back into the same model gives the _achievable_ relative
Jacobian accuracy:

```
η ≈ ε^{p/(p+1)}        ⟺        ε ≤ η^{(p+1)/p}
```

- **forward** (`p = 1`): `ε ≤ η²` — the square, in the form it is always quoted.
- **central** (`p = 2`): `ε ≤ η^{3/2}`.

**This package differences centrally by default** (`JacobianOptions.scheme`).
At `η = 1e-3` the forward rule demands `rtol ≤ 1e-6` and the central rule only
`rtol ≤ 3.16e-5` — **31.6× looser**, and `η^{-1/2}` looser in general. Applying
the square to a central-difference caller over-tightens the inner solve by an
order and a half of magnitude, which on this repo's own benchmark
(`inverse-solve-perf.json`, p50 9.66 ms) is real time rather than a rounding
error.

So `coupleTolerances` takes the scheme as an input and the exponent follows
from it. **The task's own title says "outer tol²-style heuristic"; the square
is the special case, not the rule.**

### Neither clause dominates

Clause 1 scales with `τ / L`; clause 2 does not involve `τ` at all. On this
ADR's own shot (`L = 295.32` m, `η = 1e-3`, central) the crossover sits near
`τ = 0.09` m:

| outer `τ` | binding clause   | chosen `rtol` | true miss achieved |
| --------- | ---------------- | ------------- | ------------------ |
| `1e-6` m  | `residual-floor` | `3.386e-10`   | `4.641e-09` m      |
| `1e-4` m  | `residual-floor` | `3.386e-08`   | `2.921e-07` m      |
| `1e-2` m  | `residual-floor` | `3.386e-06`   | `1.227e-03` m      |
| `0.5` m   | `jacobian`       | `3.162e-05`   | `1.367e-03` m      |

Every row lands inside its tolerance, with one to three orders of headroom.
`ToleranceCoupling.binding` reports which clause decided, because "your
tolerance is too loose" is not actionable and "too loose _for the Jacobian_, so
either tighten it or accept a worse Jacobian" is.

### A third failure the rule catches, which is not a tolerance at all

`checkToleranceCoupling` also compares `JacobianOptions.noiseFloor` against the
inner `rtol`. These are two independent numbers that must agree, and nothing
else in the codebase relates them: a caller can integrate tightly and still
hand the Jacobian a stale, optimistic noise floor left over from an earlier
configuration. The consequence is a difference step derived for a residual far
cleaner than the one being differenced — the noise branch of the V-curve
`shooting-jacobian.ts` measures — reached while every tolerance in sight looks
conservative. `DEFAULT_NOISE_FLOOR` is `Number.EPSILON`, so **this is the
default behaviour for any caller who does not set it**.

### Audit, do not enforce

`coupleTolerances` returns a recommendation; `checkToleranceCoupling` returns a
verdict with reasons. Neither throws on an inconsistent configuration, and
`newtonShooting` is **not** changed to call either.

Three reasons:

1. A library that threw could not be used to _measure_ the inconsistency, and
   measuring it is what this ADR is built on — the table above is produced by
   auditing knowingly-bad configurations.
2. Deliberately loose solves are legitimate. `basin-of-attraction.ts`,
   `multi-start.ts` and the perf harness all want cheap approximate solves, and
   a rule that refused them would be refusing correct code.
3. `ShootingProblem` does not carry `L`. The trajectory scale is a property of
   the _target_, known to the caller and not to the solver, and there is no
   defensible default: a 30 m lob and a 3 km shot differ by two orders of
   magnitude in how much absolute error the same `rtol` buys. Inventing one
   inside `newtonShooting` would make the rule wrong by default for half its
   callers.

## Consequences

- Callers that want the coupling get it in one call and can wire both ends
  from one object (`rtol`, `atol`, and `noiseFloor` are all on the result,
  deliberately, because setting one and forgetting the other is the most
  likely way to use this wrongly).
- Nothing existing changes behaviour. 2448 tests were green before and after.
- **The reported residual of an inverse solve remains untrustworthy on its own
  terms.** The rule bounds the error; it does not report it. A caller who wants
  to _know_ the miss must re-fly the returned aim at a tighter tolerance, which
  is what the test does and what any future validation of a solved aim should
  do.
- The measurement suggests a follow-up this ADR does not take: the outer
  solvers could carry the audit's verdict on their result objects, so a
  `converged` status with an inconsistent configuration would at least say so.
  That is a change to four solvers' public result types and belongs to its own
  task.

## Alternatives rejected

**Hard-code the square.** It is the forward-difference case and this package
differences centrally. Over-tightening by 31.6× is not conservatism; it is
spending inner steps — the whole run time — to buy accuracy the Jacobian
cannot use.

**Derive `L` inside the solver from the first residual evaluation.** Tempting,
and wrong in the case that matters: the first evaluation is at the _initial_
aim, which for a rough start can be off by a factor of several, and clause 1's
limit would then move with the quality of the guess. `L` is a property of the
problem, so the caller passes it.

**Make `residualTolerance` relative instead, so the two are directly
comparable.** This would fold `L` into the outer tolerance and collapse clause
1 into a single comparison. It is arguably the better design and it is not
available: `residualTolerance` is a miss in metres, it is documented as one,
and every caller, golden file and benchmark in the repo is written against
that. Changing it is a breaking change to the package's central API in service
of a diagnostic.
