import type { ProjectileSpec } from "./projectile-spec.js";

/**
 * Initial projectile data assets (§3.9): smooth sphere, golf ball, soccer
 * ball, baseball, table-tennis ball, cannonball (0.1 m iron), shot put.
 * "Custom" (the eighth entry §3.9 mentions) is a UI concept — an empty
 * user-editable slot — not a data asset, so it has no entry here.
 */
export const PROJECTILE_ASSETS: readonly ProjectileSpec[] = [
  {
    id: "smooth-sphere",
    name: "Smooth Sphere (reference)",
    mass: 1,
    radius: 0.05,
    dragModel: { kind: "constant", cd: 0.47 },
    provenance:
      "Idealized reference body, R=0.05 m, m=1 kg by convention. Cd=0.47 is the standard " +
      "subcritical drag coefficient for a smooth sphere (Re ~ 1e3-2e5), e.g. White, Fluid " +
      "Mechanics, 7th ed., Table 7.2.",
  },
  {
    id: "golf-ball",
    name: "Golf Ball",
    mass: 0.04593,
    radius: 0.021335,
    dragModel: { kind: "constant", cd: 0.25 },
    liftModel: { kind: "saturating" },
    spinDecayTau: 25,
    provenance:
      "USGA/R&A Rules of Golf, Equipment Rules Appendix III: mass <= 45.93 g, diameter >= " +
      "42.67 mm. Cd ~ 0.25 typical in-flight value for a dimpled ball, Bearman & Harvey " +
      "(1976), 'Golf ball aerodynamics', Aeronautical Quarterly 27(2).",
  },
  {
    id: "soccer-ball",
    name: "Soccer Ball",
    mass: 0.43,
    radius: 0.11,
    dragModel: { kind: "constant", cd: 0.25 },
    liftModel: { kind: "saturating" },
    spinDecayTau: 20,
    provenance:
      "FIFA Laws of the Game, Law 2: mass 410-450 g, circumference 68-70 cm (R ~ 0.11 m). " +
      "Cd ~ 0.2-0.3 in-flight, Asai et al. (2007), 'Aerodynamics of a new soccer ball', " +
      "Journal of Sports Sciences 25(4).",
  },
  {
    id: "baseball",
    name: "Baseball",
    mass: 0.145,
    radius: 0.0366,
    dragModel: { kind: "constant", cd: 0.3 },
    liftModel: { kind: "saturating" },
    spinDecayTau: 25,
    provenance:
      "MLB Official Baseball Rules 3.01: mass 5.00-5.25 oz (0.142-0.149 kg), circumference " +
      "9.00-9.25 in (R ~ 0.0366 m). Cd ~ 0.3-0.4 depending on speed/seam orientation, Adair, " +
      "The Physics of Baseball, 3rd ed., ch. 1; representative value 0.3 used here.",
  },
  {
    id: "table-tennis-ball",
    name: "Table Tennis Ball",
    mass: 0.0027,
    radius: 0.02,
    dragModel: { kind: "tabulated-reynolds-smooth-sphere" },
    liftModel: { kind: "saturating" },
    spinDecayTau: 20,
    provenance:
      "ITTF Table Tennis Equipment Regulations: mass 2.67-2.77 g, diameter 40 mm " +
      "(R = 0.02 m). Low mass and small radius give a high drag-to-gravity ratio Pi " +
      "(§3.9), the platform's canonical high-Pi exhibit; the tabulated smooth-sphere Cd(Re) " +
      "model (P1.12) is used since no dimple/seam-specific curve is on file.",
  },
  {
    id: "cannonball-iron",
    name: "Cannonball (0.1 m iron)",
    mass: 4.123,
    radius: 0.05,
    dragModel: { kind: "tabulated-reynolds-smooth-sphere" },
    provenance:
      "0.1 m diameter per the platform's canonical stiff/high-Re exhibit spec (§3.9). Mass " +
      "derived from solid-iron density 7874 kg/m^3 (CRC Handbook of Chemistry and Physics) " +
      "times sphere volume (4/3)*pi*R^3 at R=0.05 m: m = 7874 * 5.236e-4 m^3 ~ 4.123 kg. " +
      "Tabulated smooth-sphere Cd(Re) captures the drag crisis at cannonball-relevant Re.",
  },
  {
    id: "shot-put",
    name: "Shot Put",
    mass: 7.26,
    radius: 0.06,
    dragModel: { kind: "constant", cd: 0.5 },
    provenance:
      "World Athletics Competition Rules, Rule 32/TR32: men's shot mass 7.260 kg, diameter " +
      "110-130 mm (R=0.06 m used here, mid-range). Cd ~ 0.5 (subcritical smooth-sphere " +
      "regime at typical release speeds); the platform's canonical low-Pi exhibit (§3.9).",
  },
];
