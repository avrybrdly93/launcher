import { loadAssets } from "./asset-loader.js";
import { projectileSpecSchema, type ProjectileSpec } from "./projectile-spec.js";

/**
 * Initial projectile data assets (§3.9): smooth sphere, golf, soccer,
 * baseball, table-tennis, cannonball, shot put. Every entry is validated
 * against `projectileSpecSchema` below (P1.25 validation criterion).
 */
const RAW_ASSETS: readonly ProjectileSpec[] = [
  {
    id: "smooth-sphere",
    name: "Smooth sphere (reference)",
    massKg: 1,
    radiusM: 0.05,
    dragCoefficient: { kind: "constant", value: 0.47 },
    provenance:
      "Cd=0.47 is the standard subcritical smooth-sphere drag coefficient (Hoerner, 'Fluid-Dynamic Drag', 1965); mass/radius are arbitrary reference values for a 1 kg, 10 cm-diameter sphere.",
  },
  {
    id: "golf-ball",
    name: "Golf ball",
    massKg: 0.04593,
    radiusM: 0.021335,
    dragCoefficient: { kind: "constant", value: 0.25 },
    liftCoefficient: { kind: "saturating", maxCl: 0.6, slope: 1.6 },
    spinDecayTauSeconds: 25,
    provenance:
      "Mass <=45.93 g, diameter >=42.67 mm per USGA/R&A Rules of Golf, Appendix III. Cd~0.25 (dimpled sphere, turbulent boundary layer) per Bearman & Harvey, 'Golf Ball Aerodynamics', Aeronautical Quarterly (1976). Spin decay ~20-30 s is a typical driver-shot order of magnitude cited in golf-ball aerodynamics literature.",
  },
  {
    id: "soccer-ball",
    name: "Soccer ball",
    massKg: 0.43,
    radiusM: 0.11,
    dragCoefficient: { kind: "constant", value: 0.25 },
    provenance:
      "Mass 410-450 g, circumference 68-70 cm (diameter ~22 cm) per FIFA Laws of the Game, Law 2. Cd~0.2-0.3 for a modern paneled ball at match speeds (Asai et al., 'Aerodynamics of Soccer Balls', 2007); midpoint 0.25 used here.",
  },
  {
    id: "baseball",
    name: "Baseball",
    massKg: 0.145,
    radiusM: 0.0366,
    dragCoefficient: { kind: "constant", value: 0.35 },
    spinDecayTauSeconds: 20,
    provenance:
      "Mass 5.125 oz (145 g), circumference 9.125 in (diameter ~7.32 cm) per MLB Official Baseball Rules, Rule 3.02. Cd~0.3-0.4 (raised-seam sphere) per Adair, 'The Physics of Baseball', 3rd ed. (2002); midpoint 0.35 used here.",
  },
  {
    id: "table-tennis-ball",
    name: "Table tennis ball",
    massKg: 0.0027,
    radiusM: 0.02,
    dragCoefficient: { kind: "constant", value: 0.5 },
    provenance:
      "Mass 2.7 g, diameter 40 mm per ITTF Table Tennis Rules, section 2. Cd~0.5 (smooth sphere at the ball's characteristically low Reynolds number, subcritical/laminar-separation regime) per Hoerner, 'Fluid-Dynamic Drag' (1965).",
  },
  {
    id: "cannonball",
    name: "Cannonball (0.1 m iron)",
    massKg: 3.77,
    radiusM: 0.05,
    dragCoefficient: { kind: "constant", value: 0.47 },
    provenance:
      "0.1 m diameter solid cast-iron sphere, density ~7200 kg/m^3 (standard cast-iron density range 7000-7300 kg/m^3) => mass = (4/3)*pi*r^3*rho ~ 3.77 kg. Cd=0.47 smooth-sphere value per Hoerner, 'Fluid-Dynamic Drag' (1965).",
  },
  {
    id: "shot-put",
    name: "Shot put (men's)",
    massKg: 7.26,
    radiusM: 0.06,
    dragCoefficient: { kind: "constant", value: 0.47 },
    provenance:
      "Mass 7.26 kg (16 lb), diameter 110-130 mm per World Athletics Technical Rules, Rule 32 (men's shot); 120 mm diameter used here. Cd=0.47 smooth-sphere value per Hoerner, 'Fluid-Dynamic Drag' (1965) -- aerodynamics are negligible at shot-put release speeds regardless.",
  },
];

export const PROJECTILE_ASSETS: readonly ProjectileSpec[] = loadAssets(
  projectileSpecSchema,
  RAW_ASSETS,
  "projectile asset",
);
