import { describe, expect, it } from "vitest";
import {
  mulhilo32,
  philox4x32,
  philox4x32BumpKey,
  philox4x32Round,
  philox4x32Uniforms,
  PHILOX_ROUNDS,
  replicateCounter,
  u32ToUnitFloat,
  type PhiloxCounter,
  type PhiloxKey,
} from "./philox.js";

/**
 * P7.21's criterion has two clauses — "Philox streams pass statistical tests"
 * and "replicate determinism by counter" — and they are different claims, so
 * they are asserted in separate blocks below and reported separately.
 *
 * A generator can satisfy either one while failing the other: a stateful PRNG
 * indexed by a shared cursor passes every statistical test and has no counter
 * determinism at all, and a constant function is perfectly counter-determined
 * and statistically worthless. Collapsing the two into one "the RNG works"
 * block would hide exactly that.
 */

/** Hex, for the known-answer vectors, which are published in hex. */
function hex(ctr: PhiloxCounter): string {
  return ctr.map((w) => w.toString(16).padStart(8, "0")).join(" ");
}

describe("mulhilo32", () => {
  /**
   * The one operation that cannot be checked by inspection: JavaScript numbers
   * cannot hold a 64-bit product, so the high word is assembled from 16-bit
   * halves and a carry. BigInt *can* hold it, which makes it an independent
   * oracle rather than a restatement of the code under test.
   */
  it("agrees with exact 64-bit arithmetic on every product it is asked for", () => {
    const pairs: Array<[number, number]> = [
      [0, 0],
      [0, 0xffffffff],
      [0xffffffff, 0],
      [1, 0xffffffff],
      [0xffffffff, 0xffffffff],
      [0xd2511f53, 0xffffffff],
      [0xcd9e8d57, 0xffffffff],
      [0x10000, 0x10000],
      [0xffff, 0xffff],
      [0x80000000, 2],
    ];

    // Deterministic spread over the space as well as the corners: a carry bug
    // that only fires when the middle term overflows would sit between the
    // hand-picked pairs, not on them.
    let x = 123456789;
    for (let i = 0; i < 20000; i += 1) {
      x = (Math.imul(x, 1103515245) + 12345) >>> 0;
      const y = (Math.imul(x, 1103515245) + 12345) >>> 0;
      pairs.push([x, y]);
    }

    for (const [a, b] of pairs) {
      const exact = BigInt(a >>> 0) * BigInt(b >>> 0);
      const got = mulhilo32(a, b);
      expect(got.hi, `hi of ${a} * ${b}`).toBe(Number(exact >> 32n));
      expect(got.lo, `lo of ${a} * ${b}`).toBe(Number(exact & 0xffffffffn));
    }
  });
});

describe("Philox4x32-10 against published known-answer vectors", () => {
  /**
   * This module was written from the algorithm's specification, not
   * transcribed from a reference implementation, so these vectors are a real
   * cross-check rather than a tautology: the code and the expected words came
   * from different places, and an implementation that reproduces a vector it
   * was not derived from agrees with the standard.
   *
   * If one of these ever fails, the vector is not the thing to edit.
   */
  const KAT: ReadonlyArray<{ name: string; ctr: PhiloxCounter; key: PhiloxKey; want: string }> = [
    {
      name: "all-zero counter and key",
      ctr: [0x00000000, 0x00000000, 0x00000000, 0x00000000],
      key: [0x00000000, 0x00000000],
      want: "6627e8d5 e169c58d bc57ac4c 9b00dbd8",
    },
    {
      name: "all-ones counter and key",
      ctr: [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff],
      key: [0xffffffff, 0xffffffff],
      want: "408f276d 41c83b0e a20bc7c6 6d5451fd",
    },
    {
      name: "digits of pi and e",
      ctr: [0x243f6a88, 0x85a308d3, 0x13198a2e, 0x03707344],
      key: [0xa4093822, 0x299f31d0],
      want: "d16cfe09 94fdcceb 5001e420 24126ea1",
    },
  ];

  for (const { name, ctr, key, want } of KAT) {
    it(`reproduces the vector for the ${name}`, () => {
      expect(hex(philox4x32(ctr, key))).toBe(want);
    });
  }

  it("uses ten rounds by default", () => {
    expect(PHILOX_ROUNDS).toBe(10);
    expect(philox4x32([1, 2, 3, 4], [5, 6])).toEqual(philox4x32([1, 2, 3, 4], [5, 6], 10));
  });

  /**
   * The first round must see the key exactly as supplied — the bump happens
   * *between* rounds, so ten rounds bump nine times. Writing the loop with the
   * bump at the top of every iteration instead of after the first is the
   * natural slip, and it produces a generator that is still perfectly
   * well-behaved statistically while agreeing with nobody. The KAT vectors
   * above would catch it; this catches it at the round that went wrong.
   */
  it("applies the key bump between rounds and not before the first", () => {
    const ctr: PhiloxCounter = [0x243f6a88, 0x85a308d3, 0x13198a2e, 0x03707344];
    const key: PhiloxKey = [0xa4093822, 0x299f31d0];

    expect(philox4x32(ctr, key, 1)).toEqual(philox4x32Round(ctr, key));

    const afterTwo = philox4x32Round(philox4x32Round(ctr, key), philox4x32BumpKey(key));
    expect(philox4x32(ctr, key, 2)).toEqual(afterTwo);
  });

  it("returns unsigned 32-bit words, never a negative or a fractional one", () => {
    for (let i = 0; i < 256; i += 1) {
      for (const w of philox4x32([i, i * 7, i * 13, i * 29], [i * 3, i * 5])) {
        expect(Number.isInteger(w)).toBe(true);
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(0xffffffff);
      }
    }
  });
});

describe("Philox streams pass statistical tests", () => {
  /**
   * One long stream: replicate counters 0..N-1 under a fixed key, flattened.
   *
   * A `Float64Array` because 262144 doubles in a boxed array is wasteful, and
   * because every statistic below is computed by *iteration* rather than by
   * indexing — `noUncheckedIndexedAccess` is on in this repo, and a run of
   * `?? 0` fallbacks in the middle of a correlation sum would be noise that
   * reads like a guard against something.
   */
  function stream(n: number, key: PhiloxKey = [0x1234abcd, 0x5678ef01]): Float64Array {
    const out = new Float64Array(n * 4);
    for (let i = 0; i < n; i += 1) out.set(philox4x32Uniforms(replicateCounter(i), key), i * 4);
    return out;
  }

  const N = 65536;
  const SAMPLES = stream(N); // 262144 uniforms

  /**
   * The 5% two-sided critical values used below are stated with their degrees
   * of freedom so a reader can check them rather than trust them. They are
   * loose on purpose: a test tight enough to fail one run in twenty is a test
   * that will fail CI, so these are the 99.9%-ish tails, and the generator is
   * deterministic anyway — this suite either always passes or always fails, and
   * a flake is impossible by construction.
   */

  it("is uniform on [0, 1): chi-square over 256 equal bins", () => {
    const bins = new Uint32Array(256);
    for (const u of SAMPLES) {
      const b = Math.min(255, Math.floor(u * 256));
      bins[b] = (bins[b] ?? 0) + 1;
    }

    const expected = SAMPLES.length / 256;
    let chi2 = 0;
    for (const observed of bins) chi2 += ((observed - expected) * (observed - expected)) / expected;

    // 255 degrees of freedom: mean 255, sd sqrt(510) ~= 22.6. The 0.999 upper
    // tail is near 350; 400 is comfortably past it and still far below what a
    // biased generator produces.
    expect(chi2).toBeLessThan(400);
    // A chi-square far *below* its mean is as diagnostic as one far above: it
    // means the bins are suspiciously even, which a real random stream is not.
    expect(chi2).toBeGreaterThan(150);
  });

  it("has the mean and variance of a uniform on [0, 1)", () => {
    const n = SAMPLES.length;
    const mean = SAMPLES.reduce((a, b) => a + b, 0) / n;
    const variance = SAMPLES.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n;

    // sd of the sample mean is sqrt(1/12/n) ~= 5.6e-4; 4e-3 is ~7 sigma.
    expect(mean).toBeCloseTo(0.5, 2);
    expect(Math.abs(mean - 0.5)).toBeLessThan(4e-3);
    expect(variance).toBeCloseTo(1 / 12, 3);
  });

  it("has no serial correlation at lag 1", () => {
    let sum = 0;
    let n = 0;
    let prev: number | undefined;
    for (const u of SAMPLES) {
      if (prev !== undefined) {
        sum += (prev - 0.5) * (u - 0.5);
        n += 1;
      }
      prev = u;
    }
    // Normalised by the variance of a uniform, 1/12.
    const r = sum / n / (1 / 12);
    // sd of r under independence is ~1/sqrt(n) ~= 2e-3; 0.01 is ~5 sigma.
    expect(Math.abs(r)).toBeLessThan(0.01);
  });

  /**
   * Every one of the 32 bit positions must be set about half the time. This is
   * the test that catches a generator which is uniform *as a float* while
   * leaking structure in its low bits — the failure mode of a linear generator
   * whose bottom bits have short periods, and the reason `u32ToUnitFloat`
   * divides the whole word rather than taking a slice of it.
   */
  it("sets every bit position about half the time", () => {
    const key: PhiloxKey = [0x0f0f0f0f, 0xf0f0f0f0];
    const counts = new Uint32Array(32);
    let words = 0;

    for (let i = 0; i < 20000; i += 1) {
      for (const w of philox4x32(replicateCounter(i), key)) {
        words += 1;
        for (let b = 0; b < 32; b += 1) {
          if ((w >>> b) & 1) counts[b] = (counts[b] ?? 0) + 1;
        }
      }
    }

    // sd of a count is sqrt(words)/2 ~= 141 on 80000 words; 0.01 * words is
    // 800, about 5.6 sigma.
    counts.forEach((count, b) => {
      expect(Math.abs(count / words - 0.5), `bit ${b}`).toBeLessThan(0.01);
    });
  });

  /**
   * Consecutive counters must not give correlated output. This is the property
   * the whole design rests on: the kernel hands invocation `i` the counter `i`,
   * so if neighbouring counters produced neighbouring numbers, every replicate
   * in a dispatch would be jittered almost identically and the ensemble would
   * be a single trajectory wearing 10000 hats.
   */
  it("decorrelates adjacent counters, which is what makes counter-per-replicate safe", () => {
    const key: PhiloxKey = [0xdeadbeef, 0x1badb002];
    const n = 50000;
    let sum = 0;
    for (let i = 0; i < n; i += 1) {
      const a = philox4x32Uniforms(replicateCounter(i), key)[0];
      const b = philox4x32Uniforms(replicateCounter(i + 1), key)[0];
      sum += (a - 0.5) * (b - 0.5);
    }
    expect(Math.abs(sum / n / (1 / 12))).toBeLessThan(0.02);
  });

  /**
   * Two keys are two independent streams. The MC pipeline uses this for the
   * study seed, so a correlation here would mean re-running a study with a new
   * seed reproduced the old study's draws.
   */
  it("gives uncorrelated streams for different keys", () => {
    const n = 50000;
    let sum = 0;
    for (let i = 0; i < n; i += 1) {
      const a = philox4x32Uniforms(replicateCounter(i), [1, 0])[0];
      const b = philox4x32Uniforms(replicateCounter(i), [2, 0])[0];
      sum += (a - 0.5) * (b - 0.5);
    }
    expect(Math.abs(sum / n / (1 / 12))).toBeLessThan(0.02);
  });

  it("gives four uncorrelated words per call, not one word repeated", () => {
    const key: PhiloxKey = [0xa5a5a5a5, 0x5a5a5a5a];
    const n = 50000;
    let s01 = 0;
    let s02 = 0;
    let s03 = 0;
    let s12 = 0;
    let s13 = 0;
    let s23 = 0;

    for (let i = 0; i < n; i += 1) {
      const [u0, u1, u2, u3] = philox4x32Uniforms(replicateCounter(i), key);
      const c0 = u0 - 0.5;
      const c1 = u1 - 0.5;
      const c2 = u2 - 0.5;
      const c3 = u3 - 0.5;
      s01 += c0 * c1;
      s02 += c0 * c2;
      s03 += c0 * c3;
      s12 += c1 * c2;
      s13 += c1 * c3;
      s23 += c2 * c3;
    }

    const r = (sum: number): number => Math.abs(sum / n / (1 / 12));
    expect(r(s01), "lanes 0/1").toBeLessThan(0.02);
    expect(r(s02), "lanes 0/2").toBeLessThan(0.02);
    expect(r(s03), "lanes 0/3").toBeLessThan(0.02);
    expect(r(s12), "lanes 1/2").toBeLessThan(0.02);
    expect(r(s13), "lanes 1/3").toBeLessThan(0.02);
    expect(r(s23), "lanes 2/3").toBeLessThan(0.02);
  });
});

describe("replicate determinism by counter", () => {
  const KEY: PhiloxKey = [0x13579bdf, 0x2468ace0];

  it("is a pure function of the counter and key", () => {
    const ctr: PhiloxCounter = [7, 0, 0, 0];
    const first = philox4x32(ctr, KEY);
    for (let i = 0; i < 100; i += 1) philox4x32([i, i, i, i], [i, i]);
    expect(philox4x32(ctr, KEY)).toEqual(first);
  });

  /**
   * The clause that actually matters for the kernel. A replicate's numbers must
   * not depend on the order its invocation happened to run in, on how many
   * other replicates ran, or on the workgroup size — none of which a shader can
   * control. Drawing them out of order and comparing against the in-order
   * sequence is the direct test, and it is a test a stateful generator cannot
   * pass.
   */
  it("gives a replicate the same draws whatever order replicates are evaluated in", () => {
    const n = 1024;
    const inOrder = new Map<number, readonly number[]>();
    for (let i = 0; i < n; i += 1) inOrder.set(i, philox4x32Uniforms(replicateCounter(i), KEY));

    // A deterministic permutation, so a failure reproduces. Sorting by a hash
    // of the index rather than shuffling in place: it is a permutation by
    // construction and needs no swap.
    const scramble = (i: number): number => Math.imul(i ^ 0x9e3779b9, 2654435761) >>> 0;
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => scramble(a) - scramble(b));
    expect(order).not.toEqual(Array.from({ length: n }, (_, i) => i));

    for (const i of order) {
      expect(philox4x32Uniforms(replicateCounter(i), KEY), `replicate ${i}`).toEqual(
        inOrder.get(i),
      );
    }
  });

  it("gives a replicate the same draws whether or not its neighbours are drawn at all", () => {
    const alone = philox4x32Uniforms(replicateCounter(512), KEY);
    for (let i = 0; i < 512; i += 1) philox4x32Uniforms(replicateCounter(i), KEY);
    expect(philox4x32Uniforms(replicateCounter(512), KEY)).toEqual(alone);
  });

  it("gives distinct replicates distinct draws", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20000; i += 1) seen.add(hex(philox4x32(replicateCounter(i), KEY)));
    expect(seen.size).toBe(20000);
  });

  it("puts the replicate index in the low counter word and zeroes the rest", () => {
    expect(replicateCounter(0)).toEqual([0, 0, 0, 0]);
    expect(replicateCounter(4097)).toEqual([4097, 0, 0, 0]);
    // The convention has to survive an index past 2^31, since the counter word
    // is unsigned and a signed shift would wrap it negative.
    expect(replicateCounter(0xfffffffe)).toEqual([0xfffffffe, 0, 0, 0]);
  });

  it("maps words into [0, 1) with 1 unreachable", () => {
    expect(u32ToUnitFloat(0)).toBe(0);
    expect(u32ToUnitFloat(0xffffffff)).toBeLessThan(1);
    expect(u32ToUnitFloat(0x80000000)).toBe(0.5);
    for (let i = 0; i < 5000; i += 1) {
      for (const u of philox4x32Uniforms(replicateCounter(i), KEY)) {
        expect(u).toBeGreaterThanOrEqual(0);
        expect(u).toBeLessThan(1);
      }
    }
  });
});
