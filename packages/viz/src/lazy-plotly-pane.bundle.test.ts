import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import type { OutputChunk, RollupOutput } from "rollup";

/**
 * Bundle-splitting proof for P3.30 ("bundle: Plotly not in initial chunk").
 * Builds `lazy-plotly-pane.bundle-fixture.ts` (a real consumer of
 * `loadPlotlyModule`/`renderLazyPlotlyPane`) through Vite/Rollup with
 * `write: false` and inspects the in-memory chunk graph directly -- no
 * disk I/O, no browser, and (crucially) Plotly's own code is never
 * executed, only analyzed, since `plotly.js-dist-min` throws under a
 * plain Node global scope (`self is not defined`) and is only ever meant
 * to run inside a browser page.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

describe("lazy Plotly pane bundle splitting (P3.30)", () => {
  it("keeps plotly.js-dist-min out of the initial chunk, in its own large dynamic-import chunk", async () => {
    // A real (unminified) build of a multi-MB dependency; well past
    // vitest's default 5s per-test timeout on typical CI hardware.
    const result = await build({
      root: here,
      configFile: false,
      logLevel: "silent",
      build: {
        write: false,
        minify: false,
        lib: {
          entry: path.join(here, "lazy-plotly-pane.bundle-fixture.ts"),
          formats: ["es"],
          fileName: () => "entry.js",
        },
      },
    });

    // `build()` is typed to allow a watcher/array result only when `watch`/
    // multi-input options are set, neither of which apply to this
    // single-input, non-watch build.
    const single = Array.isArray(result) ? result[0]! : result;
    const output = (single as RollupOutput).output;
    const chunks = output.filter((item): item is OutputChunk => item.type === "chunk");

    const entryChunk = chunks.find((c) => c.isEntry);
    expect(entryChunk).toBeDefined();

    const plotlyChunks = chunks.filter((c) =>
      c.moduleIds.some((id) => id.includes("plotly.js-dist-min")),
    );
    expect(plotlyChunks.length).toBeGreaterThan(0);

    // The entry (initial) chunk must contain none of Plotly's modules. (Note:
    // this file's own module -- lazy-plotly-pane.ts -- contains the
    // substring "plotly" in its filename, so the check below specifically
    // targets the plotly.js-dist-min package, not any path with "plotly" in
    // it.)
    expect(entryChunk!.moduleIds.some((id) => id.includes("plotly.js-dist-min"))).toBe(false);

    // Every chunk containing a Plotly module must be reachable only via a
    // dynamic import -- never statically bundled into another chunk's
    // initial load (i.e. never listed in any chunk's static `imports`).
    for (const plotlyChunk of plotlyChunks) {
      expect(plotlyChunk.isDynamicEntry).toBe(true);
      for (const other of chunks) {
        expect(other.imports).not.toContain(plotlyChunk.fileName);
      }
    }
    for (const plotlyChunk of plotlyChunks) {
      expect(entryChunk!.dynamicImports).toContain(plotlyChunk.fileName);
    }

    // Concrete size test (this task's literal validation criterion): the
    // initial chunk stays tiny (a handful of function wrappers) while
    // Plotly's own lazy chunk carries its real multi-MB (unminified, since
    // this build disables minification for a readable/stable assertion)
    // weight -- the two are nowhere near comparable, which is the point.
    expect(entryChunk!.code.length).toBeLessThan(5_000);
    for (const plotlyChunk of plotlyChunks) {
      expect(plotlyChunk.code.length).toBeGreaterThan(500_000);
    }
  }, 30_000);
});
