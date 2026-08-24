// P6.06 validation: "matches offline numpy on fixture to 1e-10 (mean/var), quantile ±0.5%".
//
// This is the offline-numpy half of the criterion. `scripts/generate-mc-moments-fixture.py`
// draws a deterministic sample with numpy's Mersenne Twister, computes the reference mean,
// sample variance and five percentiles with numpy, and commits both the sample and the
// references to `mc-moments-fixture.json`. This suite reads that file and holds the
// TypeScript estimators to the numpy numbers on exactly the values numpy saw.
//
// The sample is committed rather than regenerated here because the criterion is agreement
// with numpy on the SAME values. Reproducing numpy's RNG in TypeScript would test an RNG
// port, not the moment estimators — and if that port drifted, this suite would fail while
// blaming the estimators. Reading a fixture keeps the thing under test isolated.
//
// The fixture spans three column shapes on purpose (see the generator's docstring): a
// well-behaved normal, the mean-600×-spread cancellation case that is the whole reason
// Welford is used over `sumSquares`, and a right-skewed lognormal where the P² markers are
// unevenly spaced. If a future run regenerates the fixture, the reference numbers change and
// this suite is the record of what they were — say so in the changelog when doing it.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { welfordMoments, P2QuantileEstimator, WelfordAccumulator } from "@ballista/analysis";

interface FixtureColumn {
  values: number[];
  count: number;
  mean: number;
  varianceSample: number;
  variancePopulation: number;
  stdSample: number;
  percentiles: number[];
}

interface Fixture {
  generatedBy: string;
  numpyVersion: string;
  quantiles: number[];
  columns: Record<string, FixtureColumn>;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE: Fixture = JSON.parse(
  readFileSync(resolve(HERE, "mc-moments-fixture.json"), "utf8"),
) as Fixture;

const COLUMN_NAMES = Object.keys(FIXTURE.columns);

describe("P6.06 streaming moments vs offline numpy", () => {
  it("the fixture is present and shaped as the generator promises", () => {
    // A guard on the guard: an empty or truncated fixture would let every case
    // below pass vacuously.
    expect(COLUMN_NAMES.length).toBeGreaterThanOrEqual(3);
    expect(FIXTURE.quantiles).toEqual([0.05, 0.25, 0.5, 0.75, 0.95]);
    for (const name of COLUMN_NAMES) {
      const col = FIXTURE.columns[name]!;
      expect(col.values.length).toBe(col.count);
      expect(col.count).toBeGreaterThanOrEqual(1000);
      expect(col.percentiles.length).toBe(FIXTURE.quantiles.length);
    }
  });

  it.each(COLUMN_NAMES)("%s: Welford mean matches numpy to 1e-10 relative", (name) => {
    const col = FIXTURE.columns[name]!;
    const { mean } = welfordMoments(col.values);
    expect(Math.abs(mean - col.mean) / Math.abs(col.mean)).toBeLessThan(1e-10);
  });

  it.each(COLUMN_NAMES)(
    "%s: Welford sample variance matches numpy (ddof=1) to 1e-10 relative",
    (name) => {
      const col = FIXTURE.columns[name]!;
      const { variance } = welfordMoments(col.values);
      // ddof=1 is the Bessel-corrected variance WelfordAccumulator.variance
      // returns; the fixture carries ddof=0 too so a convention mismatch would
      // read as "matches the other one" rather than as an unexplained miss.
      expect(Math.abs(variance - col.varianceSample) / col.varianceSample).toBeLessThan(1e-10);
      expect(Math.abs(variance - col.variancePopulation) / col.variancePopulation).toBeGreaterThan(
        1e-6,
      );
    },
  );

  it.each(COLUMN_NAMES)("%s: P² quantile estimates land within 0.5% of numpy", (name) => {
    const col = FIXTURE.columns[name]!;
    FIXTURE.quantiles.forEach((p, i) => {
      const estimator = new P2QuantileEstimator(p);
      for (const v of col.values) estimator.push(v);
      const reference = col.percentiles[i]!;
      const relative = Math.abs(estimator.value - reference) / Math.abs(reference);
      expect(relative, `${name} p=${p}: ${estimator.value} vs numpy ${reference}`).toBeLessThan(
        0.005,
      );
    });
  });

  it("Welford's chunk merge reaches the same mean/variance as a single pass, to 1e-10", () => {
    // The parallel-reduction path (a worker pool reducing per chunk, then
    // merging). Split every column into three chunks, merge in canonical
    // order, and check against the whole-stream Welford — the property P6.10's
    // parallel MC batches rely on.
    for (const name of COLUMN_NAMES) {
      const values = FIXTURE.columns[name]!.values;
      const whole = new WelfordAccumulator();
      for (const v of values) whole.push(v);

      const bounds = [
        0,
        Math.floor(values.length / 3),
        Math.floor((2 * values.length) / 3),
        values.length,
      ];
      const merged = new WelfordAccumulator();
      for (let c = 0; c < 3; c++) {
        const part = new WelfordAccumulator();
        for (let i = bounds[c]!; i < bounds[c + 1]!; i++) part.push(values[i]!);
        merged.merge(part);
      }
      expect(merged.count).toBe(whole.count);
      expect(Math.abs(merged.mean - whole.mean) / Math.abs(whole.mean)).toBeLessThan(1e-10);
      expect(Math.abs(merged.variance - whole.variance) / whole.variance).toBeLessThan(1e-10);
    }
  });
});
