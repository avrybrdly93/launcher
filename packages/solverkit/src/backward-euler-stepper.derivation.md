# Backward (Implicit) Euler — Derivation

Implemented by {@link BackwardEulerStepper}. Blueprint §4.6.

## Scheme

$$\mathbf y_{k+1} = \mathbf y_k + h\, \mathbf f(t_{k+1}, \mathbf y_{k+1})$$

Unlike every other stepper in SolverKit, $\mathbf y_{k+1}$ appears on both sides: the update
requires solving a (generally nonlinear) equation rather than evaluating a closed-form
expression.

## Stability: why this method exists

Apply a method to the Dahlquist test equation $\dot y = \lambda y$, giving $y_{k+1} = R(z)
y_k$, $z = h\lambda$. Backward Euler's stability function is

$$R(z) = (1-z)^{-1}$$

which satisfies $|R(z)| \le 1$ for *all* $\operatorname{Re}(z) \le 0$ — **A-stable**. No
explicit RK method achieves this (§4.6): explicit Euler's region is the disk $|1+z|\le1$,
RK4's extends only to $\approx-2.785$ on the real axis. For the projectile, linearizing
quadratic drag about speed $u$ gives velocity-block eigenvalues $\lambda \approx -\rho C_d A\,
u/m \cdot \{1, \tfrac12\}$, so an explicit method needs

$$h < \frac{2}{|\lambda|_{\max}} = \frac{m}{\rho C_d A\, u_{\max}} \tag{4.12}$$

— on the stiff dust-grain scenario this forces explicit methods to crawl; backward Euler
takes visually-sized stable steps regardless of $h$, at the cost of solving an implicit
equation every step. It is the platform's one implicit reference method, included precisely
to complete the stiffness story (TR-BDF2/SDIRK2 remain an optional stretch, task P4.38).

## Newton iteration

Define the residual $F(\mathbf y) = \mathbf y - \mathbf y_k - h\, \mathbf f(t_{k+1}, \mathbf
y) = 0$ and solve by damped Newton. Each iteration solves the linear system

$$(\mathbf I - h\mathbf J)\,\boldsymbol\delta = -F\big(\mathbf y_k^{(i)}\big)$$

via {@link solveLinearSystemInPlace}, where $\mathbf J = \partial \mathbf f/\partial \mathbf
y$ comes from `model.jacobian` when declared (analytic), or an in-place central-difference
fallback otherwise: $J_{ij} \approx \big(f_i(\mathbf y + h_j\mathbf e_j) - f_i(\mathbf y -
h_j\mathbf e_j)\big) / (2h_j)$ with $h_j = \sqrt{\epsilon_{\text{mach}}}\max(|y_j|, 1)$. The
initial guess is $\mathbf y_k$ itself (not an explicit-Euler predictor), robust regardless of
$h$'s magnitude — the regime where this method is chosen specifically for its ability to take
huge steps.

**Damping.** Each correction is applied with a backtracking step size $\lambda \in \{1,
\tfrac12, \tfrac14, \dots\}$, halved until the candidate's scaled residual norm ({@link
scaledErrorNorm}, eq. 4.9-style scaling reused here as the Newton decrease test) is smaller
than the current iterate's, or the halving budget is exhausted. Convergence is declared once
that scaled norm is $\le 1$.

**Typed failure taxonomy.** A step that exhausts its iteration budget, hits a numerically
singular iteration matrix, fails the damping search, or evaluates a non-finite residual
writes `NaN` into `out.yNext`, sets `accepted = false`, and records a typed {@link
NewtonFailureReason} onto `out.newtonFailureReason` — so a forced non-convergence surfaces
*why* it failed, not just the NaN/`accepted: false` pair `integrate`'s non-finite-state guard
would otherwise report on its own.
