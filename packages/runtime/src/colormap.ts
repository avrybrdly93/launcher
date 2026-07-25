/**
 * Viridis colormap (P3.36; §6.1 hard style rule: "perceptually-uniform
 * colormap, viridis family only -- no rainbow"). This is the platform's one
 * and only scalar-to-color mapping implementation -- future scalar-channel
 * coloring (speed, |F_d|, local Re along a trajectory, §6.1) must call
 * {@link viridis} rather than hand-rolling a new hue-cycling scale.
 * `colormap.test.ts`'s "no second colormap" check enforces that no other
 * module in this package or `@ballista/viz` defines a competing one.
 *
 * Control points are matplotlib's published viridis anchors (van der Walt
 * & Smith, 2015), sampled at every 0.125 of `t`; {@link viridis} linearly
 * interpolates between the two nearest anchors in sRGB space. Coarser than
 * the reference 256-entry LUT, but perceptual uniformity is a property of
 * the anchor sequence itself (monotonically increasing lightness, no hue
 * reversals) and survives linear interpolation between adjacent anchors.
 */

const VIRIDIS_ANCHORS: readonly (readonly [number, number, number])[] = Object.freeze([
  [0x44, 0x01, 0x54], // t=0.000  #440154
  [0x48, 0x1a, 0x6c], // t=0.125  #481a6c
  [0x40, 0x31, 0x84], // t=0.250  #403184
  [0x35, 0x48, 0x8f], // t=0.375  #35488f
  [0x2a, 0x78, 0x8e], // t=0.500  #2a788e (approx: mid-viridis teal)
  [0x21, 0x90, 0x8c], // t=0.625  #21908c
  [0x5c, 0xc8, 0x63], // t=0.750  #5cc863
  [0xa4, 0xdb, 0x36], // t=0.875  #a4db36
  [0xfd, 0xe7, 0x25], // t=1.000  #fde725
]);

function toHex2(value: number): string {
  return Math.round(value).toString(16).padStart(2, "0");
}

/**
 * Maps `t` (clamped to `[0, 1]`) to a viridis color, returned as a `#rrggbb`
 * hex string. `t=0` is viridis' dark purple anchor, `t=1` its bright yellow
 * anchor, per the standard matplotlib orientation.
 */
export function viridis(t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const scaled = clamped * (VIRIDIS_ANCHORS.length - 1);
  const lowIndex = Math.floor(scaled);
  const highIndex = Math.min(VIRIDIS_ANCHORS.length - 1, lowIndex + 1);
  const frac = scaled - lowIndex;

  const low = VIRIDIS_ANCHORS[lowIndex]!;
  const high = VIRIDIS_ANCHORS[highIndex]!;

  const r = low[0] + (high[0] - low[0]) * frac;
  const g = low[1] + (high[1] - low[1]) * frac;
  const b = low[2] + (high[2] - low[2]) * frac;

  return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
}
