import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * "viridis-only colormaps enforced" (P3.36, §6.1 hard style rule: "viridis
 * family only -- no rainbow"). `@ballista/runtime`'s `viridis` (imported by
 * this package via the normal L2->L3 dependency) is the platform's one
 * scalar-to-color mapping; this scan guards against a second, competing
 * colormap definition sneaking into `@ballista/viz` -- the other package
 * that renders scalar data to color -- the same way
 * `@ballista/runtime/colormap.test.ts` guards its own source.
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

describe("viridis (from @ballista/runtime) is @ballista/viz's only colormap (enforcement scan)", () => {
  it("no file in this package defines a competing colormap", () => {
    // Excludes this scanner's own file -- its helper name necessarily
    // contains "colormap" and would otherwise flag itself.
    const hits = findColormapLikeDeclarations(SRC_DIR, ["colormap-enforcement.test.ts"]);
    expect(hits).toEqual([]);
  });
});
