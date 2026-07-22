# Heun (Trapezoidal) Runge–Kutta 2 — Derivation

Implemented by {@link HeunRK2Stepper}. Blueprint §4.3.

## Scheme

General explicit 2-stage RK:

$$ \mathbf k_1 = \mathbf f(t_k, \mathbf y_k), \quad
\mathbf k_2 = \mathbf f(t_k + c_2 h,\ \mathbf y_k + h\, a_{21} \mathbf k_1), \quad
\mathbf y_{k+1} = \mathbf y_k + h (b_1 \mathbf k_1 + b_2 \mathbf k_2) \tag{4.4}$$

Heun fixes $c_2 = a_{21} = 1$, $b = (\tfrac12, \tfrac12)$: take a *full* Euler step to get a
trial endpoint slope, then average it with the starting slope — the explicit
(non-iterated) analogue of the trapezoidal rule.

## Order-condition derivation (full)

Expand the exact solution with $\mathbf f' = \mathbf f_t + \mathbf f_y \mathbf f$ evaluated
at $(t_k, \mathbf y(t_k))$:

$$\mathbf y(t_{k+1}) = \mathbf y + h \mathbf f + \tfrac{h^2}{2}(\mathbf f_t + \mathbf f_y
\mathbf f) + \mathcal O(h^3).$$

Expand the method's stage $\mathbf k_2 = \mathbf f + c_2 h \mathbf f_t + a_{21} h\, \mathbf
f_y \mathbf f + \mathcal O(h^2)$, so

$$\mathbf y_{k+1} = \mathbf y + h(b_1 + b_2)\mathbf f + h^2 b_2 \big( c_2 \mathbf f_t +
a_{21} \mathbf f_y \mathbf f \big) + \mathcal O(h^3).$$

Matching through $h^2$ against the exact expansion gives the one-parameter family

$$b_1 + b_2 = 1, \qquad b_2 c_2 = \tfrac12, \qquad b_2 a_{21} = \tfrac12 \tag{4.5}$$

Substituting Heun's $c_2 = a_{21} = 1$ satisfies the last two with $b_2 = \tfrac12$, forcing
$b_1 = \tfrac12$ from the first — exactly {@link HEUN_TABLEAU}. Both stages contribute
equally to the update (unlike {@link MidpointRK2Stepper}, where $b_1 = 0$).

## Order and cost

Order 2 (LTE $\mathcal O(h^3)$), same as {@link MidpointRK2Stepper} — $c_2 = a_{21}$ is
forced by (4.5) for *any* member of this family, so the two named members necessarily share
the same convergence *slope* and differ only in their LTE *constant* (offset intercept on
the platform's work–precision plot, §4.5).
$$
