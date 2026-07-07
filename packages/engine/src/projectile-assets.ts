import { SMOOTH_SPHERE_CD_TABLE } from "./drag-coefficient.js";
import type { ProjectileSpec } from "./projectile-spec.js";

/**
 * Initial projectile data assets (§3.9): smooth sphere, golf ball, soccer
 * ball, baseball, table-tennis ball, cannonball (0.1 m iron), shot put.
 * Values are regulation/typical figures from equipment rules and standard
 * aerodynamics references; every entry carries a `provenance` citation.
 */
export const PROJECTILE_ASSETS: readonly ProjectileSpec[] = [
  {
    name: "smooth-sphere",
    mass: 0.1,
    radius: 0.05,
    dragCoefficient: { type: "tabulatedReynolds", table: SMOOTH_SPHERE_CD_TABLE },
    provenance:
      "Idealized smooth sphere reference case; Cd(Re) incl. drag crisis from Hoerner, Fluid-Dynamic Drag (1965), representative smooth-sphere curve.",
  },
  {
    name: "golf-ball",
    mass: 0.0459,
    radius: 0.02135,
    dragCoefficient: { type: "constant", value: 0.25 },
    liftCoefficient: { type: "saturating" },
    spinDecayTau: 25,
    provenance:
      "Mass/diameter per USGA/R&A Rules of Golf equipment specs (min. diameter 42.67 mm, max mass 45.93 g). Cd ~0.25 dimpled-turbulent regime is a representative value from golf-ball aerodynamics literature (e.g. Bearman & Harvey 1976); spin decay tau_omega ~25 s is sport-typical (§3.6).",
  },
  {
    name: "soccer-ball",
    mass: 0.43,
    radius: 0.11,
    dragCoefficient: { type: "constant", value: 0.25 },
    provenance:
      "Mass/circumference per FIFA Laws of the Game (mass 410-450 g, circumference 68-70 cm => R ~0.11 m). Cd ~0.25 is a representative smooth-turbulent-regime value from soccer-ball aerodynamics studies.",
  },
  {
    name: "baseball",
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: { type: "constant", value: 0.35 },
    liftCoefficient: { type: "saturating" },
    spinDecayTau: 20,
    provenance:
      "Mass/circumference per MLB rules (mass 5-5.25 oz, circumference 9-9.25 in => R ~0.0366 m). Cd ~0.3-0.4 (seam-dependent) per standard sports-ball aerodynamics references; representative value 0.35 used here.",
  },
  {
    name: "table-tennis-ball",
    mass: 0.0027,
    radius: 0.02,
    dragCoefficient: { type: "constant", value: 0.5 },
    liftCoefficient: { type: "saturating" },
    spinDecayTau: 15,
    provenance:
      "Mass/diameter per ITTF equipment rules (mass 2.7 g, diameter 40 mm). Cd ~0.5 is a representative value for a smooth low-Re plastic sphere in this platform's flight-speed range (Hoerner 1965).",
  },
  {
    name: "cannonball",
    mass: 4.12,
    radius: 0.05,
    dragCoefficient: { type: "tabulatedReynolds", table: SMOOTH_SPHERE_CD_TABLE },
    provenance:
      "0.1 m diameter solid iron sphere (density ~7870 kg/m^3 => mass ~4.12 kg, per §3.9's canonical cannonball asset). Cd(Re) taken from the same smooth-sphere curve as the reference sphere asset.",
  },
  {
    name: "shot-put",
    mass: 7.26,
    radius: 0.06,
    dragCoefficient: { type: "constant", value: 0.47 },
    provenance:
      "Men's shot put mass/diameter per World Athletics rules (mass 7.26 kg = 16 lb, diameter range 110-130 mm => R ~0.06 m). Cd ~0.47 is the standard subcritical smooth-sphere value (Hoerner 1965), appropriate at shot-put flight speeds.",
  },
];
