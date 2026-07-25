import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { viridis } from "./colormap.js";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

describe("viridis (P3.36: viridis-only colormaps)", () => {
  it("t=0 is viridis' dark purple anchor, t=1 its bright yellow anchor", () => {
    expect(viridis(0)).toBe("#440154");
    expect(viridis(1)).toBe("#fde725");
  });

  it("clamps out-of-range t to the same endpoints", () => {
    expect(viridis(-5)).toBe(viridis(0));
    expect(viridis(5)).toBe(viridis(1));
  });

  it("every output is a well-formed #rrggbb hex string", () => {
    for (let t = 0; t <= 1; t += 0.05) {
      expect(viridis(t)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("perceptual lightness (relative luminance) increases monotonically from t=0 to t=1 (no hue reversals)", () => {
    function relativeLuminance(hex: string): number {
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    const samples = Array.from({ length: 21 }, (_, i) => relativeLuminance(viridis(i / 20)));
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!).toBeGreaterThanOrEqual(samples[i - 1]! - 1e-9);
    }
    // Strictly brighter end-to-end, not just non-decreasing throughout.
    expect(samples.at(-1)!).toBeGreaterThan(samples[0]!);
  });
});

/**
 * "viridis-only colormaps enforced" (P3.36): scans every other source file
 * in this package for a second colormap-shaped definition -- a function or
 * exported const whose name contains "colormap" or "Colormap" -- outside
 * this module. A future scalar-channel coloring feature (§6.1: speed,
 * |F_d|, local Re along a trajectory) must extend `viridis`, not hand-roll
 * a competing (and possibly rainbow) scale. `@ballista/viz`, the other
 * package that renders scalar data to color, carries the same scan over its
 * own source in `colormap-enforcement.test.ts` (a runtime test reaching
 * into a sibling package's directory would blur the L2/L3 layering this
 * scan is itself trying to keep honest).
 */
function findColormapLikeDeclarations(dir: string, exclude: readonly string[]): string[] {
  const hits: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      hits.push(...findColormapLikeDeclarations(join(dir, entry.name), exclude));
      continue;
    }
    if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
    if (exclude.includes(entry.name)) continue;

    const source = readFileSync(join(dir, entry.name), "utf8");
    const declarationPattern = /\b(function|const)\s+\w*[Cc]olormap\w*/g;
    for (const match of source.matchAll(declarationPattern)) {
      hits.push(`${entry.name}: ${match[0]}`);
    }
  }
  return hits;
}

describe("viridis is the platform's only colormap in @ballista/runtime (enforcement scan)", () => {
  it("no other file in this package defines a competing colormap", () => {
    const hits = findColormapLikeDeclarations(SRC_DIR, ["colormap.ts", "colormap.test.ts"]);
    expect(hits).toEqual([]);
  });
});
