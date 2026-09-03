/** Standard gravity, m/s^2 (§3.2). */
export const G_STD = 9.80665;

/** ISA sea-level constants (§3.4). */
export const ISA = {
  rho0: 1.225, // kg/m^3
  T0: 288.15, // K
  p0: 101325, // Pa
  Rs: 287.05, // J/(kg*K), specific gas constant for dry air
  lapseRate: 6.5e-3, // K/m
  scaleHeight: 8500, // m, isothermal exponential-atmosphere approximation
} as const;

/** Sutherland's law reference values (§3.4, eq. 3.12). */
export const SUTHERLAND = {
  etaRef: 1.789e-5, // Pa*s at Tref
  Tref: 288.15, // K
  S: 110.4, // K
} as const;

/**
 * Sutherland's law: dynamic viscosity of air as a function of absolute
 * temperature (§3.4, eq. 3.12).
 *
 * The $(T/T_{ref})^{3/2}$ factor is evaluated as `r * Math.sqrt(r)` rather
 * than `Math.pow(r, 1.5)` (P0.121). `Math.sqrt` compiles to a single hardware
 * instruction; V8's `Math.pow` takes a generic path for any non-integer
 * exponent, and measured here at 2e7 evaluations over the ISA temperature
 * range that is **1303.7 ms against 222.9 ms, 5.85x**. This function is
 * called once per environment sample and therefore once per `model.rhs`
 * evaluation, four to five times per fixed step.
 *
 * **This is an accuracy trade, and it is a real one rather than a free
 * simplification.** The two forms are algebraically identical but not
 * bit-identical: `Math.sqrt` is correctly rounded and the following multiply
 * rounds once more, so the result can differ from `Math.pow`'s in the last
 * bits. Swept at 4e6 points over 150-350 K, the maximum relative difference
 * is **4.440826e-16, exactly 2.0000x `Number.EPSILON`**, at T = 236.05 K;
 * the two forms return **bit-identical** results on 79% of that sweep and
 * 82% of the ISA troposphere. `units.test.ts` pins this as an enforced
 * contract with a 2x margin.
 *
 * The committed golden trajectories do **not** move: 0 of 23 hashes, with
 * `pnpm update-goldens` reproducing both fixture files byte for byte. That
 * is measured against a negative control rather than assumed — a deliberate
 * **1 ulp** perturbation of this function's result moves **4 of 23** hashes,
 * so the goldens do resolve changes at this scale and the zero is a real
 * zero. It is nonetheless partly luck: the golden scenarios' temperatures
 * happen to land in the agreeing 79%, and a future golden that reaches a
 * differing temperature will move. See the P0.121 entry in `CHANGELOG.md`.
 *
 * Neither form is exact, and the accurate one is not obviously `Math.pow`:
 * it is also only correctly rounded to within about an ulp for a fractional
 * exponent, so this is a trade between two approximations of similar quality,
 * bought at 5.85x. It is not a claim that the two are interchangeable.
 */
export function sutherlandViscosity(temperatureK: number): number {
  const r = temperatureK / SUTHERLAND.Tref;
  return (
    SUTHERLAND.etaRef *
    (r * Math.sqrt(r)) *
    ((SUTHERLAND.Tref + SUTHERLAND.S) / (temperatureK + SUTHERLAND.S))
  );
}

/** Mean Earth radius, m (used by altitude-dependent gravity, §3.2). */
export const EARTH_RADIUS_M = 6.371e6;

/** Earth's sidereal rotation rate, rad/s (2*pi / 86164.0905s, used by the Coriolis force, P4.27). */
export const EARTH_ANGULAR_VELOCITY = 7.292115e-5;

/** Degrees to radians. */
export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Radians to degrees. */
export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** m/s to km/h. */
export function msToKmh(ms: number): number {
  return ms * 3.6;
}

/** km/h to m/s. */
export function kmhToMs(kmh: number): number {
  return kmh / 3.6;
}

/** m/s to mph. */
export function msToMph(ms: number): number {
  return ms * 2.2369362920544;
}

/** mph to m/s. */
export function mphToMs(mph: number): number {
  return mph / 2.2369362920544;
}

/** Meters to feet. */
export function mToFt(m: number): number {
  return m * 3.280839895013123;
}

/** Feet to meters. */
export function ftToM(ft: number): number {
  return ft / 3.280839895013123;
}

/** Kilograms to pounds (avoirdupois). */
export function kgToLb(kg: number): number {
  return kg * 2.2046226218487757;
}

/** Pounds (avoirdupois) to kilograms. */
export function lbToKg(lb: number): number {
  return lb / 2.2046226218487757;
}
