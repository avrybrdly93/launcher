<!-- GENERATED FILE — DO NOT EDIT BY HAND.
     Source: ballista-technical-blueprint.md §3.8
     Regenerate: node scripts/generate-physics-docs.mjs
     The prose below is copied verbatim from the blueprint, which stays the
     source of truth for architecture. Edit the blueprint, then regenerate. -->

# §3.8 Continuous-Time System Properties

> Regenerated from [`ballista-technical-blueprint.md`](../../ballista-technical-blueprint.md) §3.8.
> Physics reference index: [`docs/physics/README.md`](./README.md).

Several analytic properties of (3.17) shape the numerical design and must be documented alongside the model:

**Smoothness.** With smooth $C_d$, $C_L$, atmosphere, and wind models, $\mathbf{f} \in C^\infty$ except at $\mathbf{v}_{\text{rel}} = 0$, where $u\,\mathbf{u}$ is $C^1$ but not $C^2$. Trajectories passing near stagnation (vertical throws in still air near apex have $u \ne 0$ generally, but pure vertical drop from rest starts *at* the kink) can locally limit high-order convergence; the validation suite includes this case deliberately.

**Lipschitz constant / stiffness scales.** Linearizing drag gives a velocity-relaxation timescale; for quadratic drag near speed $u$, $\tau_{\text{drag}} \sim m / (\rho C_d A\, u)$. Stiffness in this system is **parameter-induced**: a table-tennis ball ($\tau \sim 0.4$ s) is benign, a dust grain ($\tau \sim 10^{-4}$ s) with flight time of seconds yields stiffness ratio $\sim10^4$ and makes explicit Euler at visually-reasonable $\Delta t$ unstable — the platform's canonical stiffness demonstration (Section 4.8).

**Energy balance.** Define mechanical energy $E = \tfrac12 m \lVert\mathbf v\rVert^2 + mgy$. Along trajectories,

$$\frac{dE}{dt} = \mathbf{F}_{\text{aero}} \cdot \mathbf{v} = -\tfrac12 \rho C_d A\, u\, (\mathbf u \cdot \mathbf v) + \mathbf F_M \cdot \mathbf v
\tag{3.19}$$

In still air, drag strictly dissipates ($\mathbf u = \mathbf v$ ⇒ $dE/dt = -\rho C_d A\, \lVert\mathbf v\rVert^3/2 \le 0$) and the *ideal* Magnus force does no work ($\mathbf F_M \perp \mathbf v_{\text{rel}} = \mathbf v$). These give two exact runtime checks: (i) with all aero off, $E$ is conserved; (ii) with Magnus only, $E$ is conserved; (iii) with drag on in still air, $E$ is monotone non-increasing. The Recorder computes the **energy residual** $\;\mathcal R_E(t) = E(t) - E(0) - \int_0^t \mathbf F_{\text{aero}}\cdot\mathbf v\, dt'\;$ (work integral accumulated by the same quadrature order as the stepper) as a first-class diagnostic channel.

**Nondimensionalization.** With characteristic speed $v_0$ and time $v_0/g$, the drag-to-gravity ratio is governed by a single dimensionless group $\Pi = \rho C_d A v_0^2 / (2mg) = (v_0/v_T)^2$. The UI surfaces $\Pi$, $Re$, $S$, and $M$ live; the scenario library is organized by these groups rather than by raw parameters, which is both better pedagogy and better test coverage (each analytic/qualitative regime gets a representative scenario).

**Well-posedness of events.** Ground impact is the root of $g_{\text{gnd}}(t) = y(t) - y_{\text{terrain}}(x(t))$; apex is the root of $v_y(t)$. Both are simple roots for generic trajectories (transversality), but grazing impacts (near-tangent terrain) are a documented hard case with a dedicated bisection fallback in the event detector (Section 4.9 / task P2.31).

## Implementation

Where this section's model lives in the codebase. Every row is checked by
[`packages/validation/src/physics-docs.test.ts`](../../packages/validation/src/physics-docs.test.ts):
the file must exist and the symbol must be a named export of it.

| Symbol | Source | Role |
| --- | --- | --- |
| `mechanicalEnergy` | [`packages/engine/src/planar-projectile-model.ts`](../../packages/engine/src/planar-projectile-model.ts) | E = m|v|^2/2 + mgy, the quantity Eq. (3.19) differentiates. |
| `totalForcePower` | [`packages/engine/src/forces.ts`](../../packages/engine/src/forces.ts) | F_aero . v — the RHS of Eq. (3.19) and the integrand of the energy residual. |
| `dimensionlessPi` | [`packages/engine/src/characteristic-scales.ts`](../../packages/engine/src/characteristic-scales.ts) | Pi = rho C_d A v_0^2 / (2mg) = (v_0/v_T)^2. |
| `apexHeightEstimate` | [`packages/engine/src/characteristic-scales.ts`](../../packages/engine/src/characteristic-scales.ts) | Drag-free apex scale for the characteristic-scales readout. |
| `recommendSolver` | [`packages/engine/src/solver-advisor.ts`](../../packages/engine/src/solver-advisor.ts) | Turns the parameter-induced stiffness scales of this section into a solver recommendation. |
| `groundHeightResidual` | [`packages/engine/src/terrain.ts`](../../packages/engine/src/terrain.ts) | g_gnd(t) = y - y_terrain(x), the ground-impact event root. |
| `finiteDifferenceJacobian` | [`packages/engine/src/finite-difference-jacobian.ts`](../../packages/engine/src/finite-difference-jacobian.ts) | Numerical J = df/dy where a model declares no analytic Jacobian. |

---

← [§3.7 State Vector Formulation](./state-vector.md) · [Index](./README.md) · [§3.9 Projectile and Scenario Database](./projectile-and-scenario-database.md) →
