// P0.136's recorded device result, and the drift guard on the fixture that
// produced it.
//
// WHY THIS GUARDS THE COPY THROUGH ITS OUTPUT RATHER THAN ITS SOURCE.
// `scripts/gpu-compensated-impact-fixture.mjs` re-derives P7.19's vacuum-45deg
// batch instead of importing it, because it must load under plain Node from
// `dist/` and `planar-impact-agreement-study.js` carries a bare
// `@ballista/solverkit` import Node cannot resolve. A second spelling of a grid
// is exactly the failure `wgsl-planar-physics.ts` exists to prevent -- the
// copies agree on the day they are written, and the day one changes the other
// silently keeps describing the old batch.
//
// The obvious guard is to import that fixture here and diff it member for
// member. That is not what this file does, for a reason worth stating: the
// fixture's own imports reach into `dist/`, so importing it would make this
// test red on a fresh clone until `pnpm build` has run -- which is the exact
// defect P0.137 was filed about, reintroduced by its own regression guard's
// neighbour.
//
// So the guard runs through the recorded numbers instead, and it is strictly
// stronger than a structural diff would be. If the fixture's batch ever drifted
// from the study's -- a different grid, a different step budget, a different
// scenario -- its CPU arms would compute different errors, and the two figures
// asserted below would stop matching the ones P7.19 recorded from
// `buildImpactBatch` itself. Two independent code paths agreeing to every digit
// of a double is not a coincidence that survives a drift.

// Everything this file needs about the study comes from the study's own
// recorded result rather than from `@ballista/runtime`, and that is a
// constraint rather than a preference: `.dependency-cruiser.cjs` allows
// `validation` to import `engine`, `solverkit` and `analysis` only, so an
// import of the runtime package would fail `pnpm lint:deps`. The recorded file
// carries the grid, the budget and each family's step budget, which is all of
// it -- and reading the recorded values keeps this test comparing two
// measurements rather than a measurement against the code that produced it.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

interface CompensatedImpactRecord {
  readonly task: string;
  readonly familyId: string;
  readonly gridSide: number;
  readonly count: number;
  readonly h: number;
  readonly steps: number;
  readonly absoluteBudgetMetres: number;
  readonly ulpBudget: number;
  readonly adapter: { readonly architecture: string | null };
  readonly adapterClass: string;
  readonly impactedOnReference: number;
  readonly impactedMismatches: number;
  readonly identicalRanges: number;
  readonly worstUlpVsCpuCompensated: number;
  readonly worstDeviceErrorMetres: number;
  readonly worstCpuCompensatedErrorMetres: number;
  readonly worstCpuPlainErrorMetres: number;
  readonly notes: readonly string[];
}

interface ImpactAgreementFamily {
  readonly familyId: string;
  readonly h: number;
  readonly steps: number;
}

interface ImpactAgreementRecord {
  readonly absoluteBudgetMetres: number;
  readonly gridSide: number;
  readonly worstPlainError: number;
  readonly worstPlainFamily: string;
  readonly worstCompensatedError: number;
  readonly worstCompensatedFamily: string;
  readonly families: readonly ImpactAgreementFamily[];
}

function readJson<T>(...segments: string[]): T {
  return JSON.parse(readFileSync(join(repoRoot, ...segments), "utf8")) as T;
}

const record = readJson<CompensatedImpactRecord>("scripts", "gpu-compensated-impact-results.json");
const p719 = readJson<ImpactAgreementRecord>(
  "packages",
  "runtime",
  "src",
  "planar-impact-agreement-results.json",
);

describe("the recorded device batch is the batch P7.19 defined", () => {
  const family = p719.families.find((f) => f.familyId === "vacuum-45deg");

  it("names the family P7.19's criterion turns on", () => {
    expect(family).toBeDefined();
    expect(record.familyId).toBe("vacuum-45deg");
    // The family that misses the bar is the one worth putting on a device. If
    // P7.19's worst plain family ever moves, this measurement is aimed wrong.
    expect(p719.worstPlainFamily).toBe(record.familyId);
    expect(p719.worstCompensatedFamily).toBe(record.familyId);
  });

  it("uses that family's own step budget and grid, not a reduced one", () => {
    expect(record.h).toBe(family!.h);
    expect(record.steps).toBe(family!.steps);
    expect(record.gridSide).toBe(p719.gridSide);
    expect(record.count).toBe(p719.gridSide * p719.gridSide);
  });

  it("grades against the budget the study defines, not a local copy of it", () => {
    expect(record.absoluteBudgetMetres).toBe(p719.absoluteBudgetMetres);
  });
});

describe("the fixture's re-derived batch has not drifted from the study's", () => {
  it("computes P7.19's own plain-arm maximum to the last digit", () => {
    // The strongest statement this file makes. The script's fixture built its
    // grid from PRECISION_SCENARIOS independently of buildImpactBatch, ran the
    // f32 plain arm over it, and arrived at the number the study recorded.
    expect(record.worstCpuPlainErrorMetres).toBe(p719.worstPlainError);
  });

  it("computes P7.19's own compensated-arm maximum to the last digit", () => {
    expect(record.worstCpuCompensatedErrorMetres).toBe(p719.worstCompensatedError);
  });

  it("keeps the plain arm failing, so the comparison is not vacuous", () => {
    // If a future change made the plain arm pass, this task's premise would be
    // gone and a green run here would mean nothing.
    expect(record.worstCpuPlainErrorMetres).toBeGreaterThan(record.absoluteBudgetMetres);
  });
});

describe("P0.136's criterion is met on the device, in both of its clauses", () => {
  it("clause 1: the device reproduces the CPU compensated arm", () => {
    expect(record.worstUlpVsCpuCompensated).toBeLessThanOrEqual(record.ulpBudget);
    expect(record.identicalRanges).toBe(record.count);
    expect(record.impactedMismatches).toBe(0);
  });

  it("clause 2: the batch maximum falls below the 1e-3 m bar", () => {
    expect(record.worstDeviceErrorMetres).toBeLessThan(record.absoluteBudgetMetres);
  });

  it("measured a batch in which every member actually landed", () => {
    // A non-impacting member returns range 0 on both arms and contributes a
    // perfect 0.0 while testing nothing -- the inert-instrument shape P7.19's
    // study names and refuses.
    expect(record.impactedOnReference).toBe(record.count);
  });

  it("improves on the plain arm by more than two orders of magnitude", () => {
    // Guards against a "compensated" march that is quietly the plain one: that
    // would still clear no bar, but a future weakening that merely halved the
    // error would slip past a pass/fail gate. It does not here -- 490x.
    const ratio = record.worstCpuPlainErrorMetres / record.worstDeviceErrorMetres;
    expect(ratio).toBeGreaterThan(100);
  });
});

describe("the record says what it was measured on, and does not overstate it", () => {
  it("records the adapter and labels a software one as software", () => {
    expect(record.adapter.architecture).not.toBeNull();
    if (record.adapter.architecture === "swiftshader") {
      expect(record.adapterClass).toBe("software");
    }
  });

  it("carries the note distinguishing this criterion from P7.20's", () => {
    // The distinction is load-bearing and easy to lose: an arithmetic result is
    // portable across adapters, a throughput figure is not. A future reader who
    // drops this note will be one step from publishing a rate from here.
    const joined = record.notes.join(" ");
    expect(joined).toContain("arithmetic");
    expect(joined).toMatch(/P7\.20/);
  });

  it("records that the default kernel text did not move", () => {
    const joined = record.notes.join(" ");
    expect(joined).toMatch(/byte-identical/);
  });
});
