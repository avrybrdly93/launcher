<!-- GENERATED FILE — DO NOT EDIT BY HAND.
     Source: ballista-technical-blueprint.md §3.4
     Regenerate: node scripts/generate-physics-docs.mjs
     The prose below is copied verbatim from the blueprint, which stays the
     source of truth for architecture. Edit the blueprint, then regenerate. -->

# §3.4 Atmosphere Model

> Regenerated from [`ballista-technical-blueprint.md`](../../ballista-technical-blueprint.md) §3.4.
> Physics reference index: [`docs/physics/README.md`](./README.md).

Air density and viscosity vary with altitude and weather. The engine defines an `Atmosphere` interface returning $(\rho, T, p, \eta, c)$ at a query point.

**Constant atmosphere (default):** $\rho = 1.225\ \text{kg m}^{-3}$, $T = 288.15\ \text{K}$ (ISA sea level).

**Isothermal exponential:** $\rho(y) = \rho_0 e^{-y/H}$, scale height $H = \frac{R_s T}{g} \approx 8.5\ \text{km}$.

**ISA troposphere (Phase 4):** linear lapse $T(y) = T_0 - L y$ with $L = 6.5\ \text{K km}^{-1}$, and

$$p(y) = p_0\left(1 - \frac{L y}{T_0}\right)^{g/(R_s L)}, \qquad \rho = \frac{p}{R_s T}
\tag{3.11}$$

valid to 11 km, with $R_s = 287.05\ \text{J kg}^{-1}\text{K}^{-1}$. Sutherland's law supplies $\eta(T)$:

$$\eta(T) = \eta_{\text{ref}} \left(\frac{T}{T_{\text{ref}}}\right)^{3/2} \frac{T_{\text{ref}} + S}{T + S}, \qquad S = 110.4\ \text{K}
\tag{3.12}$$

**Buoyancy** (small but honest): $\mathbf{F}_b = \rho V g\, \hat{\mathbf{e}}_y$ with projectile volume $V$; for a soccer ball this is $\sim1\%$ of weight and its inclusion is a toggle used in the "how big are the effects we ignore?" exercise. Added-mass effects are documented as deliberately neglected (relevant only for $\rho_{\text{body}} \sim \rho_{\text{air}}$).

## Implementation

Where this section's model lives in the codebase. Every row is checked by
[`packages/validation/src/physics-docs.test.ts`](../../packages/validation/src/physics-docs.test.ts):
the file must exist and the symbol must be a named export of it.

| Symbol | Source | Role |
| --- | --- | --- |
| `Atmosphere` | [`packages/engine/src/environment.ts`](../../packages/engine/src/environment.ts) | Returns (rho, T, p, eta, c) at a query point. |
| `ConstantAtmosphere` | [`packages/engine/src/environment.ts`](../../packages/engine/src/environment.ts) | ISA sea level default, rho = 1.225 kg/m^3. |
| `ExponentialAtmosphere` | [`packages/engine/src/environment.ts`](../../packages/engine/src/environment.ts) | Isothermal exponential, rho(y) = rho_0 exp(-y/H). |
| `IsaTroposphereAtmosphere` | [`packages/engine/src/environment.ts`](../../packages/engine/src/environment.ts) | Eq. (3.11) lapse-rate model plus Eq. (3.12) Sutherland viscosity. |
| `BuoyancyForce` | [`packages/engine/src/forces.ts`](../../packages/engine/src/forces.ts) | F_b = rho V g e_y, toggleable. |
| `buoyancyToWeightRatio` | [`packages/engine/src/forces.ts`](../../packages/engine/src/forces.ts) | Powers the 'how big are the effects we ignore?' exercise. |

---

← [§3.3 Drag: Linear and Quadratic Regimes](./drag.md) · [Index](./README.md) · [§3.5 Wind Interaction Model](./wind.md) →
