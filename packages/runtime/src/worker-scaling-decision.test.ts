/**
 * P7.12 / ADR-020: the premises the wasm-threads deferral rests on, asserted
 * against the repository rather than left as prose in the ADR.
 *
 * **This file exists because two of ADR-020's load-bearing claims are facts
 * about this repo that a later commit could silently falsify.** The ADR says
 * the app is not cross-origin isolated today and has no cross-origin
 * subresources, and it reasons from both. Prose cannot notice when it stops
 * being true; a test can.
 *
 * **It is deliberately NOT a test that the headers must never be set.** Setting
 * COOP/COEP is reopening-reason 3 in that ADR and is a legitimate thing for a
 * later task to do. What this asserts is that they cannot be set, or a
 * cross-origin subresource added, *without someone reading ADR-020 first* --
 * the failure message is the pointer. A guard whose remedy is "go and update
 * the decision" is doing its job when it fails.
 *
 * **What is deliberately not asserted here: the 3.08x itself.** A timing
 * assertion inside `pnpm test` is a flake, and this repository's three other
 * perf checks all live in scripts that soft-warn for exactly that reason. The
 * measurement lives in `scripts/worker-scaling-results.json` with the
 * environment it was taken in, and `pnpm bench:worker-scaling` re-derives it.
 * What IS asserted about that artifact is its internal consistency -- that its
 * recorded verdict matches its own recorded points -- which is a property of
 * the file and not of the machine that produced it.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = new URL("../../../", import.meta.url);

function readRepoFile(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, repoRoot)), "utf8");
}

/**
 * The header names cross-origin isolation turns on. Matched case-insensitively
 * against the raw deploy config text rather than against a parsed structure,
 * because Vercel accepts them in several shapes and this guard should fire on
 * any of them.
 */
const ISOLATION_HEADERS = ["cross-origin-opener-policy", "cross-origin-embedder-policy"];

describe("ADR-020 premise: the app is not cross-origin isolated today", () => {
  it("vercel.json sets no COOP or COEP header", () => {
    const config = readRepoFile("vercel.json").toLowerCase();
    for (const header of ISOLATION_HEADERS) {
      expect(
        config.includes(header),
        `vercel.json now sets ${header}. That is reopening-reason 3 in docs/adr/ADR-020-wasm-threads-deferred.md: if the app is cross-origin isolated for another reason, wasm threads' incremental cost drops to the toolchain paragraph alone and the deferral should be re-argued. Update the ADR, then update this test.`,
      ).toBe(false);
    }
  });

  it("vercel.json is still the deploy config, so the ADR is reasoning about the right host", () => {
    // ADR-020 opens by correcting the 95th run's belief that this app deploys
    // to GitHub Pages. If that ever becomes true, the ADR's header argument is
    // about the wrong host -- Pages genuinely cannot set response headers.
    const config = JSON.parse(readRepoFile("vercel.json")) as Record<string, unknown>;
    expect(config.outputDirectory).toBe("packages/app/dist");
  });
});

describe("ADR-020 premise: the app has no cross-origin subresources", () => {
  it("index.html loads no absolute-URL script, style or image", () => {
    const html = readRepoFile("packages/app/index.html");
    const absoluteUrls = html.match(/(?:src|href)\s*=\s*["']https?:\/\/[^"']+/gi) ?? [];
    expect(
      absoluteUrls,
      `packages/app/index.html now loads a cross-origin subresource. ADR-020 reasons from there being none -- specifically, that COEP require-corp would cost this app nothing in broken subresources. See docs/adr/ADR-020-wasm-threads-deferred.md.`,
    ).toEqual([]);
  });
});

describe("the recorded scaling artifact is internally consistent", () => {
  interface ScalingPoint {
    readonly workers: number;
    readonly chunks: number;
    readonly elapsedSeconds: number;
    readonly trajectoriesPerSecond: number;
    readonly speedupOverOneWorker: number;
    readonly parallelEfficiency: number;
  }
  interface ScalingArtifact {
    readonly task: string;
    readonly criterion: { readonly speedup: number; readonly workers: number };
    readonly stepSize: number;
    readonly replicates: number;
    readonly checksum: {
      readonly perWorkerCount: Record<string, number>;
      readonly relativeSpread: number;
      readonly reassociationTolerance: number;
    };
    readonly points: readonly ScalingPoint[];
    readonly verdict: {
      readonly speedupAtFourWorkers: number;
      readonly meetsCriterion: boolean;
    };
  }

  const artifact = JSON.parse(
    readRepoFile("scripts/worker-scaling-results.json"),
  ) as ScalingArtifact;

  it("is the artifact P7.12 recorded", () => {
    expect(artifact.task).toBe("P7.12");
    expect(artifact.criterion.speedup).toBe(2.5);
    expect(artifact.criterion.workers).toBe(4);
  });

  it("every point derives its own speedup and efficiency from the one-worker point", () => {
    const baseline = artifact.points.find((point) => point.workers === 1);
    expect(baseline).toBeDefined();
    for (const point of artifact.points) {
      // Recomputed from the recorded rates rather than trusted, so a
      // hand-edited speedup cannot pass -- the same reasoning P7.11's golden
      // uses for recomputing its observables hash from the rows.
      const speedup = point.trajectoriesPerSecond / baseline!.trajectoriesPerSecond;
      expect(point.speedupOverOneWorker).toBeCloseTo(speedup, 12);
      expect(point.parallelEfficiency).toBeCloseTo(speedup / point.workers, 12);
      // And the rate is the replicate count over the elapsed time, so a
      // rewritten rate cannot pass either.
      expect(point.trajectoriesPerSecond).toBeCloseTo(
        artifact.replicates / point.elapsedSeconds,
        6,
      );
      // One chunk per worker: a point with fewer chunks than workers measured
      // idle threads and its efficiency figure would be meaningless.
      expect(point.chunks).toBe(point.workers);
    }
  });

  it("the verdict is the four-worker point's own speedup, read against the criterion", () => {
    const four = artifact.points.find((point) => point.workers === 4);
    expect(four).toBeDefined();
    expect(artifact.verdict.speedupAtFourWorkers).toBe(four!.speedupOverOneWorker);
    expect(artifact.verdict.meetsCriterion).toBe(
      four!.speedupOverOneWorker >= artifact.criterion.speedup,
    );
  });

  it("the recorded run met the criterion, which is what ADR-020's decision rests on", () => {
    // Not a live timing -- this reads the committed artifact. A later run that
    // re-records a slower machine's numbers will red this, which is correct:
    // re-recording a failing measurement over a passing one is a decision to
    // reopen ADR-020, not a routine artifact refresh.
    expect(artifact.verdict.meetsCriterion).toBe(true);
  });

  it("all three worker counts computed the same ensemble, up to the reassociation bound", () => {
    // The ensemble is bit-identical at every partition; the checksum sums one
    // partial per chunk and the chunk count IS the worker count, so the three
    // sums are three associations of the same values and land a few ULP apart.
    // See CHECKSUM_REASSOCIATION_TOLERANCE in the measurement script.
    const checksums = Object.values(artifact.checksum.perWorkerCount);
    expect(checksums).toHaveLength(3);
    const lowest = Math.min(...checksums);
    const highest = Math.max(...checksums);
    expect((highest - lowest) / Math.abs(lowest)).toBeCloseTo(artifact.checksum.relativeSpread, 18);
    expect(artifact.checksum.relativeSpread).toBeLessThanOrEqual(
      artifact.checksum.reassociationTolerance,
    );
    // And the spread is genuinely a rounding effect rather than a bound that
    // happens to hold: it must sit far below the tolerance, not just inside
    // it. Measured 1.85e-15 against a 1e-13 bound.
    expect(artifact.checksum.relativeSpread).toBeLessThan(
      artifact.checksum.reassociationTolerance / 10,
    );
  });
});
