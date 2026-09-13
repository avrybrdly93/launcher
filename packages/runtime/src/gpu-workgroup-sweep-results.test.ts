// P7.15 guard: the recorded workgroup sweep says only what it measured.
//
// ## Why a test on a results file
//
// P7.15's criterion is "best workgroup size recorded per adapter class", and
// the 99th run's handover flagged that the criterion can be met dishonestly:
// the only adapter reachable in this project's container is SwiftShader, a
// SOFTWARE adapter, and a number measured on it that ends up in the record
// unlabelled reads exactly like a hardware result.
//
// The 100th run resolved that by reading the criterion as "per adapter class
// actually measured, software included, each row labelled with the class it was
// measured on" — recorded in `ROADMAP.json` before any measurement — and by
// deriving each row's class from the adapter's own info rather than typing it.
//
// **A derivation the writer performs is only as good as the next person's
// willingness to leave it alone.** `gpu-workgroup-sweep-results.json` is a
// committed JSON file; nothing stops a later edit from adding a `hardware` row
// by hand, or flipping a class, or filling in a `bestWorkgroupSize` the
// separation does not support. These assertions are what make that fail. They
// need no GPU, no device and no measurement: they re-derive from the row's own
// recorded adapter info what the row claims about itself.
//
// If this file is failing, the fix is to correct the row or to re-run
// `pnpm bench:gpu-workgroup --record` on the adapter in question. It is not to
// relax the assertion.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ADAPTER_CLASSES,
  classifyAdapter,
  summariseWorkgroupSweep,
} from "./wgsl-workgroup-sweep.js";

const repoRoot = new URL("../../../", import.meta.url);

interface Ranking {
  workgroupSize: number;
  medianMs: number;
  minMs: number;
  maxMs: number;
  repeats: number;
}

interface Row {
  adapterClass: string;
  bestWorkgroupSize: number | null;
  fastestWorkgroupSize: number;
  runnerUpWorkgroupSize: number | null;
  separationMs: number | null;
  separated: boolean | null;
  evidence: string;
  adapter: {
    vendor: string | null;
    architecture: string | null;
    description: string | null;
    isFallbackAdapter: boolean | null;
  };
  rankings: Ranking[];
}

interface Results {
  schemaVersion: number;
  task: string;
  criterion: string;
  criterionReading: string;
  provenance: string;
  rows: Row[];
}

const results = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("scripts/gpu-workgroup-sweep-results.json", repoRoot)),
    "utf8",
  ),
) as Results;

describe("the sweep results file", () => {
  it("names its task and its criterion, and records the reading taken", () => {
    expect(results.schemaVersion).toBe(1);
    expect(results.task).toBe("P7.15");
    expect(results.criterion).toBe("best workgroup size recorded per adapter class");
    // The reading is the whole reason the file can be honest, so its absence is
    // a defect and not a formatting slip.
    expect(results.criterionReading.length).toBeGreaterThan(100);
    // The script path, not the `pnpm` alias: the alias can be renamed in
    // `package.json` without the file changing, and it is the script that
    // wrote the row.
    expect(results.provenance).toContain("measure-gpu-workgroup-sweep.mjs");
  });

  it("holds at least one row, and no duplicate classes", () => {
    expect(results.rows.length).toBeGreaterThan(0);
    const classes = results.rows.map((row) => row.adapterClass);
    expect(new Set(classes).size).toBe(classes.length);
  });
});

describe.each(results.rows.map((row) => [row.adapterClass, row] as const))(
  "the %s row",
  (_name, row) => {
    it("uses a class from the closed vocabulary", () => {
      expect(ADAPTER_CLASSES).toContain(row.adapterClass);
    });

    /**
     * **The load-bearing assertion in this file.**
     *
     * The class is re-derived from the row's own recorded adapter info. A row
     * hand-edited to say `hardware` while carrying SwiftShader's adapter info
     * fails here, which is precisely the misrepresentation P7.15's criterion
     * had to be read carefully to avoid.
     */
    it("carries the class its own recorded adapter info implies", () => {
      expect(
        classifyAdapter({
          vendor: row.adapter.vendor ?? undefined,
          architecture: row.adapter.architecture ?? undefined,
          description: row.adapter.description ?? undefined,
          isFallbackAdapter: row.adapter.isFallbackAdapter ?? undefined,
        }),
      ).toBe(row.adapterClass);
    });

    it("says in words whether it is evidence about hardware", () => {
      expect(row.evidence.length).toBeGreaterThan(60);
      const claimsHardware = /HARDWARE adapter/.test(row.evidence);
      expect(claimsHardware).toBe(row.adapterClass === "hardware");
      if (row.adapterClass === "software") {
        expect(row.evidence).toMatch(/NOT evidence about any hardware adapter class/);
      }
    });

    it("names a best size only when the separation supports one", () => {
      // `separated` is the non-overlap test; `bestWorkgroupSize` must be its
      // consequence and never an independent claim.
      if (row.separated === true) {
        expect(row.bestWorkgroupSize).toBe(row.fastestWorkgroupSize);
      } else {
        expect(row.bestWorkgroupSize).toBeNull();
      }
    });

    it("agrees with the summariser re-run over its own rankings", () => {
      // The rankings carry min/max/median rather than the raw timings, so the
      // summariser cannot be re-run from them exactly. What can be re-derived
      // is every claim that depends only on those three, which is all of them.
      const ordered = [...row.rankings].sort(
        (a, b) => a.medianMs - b.medianMs || a.workgroupSize - b.workgroupSize,
      );
      expect(row.rankings).toStrictEqual(ordered);

      const fastest = ordered[0] as Ranking;
      const runnerUp = ordered.length > 1 ? (ordered[1] as Ranking) : null;
      expect(row.fastestWorkgroupSize).toBe(fastest.workgroupSize);
      expect(row.runnerUpWorkgroupSize).toBe(runnerUp?.workgroupSize ?? null);
      if (runnerUp !== null) {
        expect(row.separated).toBe(fastest.maxMs < runnerUp.minMs);
        expect(row.separationMs).toBeCloseTo(runnerUp.medianMs - fastest.medianMs, 9);
      }
    });

    it("ranks the degenerate size 1 last, which is the sweep's own control", () => {
      const index = row.rankings.findIndex((rank) => rank.workgroupSize === 1);
      if (index !== -1) {
        expect(index).toBe(row.rankings.length - 1);
      }
    });

    it("records a plausible measurement rather than a placeholder", () => {
      expect(row.rankings.length).toBeGreaterThan(1);
      for (const rank of row.rankings) {
        expect(Number.isInteger(rank.workgroupSize)).toBe(true);
        expect(rank.workgroupSize).toBeGreaterThan(0);
        expect(rank.repeats).toBeGreaterThan(1);
        expect(rank.minMs).toBeGreaterThan(0);
        expect(rank.minMs).toBeLessThanOrEqual(rank.medianMs);
        expect(rank.medianMs).toBeLessThanOrEqual(rank.maxMs);
      }
    });
  },
);

describe("the summariser and the file cannot drift apart", () => {
  it("reproduces each row's verdict when handed timings with that row's spread", () => {
    // A round trip through the summariser using the recorded min/median/max as
    // a three-point stand-in for the sample. This is not a re-measurement --
    // the raw timings are not in the file -- but it does check that the
    // recorded verdict is the one the code in the repo would reach from the
    // recorded spread, which is what would break if the two were edited apart.
    for (const row of results.rows) {
      const samples = row.rankings.map((rank) => ({
        workgroupSize: rank.workgroupSize,
        timingsMs: [rank.minMs, rank.medianMs, rank.maxMs],
      }));
      const summary = summariseWorkgroupSweep(samples);
      expect(summary.fastestWorkgroupSize).toBe(row.fastestWorkgroupSize);
      expect(summary.runnerUpWorkgroupSize).toBe(row.runnerUpWorkgroupSize);
      expect(summary.separated).toBe(row.separated);
      expect(summary.bestWorkgroupSize).toBe(row.bestWorkgroupSize);
    }
  });
});
