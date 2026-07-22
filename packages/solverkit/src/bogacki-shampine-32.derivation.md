# Bogacki–Shampine RK3(2) — Derivation

Implemented via {@link createBogackiShampine32Stepper} ({@link EmbeddedRKStepper} wired with
{@link BS32_TABLEAU}). Blueprint §4.5. See the `dormand-prince-54.derivation.md` derivation page for
{@link createDormandPrince54Stepper} — the shared embedded-pair theory this page only
summarizes.

## Principle

Run two methods of orders $p=3$ and $\hat p=2$ sharing the same 4 stages; their difference
estimates the local truncation error of the lower-order result:

$$ \boldsymbol\delta_{k+1} = \mathbf y_{k+1} - \hat{\mathbf y}_{k+1} = h \sum_i (b_i - \hat
b_i)\, \mathbf k_i = \mathcal O(h^{\hat p + 1}) \tag{4.8}$$

## Tableau

$$c = \left[0, \tfrac12, \tfrac34, 1\right], \qquad
b = \left[\tfrac29, \tfrac13, \tfrac49, 0\right], \qquad
\hat b = \left[\tfrac7{24}, \tfrac14, \tfrac13, \tfrac18\right]$$

exactly {@link BS32_TABLEAU}, with `embeddedOrder: 2`.

## FSAL structure

$b$ (order 3) is exactly $a$'s 4th row (`a[3]`) with a trailing 0 — the defining
first-same-as-last property. Since $c_4 = 1$, stage 4 evaluates $\mathbf f$ at exactly $(t +
h, \mathbf y_{k+1})$, the same point stage 1 of the *next* step would evaluate at; reusing it
makes a nominally-4-stage method cost effectively 3 evaluations/step.
{@link DOPRI5_TABLEAU}'s 7-stage tableau has the identical structural property.

## Role in the platform

The right default for loose-tolerance interactive use (§4.10's method-selection table):
cheaper per accepted step than {@link createDormandPrince54Stepper}'s DOPRI5 at the cost of
one order of local accuracy, appropriate when the step-size controller (§4.5, eq. 4.9-4.10)
is doing most of the accuracy work anyway.
$$
