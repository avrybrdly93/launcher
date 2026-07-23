// L3 visualization: trajectory renderer (Canvas/WebGL), vector-field overlay,
// analysis plots. Implementation begins in Phase 3 (§7); this is the Phase 0
// package skeleton.
export const VIZ_PACKAGE = "@ballista/viz";

export * from "./canvas-bootstrap.js";
export * from "./camera2d.js";
export * from "./auto-fit-camera.js";
export * from "./axes-layer.js";
export * from "./trajectory-layer.js";
export * from "./trajectory-decimation.js";
export * from "./static-layer-cache.js";
export * from "./projectile-layer.js";
export * from "./scrub-bar.js";
export * from "./force-glyphs.js";
export * from "./hud-readout.js";
export * from "./annotation-layer.js";
