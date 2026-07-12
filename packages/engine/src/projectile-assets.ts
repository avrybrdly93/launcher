import { parseWithSchema } from "./schema.js";
import { ProjectileSpecSchema, type ProjectileSpec } from "./projectile-spec.js";

/**
 * The Phase-1 projectile data assets (§3.9): sphere, golf, soccer, baseball,
 * table-tennis, cannonball, shot put. Drag coefficients are the constant
 * "operating range" approximations available in Phase 1 (§3.3 option 1);
 * sport-specific tabulated Cd(Re)/CL(S) curves with literature-asserted
 * bounds are P4.05.
 */
const RAW_PROJECTILE_ASSETS: readonly ProjectileSpec[] = [
  {
    id: "sphere",
    displayName: "Smooth sphere (reference)",
    mass: 1,
    radius: 0.05,
    dragCoefficient: { kind: "constant", value: 0.47 },
    provenance:
      "Generic 0.1 m diameter, 1 kg reference sphere for validation/didactic use, not a specific sport object. Cd=0.47 is the standard smooth-sphere subcritical value, Re < 3e5 (§3.3).",
  },
  {
    id: "golf",
    displayName: "Golf ball",
    mass: 0.04593,
    radius: 0.021335,
    dragCoefficient: { kind: "constant", value: 0.25 },
    liftCoefficient: { kind: "saturating", maxCl: 0.6, slope: 1.6 },
    spinDecayTau: 25,
    provenance:
      "Mass/diameter at the USGA/R&A Rules of Golf equipment-standard minimums (mass >= 45.93 g, diameter >= 42.67 mm). Cd=0.25 is the approximate dimpled-sphere operating-range value (§3.3); a tabulated Cd(Re) with literature-asserted bounds lands in P4.05. Lift uses the platform's generic saturating fit (eq. 3.16); spinDecayTau=25 s is the sport-typical mid-range value from §3.6 (~20-30 s).",
  },
  {
    id: "soccer",
    displayName: "Soccer ball (size 5)",
    mass: 0.43,
    radius: 0.11,
    dragCoefficient: { kind: "constant", value: 0.25 },
    provenance:
      "FIFA Laws of the Game, Law 2 (size 5 ball): mass 410-450 g (0.43 kg used), circumference 68-70 cm (~0.22 m diameter used). Cd=0.25 is an approximate operating-range value (§3.3); seam-pattern-specific data with literature bounds lands in P4.05.",
  },
  {
    id: "baseball",
    displayName: "Baseball",
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: { kind: "constant", value: 0.3 },
    provenance:
      "MLB Official Baseball Rule 3.01: weight 5-5.25 oz (0.145 kg used), circumference 9-9.25 in (~0.0732 m diameter used). Cd=0.3 is a commonly-used average value for a baseball in flight (§3.3); seam-orientation effects folded into a sport-specific Cd(Re) land in P4.05.",
  },
  {
    id: "table-tennis",
    displayName: "Table-tennis ball",
    mass: 0.0027,
    radius: 0.02,
    dragCoefficient: { kind: "constant", value: 0.47 },
    provenance:
      "ITTF equipment regulations: mass 2.67-2.77 g (0.0027 kg used), diameter 40 mm. Treated as a smooth sphere (Cd=0.47, §3.3) — its unusually high area-to-mass ratio, not a special Cd, is what makes it the platform's high-drag (high-Pi) exhibit.",
  },
  {
    id: "cannonball",
    displayName: "Cannonball (0.1 m iron)",
    mass: 4.12,
    radius: 0.05,
    dragCoefficient: { kind: "constant", value: 0.47 },
    provenance:
      "0.1 m diameter cast-iron sphere per §3.9. Mass = rho_iron * (4/3)*pi*r^3 with rho_iron = 7870 kg/m^3, giving ~4.12 kg. Cd=0.47 smooth-sphere subcritical default (§3.3); Mach-dependent Cd(M) for high-speed ballistics is a Phase-4 extension.",
  },
  {
    id: "shot-put",
    displayName: "Shot put (men's)",
    mass: 7.26,
    radius: 0.06,
    dragCoefficient: { kind: "constant", value: 0.47 },
    provenance:
      "World Athletics Technical Rules (shot put): men's shot mass 7.260 kg, diameter 110-130 mm (120 mm nominal used). Cd=0.47 smooth-sphere default (§3.3); at typical release speeds (~13-14 m/s) drag is a small correction to the parabolic trajectory.",
  },
];

/** Schema-validated at module load, standing in for P1.26's build-time asset loader. */
export const PROJECTILE_ASSETS: readonly ProjectileSpec[] = RAW_PROJECTILE_ASSETS.map((asset) =>
  parseWithSchema(ProjectileSpecSchema, asset),
);
