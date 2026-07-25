/**
 * Colorblind-safety check for categorical (hue-coded) palettes (P3.36,
 * §6.1's "no rainbow" style rule's sibling requirement: every place the UI
 * tells two things apart *by hue alone* -- pinned-trajectory colors
 * (`compare-store.ts`), force-glyph colors (`@ballista/viz`'s
 * `force-glyphs.ts`) -- must stay pairwise distinguishable under simulated
 * color vision deficiency (CVD), not just to normal vision.
 *
 * CVD simulation uses the Viénot-Brettel-Mollon (1999) linear approximation
 * matrices as commonly implemented by web accessibility tooling (e.g. the
 * "Colorblind Web Page Filter" lineage): a fixed 3x3 transform per
 * deficiency, applied directly to gamma-encoded sRGB channels. This is a
 * practical screening approximation, not a clinical simulation -- adequate
 * for "are these two swatches confusable", which is this module's only job.
 *
 * Distinguishability is measured as CIE76 ΔE (Euclidean distance in CIELAB,
 * D65 white point) between each color pair, both under normal vision and
 * under each simulated deficiency. Per the commonly cited ΔE76
 * interpretation scale (~0-1 imperceptible, ~1-2 perceptible only on close
 * inspection, ~2-10 perceptible at a glance, >10 clearly distinct), this
 * module's default threshold of 6 sits solidly in "perceptible at a
 * glance" -- comfortably above the just-noticeable-difference floor, while
 * still satisfiable by the peer-reviewed Okabe-Ito (2008) 8-color
 * "Color Universal Design" categorical palette (worst case ΔE76 ≈ 7.3,
 * between bluish-green and blue under simulated tritanopia).
 */

export type CvdKind = "protanopia" | "deuteranopia" | "tritanopia";

/** `"normal"` (no simulation applied) plus every {@link CvdKind} this module screens against. */
export type VisionKind = "normal" | CvdKind;

export const ALL_CVD_KINDS: readonly CvdKind[] = Object.freeze([
  "protanopia",
  "deuteranopia",
  "tritanopia",
]);

/** Every vision this module checks a palette against: normal vision plus every {@link CvdKind}. */
export const ALL_VISION_KINDS: readonly VisionKind[] = Object.freeze(["normal", ...ALL_CVD_KINDS]);

type Rgb = readonly [number, number, number];
type Lab = readonly [number, number, number];

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function clamp255(value: number): number {
  return Math.min(255, Math.max(0, value));
}

/** Viénot-Brettel-Mollon (1999) approximation matrices, applied to gamma-encoded sRGB (see module doc). */
const CVD_TRANSFORM: Record<CvdKind, (rgb: Rgb) => Rgb> = {
  protanopia: ([r, g, b]) => [
    clamp255(0.56667 * r + 0.43333 * g),
    clamp255(0.55833 * r + 0.44167 * g),
    clamp255(0.24167 * g + 0.75833 * b),
  ],
  deuteranopia: ([r, g, b]) => [
    clamp255(0.625 * r + 0.375 * g),
    clamp255(0.7 * r + 0.3 * g),
    clamp255(0.3 * g + 0.7 * b),
  ],
  tritanopia: ([r, g, b]) => [
    clamp255(0.95 * r + 0.05 * g),
    clamp255(0.43333 * g + 0.56667 * b),
    clamp255(0.475 * g + 0.525 * b),
  ],
};

/** Applies `vision`'s CVD simulation to `rgb`, or returns it unchanged for `"normal"`. */
function simulate(rgb: Rgb, vision: VisionKind): Rgb {
  return vision === "normal" ? rgb : CVD_TRANSFORM[vision](rgb);
}

function srgbChannelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

const D65_WHITE = { x: 95.047, y: 100.0, z: 108.883 };

/** CIE `f(t)` piecewise cube-root, per the standard XYZ->Lab conversion. */
function labF(t: number): number {
  const epsilon = 216 / 24389;
  const kappa = 24389 / 27;
  return t > epsilon ? Math.cbrt(t) : (kappa * t + 16) / 116;
}

/** sRGB (0-255 channels) -> CIELAB (D65), via linearized sRGB -> XYZ -> Lab. */
function rgbToLab([r, g, b]: Rgb): Lab {
  const rl = srgbChannelToLinear(r);
  const gl = srgbChannelToLinear(g);
  const bl = srgbChannelToLinear(b);

  const x = (rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) * 100;
  const y = (rl * 0.2126729 + gl * 0.7151522 + bl * 0.072175) * 100;
  const z = (rl * 0.0193339 + gl * 0.119192 + bl * 0.9503041) * 100;

  const fx = labF(x / D65_WHITE.x);
  const fy = labF(y / D65_WHITE.y);
  const fz = labF(z / D65_WHITE.z);

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 ΔE: Euclidean distance between two Lab colors. */
function deltaE76(a: Lab, b: Lab): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

/** `hex`'s Lab coordinates as perceived under `vision` (simulated CVD, or `"normal"` for unmodified). */
export function labUnderVision(hex: string, vision: VisionKind): Lab {
  return rgbToLab(simulate(hexToRgb(hex), vision));
}

/** One pair of palette entries that fell below the distinguishability threshold under a given vision. */
export interface PaletteViolation {
  readonly indexA: number;
  readonly indexB: number;
  readonly vision: VisionKind;
  readonly deltaE: number;
}

export interface PaletteSafetyResult {
  readonly safe: boolean;
  readonly minDeltaE: number;
  readonly violations: readonly PaletteViolation[];
}

/**
 * Checks every pair in `colors` (hex strings) for distinguishability under
 * normal vision and every simulated CVD in {@link ALL_CVD_KINDS}, per this
 * module's ΔE76 threshold convention (see module doc). `safe` is `true`
 * only when every pair, under every vision, clears `minDeltaE`.
 */
export function checkPaletteColorblindSafety(
  colors: readonly string[],
  minDeltaE = 6,
): PaletteSafetyResult {
  const violations: PaletteViolation[] = [];
  let observedMin = Infinity;

  for (const vision of ALL_VISION_KINDS) {
    const labs = colors.map((hex) => labUnderVision(hex, vision));
    for (let i = 0; i < colors.length; i++) {
      for (let j = i + 1; j < colors.length; j++) {
        const deltaE = deltaE76(labs[i]!, labs[j]!);
        observedMin = Math.min(observedMin, deltaE);
        if (deltaE < minDeltaE) {
          violations.push({ indexA: i, indexB: j, vision, deltaE });
        }
      }
    }
  }

  return { safe: violations.length === 0, minDeltaE: observedMin, violations };
}
