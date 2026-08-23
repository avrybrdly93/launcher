import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import type { OutputChunk, RollupOutput } from "rollup";

/**
 * Bundle-splitting proof for P3.45, mirroring `lazy-plotly-pane.bundle.test.ts`'s
 * P3.30 methodology exactly (same ADR-007 reasoning: a derivation panel is
 * opened on demand, not on every frame, so KaTeX's weight has no business
 * in the initial bundle). Builds `lazy-katex-pane.bundle-fixture.ts` (a
 * real consumer of `loadKatexModule`/`renderLazyKatexPane`) through
 * Vite/Rollup with `write: false` and inspects the in-memory chunk graph
 * directly -- no disk I/O, no browser.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

describe("lazy KaTeX pane bundle splitting (P3.45)", () => {
  it("keeps katex out of the initial chunk, in its own dynamic-import chunk", async () => {
    const result = await build({
      root: here,
      configFile: false,
      logLevel: "silent",
      build: {
        write: false,
        minify: false,
        lib: {
          entry: path.join(here, "lazy-katex-pane.bundle-fixture.ts"),
          formats: ["es"],
          fileName: () => "entry.js",
        },
      },
    });

    const single = Array.isArray(result) ? result[0]! : result;
    const output = (single as RollupOutput).output;
    const chunks = output.filter((item): item is OutputChunk => item.type === "chunk");

    const entryChunk = chunks.find((c) => c.isEntry);
    expect(entryChunk).toBeDefined();

    const katexChunks = chunks.filter((c) =>
      c.moduleIds.some((id) => id.includes(`${path.sep}katex${path.sep}`)),
    );
    expect(katexChunks.length).toBeGreaterThan(0);

    // The entry (initial) chunk must contain none of KaTeX's modules. (Note:
    // this file's own module -- lazy-katex-pane.ts -- contains the
    // substring "katex" in its filename, so the check targets the actual
    // `katex` package path segment, not any path with "katex" in it.)
    expect(entryChunk!.moduleIds.some((id) => id.includes(`${path.sep}katex${path.sep}`))).toBe(
      false,
    );

    // Every chunk containing a KaTeX module must be reachable only via a
    // dynamic import -- never statically bundled into another chunk.
    for (const katexChunk of katexChunks) {
      expect(katexChunk.isDynamicEntry).toBe(true);
      for (const other of chunks) {
        expect(other.imports).not.toContain(katexChunk.fileName);
      }
    }
    for (const katexChunk of katexChunks) {
      expect(entryChunk!.dynamicImports).toContain(katexChunk.fileName);
    }

    // Concrete size test (mirrors P3.30's literal validation criterion):
    // the initial chunk stays tiny while KaTeX's own lazy chunk carries
    // its real (unminified) weight.
    expect(entryChunk!.code.length).toBeLessThan(5_000);
    for (const katexChunk of katexChunks) {
      expect(katexChunk.code.length).toBeGreaterThan(50_000);
    }
    // P0.106: 90 s, not 30 s. A real unminified vite build of a multi-MB
    // dependency; 0.8 s standalone here, and measured at 22.1 s against
    // the old 30 s limit in P4.38 -- under the parallel suite that margin is not
    // enough. 90 s is ~4x the slowest standalone measurement on record. The
    // assertions above are untouched; only the deadline moved.
  }, 90_000);
});
