import type { ProjectileSpec } from "./projectile-spec.js";

/**
 * Initial data assets (§3.9): smooth sphere, golf, soccer, baseball, table
 * tennis, cannonball, shot put. "Custom" (user-entered) projectiles are a
 * runtime UI concept (Phase 3), not a data asset, so it has no entry here.
 */
export const PROJECTILE_ASSETS: readonly ProjectileSpec[] = [
  {
    id: "smooth-sphere",
    name: "Smooth reference sphere",
    mass: 1,
    radius: 0.05,
    dragCoefficient: 0.47,
    provenance:
      "Cd ~0.47 is the standard subcritical smooth-sphere drag coefficient (Hoerner, Fluid-Dynamic Drag, 1965). Mass and radius are a round reference, not a physical object.",
  },
  {
    id: "golf-ball",
    name: "Golf ball",
    mass: 0.04593,
    radius: 0.021335,
    dragCoefficient: 0.25,
    liftCoefficient: { maxCl: 0.6, slope: 1.6 },
    spinDecayTau: 25,
    provenance:
      "USGA/R&A Rules of Golf: mass <= 45.93 g, diameter >= 42.67 mm. Dimpled-ball Cd ~0.25 over typical drive speeds per Bearman & Harvey, 'Golf Ball Aerodynamics', Aeronautical Quarterly (1976).",
  },
  {
    id: "soccer-ball",
    name: "Soccer ball (FIFA size 5)",
    mass: 0.43,
    radius: 0.11,
    dragCoefficient: 0.25,
    spinDecayTau: 20,
    provenance:
      "FIFA Laws of the Game: size-5 ball mass 410-450 g, circumference 68-70 cm (radius ~0.11 m). Cd ~0.2-0.25 in the transitional/turbulent regime typical of a struck ball, per Asai et al., 'Aerodynamics of Football', Sports Engineering (2007).",
  },
  {
    id: "baseball",
    name: "Baseball",
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: 0.3,
    spinDecayTau: 30,
    provenance:
      "MLB Official Baseball Rule 3.01: mass 5-5.25 oz (0.142-0.149 kg), circumference 9-9.25 in (radius ~0.0366 m). Cd ~0.3-0.35 for a seamed baseball in flight per Adair, The Physics of Baseball, 3rd ed. (2002).",
  },
  {
    id: "table-tennis-ball",
    name: "Table tennis ball",
    mass: 0.0027,
    radius: 0.02,
    dragCoefficient: 0.4,
    spinDecayTau: 20,
    provenance:
      "ITTF Equipment Regulations: 40 mm diameter (radius 0.02 m), mass 2.7 g. Cd ~0.4-0.5 for a smooth sphere at the ball's sub-critical rally-speed Reynolds numbers.",
  },
  {
    id: "cannonball",
    name: "Cannonball (0.1 m iron)",
    mass: 4.12,
    radius: 0.05,
    dragCoefficient: 0.47,
    provenance:
      "0.1 m diameter solid iron sphere: mass = (4/3)*pi*r^3*rho_iron with rho_iron ~7874 kg/m^3 gives ~4.12 kg. Cd ~0.47 (subcritical smooth sphere); black-powder muzzle velocities stay below the drag-crisis Reynolds number.",
  },
  {
    id: "shot-put",
    name: "Shot put (men's)",
    mass: 7.26,
    radius: 0.06,
    dragCoefficient: 0.47,
    provenance:
      "World Athletics Rule 32: men's shot mass 7.260 kg, diameter 110-130 mm (radius ~0.06 m). Cd ~0.47 for a smooth sphere; aerodynamic drag is negligible relative to gravity at shot-put release speeds.",
  },
];
