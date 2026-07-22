# Dormand–Prince RK5(4)7M (DOPRI5) — Derivation

Implemented via {@link createDormandPrince54Stepper} ({@link EmbeddedRKStepper} wired with
{@link DOPRI5_TABLEAU} and {@link DOPRI5_DENSE_OUTPUT_COEFFICIENTS}). Blueprint §4.5, §4.9.

## Principle: embedded pairs

Run two methods of orders $p$ and $\hat p = p-1$ sharing the same stages; their difference
estimates the local truncation error of the lower-order result:

$$ \boldsymbol\delta_{k+1} = \mathbf y_{k+1} - \hat{\mathbf y}_{k+1} = h \sum_i (b_i - \hat
b_i)\, \mathbf k_i = \mathcal O(h^{\hat p + 1}) \tag{4.8}$$

DOPRI5 is $p=5$, $\hat p=4$, 7 stages, FSAL: `b` (order 5) advances the accepted solution,
`bHat` (order 4) is the embedded estimate feeding the step-size controller. `b` is exactly
`a`'s 7th row (`a[6]`) with a trailing 0 — since $c_7=1$, stage 7 evaluates $\mathbf f$ at
exactly $(t+h, \mathbf y_{k+1})$, the same point stage 1 of the next step evaluates at, for
7 stages costing 6 evaluations/step amortized.

## Step-size controller

Given per-component tolerance $sc_i = \text{atol}_i + \text{rtol}\cdot\max(|y_{k,i}|,
|y_{k+1,i}|)$ and error norm ({@link scaledErrorNorm})

$$\text{err} = \sqrt{ \frac{1}{n} \sum_{i=1}^{n} \left( \frac{\delta_i}{sc_i} \right)^2 }
\tag{4.9}$$

accept the step iff $\text{err} \le 1$ and update

$$h_{\text{new}} = h \cdot \min\Big( f_{\max},\ \max\big( f_{\min},\ f_s\, \text{err}^{-1/(\hat
p + 1)} \big) \Big) \tag{4.10}$$

with safety $f_s = 0.9$, clamps $f_{\min} = 0.2$, $f_{\max} = 5$ (tighter $f_{\max}=1$ after a
rejection) — {@link attemptAdaptiveStep}, the "I" (elementary) controller. A **PI controller**
variant, `attemptAdaptivePIStep`, $h_{\text{new}} = h\, f_s\, \text{err}_k^{-\alpha}\,
\text{err}_{k-1}^{\beta}$ with $(\alpha,\beta) \approx (0.7/\hat p,\ 0.4/\hat p)$, visibly
suppresses accept/reject chatter on scenarios where $C_d(Re)$ changes rapidly. Mandatory
guards: an $h_{\min}$ floor that raises {@link StepSizeUnderflowError} (a diagnostic failure,
never a silent stall), step clamping at $t_f$ and at event localizations, and
rejection-count telemetry in `SolveStats`.

## Dense output ("free" interpolant)

{@link DOPRI5_DENSE_OUTPUT_COEFFICIENTS} is Shampine's continuous extension of the pair —
the same coefficients used by the reference Fortran `dopri5.f` and SciPy's `RK45` dense
output (§4.9). Row $s$ holds $[p_{s,1}, p_{s,2}, p_{s,3}, p_{s,4}]$: at $\theta=1$ each row
sums to `DOPRI5_TABLEAU.b[s]` (reproduces $\mathbf y_{k+1}$ exactly) and the $\theta^1$
coefficients are $(1,0,0,0,0,0,0)$ (reproduces $\mathbf f(t_k,\mathbf y_k)$ exactly at
$\theta=0$) — built from stages already computed for the step, so rendering, event
localization, and Monte Carlo observables between steps cost no extra `model.rhs` calls.

## Role in the platform

The reference production solver (§4.10): "Interactive sliders, sports projectiles → DOPRI5,
rtol $10^{-6}$ — fast, robust, dense output free." See
`bogacki-shampine-32.derivation.md` for the cheaper, lower-order sibling
({@link createBogackiShampine32Stepper}) used for loose-tolerance interactive use.
$$
