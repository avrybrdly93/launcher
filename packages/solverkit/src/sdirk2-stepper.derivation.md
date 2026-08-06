# SDIRK2 (Alexander) — Derivation

Implemented by {@link Sdirk2Stepper}. Blueprint §4.6, task P4.38.

## Scheme

A two-stage **singly diagonally implicit** Runge–Kutta method:

$$
\begin{array}{c|cc}
\gamma & \gamma & 0 \\
1 & 1-\gamma & \gamma \\ \hline
 & 1-\gamma & \gamma
\end{array}
\qquad\Longrightarrow\qquad
\begin{aligned}
\mathbf Y_1 &= \mathbf y_k + h\gamma\, \mathbf f(t_k + \gamma h, \mathbf Y_1) \\
\mathbf Y_2 &= \mathbf y_k + h(1-\gamma)\, \mathbf f_1 + h\gamma\, \mathbf f(t_k + h, \mathbf Y_2) \\
\mathbf y_{k+1} &= \mathbf y_k + h\big[(1-\gamma)\mathbf f_1 + \gamma \mathbf f_2\big] = \mathbf Y_2
\end{aligned}
$$

with $\mathbf f_i = \mathbf f(t_k + c_i h, \mathbf Y_i)$.

Three words in the name, three structural facts:

- **Diagonally implicit** ($a_{12} = 0$): the stages are solved one after the other, each a
  $\dim$-dimensional nonlinear system. A general two-stage implicit RK couples them into one
  $2\dim$-dimensional system.
- **Singly** ($a_{11} = a_{22} = \gamma$): both stages share the iteration matrix $(\mathbf I -
  h\gamma\mathbf J)$. {@link Sdirk2Stepper} evaluates the Jacobian once per step and reuses that
  matrix across both stages and every Newton iteration within them.
- **Stiffly accurate** ($\mathbf b$ = last row of $\mathbf A$): $\mathbf y_{k+1} = \mathbf Y_2$
  exactly, so the update is a copy rather than a weighted sum.

## Why $\gamma = 1 - 1/\sqrt2$

For an autonomous problem the order conditions through order 2 are

$$\sum_i b_i = 1, \qquad \sum_i b_i c_i = \tfrac12 .$$

The first holds for any $\gamma$: $(1-\gamma) + \gamma = 1$. With $\mathbf c = (\gamma, 1)$ the
second reads

$$(1-\gamma)\gamma + \gamma\cdot 1 = 2\gamma - \gamma^2 = \tfrac12
\quad\Longleftrightarrow\quad \gamma^2 - 2\gamma + \tfrac12 = 0
\quad\Longleftrightarrow\quad \gamma = 1 \pm \tfrac{1}{\sqrt2}.$$

Both roots give a second-order A-stable method. The conventional choice is the one inside
$(0,1)$,

$$\gamma = 1 - \tfrac{1}{\sqrt2} \approx 0.2928932188134525,$$

which has the smaller error constant. The order-3 condition $\sum_i b_i c_i^2 = \tfrac13$ gives
$(1-\gamma)\gamma^2 + \gamma = \tfrac13$, which neither root satisfies — the method is second
order and no better, which is what the convergence test measures.

## Stability: A-stable *and* L-stable

Apply the scheme to $\dot y = \lambda y$, $z = h\lambda$. Stage 1 gives $Y_1 = y_k/(1-\gamma z)$,
and substituting into stage 2:

$$Y_2 (1-\gamma z) = y_k + (1-\gamma)z\,\frac{y_k}{1-\gamma z}
\quad\Longrightarrow\quad
R(z) = \frac{(1-\gamma z) + (1-\gamma)z}{(1-\gamma z)^2} = \frac{1 + (1-2\gamma)z}{(1-\gamma z)^2}$$

({@link sdirk2StabilityFunction}). Note $1-2\gamma = \sqrt2 - 1 > 0$.

**A-stability** ($|R(z)| \le 1$ for all $\operatorname{Re} z \le 0$). $R$ is a rational function
analytic in the closed left half-plane — its only pole is $z = 1/\gamma > 0$ — so by the maximum
principle it suffices to check the boundary $z = iy$. There

$$|1 + (1-2\gamma)iy|^2 = 1 + (1-2\gamma)^2 y^2, \qquad
|1-\gamma iy|^4 = \big(1 + \gamma^2 y^2\big)^2 = 1 + 2\gamma^2 y^2 + \gamma^4 y^4 .$$

With $\gamma = 1 - 1/\sqrt2$: $(1-2\gamma)^2 = (\sqrt2-1)^2 = 3 - 2\sqrt2 \approx 0.1716$ and
$2\gamma^2 = 3 - 2\sqrt2 \approx 0.1716$ — *equal*. So the difference of the two is $\gamma^4 y^4
\ge 0$, giving $|R(iy)| \le 1$ for every real $y$, hence throughout the left half-plane. (That the
two coefficients coincide is not a coincidence: it is the same quadratic $\gamma^2 - 2\gamma +
\tfrac12 = 0$ rearranged, so second order and this equality are the same condition — the method
is A-stable *because* it is second order at this $\gamma$.)

**L-stability** ($R(z) \to 0$ as $z \to -\infty$). The numerator is degree 1 in $z$, the
denominator degree 2, so $R(z) \sim (1-2\gamma)/(\gamma^2 z) \to 0$.

### Why L-stability, not just A-stability

The trapezoidal rule is also second order and A-stable, with $R(z) = (1 + z/2)/(1 - z/2)$. But
$R(z) \to -1$ as $z \to -\infty$: on a stiff mode it neither blows up *nor decays* — it flips the
component's sign and preserves its magnitude, every step, forever. A physically instantaneous
transient rings for the entire solve. L-stability is exactly the property that rules this out, and
stiff accuracy ($\mathbf y_{k+1} = \mathbf Y_2$) is what secures $R(\infty) = 0$ rather than a
merely small value.

{@link BackwardEulerStepper} is also L-stable ($R(z) = (1-z)^{-1} \to 0$) but only first order.
SDIRK2 is the cheapest way to keep that damping and gain an order — at the cost of two implicit
solves per step instead of one.

## Newton iteration

Stage $i$ solves $F(\mathbf Y) = \mathbf Y - \mathbf p_i - h\gamma\,\mathbf f(t + c_i h, \mathbf
Y) = 0$, where $\mathbf p_1 = \mathbf y_k$ and $\mathbf p_2 = \mathbf y_k + h(1-\gamma)\mathbf
f_1$ are known before the stage starts. Each iteration solves

$$(\mathbf I - h\gamma\mathbf J)\,\boldsymbol\delta = -F\big(\mathbf Y^{(i)}\big)$$

via {@link solveLinearSystemInPlace}, with the same damped-backtracking acceptance test, the same
`model.jacobian`-or-central-differences Jacobian source, and the same typed
{@link NewtonFailureReason} reporting as {@link BackwardEulerStepper} — see that page for the
damping schedule and the finite-difference formula, which are unchanged here.

What *is* different: the Jacobian is evaluated **once per step**, at $\mathbf y_k$, and the
resulting $(\mathbf I - h\gamma\mathbf J)$ is reused by both stages (simplified/chord Newton).
This is the saving "singly" exists for; re-evaluating per iterate would discard it. Stage 1 starts
from $\mathbf y_k$, stage 2 from the converged $\mathbf Y_1$.

## Not covered here

No embedded error estimator: this is a fixed-step method and `errorEstimate` stays 0. The usual
adaptive companion is an ESDIRK pair (an explicit first stage plus a third stage supplying the
embedded solution), which changes the tableau rather than extending this one, and is not part of
P4.38.
