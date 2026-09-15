# The GPU impact point: how close is the in-kernel bisection, over a batch?

<!-- P7.19. Every number on this page is produced by
     packages/runtime/src/planar-impact-agreement-results.test.ts and recorded in
     planar-impact-agreement-results.json beside it. That test re-derives each verdict
     from the recorded numbers rather than reading the verdict fields, so a row edited
     here or there to say something friendlier fails the suite.
     Re-record with `pnpm update:impact-agreement`. -->

The GPU observables kernel locates ground impact by **bisecting the vertical cubic
Hermite** over the step that brackets the crossing — a fixed 60 halvings, hoisted out of
the step loop, every conditional a `select`. P7.19 asks whether that lands the impact
abscissa **within 1 mm of the CPU, over a batch of 10 000**.

**The short version.** It does not, on the default accumulator — and the family it fails on
is the one with no drag, no stiffness and the simplest dynamics in the study. The bisection
is not what fails. The march that hands it a bracket is.

## The mechanism was already there

P7.19's title asks for an in-kernel bisection with a fixed iteration count and
branch-uniform control flow. That landed with **P7.16**, inside the observables reduction:
`WGSL_IMPACT_BISECTION_STEPS` is 60, the loop runs once per thread after the march, and its
trip count does not depend on data. What P7.19 was actually still owed was the measurement
on this page, which had never been made at any batch size.

## What is being compared, and why it is not the obvious thing

"Within 1e-3 m **of CPU**" has two readings, and only one of them can fail.

No WebGPU adapter runs in CI or in the containers these sessions execute in, so the device
arm cannot be run. On P7.16's measured result — the WGSL reduction reproduced the CPU one
at **0 ULP across 50 000 values and 10 000 trajectories** on a real adapter — the **CPU f32
reduction stands in for the device**. That is P7.17's `withinP716Family` licence and it is
carried per family here for the same reason.

Read "CPU" as the f32 reduction and the comparison is then **that stand-in against itself**:
exactly `0.0` on all 10 000 rows, a criterion satisfied by construction. It would publish a
flat line as a pass. So the reference here is the **f64** arm, which makes the bar one the
f32 path can miss — and does.

This is not P7.17 again. That page budgets **relative** error per scenario class on four
hand-picked flights. This is an **absolute** millimetre bar on one observable over a
distribution of 10 000, and the batch finds worse members than the hand-picked flight did:
1.55e-2 m against 5.76e-3 m for the same scenario's nominal launch, **2.7× worse**.

## The batch

Four families, one per P7.17 scenario, each a 50 × 50 grid over launch speed (0.8–1.2×
nominal) and elevation (25–65°). Deterministic and RNG-free — a grid states its coverage in
its own definition. Every member launches from `x = 0` with `vx > 0`, which is what makes
`range` and the impact abscissa the same number; the reducer does not expose the abscissa
directly.

**All 10 000 members reach the ground.** That is asserted, not hoped: a flight that never
crosses `y = 0` returns `range = 0` on _both_ arms and would contribute a perfect `0.0` to
every maximum it was allowed into. Step budgets come from a measurement — each family's
longest flight integrated at f64 with an oversized budget, plus about 8%.

Errors below are **maximum absolute metres across the batch**, never a mean. A correctness
bar that passes on average is not a correctness bar.

## The result

| Family                | Class     | n    | Plain f32   | Compensated f32 | Plain ≤ 1 mm | Comp. ≤ 1 mm |
| --------------------- | --------- | ---- | ----------- | --------------- | ------------ | ------------ |
| `vacuum-45deg`        | `low-pi`  | 2500 | **1.55e-2** | 3.17e-5         | **no**       | yes          |
| `shot-put`            | `low-pi`  | 2500 | 1.17e-4     | 4.11e-6         | yes          | yes          |
| `table-tennis`        | `high-pi` | 2500 | 3.57e-5     | 2.30e-6         | yes          | yes          |
| `table-tennis-cannon` | `stiff`   | 2500 | 1.01e-4     | 5.46e-6         | yes          | yes          |

**Plain f32 misses the budget by 15.5×**, and misses it on exactly one family. **Compensated
f32 meets it everywhere**, worst case 3.17e-5 m — 31× inside the bar.

## Why the drag-free family is the one that fails

Because it flies longest. This is P7.17's central finding reproduced over a distribution
rather than a single flight: f32 adequacy here is a property of the **march**, not of the
physics. Error accumulates with step count, the drag-free case has no drag to bring it down
and therefore the most steps, and the `stiff` row — the one the word suggests should be
worst — passes with an order of magnitude to spare.

The worst member sits at maximum speed but an **interior** elevation of 60.9°, not at a grid
corner. Higher elevation buys flight time and loses range, so the worst case is a genuine
optimum inside the grid rather than an artefact of where the sweep was cut off.

## What fixes it, and what that says about the kernel

P7.18's two-float accumulator, which is already in the tree and **off by default**. The
improvement on the drag-free worst member is **490×**.

P7.18 handed forward the question of whether this bisection accumulates anything across its
iterations, in which case compensation would be a flag rather than a new mechanism. **It does
not** — `mid = 0.5 * (lo + hi)` is a contraction whose error is bounded by the current
bracket width rather than summed. But the march that produces the bracket does accumulate,
so compensation is load-bearing here anyway, by a different route than the one predicted.

**The consequence is that the WGSL kernel cannot currently meet this bar on long flights.**
P7.18 added `compensated` to the CPU stepper; `rk4Step` in `wgsl-planar-physics.ts` has no
equivalent, so the device has no switch to turn on. Closing that is **P0.136**, filed rather
than done here: adding an accumulation mode to a kernel is a change to the shader every GPU
task downstream depends on, and it would move recorded references P7.16 and P7.17 were
measured against.

## What this page does not say

- **It is not a device measurement.** No adapter was available; these are CPU f32 numbers
  standing in for one under the licence above. `table-tennis-cannon` is explicitly _outside_
  that family, and its row is a CPU result that has not been shown to predict a device.
- **It says nothing about impact _time_.** P7.17 established that the time channels do not
  improve under compensation, because the march recomputes `t` from `n` rather than
  accumulating it, so there is no running sum to compensate. Nothing here changes that.
- **1 mm is P7.19's bar, not a physical tolerance.** Whether a millimetre matters is a
  question about the application, and this page does not answer it.

## See also

- [The f32 precision budget](./f32-precision-budget.md) — P7.17, the per-class relative
  budget this page's absolute bar sits beside
- `packages/runtime/src/planar-impact-agreement-study.ts` — the study
- `packages/runtime/src/wgsl-observables-kernel.ts` — the kernel whose bisection this grades
