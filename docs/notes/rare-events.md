# Rare events, and why counting stops working

Companion note to `packages/analysis/src/importance-sampling.ts` (P6.23).

The other Monte Carlo notes in this repo are about estimating a _mean_ well.
This one is about the case where the ordinary estimator does not merely
converge slowly but stops being usable at all, and about the one change that
fixes it.

---

## 1. The cost of a rare event

Estimate `p = P(A)` by firing `N` shots and counting. `p̂ = k/N` is unbiased
and its variance is `p(1 − p)/N`, so

$$\frac{\mathrm{SE}(\hat p)}{p} = \sqrt{\frac{1-p}{Np}} \approx \frac{1}{\sqrt{Np}}$$

The absolute error falls as `1/√N`, exactly as it always does. **The relative
error does not depend on `N` alone — it depends on `Np`, the expected number
of hits.** So a fixed relative accuracy costs

$$N \approx \frac{1}{p \cdot \mathrm{rse}^2}$$

which scales as `1/p`. That is the whole difficulty, and it is worth writing
out because it is not a constant-factor problem that a faster integrator or
more workers can fix:

| `p`    | draws for 10% relative error |
| ------ | ---------------------------- |
| `10⁻¹` | 900                          |
| `10⁻²` | 9,900                        |
| `10⁻³` | 99,900                       |
| `10⁻⁴` | 999,900                      |
| `10⁻⁶` | ~10⁸                         |

`bruteForceSampleSize(p, rse)` returns this number.

There is a second failure that the standard-error formula hides. At `Np ≈ 0.3`
the _most likely single outcome of the entire study is zero hits_. The
estimate is then `p̂ = 0`, and its estimated standard error is also `0` —
a point estimate of zero with no uncertainty attached, which is the most
confidently wrong output a Monte Carlo study can produce. The 200-replication
demo in `importance-sampling-variance-reduction.test.ts` measures this
directly: at `p = 1.59 × 10⁻⁴` and `N = 20,000`, **only 39 of 200 brute-force
studies land within 25% of the truth.**

---

## 2. Sampling somewhere else, and paying for it

Let `f` be the distribution we care about and `g` any distribution whose
support covers wherever `f` has mass. Then

$$p = \mathbb{E}_f[\mathbb{1}_A] = \int \mathbb{1}_A(x) f(x)\,dx = \int \mathbb{1}_A(x) \frac{f(x)}{g(x)} g(x)\,dx = \mathbb{E}_g\!\left[\mathbb{1}_A \frac{f}{g}\right]$$

so drawing `x₁…x_N ~ g` and averaging `1{A(xᵢ)} · wᵢ` with the **likelihood
ratio** `wᵢ = f(xᵢ)/g(xᵢ)` estimates the same `p`. This is unbiased for _any_
admissible `g`; the proposal affects variance and nothing else.

That is the same structural property `control-variate.ts` has for its
coefficient `c`, and it has the same consequence for API design: a bad choice
costs accuracy, never correctness, so this belongs as something a caller
reaches for rather than a transformation applied silently.

The variance is

$$\mathrm{Var}_g(\hat p_{\mathrm{IS}}) = \frac{1}{N}\left(\mathbb{E}_g\!\left[\mathbb{1}_A \frac{f^2}{g^2}\right] - p^2\right)$$

and it is minimised — to exactly zero — by `g*(x) = f(x)1_A(x)/p`. That
proposal is useless, since building it requires `p`. But it says what a good
proposal looks like: **it should look like `f` restricted to the event.**

---

## 3. The tilt

For `X ~ N(μ, σ)` and `A = {X > t}`, take `g = N(ν, σ)` — the same spread,
shifted mean. The normalising constants and the quadratic terms cancel, and
with `d = ν − μ` the ratio is a clean exponential:

$$\log w(x) = -\frac{d}{\sigma^2}\left(x - \mu - \frac{d}{2}\right)$$

`normalShiftLikelihoodRatio` computes exactly this form rather than
`exp(−z_f²/2 + z_g²/2)`. The two are algebraically equal; the second subtracts
two large nearly-equal numbers, and the far tail is both where this estimator
gets used and where that subtraction loses the most. It also makes `d = 0`
return exactly `1`, which is what lets the demo's negative control assert
`weights.every(w => w === 1)` rather than a tolerance.

**Keeping `σ` fixed is a deliberate constraint.** Widening the proposal instead
of shifting it also puts draws in the tail, but then `f/g` grows without bound
as `x → ∞`, and the estimator can have _infinite variance_ while every
individual draw looks perfectly reasonable and the sample standard error looks
small. A mean shift keeps the ratio bounded on the event.

---

## 4. Where to put the shift

`normalShiftProposal(mean, sigma, threshold)` puts `ν = t`: **the proposal mean
goes on the threshold.**

This is the classical large-deviations tilt — the exponentially tilted
distribution whose mean satisfies the constraint — and the intuition is
immediate: it turns the rare event into a coin flip. Measured in the demo,
50.2% of draws under this proposal land in the event, against 0.05% under the
nominal distribution (1 hit in 2000).

It is not the exact variance minimiser; `g*` above is, and is unavailable. What
matters is that it is robust, and that the failure mode of getting it wrong is
asymmetric:

- **Under-tilting** (`ν` short of `t`) degrades gracefully towards brute force.
  At `ν = μ` every weight is 1 and the estimator _is_ brute force — asserted
  in the demo as a negative control.
- **Over-tilting** (`ν` far past `t`) fails badly and _quietly_. Measured at
  `ν = μ + 12σ` on the demo's problem: 100% of draws "hit", which looks like a
  triumph; the estimate is `3.0 × 10⁻¹⁶` against a true `1.59 × 10⁻⁴`, wrong by
  twelve orders of magnitude. Nothing in `p̂` says so.

That asymmetry is the entire argument for §5.

---

## 5. Three diagnostics, because the estimate cannot police itself

Under a bad proposal the estimate is computed almost entirely from one or two
draws — and its _sample_ standard error, computed from that same degenerate
sample, is small, because the sample really was internally consistent. The
estimate and its error bar agree with each other and are both wrong.

`ImportanceSamplingEstimate` therefore reports three things beside `pHat`:

| field                 | what it catches                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------- |
| `effectiveSampleSize` | Kish's `(Σw)²/Σw²`. `N = 2000` with `ESS = 1.1` is a one-sample study wearing a two-thousand-sample coat. |
| `maxWeightShare`      | The largest contributing weight over their sum. Near 1 means one draw _is_ the answer.                    |
| `hits`                | How many draws landed in `A` at all. Under-tilting shows up here first.                                   |

Measured on the demo's problem at `N = 2000`:

The true value is `p = 1.591 × 10⁻⁴`.

| proposal                    | `hits/N`  | `pHat`        | ESS       | weight efficiency | max share  |
| --------------------------- | --------- | ------------- | --------- | ----------------- | ---------- |
| untilted (`ν = μ`)          | 0.0005    | `5.00e-4`     | 1.00      | 0.0005            | 1.00       |
| **tilted to `t`**           | **0.502** | **`1.54e-4`** | **402.5** | **0.201**         | **0.0050** |
| over-tilted (`ν = μ + 12σ`) | 1.000     | `3.00e-16`    | 1.09      | 0.00055           | 0.955      |

The middle row is the only one that is right, and — the point — it is the only
one whose diagnostics say so. Both failures show an ESS of about **1**: the
untilted study saw a single hit, and the over-tilted one made 2000 hits of which
one carries 96% of the answer. They fail for opposite reasons and the ESS
catches both, which is why it is reported rather than left for a caller to
derive.

Note the over-tilted row's `pHat` beside its ESS. `3.00 × 10⁻¹⁶` against a true
`1.59 × 10⁻⁴` is not a slightly noisy answer — it is wrong by twelve orders of
magnitude — and the estimator's own standard error for it is `3 × 10⁻¹⁶`, i.e.
it reports that catastrophic answer to within 100% of itself and no further.
Nothing in the estimate or its error bar is alarming. The ESS is.

When nothing contributed, the three come back `NaN` rather than `0`. Zero would
read as "perfectly concentrated" and "no uncertainty", and an empty sample
supports neither statement.

---

## 6. The measured result

`importance-sampling-variance-reduction.test.ts`, 200 independent replications
of each estimator on a constructed tail at `p = 1.59 × 10⁻⁴`:

|                     | draws per study | RMS error vs exact `p` | studies within 25% |
| ------------------- | --------------- | ---------------------- | ------------------ |
| brute force         | 20,000          | `8.94 × 10⁻⁵`          | 39 / 200           |
| importance sampling | **2,000**       | `7.76 × 10⁻⁶`          | **200 / 200**      |

**11.5× less error at 10× fewer draws.** Since Monte Carlo error falls as
`1/√N`, brute force would need about `11.5² = 132×` more than its 20,000 to
match — call it three orders of magnitude in total sample size.

Both estimators are unbiased over the replications (`|z| = 0.68` for IS,
`1.57` for brute force against their own standard errors), which is the control
that stops the RMSE comparison being satisfied by an estimator that returns a
well-chosen constant.

### Why the exact `p` is available

The demo is a real hit probability, not an abstract Gaussian tail, and it is
still checkable in closed form. Muzzle velocity `v₀ ~ N(300, 3)` m/s at 20°
elevation; the event is "the shot carries past a no-go line". Drag-free range
`R(v₀) = v₀² sin 2θ / g` is **strictly increasing** in `v₀`, so

$$R(v_0) > R_t \iff v_0 > \sqrt{R_t g / \sin 2\theta}$$

_exactly_ — the event is a Gaussian upper tail in `v₀` after all, with
probability `normalUpperTail((v_crit − μ)/σ)`. Both estimators are scored
against that number rather than against each other. Two noisy estimators
agreeing is not evidence, and a brute-force estimate at these sample sizes is
far too noisy to serve as anyone's reference. The monotonicity step is asserted
in the suite rather than assumed, since it is what makes the closed form
legitimate.

---

## 7. What this does not cover

- **Multivariate proposals.** The tilt here is one-dimensional. The
  multivariate Gaussian mean shift generalises directly; choosing the shift
  _direction_ is the "design point" problem of structural reliability (FORM /
  SORM) and is a genuinely larger piece of work.
- **Adaptive / cross-entropy importance sampling**, which learns the proposal
  from pilot draws instead of being handed a threshold.
- **Non-Gaussian nominal distributions.** The estimator itself is generic — it
  takes weights — but the only proposal family shipped with an exact closed-form
  ratio is the shifted normal.
- **Self-normalised importance sampling**, needed when `f` is known only up to
  a constant. Not needed here, and it is biased, so it is a different estimator
  rather than an option on this one.
- **Multilevel splitting / subset simulation**, the other main family for rare
  events, which is a better fit when no good proposal is available but the event
  can be reached through nested intermediate ones.

---

## References

- Kish, L., _Survey Sampling_, Wiley, 1965 — the effective sample size.
- Bucklew, J. A., _Introduction to Rare Event Simulation_, Springer, 2004 —
  exponential tilting and the large-deviations choice of proposal.
- Owen, A. B., _Monte Carlo theory, methods and examples_, 2013, ch. 9 —
  importance sampling, and the infinite-variance traps in particular.
- Asmussen, S. & Glynn, P., _Stochastic Simulation_, Springer, 2007, ch. VI.
