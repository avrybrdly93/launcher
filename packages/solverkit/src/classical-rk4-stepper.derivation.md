# Classical Runge–Kutta 4 — Derivation

Implemented by {@link ClassicalRK4Stepper}. Blueprint §4.4.

## Butcher tableau and scheme

$$
\begin{array}{c|cccc}
0 & & & & \\
\tfrac12 & \tfrac12 & & & \\
\tfrac12 & 0 & \tfrac12 & & \\
1 & 0 & 0 & 1 & \\
\hline
 & \tfrac16 & \tfrac13 & \tfrac13 & \tfrac16
\end{array}
\qquad
\begin{aligned}
\mathbf k_1 &= \mathbf f(t_k, \mathbf y_k)\\
\mathbf k_2 &= \mathbf f(t_k + \tfrac h2, \mathbf y_k + \tfrac h2 \mathbf k_1)\\
\mathbf k_3 &= \mathbf f(t_k + \tfrac h2, \mathbf y_k + \tfrac h2 \mathbf k_2)\\
\mathbf k_4 &= \mathbf f(t_k + h, \mathbf y_k + h \mathbf k_3)\\
\mathbf y_{k+1} &= \mathbf y_k + \tfrac h6(\mathbf k_1 + 2\mathbf k_2 + 2\mathbf k_3 + \mathbf k_4)
\end{aligned}
\tag{4.6}
$$

This is exactly {@link RK4_TABLEAU}, consumed through the shared {@link stepExplicitRK}
kernel.

## Derivation sketch (honest but bounded)

Order-4 accuracy requires matching the Taylor expansion of the exact flow through $h^4$.
The systematic tool is Butcher's rooted-tree theory: each elementary differential of
$\mathbf f$ (e.g. $\mathbf f_y \mathbf f$, $\mathbf f_{yy}(\mathbf f,\mathbf f)$, $\mathbf f_y
\mathbf f_y \mathbf f$, ...) corresponds to a rooted tree $\tau$, and order $p$ holds iff

$$ \sum_i b_i, \phi_i(\tau) = \frac{1}{\gamma(\tau)} \quad \text{for all trees with } |\tau|
\le p \tag{4.7}$$

where $\phi_i$ are stage weights and $\gamma$ the tree density. For $p=4$ there are 8 trees,
hence 8 conditions; the classical coefficients above satisfy all 8. For the scalar
autonomous case the four explicit conditions are

$$\sum b_i = 1, \quad \sum b_i c_i = \tfrac12, \quad \sum b_i c_i^2 = \tfrac13, \quad \sum
b_i a_{ij} c_j = \tfrac16,$$

plus, for the full vector case,

$$\sum b_i c_i^3 = \tfrac14, \quad \sum b_i c_i a_{ij}c_j = \tfrac18, \quad \sum b_i
a_{ij}c_j^2 = \tfrac1{12}, \quad \sum b_i a_{ij}a_{jl}c_l = \tfrac1{24}.$$

({@link checkOrderConditions} verifies these symbolically/numerically — task P2.14.)

## Properties

Order 4 with only 4 function evaluations per step — sitting exactly on the boundary where
stage count equals order (the *Butcher barrier*: for $p \ge 5$, explicit RK needs $> p$
stages). No embedded error estimate and no dense output natively, which is precisely what
motivates the adaptive embedded pairs of §4.5 ({@link createBogackiShampine32Stepper},
{@link createDormandPrince54Stepper}) and the Hermite dense-output fallback (§4.9,
{@link HermiteDenseOutputStepper}) used for fixed-step RK4 playback.

## Stability

$R_{\text{RK4}}(z) = \sum_{j=0}^4 z^j/j!$ (§4.6, eq. 4.11); the region extends to
$\approx -2.785$ on the real axis and, unlike Euler/RK2, includes a genuine interval of the
imaginary axis ($|z| \lesssim 2\sqrt2$) — why RK4 tolerates oscillatory dynamics that
destabilize Euler at any $h$.
$$
