import { SUTHERLAND } from "./units.js";

/** Sutherland's law: dynamic viscosity of air as a function of temperature (eq. 3.12). */
export function sutherlandViscosity(T: number): number {
  const { etaRef, Tref, S } = SUTHERLAND;
  return etaRef * (T / Tref) ** 1.5 * ((Tref + S) / (T + S));
}
