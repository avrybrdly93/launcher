# Midpoint Runge–Kutta 2 — Derivation

Implemented by {@link MidpointRK2Stepper}. Blueprint §4.3. See
{@link HeunRK2Stepper}'s derivation page for the shared order-condition algebra this page
only summarizes.

## Scheme

General explicit 2-stage RK:

$$\mathbf k_1 = \mathbf f(t_k, \mathbf y_k), \quad
\mathbf k_2 = \mathbf f(t_k + c_2 h,\ \mathbf y_k + h\, a_{21} \mathbf k_1), \quad
\mathbf y_{k+1} = \mathbf y_k + h (b_1 \mathbf k_1 + b_2 \mathbf k_2) \tag{4.4}$$

Midpoint fixes $c_2 = a_{21} = \tfrac12$, $b = (0, 1)$: take an Euler half-step to estimate
the state at the step's midpoint, evaluate the slope there, then advance the *full* step
using only that midpoint slope (the starting slope $\mathbf k_1$ is discarded from the
final combination — $b_1 = 0$).

## Order conditions

Matching the method's Taylor expansion against the exact solution's through $\mathcal
O(h^2)$ gives the one-parameter family

$$b_1 + b_2 = 1, \qquad b_2 c_2 = \tfrac12, \qquad b_2 a_{21} = \tfrac12 \tag{4.5}$$

(full expansion in {@link HeunRK2Stepper}'s derivation page). Substituting $c_2 = a_{21} =
\tfrac12$ satisfies the second and third conditions with $b_2 = 1$, forcing $b_1 = 0$ from
the first — exactly {@link MIDPOINT_TABLEAU}. Order 2: LTE is $\mathcal O(h^3)$.

## Relationship to Heun

Note $c_2 = a_{21}$ is *forced* by (4.5) for any member of this family — a fact worth
surfacing pedagogically (§4.3). Midpoint and Heun are both order 2 with the same
work–precision *slope*, differing only in their LTE *constant* (offset intercept on the
log-log convergence plot) — the platform demonstrates this empirically rather than just
asserting it.
