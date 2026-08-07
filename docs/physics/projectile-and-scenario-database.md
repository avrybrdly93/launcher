<!-- GENERATED FILE — DO NOT EDIT BY HAND.
     Source: ballista-technical-blueprint.md §3.9
     Regenerate: node scripts/generate-physics-docs.mjs
     The prose below is copied verbatim from the blueprint, which stays the
     source of truth for architecture. Edit the blueprint, then regenerate. -->

# §3.9 Projectile and Scenario Database

> Regenerated from [`ballista-technical-blueprint.md`](../../ballista-technical-blueprint.md) §3.9.
> Physics reference index: [`docs/physics/README.md`](./README.md).

`ProjectileSpec` records $(m, R\ \text{or}\ A, C_d\text{-model}, C_L\text{-model}, \tau_\omega, \text{provenance})$. Initial data assets: smooth sphere, golf ball, soccer ball, baseball, table-tennis ball, cannonball (0.1 m iron), shot put, and "custom." Every numeric datum carries a citation field; the asset loader validates schemas (zod) at build time. Scenarios compose a projectile + environment + initial conditions + solver config into the ScenarioSpec of Section 2.3, and the preset library (Phase 3) ships with regime-spanning defaults: drag-free reference, low-$\Pi$ shot put, high-$\Pi$ table tennis, Magnus-dominated golf drive, stiff dust-grain, headwind/tailwind pairs.
---

## Implementation

Where this section's model lives in the codebase. Every row is checked by
[`packages/validation/src/physics-docs.test.ts`](../../packages/validation/src/physics-docs.test.ts):
the file must exist and the symbol must be a named export of it.

| Symbol | Source | Role |
| --- | --- | --- |
| `projectileSpecSchema` | [`packages/engine/src/projectile-spec.ts`](../../packages/engine/src/projectile-spec.ts) | zod schema validating (m, R or A, C_d model, C_L model, tau_omega, provenance). |
| `projectileSpecToParams` | [`packages/engine/src/projectile-spec.ts`](../../packages/engine/src/projectile-spec.ts) | Spec -> runtime ProjectileParams. |
| `PROJECTILE_ASSETS` | [`packages/engine/src/projectile-assets.ts`](../../packages/engine/src/projectile-assets.ts) | The shipped asset set — sphere, golf, soccer, baseball, table tennis, cannonball, shot put, custom. |
| `loadProjectileAssets` | [`packages/engine/src/asset-loader.ts`](../../packages/engine/src/asset-loader.ts) | Build-time schema validation of the data assets. |
| `scenarioSpecSchema` | [`packages/engine/src/scenario-spec.ts`](../../packages/engine/src/scenario-spec.ts) | Projectile + environment + initial conditions + solver config. |
| `SCENARIO_LIBRARY` | [`packages/engine/src/scenario-library.ts`](../../packages/engine/src/scenario-library.ts) | Regime-spanning curated presets with teaching notes. |
| `findCuratedScenario` | [`packages/engine/src/scenario-library.ts`](../../packages/engine/src/scenario-library.ts) | Lookup by scenario id. |

---

← [§3.8 Continuous-Time System Properties](./system-properties.md) · [Index](./README.md)
