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

/** Sutherland's law: dynamic viscosity of air as a function of temperature (eq. 3.12). */
export function sutherlandViscosity(T: number): number {
  return (
    SUTHERLAND.etaRef *
    (T / SUTHERLAND.Tref) ** 1.5 *
    ((SUTHERLAND.Tref + SUTHERLAND.S) / (T + SUTHERLAND.S))
  );
}

export const EARTH_RADIUS_M = 6.371e6;

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function msToKmh(ms: number): number {
  return ms * 3.6;
}

export function kmhToMs(kmh: number): number {
  return kmh / 3.6;
}

export function msToMph(ms: number): number {
  return ms * 2.2369362920544;
}

export function mphToMs(mph: number): number {
  return mph / 2.2369362920544;
}

export function mToFt(m: number): number {
  return m * 3.280839895013123;
}

export function ftToM(ft: number): number {
  return ft / 3.280839895013123;
}
