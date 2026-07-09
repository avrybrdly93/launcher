import { SUTHERLAND } from "./units.js";

/**
 * Sutherland's law (§3.4, eq. 3.12): dynamic viscosity of air as a function
 * of temperature, eta(T) = eta_ref*(T/Tref)^1.5*(Tref+S)/(T+S). Used by
 * atmosphere models with a temperature that varies with position (unlike
 * `ConstantAtmosphere`/`ExponentialAtmosphere`'s isothermal default, which
 * evaluate this once at their fixed T0).
 */
export function sutherlandViscosity(
  T: number,
  etaRef: number = SUTHERLAND.etaRef,
  Tref: number = SUTHERLAND.Tref,
  S: number = SUTHERLAND.S,
): number {
  return etaRef * (T / Tref) ** 1.5 * ((Tref + S) / (T + S));
}
