import { SMOOTH_SPHERE_CD_TABLE } from "./drag-coefficient.js";
import type { ProjectileSpec } from "./projectile-spec.js";

/**
 * Initial projectile data-asset library (§3.9). Every numeric datum is
 * backed by the asset's `provenance` citation; the asset loader (P1.26)
 * schema-validates these at build time.
 */
export const PROJECTILE_ASSETS: readonly ProjectileSpec[] = [
  {
    id: "smooth-sphere",
    name: "Smooth sphere (reference)",
    mass: 0.145,
    radius: 0.0366,
    dragModel: {
      kind: "tabulated-reynolds",
      table: { re: [...SMOOTH_SPHERE_CD_TABLE.re], cd: [...SMOOTH_SPHERE_CD_TABLE.cd] },
    },
    provenance:
      "Idealized smooth-sphere baseline; drag curve Cd(Re) spanning the drag crisis per Achenbach, E. (1972) " +
      "'Experiments on the flow past spheres at very high Reynolds numbers', J. Fluid Mech. 54(3), 565-575. " +
      "Mass/radius match the baseball preset for direct A/B comparison against a rough-seamed ball.",
  },
  {
    id: "golf-ball",
    name: "Golf ball",
    mass: 0.0459,
    radius: 0.02134,
    dragModel: { kind: "constant", cd: 0.25 },
    liftModel: { kind: "saturating", maxCl: 0.6, slope: 1.6 },
    spinDecayTime: 25,
    provenance:
      "Mass (45.93 g max) and diameter (42.67 mm min) per USGA/R&A Rules of Golf, Equipment Rules 2019, " +
      "App. III. Dimpled-sphere Cd ~= 0.25 in the operating Reynolds range per Bearman, P.W. & Harvey, J.K. (1976) " +
      "'Golf ball aerodynamics', Aeronautical Quarterly 27(2), 112-122. C_L(S) saturation form per blueprint eq. (3.16).",
  },
  {
    id: "soccer-ball",
    name: "Soccer ball (FIFA size 5)",
    mass: 0.43,
    radius: 0.11,
    dragModel: { kind: "constant", cd: 0.25 },
    provenance:
      "Mass (410-450 g) and circumference (68-70 cm) per FIFA Laws of the Game 2023/24, Law 2. " +
      "Cd ~= 0.2-0.3 (seam-induced early boundary-layer transition, similar to a golf ball) per Asai, T., Seo, K., " +
      "Kobayashi, O. & Sakashita, R. (2007) 'Fundamental aerodynamics of the soccer ball', Sports Eng. 10, 101-109.",
  },
  {
    id: "baseball",
    name: "Baseball",
    mass: 0.145,
    radius: 0.03645,
    dragModel: { kind: "constant", cd: 0.35 },
    spinDecayTime: 30,
    provenance:
      "Mass (5.125 oz) and circumference (9-9.25 in) per Official Baseball Rules (MLB), Rule 3.01. " +
      "Cd ~= 0.3-0.4 depending on seam orientation, per Adair, R.K. (2002) 'The Physics of Baseball', 3rd ed., " +
      "HarperCollins, ch. 2.",
  },
  {
    id: "table-tennis-ball",
    name: "Table-tennis ball",
    mass: 0.0027,
    radius: 0.02,
    dragModel: { kind: "constant", cd: 0.5 },
    liftModel: { kind: "saturating", maxCl: 0.6, slope: 1.6 },
    spinDecayTime: 20,
    provenance:
      "Mass (2.67-2.77 g) and diameter (40 mm) per ITTF Table Tennis Equipment Regulations, sec. 2.4. " +
      "Cd ~= 0.4-0.5, subcritical smooth-sphere regime typical of TT-ball Reynolds numbers, per Achenbach, E. " +
      "(1972), J. Fluid Mech. 54(3), 565-575.",
  },
  {
    id: "cannonball",
    name: "Cannonball (0.1 m iron)",
    mass: 4.12,
    radius: 0.05,
    dragModel: {
      kind: "tabulated-reynolds",
      table: { re: [...SMOOTH_SPHERE_CD_TABLE.re], cd: [...SMOOTH_SPHERE_CD_TABLE.cd] },
    },
    provenance:
      "0.1 m diameter smooth cast-iron sphere per blueprint spec (§3.9). Mass = (4/3)*pi*r^3 * rho_iron with " +
      "rho_iron = 7870 kg/m^3 (cast iron density, standard engineering reference value). Drag curve Cd(Re) per " +
      "Achenbach, E. (1972), J. Fluid Mech. 54(3), 565-575, spanning the drag crisis relevant at cannonball " +
      "muzzle-velocity Reynolds numbers.",
  },
  {
    id: "shot-put",
    name: "Shot put (men's)",
    mass: 7.26,
    radius: 0.06,
    dragModel: { kind: "constant", cd: 0.47 },
    provenance:
      "Mass (7.26 kg) and diameter (110-130 mm, mid-range 120 mm used here) per World Athletics Technical " +
      "Rules, Rule 32 (men's shot put). Cd ~= 0.47, subcritical smooth-sphere value (throwing-speed Reynolds " +
      "numbers stay below the drag crisis), per White, F.M. (2011) 'Fluid Mechanics', 7th ed., McGraw-Hill, " +
      "ch. 7.",
  },
];
