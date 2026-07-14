import type { ProjectileSpec } from "./projectile-spec.js";

/**
 * Initial projectile data assets (§3.9): smooth sphere, golf ball, soccer
 * ball, baseball, table-tennis ball, cannonball, shot put. Every numeric
 * value carries a `provenance` citation; P1.26 validates these against
 * `ProjectileSpecSchema` at build time.
 */
export const PROJECTILE_ASSETS: readonly ProjectileSpec[] = [
  {
    id: "smooth-sphere",
    displayName: "Smooth Sphere (reference)",
    mass: 1,
    radius: 0.05,
    dragCoefficient: { kind: "constant", value: 0.47 },
    provenance:
      "Idealized 1 kg, R=5cm smooth sphere; Cd=0.47 is the standard subcritical smooth-sphere " +
      "drag coefficient (Hoerner, 'Fluid-Dynamic Drag', 1965). Round numbers chosen deliberately " +
      "as the platform's drag-free/simple-drag teaching reference, not a real object.",
  },
  {
    id: "golf-ball",
    displayName: "Golf Ball",
    mass: 0.04593,
    radius: 0.021335,
    dragCoefficient: { kind: "constant", value: 0.25 },
    liftCoefficient: { kind: "saturating", maxCl: 0.6, slope: 1.6 },
    spinDecayTau: 25,
    provenance:
      "Mass <=45.93g and diameter >=42.67mm per USGA/R&A Rules of Golf, Rule 4a/4b (2023). " +
      "Cd~=0.25 for a dimpled ball at typical drive speeds, well below the ~0.47 smooth-sphere " +
      "value because dimples trip the boundary layer turbulent early (Bearman & Harvey, " +
      "'Golf Ball Aerodynamics', Aeronautical Quarterly, 1976). Spin decay tau in the " +
      "sport-typical 20-30s band (§3.6).",
  },
  {
    id: "soccer-ball",
    displayName: "Soccer Ball",
    mass: 0.43,
    radius: 0.10979,
    dragCoefficient: { kind: "constant", value: 0.25 },
    provenance:
      "Mass 410-450g (midpoint 430g) and circumference 68-70cm (midpoint 69cm => R=0.10979m) " +
      "per FIFA Laws of the Game, Law 2 (2023/24). Cd~=0.25 typical of a size-5 match ball in " +
      "the supercritical regime at kicking speeds (Mehta, 'Sports Ball Aerodynamics', in " +
      "'Sport Aerodynamics', Springer, 2008).",
  },
  {
    id: "baseball",
    displayName: "Baseball",
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: { kind: "constant", value: 0.3 },
    liftCoefficient: { kind: "saturating", maxCl: 0.6, slope: 1.6 },
    spinDecayTau: 20,
    provenance:
      "Mass 5.125 oz (145g) and circumference 9-9.25in (=> R~=3.66cm) per MLB Official " +
      "Baseball Rules, Rule 3.02. Cd~=0.3-0.35 typical for a seamed baseball at pitch/batted-ball " +
      "speeds (Adair, 'The Physics of Baseball', 3rd ed., 2002); 0.3 used here.",
  },
  {
    id: "table-tennis-ball",
    displayName: "Table Tennis Ball",
    mass: 0.0027,
    radius: 0.02,
    dragCoefficient: { kind: "constant", value: 0.5 },
    spinDecayTau: 20,
    provenance:
      "Mass 2.7g and diameter 40mm per ITTF Table Tennis Rules, Rule 2.2/2.3 (post-2000 " +
      "40mm ball). Cd~=0.5 for a smooth low-Re sphere in this size/speed range (Kensrud, " +
      "Nathan & Smith, 'The Aerodynamics of Table Tennis Balls', Procedia Engineering, 2014); " +
      "high area-to-mass ratio makes this the platform's high-Pi (drag-dominated) exhibit.",
  },
  {
    id: "cannonball",
    displayName: "Cannonball (0.1 m iron)",
    mass: 4.1228,
    radius: 0.05,
    dragCoefficient: { kind: "constant", value: 0.47 },
    provenance:
      "0.1m-diameter solid iron sphere per §3.9's canonical spec: mass = rho_iron * (4/3)*pi*R^3 " +
      "with rho_iron = 7874 kg/m^3 (standard density of iron) and R=0.05m, giving 4.1228 kg. " +
      "Cd=0.47 subcritical smooth-sphere default; real cannonball flight speeds can cross the " +
      "drag-crisis Re, for which the platform's TabulatedReynoldsCd model is the documented " +
      "higher-fidelity alternative.",
  },
  {
    id: "shot-put",
    displayName: "Shot Put (men's, 7.26 kg)",
    mass: 7.26,
    radius: 0.06,
    dragCoefficient: { kind: "constant", value: 0.47 },
    provenance:
      "Mass 7.26kg (16 lb) per World Athletics Rule 32 (men's implement); diameter ~110-130mm, " +
      "R=0.06m taken near the low end of that range as representative. Cd=0.47 subcritical " +
      "smooth-sphere default; drag is negligible for this projectile (Pi << 1, §3.8), making it " +
      "the platform's canonical low-drag/near-parabolic reference scenario.",
  },
] as const;
