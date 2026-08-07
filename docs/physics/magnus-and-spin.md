<!-- GENERATED FILE — DO NOT EDIT BY HAND.
     Source: ballista-technical-blueprint.md §3.6
     Regenerate: node scripts/generate-physics-docs.mjs
     The prose below is copied verbatim from the blueprint, which stays the
     source of truth for architecture. Edit the blueprint, then regenerate. -->

# §3.6 Magnus Force and Spin

> Regenerated from [`ballista-technical-blueprint.md`](../../ballista-technical-blueprint.md) §3.6.
> Physics reference index: [`docs/physics/README.md`](./README.md).

A spinning body in flow experiences a lift force orthogonal to both spin axis and relative velocity. The platform uses the standard lift-coefficient parameterization:

$$\mathbf{F}_M = \tfrac{1}{2}\, \rho\, C_L(S)\, A\, \lVert \mathbf{v}_{\text{rel}} \rVert^2 \; \frac{ \hat{\boldsymbol{\omega}} \times \mathbf{v}_{\text{rel}} }{ \lVert \hat{\boldsymbol{\omega}} \times \mathbf{v}_{\text{rel}} \rVert } \;\; \xrightarrow{\ \text{implemented as}\ } \;\;
\tfrac{1}{2}\, \rho\, C_L\, A\, \lVert \mathbf{v}_{\text{rel}} \rVert \, \left( \hat{\boldsymbol{\omega}} \times \mathbf{v}_{\text{rel}} \right)
\tag{3.15}$$

where the right-hand implemented form (valid when $\hat{\boldsymbol{\omega}} \perp \mathbf{v}_{\text{rel}}$, exact in the 2D configuration) avoids the normalization singularity as $\hat{\boldsymbol{\omega}} \times \mathbf{v}_{\text{rel}} \to 0$. The lift coefficient is modeled as a function of the **spin ratio**

$$S = \frac{\omega R}{\lVert \mathbf{v}_{\text{rel}} \rVert}, \qquad C_L(S) \approx \min(0.6,\ 1.6\,S) \ \text{(smooth-saturating fit; sport-specific tables in data assets)}
\tag{3.16}$$

In 2D, spin is a scalar $\omega$ (positive = backspin for rightward motion), $\hat{\boldsymbol{\omega}} = \hat{\mathbf{e}}_z$, and $\hat{\mathbf{e}}_z \times \mathbf{v}_{\text{rel}} = (-v_{\text{rel},y},\, v_{\text{rel},x})$: backspin lifts, topspin dives. Note the singularity risk at $\lVert\mathbf{v}_{\text{rel}}\rVert \to 0$ hidden in (3.16) through $S$; the implementation clamps $S$ and multiplies through so that $\mathbf{F}_M \to 0$ smoothly with $\lVert\mathbf{v}_{\text{rel}}\rVert$ (regression test T-VAL-14, apex of a vertical throw in still air).

**Spin decay:** $\dot{\omega} = -\omega / \tau_\omega$ with sport-typical $\tau_\omega \sim 20$–$30$ s, adding one state component when enabled. This is the first place the state dimension becomes model-dependent, exercising the variable-dimension design of Section 3.7.

## Implementation

Where this section's model lives in the codebase. Every row is checked by
[`packages/validation/src/physics-docs.test.ts`](../../packages/validation/src/physics-docs.test.ts):
the file must exist and the symbol must be a named export of it.

| Symbol | Source | Role |
| --- | --- | --- |
| `MagnusForce` | [`packages/engine/src/forces.ts`](../../packages/engine/src/forces.ts) | Eq. (3.15) in its implemented (non-normalized) form — no singularity as omega x v_rel -> 0. |
| `LiftCoefficientModel` | [`packages/engine/src/lift-coefficient.ts`](../../packages/engine/src/lift-coefficient.ts) | C_L(S) interface. |
| `SaturatingLiftCoefficient` | [`packages/engine/src/lift-coefficient.ts`](../../packages/engine/src/lift-coefficient.ts) | Eq. (3.16), min(0.6, 1.6 S) smooth-saturating fit. |
| `spinParameter` | [`packages/engine/src/characteristic-scales.ts`](../../packages/engine/src/characteristic-scales.ts) | Spin ratio S = omega R / |v_rel|, clamped near stagnation (T-VAL-14). |
| `StatefulSpinMagnusForce` | [`packages/engine/src/planar-projectile-spin-model.ts`](../../packages/engine/src/planar-projectile-spin-model.ts) | Magnus term reading the spin state component when spin decay is enabled. |
| `PLANAR_SPIN_CHANNELS` | [`packages/engine/src/planar-projectile-spin-model.ts`](../../packages/engine/src/planar-projectile-spin-model.ts) | The extra omega channel; its unit is rad/s — a rate, not an angle (ADR-015). |

---

← [§3.5 Wind Interaction Model](./wind.md) · [Index](./README.md) · [§3.7 State Vector Formulation](./state-vector.md) →
