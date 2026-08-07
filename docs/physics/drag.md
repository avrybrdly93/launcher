<!-- GENERATED FILE — DO NOT EDIT BY HAND.
     Source: ballista-technical-blueprint.md §3.3
     Regenerate: node scripts/generate-physics-docs.mjs
     The prose below is copied verbatim from the blueprint, which stays the
     source of truth for architecture. Edit the blueprint, then regenerate. -->

# §3.3 Drag: Linear and Quadratic Regimes

> Regenerated from [`ballista-technical-blueprint.md`](../../ballista-technical-blueprint.md) §3.3.
> Physics reference index: [`docs/physics/README.md`](./README.md).

Aerodynamic drag opposes the velocity of the projectile **relative to the air**. Define the relative velocity

$$\mathbf{v}_{\text{rel}} = \mathbf{v} - \mathbf{w}(t, \mathbf{r})
\tag{3.4}$$

where $\mathbf{w}$ is the wind field (Section 3.5). All aerodynamic forces are functions of $\mathbf{v}_{\text{rel}}$, never of $\mathbf{v}$ directly; conflating these is the single most common student bug and is caught by a dedicated regression test (T-VAL-09).

**Linear (Stokes) drag** — valid for Reynolds number $Re \lesssim 1$ (mist droplets, dust):

$$\mathbf{F}_{d,\text{lin}} = -b\, \mathbf{v}_{\text{rel}}, \qquad b = 6\pi \eta R \ \ \text{(Stokes sphere)}
\tag{3.5}$$

with dynamic viscosity $\eta$ and radius $R$. Its virtue is analytical solvability: with $\mathbf{w} = 0$, the components decouple,

$$v_x(t) = v_{x0} e^{-t/\tau}, \qquad
v_y(t) = -v_T + (v_{y0} + v_T) e^{-t/\tau}, \qquad
\tau = \frac{m}{b},\ v_T = \frac{mg}{b}
\tag{3.6}$$

$$x(t) = x_0 + v_{x0}\,\tau\,(1 - e^{-t/\tau}), \qquad
y(t) = y_0 - v_T t + (v_{y0} + v_T)\,\tau\,(1 - e^{-t/\tau})
\tag{3.7}$$

Equations (3.6)–(3.7) are the platform's second analytical validation pillar (after the drag-free parabola) and the basis of the convergence-rate test suite (Section 8.2).

**Quadratic (Newtonian) drag** — valid for $Re \gtrsim 10^3$, i.e., essentially all sports and ballistic regimes:

$$\mathbf{F}_{d,\text{quad}} = -\tfrac{1}{2}\, \rho(\mathbf{r})\, C_d(Re, M)\, A\, \lVert \mathbf{v}_{\text{rel}} \rVert\, \mathbf{v}_{\text{rel}}
\tag{3.8}$$

with air density $\rho$, drag coefficient $C_d$, reference (cross-sectional) area $A = \pi R^2$ for spheres. The Reynolds and Mach numbers are

$$Re = \frac{\rho \lVert\mathbf{v}_{\text{rel}}\rVert D}{\eta}, \qquad M = \frac{\lVert\mathbf{v}_{\text{rel}}\rVert}{c(T)}, \quad c = \sqrt{\gamma R_s T}
\tag{3.9}$$

**Drag coefficient models**, in increasing fidelity, all behind one `DragCoefficientModel` interface:

1. **Constant:** $C_d = 0.47$ (smooth sphere, subcritical). Default.
2. **Reynolds-dependent smooth sphere** (covers the drag crisis near $Re \approx 3\times10^5$ where $C_d$ drops to $\approx 0.1$): piecewise correlation, e.g., a Morrison-type fit; implemented as tabulated $(Re, C_d)$ with monotone cubic (PCHIP) interpolation to guarantee smoothness of $\mathbf{f}$ (a $C^0$-only $C_d(Re)$ degrades observed integrator convergence order — this is itself a planned Solver Lab demonstration).
3. **Sport-specific tables:** golf (dimpled, $C_d \approx 0.25$ in operating range), soccer, baseball (seam effects folded into effective $C_d$), each stored as data assets with provenance notes.
4. **Mach-dependent** (Phase 4 ballistics): $C_d(M)$ table with transonic rise; requires atmosphere with temperature model for local $c$.

**Terminal velocity** for quadratic drag, used in validation and in the UI's characteristic-scales readout:

$$v_T = \sqrt{ \frac{2 m g}{\rho C_d A} }
\tag{3.10}$$

**Regime blending.** For completeness, a combined law $\mathbf{F}_d = -(b_1 + b_2\lVert\mathbf{v}_{\text{rel}}\rVert)\,\mathbf{v}_{\text{rel}}$ is provided; the UI displays instantaneous $Re$ so students can see which regime dominates.

## Implementation

Where this section's model lives in the codebase. Every row is checked by
[`packages/validation/src/physics-docs.test.ts`](../../packages/validation/src/physics-docs.test.ts):
the file must exist and the symbol must be a named export of it.

| Symbol | Source | Role |
| --- | --- | --- |
| `LinearDragForce` | [`packages/engine/src/forces.ts`](../../packages/engine/src/forces.ts) | Eq. (3.5), Stokes regime. |
| `QuadraticDragForce` | [`packages/engine/src/forces.ts`](../../packages/engine/src/forces.ts) | Eq. (3.8); reads v_rel, never v — the T-VAL-09 invariant. |
| `DragCoefficientModel` | [`packages/engine/src/drag-coefficient.ts`](../../packages/engine/src/drag-coefficient.ts) | The one interface all four C_d fidelities sit behind. |
| `ConstantCd` | [`packages/engine/src/drag-coefficient.ts`](../../packages/engine/src/drag-coefficient.ts) | C_d = 0.47 smooth-sphere default. |
| `TabulatedReynoldsCd` | [`packages/engine/src/drag-coefficient.ts`](../../packages/engine/src/drag-coefficient.ts) | Re-dependent C_d covering the drag crisis. |
| `SMOOTH_SPHERE_CD_TABLE` | [`packages/engine/src/drag-coefficient.ts`](../../packages/engine/src/drag-coefficient.ts) | Tabulated (Re, C_d) data for the smooth sphere. |
| `TabulatedMachCd` | [`packages/engine/src/drag-coefficient.ts`](../../packages/engine/src/drag-coefficient.ts) | Mach-dependent C_d with transonic rise (Phase 4). |
| `TRANSONIC_MACH_CD_TABLE` | [`packages/engine/src/drag-coefficient.ts`](../../packages/engine/src/drag-coefficient.ts) | Tabulated (M, C_d) transonic data. |
| `PchipInterpolator` | [`packages/engine/src/pchip.ts`](../../packages/engine/src/pchip.ts) | Monotone cubic interpolation that keeps C_d(Re) smooth enough not to degrade observed convergence order. |
| `reynoldsNumber` | [`packages/engine/src/characteristic-scales.ts`](../../packages/engine/src/characteristic-scales.ts) | Eq. (3.9), Re. |
| `machNumber` | [`packages/engine/src/characteristic-scales.ts`](../../packages/engine/src/characteristic-scales.ts) | Eq. (3.9), M. |
| `terminalVelocityQuadratic` | [`packages/engine/src/characteristic-scales.ts`](../../packages/engine/src/characteristic-scales.ts) | Eq. (3.10). |
| `dragRelaxationTimeLinear` | [`packages/engine/src/characteristic-scales.ts`](../../packages/engine/src/characteristic-scales.ts) | tau = m/b from Eq. (3.6). |

---

← [§3.2 Gravity](./gravity.md) · [Index](./README.md) · [§3.4 Atmosphere Model](./atmosphere.md) →
