import type { ProjectileSpec } from "./projectile-spec.js";

/**
 * Initial projectile data assets (§3.9): smooth sphere, golf ball, soccer
 * ball, baseball, table-tennis ball, cannonball, shot put. Every numeric
 * datum's source is in `provenance`; the asset loader (P1.26) validates
 * these against `PROJECTILE_SPEC_SCHEMA` at build time.
 */
export const PROJECTILE_ASSETS: readonly ProjectileSpec[] = [
  {
    id: "smooth-sphere",
    name: "Smooth sphere",
    mass: 1,
    radius: 0.05,
    dragCoefficient: { kind: "tabulated-reynolds" },
    provenance:
      "Reference smooth sphere, m=1 kg, R=0.05 m (arbitrary round numbers for a baseline case); " +
      "Cd(Re) from the platform's tabulated smooth-sphere drag-crisis curve (PCHIP-interpolated, " +
      "approximating classical smooth-sphere data e.g. Achenbach, J. Fluid Mech. 54, 1972).",
  },
  {
    id: "golf-ball",
    name: "Golf ball",
    mass: 0.04593,
    radius: 0.021335,
    dragCoefficient: { kind: "constant", value: 0.25 },
    liftCoefficient: { kind: "saturating", maxCl: 0.6, slope: 1.6 },
    spinDecayTau: 25,
    provenance:
      "USGA/R&A Rules of Golf: mass <= 45.93 g, diameter >= 42.67 mm (radius used here). " +
      "Cd ~= 0.25 for a dimpled ball in its normal flight-speed range " +
      "(Bearman & Harvey, Aeronautical Quarterly 27, 1976). tau_omega ~ 25 s is a " +
      "sport-typical mid-range value (Ballista blueprint Section 3.6, tau_omega ~ 20-30 s).",
  },
  {
    id: "soccer-ball",
    name: "Soccer ball",
    mass: 0.43,
    radius: 0.11,
    dragCoefficient: { kind: "constant", value: 0.25 },
    provenance:
      "FIFA Laws of the Game, size 5 ball: mass 410-450 g (0.43 kg used), circumference " +
      "68-70 cm giving radius ~ 0.11 m. Cd ~= 0.2-0.25 in the typical playing speed range " +
      "(Asai, Seo, Kobayashi & Sakashita, Sports Eng. 10, 2007).",
  },
  {
    id: "baseball",
    name: "Baseball",
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: { kind: "constant", value: 0.3 },
    provenance:
      "MLB Official Baseball Rules: mass 141.7-148.8 g (5.00-5.25 oz; 0.145 kg used), " +
      "circumference 22.9-23.5 cm giving radius ~ 0.0366 m. Cd ~= 0.3-0.4 depending on seam " +
      "orientation and speed, effective value folded to 0.3 here " +
      "(Adair, The Physics of Baseball, 3rd ed., 2002).",
  },
  {
    id: "table-tennis-ball",
    name: "Table-tennis ball",
    mass: 0.0027,
    radius: 0.02,
    dragCoefficient: { kind: "constant", value: 0.45 },
    liftCoefficient: { kind: "saturating", maxCl: 0.6, slope: 1.6 },
    spinDecayTau: 20,
    provenance:
      "ITTF Table Tennis Equipment Regulations: mass 2.7 g, diameter 40 mm. " +
      "Cd ~= 0.4-0.5 for a smooth plastic ball at typical rally speeds " +
      "(Cordingley, MSc thesis, Loughborough University, 2003). " +
      "tau_omega ~ 20 s is a sport-typical lower-range value (blueprint Section 3.6).",
  },
  {
    id: "cannonball",
    name: "Cannonball (0.1 m iron)",
    mass: 4.12,
    radius: 0.05,
    dragCoefficient: { kind: "constant", value: 0.47 },
    provenance:
      "0.1 m diameter solid cast-iron sphere per blueprint Section 3.9. Mass = density * " +
      "volume with cast-iron density 7870 kg/m^3 (standard engineering reference value) and " +
      "volume (4/3)*pi*(0.05 m)^3, giving 4.12 kg. Cd = 0.47, smooth sphere subcritical regime " +
      "(standard textbook value, e.g. Cengel & Cimbala, Fluid Mechanics, 4th ed.).",
  },
  {
    id: "shot-put",
    name: "Shot put",
    mass: 7.26,
    radius: 0.061,
    dragCoefficient: { kind: "constant", value: 0.47 },
    provenance:
      "World Athletics (IAAF) Technical Rules, men's shot: mass 7.26 kg, diameter 110-130 mm " +
      "(radius 0.061 m, mid-range, used here). Cd = 0.47, smooth sphere subcritical regime " +
      "(standard textbook value, e.g. Cengel & Cimbala, Fluid Mechanics, 4th ed.).",
  },
];
