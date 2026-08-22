# Choosing a method: Newton vs Nelder–Mead vs Levenberg–Marquardt

<!-- P5.29. Hand-written, unlike docs/physics/, which is generated from the blueprint.
     packages/validation/src/analysis-docs.test.ts checks the claims that can be checked:
     every method named below is a real export of the file named beside it, every table row
     resolves, and the table covers every solver `@ballista/analysis` exports. -->

`@ballista/analysis` ships five families of solver, and they are not ranked. Each is the
right answer to a differently-shaped question, and the fastest way to get a wrong answer
here is to reach for the most sophisticated one. This page is the decision procedure; the
[API map](./README.md) is the index of what exists.

Read the first matching row.

## Decision table

| If your problem is…                                                                                                                  | Use                                     | Exported from            | Needs derivatives?                 | Dimension | How it fails                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | ------------------------ | ---------------------------------- | --------- | ---------------------------------------------------------------------- |
| Hit a target: drive the two-component miss `F(θ, v₀)` to zero                                                                        | `newtonShooting`                        | `newton-shooting.ts`     | Yes — finite-difference Jacobian   | 2         | `stalled`, `line-search-failed`, `evaluation-failed`, `max-iterations` |
| The same solve, but near the reachability envelope where Newton stalls                                                               | `levenbergMarquardt`                    | `levenberg-marquardt.ts` | Yes — same Jacobian                | 2         | `stalled`, `damping-exhausted`, `evaluation-failed`, `max-iterations`  |
| The same solve, and you would rather not decide which of the two to call                                                             | `shootingWithFallback`                  | `levenberg-marquardt.ts` | Yes                                | 2         | Reports which solver produced the answer                               |
| Minimize something you cannot differentiate through — a table lookup, a `min` over arcs, a hit/miss predicate, a user-authored score | `nelderMead`                            | `nelder-mead.ts`         | **No**                             | `n`       | `max-iterations`, `max-evaluations`                                    |
| Minimize a smooth function of **one** variable on an interval you can bracket                                                        | `brentMinimize`                         | `brent-minimize.ts`      | No                                 | 1         | `max-iterations`, `evaluation-failed`                                  |
| The same, but you want guaranteed linear contraction rather than speed                                                               | `goldenSectionMinimize`                 | `brent-minimize.ts`      | No                                 | 1         | `max-iterations`, `evaluation-failed`                                  |
| Find _both_ arcs to a target, and you know where the range peak is                                                                   | `solveArcs`                             | `arcs.ts`                | No — two bracketed Brent solves    | 1 each    | Returns fewer than two solutions                                       |
| Find both arcs **without** supplying a peak or a bracket                                                                             | `multiStart`                            | `multi-start.ts`         | Yes — local solves                 | 2         | Reports how many distinct solutions it found                           |
| `argmax_θ R(θ)` — the optimal elevation, and how far it sits from 45°                                                                | `maximizeRange`                         | `optimal-angle.ts`       | No                                 | 1         | `at-bound`, `no-impact`, plus `Minimize1DStatus`                       |
| Of all aims that hit, the one launched slowest                                                                                       | `minimumSpeedToHit`                     | `min-energy.ts`          | No                                 | 1 (outer) | `unreachable`, `below-bracket`, `max-iterations`                       |
| The aim must respect box bounds on `θ` and `v₀`                                                                                      | `constrainedShooting`                   | `constraints.ts`         | Yes                                | 2         | `converged-on-bound`, `blocked-by-bound`, `unconstrained-failure`      |
| Minimize a risk measure of the miss over an ensemble of winds                                                                        | `robustAim`                             | `robust-aim.ts`          | No — wraps a derivative-free solve | 2         | `not-converged`, `nominal-failed`                                      |
| Lock any two of `(θ, v₀, R)` and solve the third                                                                                     | `designTrajectory`                      | `trajectory-designer.ts` | Depends on the lock                | 0, 1 or 2 | `unreachable`, `degenerate-elevation`                                  |
| Solve `R(θ) = R*` for one root, with a bracket                                                                                       | `solveRangeRoot`                        | `range-root.ts`          | No                                 | 1         | Returns no root                                                        |
| Where is the reachable set's boundary?                                                                                               | `computeEnvelope`, `assessReachability` | `envelope.ts`            | No                                 | —         | Reports unreachable rather than iterating                              |

Two entries that look like solvers and are not: `smartInitialAim` (`smart-init.ts`)
produces a _starting guess_ from the drag-free closed form, and `shootingJacobian`
(`shooting-jacobian.ts`) produces the derivative the two gradient-based rows above consume.
Neither converges to anything on its own.

## Why the three headline methods differ

### Newton — `newtonShooting`

The default for "hit this target". It uses the finite-difference Jacobian from
`shooting-jacobian.ts` and an Armijo backtracking line search, and it converges fast when it
converges at all.

The thing to understand before using it is that **the shooting Jacobian on this problem is
rank 1, always**, and the module is built around that rather than in spite of it. A
ground-impact terminal event pins `y_impact` to the ground for every aim, so
`∂F_y/∂θ = ∂F_y/∂v₀ = 0` and the vertical row is zero to `<1e-8`. A ground-impact shot is
one scalar equation — downrange miss — in two unknowns. Raising the target does not fix it;
it shifts `F_y` by a constant and leaves the row zero.

A textbook Newton step would solve `J Δ = −F` by elimination, dividing by a pivot of order
`1e-8` against entries of order `1e2`. The failure that produces is not an exception: it is
a step of order `1e10`, a line search that backtracks twenty times, and linear convergence
with every iterate looking perfectly finite. So the step here is a **truncated-SVD
minimum-norm least-squares solve** (`minimumNormStep`) — singular values below a relative
threshold are discarded and the null-space direction is simply not moved.

That the solution set is a _curve_ rather than a point is a property of the problem, not of
the solver. Newton lands on the point of that curve nearest the start, which is why the
starting guess matters and why `multiStart` exists.

### Levenberg–Marquardt — `levenbergMarquardt`

Reach for it when Newton stops converging **near the reachability envelope**. It is not a
smaller step in the same direction; it is a different direction, and that is the whole
reason it works where Newton does not.

On a rank-1 Jacobian with surviving row `(a, b)` in scaled variables, the minimum-norm step
is parallel to `(a, b)` — allocated in proportion to each variable's sensitivity. A shot's
range responds far more strongly to speed than to elevation, and at the envelope itself
`a → 0`, so `b/a → ∞` and Newton's step becomes almost entirely speed. LM regularizes
instead of truncating, which keeps the elevation component alive.

If you do not want to make this call per-problem, `shootingWithFallback` runs Newton and
falls back, and reports which one produced the answer.

### Nelder–Mead — `nelderMead`

The derivative-free fallback, over `n` continuous parameters. It exists deliberately, not as
a legacy option: tangent-linear sensitivities (`tangent-linear.ts`) are the efficient route
when the objective is a smooth functional of a trajectory and the parameter count is small,
and they stop working the moment the objective is assembled from something you cannot
differentiate through. Nelder–Mead asks the objective for nothing but its value.

**It is not the fast option and the module does not pretend otherwise.** Two properties
worth knowing before you call it:

- **Bounds are a smooth transform, not clipping.** Clipping flattens the objective outside
  the box, so the simplex sees a plateau and collapses onto a face that is not a minimum.
  The transform keeps every evaluated point strictly feasible instead.
- **A minimum sitting exactly on a bound is approached but never reached**, because
  `x → bound` only as `y → ±∞`. Every convergence test in the module is therefore evaluated
  on the `x` images, never on the simplex coordinates — a test written in `y` would never
  fire. If you need an active bound reported exactly, clamp the result or use
  `constrainedShooting`.

### The 1D minimizers — `brentMinimize`, `goldenSectionMinimize`

If the problem really is one-dimensional and you can bracket the minimum, neither of the
above is the right tool. Both of these take an interval assumed to contain one interior
minimum.

They live in `analysis` rather than `solverkit` on the blueprint's authority (line 1153
groups derivative-free optimization here, line 119 assigns optimization to this package),
and `brent-root-finder.ts` staying in `solverkit` is the intended split, not an oversight:
contracting a _sign-change_ bracket and contracting an _interval_ around a stationary point
are different algorithms that share an author.

**Know the precision floor before setting a tolerance.** Near a smooth interior minimum a
displacement `δ` changes `f` by `O(δ²)` while rounding error in evaluating `f` stays at
`O(ε_mach · |f(x*)|)`, so a method that can only _compare_ values saturates at

$$\delta_{\text{floor}} \approx \sqrt{\frac{2\,\varepsilon_{\text{mach}}\,|f(x^*)|}{f''(x^*)}}$$

Note what is not in that expression: it scales with `√|f(x*)|`, the size of the value being
cancelled against — **not** with `|x*|`, which is the folklore version and is wrong. A
minimum whose value is `0` has no floor at all. Expect the objective _value_ to reach `1e-10`
comfortably while the _location_ may not.

## Two rules that are not negotiable

- **Symplectic integrators are for conservative dynamics only.** Any drag, damping or
  otherwise dissipative force path uses a standard RK scheme. This is not a tuning
  preference; a symplectic method's conservation guarantee is meaningless once the system
  is dissipative.
- **Do not treat 45° as the optimal elevation.** It is exact for a drag-free ground launch
  and it is the answer to a different problem otherwise. With quadratic drag the optimum
  moves _below_ π/4, further the deeper into the drag-dominated regime the shot is; a launch
  that is raised or lands high also peaks below π/4, for a separate reason. Use
  `maximizeRange` and read the number.

## See also

- [Analysis API map](./README.md) — what each module exports
- [Adjoint sensitivity notes](../notes/adjoint-sensitivity.md)
- [Physics reference](../physics/README.md) — the equations being solved
