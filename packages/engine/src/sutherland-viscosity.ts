import { SUTHERLAND } from "./units.js";

/** Sutherland's law: eta(T) = etaRef * (T/Tref)^1.5 * (Tref+S)/(T+S) (§3.4, eq. 3.12). */
export function sutherlandViscosity(T: number): number {
  const { etaRef, Tref, S } = SUTHERLAND;
  return etaRef * Math.pow(T / Tref, 1.5) * ((Tref + S) / (T + S));
}
