export * from "./vec2.js";
// Vec3's ops share their (deliberately vec2-mirroring) names with vec2's, so
// it's re-exported under its own namespace to avoid a barrel collision;
// internal engine modules import straight from "./vec3.js" instead (the same
// convention planar-projectile-model.ts already uses for vec2).
export * as vec3 from "./vec3.js";
export * from "./units.js";
export * from "./random.js";
export * from "./ou-gust.js";
export * from "./schema.js";
export * from "./env-sample.js";
export * from "./environment.js";
export * from "./pchip.js";
export * from "./drag-coefficient.js";
export * from "./lift-coefficient.js";
export * from "./projectile-params.js";
export * from "./projectile-spec.js";
export * from "./asset-loader.js";
export * from "./projectile-assets.js";
export * from "./eval-context.js";
export * from "./forces.js";
export * from "./model.js";
export * from "./restitution.js";
export * from "./terrain.js";
export * from "./planar-projectile-model.js";
export * from "./spatial-projectile-model.js";
export * from "./planar-projectile-spin-model.js";
export * from "./pendulum-model.js";
export * from "./finite-difference-jacobian.js";
export * from "./scenario-spec.js";
export * from "./characteristic-scales.js";
export * from "./solver-advisor.js";
export * from "./scenario-migration.js";
export * from "./scenario-metadata.js";
export * from "./scenario-presets.js";
export * from "./scenario-regime-tags.js";
