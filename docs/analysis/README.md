# Analysis API

<!-- P5.29. Hand-written, unlike docs/physics/, which is generated from the blueprint.
     packages/validation/src/analysis-docs.test.ts asserts that every module
     `@ballista/analysis` re-exports has a section here, and that every symbol named
     below is a real named export of the file it is listed under. -->

`@ballista/analysis` is the optimization and inverse-problem layer: given the forward model
in `@ballista/engine` and the linear algebra and root-finders in `@ballista/solverkit`, it
answers questions of the form _what aim produces this outcome_.

**If you are choosing between solvers, start at [method selection](./method-selection.md).**
That page is the decision table. This page is the index.

The package has one entry point:

```ts
import { newtonShooting, nelderMead, maximizeRange } from "@ballista/analysis";
```

## The forward problem, stated once

Everything here is built on the same residual. `createShootingResidual`
(`shooting-residual.ts`) turns a `ShootingProblem` into a `ResidualFunction` `F(θ, v₀)` —
the vector from where the shot lands to where it was meant to land. Solving is driving `F`
to zero; optimizing is minimizing some functional of the flight.

Two facts about `F` shape every module below, and both are measured rather than assumed:

- Its Jacobian is **rank 1** for any ground-impact shot, because a terminal event at `y = 0`
  pins the vertical residual row to zero for every aim.
- Its solution set is therefore a **curve** in `(θ, v₀)`, not an isolated point. Two arcs —
  low and high — are the generic answer to "what hits this target at this speed".

## Modules

### Problem setup

| Symbol                   | File                   | What it is                                             |
| ------------------------ | ---------------------- | ------------------------------------------------------ |
| `createShootingResidual` | `shooting-residual.ts` | `ShootingProblem` → `F(θ, v₀)`                         |
| `createFlight`           | `shooting-residual.ts` | The flight function the residual wraps                 |
| `residualNorm`           | `shooting-residual.ts` | `‖F‖`, the merit the solvers descend                   |
| `validateTarget`         | `targets.ts`           | Point, ring and platform target validation             |
| `missVector`             | `targets.ts`           | Signed miss against any target type                    |
| `isHit`                  | `targets.ts`           | Hit predicate — not differentiable, hence `nelderMead` |
| `smartInitialAim`        | `smart-init.ts`        | Starting guess from the drag-free closed form          |
| `dragFreeAim`            | `smart-init.ts`        | The closed form itself                                 |

### Derivatives

| Symbol                       | File                        | What it is                                 |
| ---------------------------- | --------------------------- | ------------------------------------------ |
| `shootingJacobian`           | `shooting-jacobian.ts`      | Finite-difference `∂F/∂(θ, v₀)`            |
| `finiteDifferenceStep`       | `shooting-jacobian.ts`      | Step-size selection for the stencil        |
| `createTangentLinearModel`   | `tangent-linear.ts`         | Forward-mode sensitivities through the ODE |
| `rangeSensitivity`           | `tangent-linear.ts`         | `∂R/∂p` by tangent-linear propagation      |
| `createAdjointRangeGradient` | `adjoint-range-gradient.ts` | The same gradient, backward mode           |

Forward mode costs one extra ODE solve per parameter; adjoint costs one backward solve
regardless of parameter count. See [the adjoint notes](../notes/adjoint-sensitivity.md).

### Tolerances

| Symbol                   | File                    | What it is                                       |
| ------------------------ | ----------------------- | ------------------------------------------------ |
| `coupleTolerances`       | `tolerance-coupling.ts` | Inner-IVP tolerances from the outer solver's ask |
| `checkToleranceCoupling` | `tolerance-coupling.ts` | Audits tolerances a caller already has           |

Two nested methods, two sets of tolerances, and nothing in the type system relating
them. A loose inner solve does not make the outer one fail — it makes it converge, in
three iterations, to a residual five orders of magnitude smaller than its true miss.
The rule and that measurement are in
[ADR-017](../adr/ADR-017-inner-outer-tolerance-coupling.md).

### Solving for an aim

| Symbol                 | File                     | What it is                                             |
| ---------------------- | ------------------------ | ------------------------------------------------------ |
| `newtonShooting`       | `newton-shooting.ts`     | Newton with a truncated-SVD minimum-norm step          |
| `minimumNormStep`      | `newton-shooting.ts`     | That step, exposed for inspection                      |
| `levenbergMarquardt`   | `levenberg-marquardt.ts` | Regularized alternative, for near-envelope aims        |
| `shootingWithFallback` | `levenberg-marquardt.ts` | Newton, falling back to LM                             |
| `constrainedShooting`  | `constraints.ts`         | Box bounds by projection or penalty                    |
| `projectAim`           | `constraints.ts`         | Clamp an aim onto the box                              |
| `multiStart`           | `multi-start.ts`         | Scattered starts, deduplicated into distinct solutions |

### Optimization

| Symbol                  | File                | What it is                                       |
| ----------------------- | ------------------- | ------------------------------------------------ |
| `nelderMead`            | `nelder-mead.ts`    | Derivative-free simplex over `n` parameters      |
| `brentMinimize`         | `brent-minimize.ts` | Brent's `localmin` on a bracketed interval       |
| `goldenSectionMinimize` | `brent-minimize.ts` | Golden-section search, same interface            |
| `maximizeRange`         | `optimal-angle.ts`  | `argmax_θ R(θ)` — the answer to the 45° folklore |
| `minimumSpeedToHit`     | `min-energy.ts`     | The slowest aim that still hits                  |
| `robustAim`             | `robust-aim.ts`     | Minimize a risk measure over a wind ensemble     |

### Structure of the solution set

| Symbol                 | File                     | What it is                                                |
| ---------------------- | ------------------------ | --------------------------------------------------------- |
| `solveArcs`            | `arcs.ts`                | Low and high arc, via a located peak and two Brent solves |
| `locatePeakAngle`      | `arcs.ts`                | The peak those brackets are placed around                 |
| `solveRangeRoot`       | `range-root.ts`          | One root of `R(θ) = R*`                                   |
| `solveRangeRoots`      | `range-root.ts`          | Both roots                                                |
| `dragFreeRange`        | `range-root.ts`          | `v₀² sin(2θ)/g`, the reference                            |
| `computeEnvelope`      | `envelope.ts`            | The reachable set's boundary                              |
| `assessReachability`   | `envelope.ts`            | Is this target reachable, and by how much                 |
| `maxHeightAtDownrange` | `envelope.ts`            | Ceiling of the reachable set at a station                 |
| `designTrajectory`     | `trajectory-designer.ts` | Lock two of `(θ, v₀, R)`, solve the third                 |

### Diagnostics

| Symbol                      | File                          | What it is                                    |
| --------------------------- | ----------------------------- | --------------------------------------------- |
| `sweepBasins`               | `basin-of-attraction.ts`      | Which start converges to which arc            |
| `censusOf`                  | `basin-of-attraction.ts`      | Outcome tally over a basin grid               |
| `boundaryFraction`          | `basin-of-attraction.ts`      | How fractal the basin boundary is             |
| `conditioningLevel`         | `ill-conditioning.ts`         | Condition-number banding                      |
| `sweepEnvelopeConditioning` | `ill-conditioning.ts`         | How conditioning degrades toward the envelope |
| `meritLogSlopes`            | `newton-convergence-order.ts` | Observed convergence order of a Newton trace  |
| `finalMeritSlopeRatio`      | `newton-convergence-order.ts` | Quadratic-convergence check                   |

### Reading a trajectory

`observables.ts` holds the pure readouts — `range`, `timeOfFlight`, `impactPoint`,
`impactSpeed`, `apex`, `apexHeight`, `apexTime`, `heightAtDownrange`, `missDistance`. They
take a solved trajectory and a layout (`PLANAR_LAYOUT` or `SPATIAL_LAYOUT`) and do no
solving of their own.

### Reading a trajectory you cannot afford to keep

`observable-sink.ts` computes the same quantities without the trajectory. `ObservableSink`
is a solver `Sink`: attach it in place of a `TrajectoryRecorder` and read `.observables`
once the solve concludes. Its footprint is `O(model.dim)` for the whole solve rather than
`O(steps × channels)`, which is what makes a 1e4-replicate Monte Carlo batch (P6.04,
`runtime`'s `mc-job.ts`) fit in a memory budget. One instance can be reused across solves;
`start` resets it.

It is the same arithmetic as `observables.ts`, not an approximation of it, and the tests
assert agreement with `Object.is` rather than a tolerance. Two caveats carry over
unchanged: the impact observables read the final row, and `status` is `"ok"` for a solve
that merely runs out of `tspan` — so `"ok"` is not a claim that anything landed. `mc-job.ts`
reports a separate per-replicate `landed` flag for that reason.

## Conventions

- **Angles are radians** throughout the API. Degrees appear only in UI and docs.
- **Every solver returns a status**, and none of them throw on non-convergence. A result
  whose status is not `converged` still carries the best point found; it is simply not
  certified. Check the status.
- **Symplectic integrators are for conservative dynamics only.** Every path here that
  includes drag uses a standard RK scheme. See
  [method selection](./method-selection.md#two-rules-that-are-not-negotiable).

## See also

- [Method selection](./method-selection.md) — Newton vs Nelder–Mead vs Levenberg–Marquardt
- [Adjoint sensitivity notes](../notes/adjoint-sensitivity.md)
- [Physics reference](../physics/README.md) — the forward model being inverted
