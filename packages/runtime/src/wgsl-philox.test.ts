import { describe, expect, it } from "vitest";

import { u32ToUnitFloatF32 } from "@ballista/engine";

import { WGSL_PHILOX_FNS, WGSL_PHILOX_REPLICATE_COUNTER } from "./wgsl-philox.js";
import { buildWgslRk4KernelSource, WGSL_RK4_KERNEL_SOURCE } from "./wgsl-rk4-kernel.js";
import { buildWgslObservablesKernelSource } from "./wgsl-observables-kernel.js";

/**
 * These assertions are the half a device run is blind to.
 *
 * A device compares numbers. Given a GPU/CPU agreement check, a *subtly* wrong
 * shader mostly shows up as a disagreement and is caught — but three things
 * here cannot be caught that way at all: whether adding this constant disturbed
 * the text other recorded measurements were taken on (a device that agrees with
 * itself says nothing about that), whether the structure that makes the
 * arithmetic right is actually present rather than coincidentally producing the
 * right numbers on the counters that happened to be sampled, and whether the
 * range is genuinely half-open at the one word in 2^32 where it might not be.
 */

describe("adding an RNG did not move the text any recorded measurement was taken on", () => {
  /**
   * P0.136 established the shape this constant follows — an opt-in constant
   * rather than an append to the shared fragment — precisely so this assertion
   * can hold. A kernel that does not ask for an RNG must interpolate exactly the
   * characters it did before, or P7.14's bit-identical result, P7.16's 0-ULP
   * observables agreement and P7.17's budgets all silently stop describing the
   * shader that ships.
   *
   * `wgsl-planar-physics.test.ts` pins the digests; this pins the *containment*,
   * which is the part specific to adding a new fragment.
   */
  it("keeps the RNG out of every default kernel build", () => {
    const builds = [
      WGSL_RK4_KERNEL_SOURCE,
      buildWgslRk4KernelSource(1),
      buildWgslRk4KernelSource(64),
      buildWgslRk4KernelSource(256),
      buildWgslObservablesKernelSource(1),
      buildWgslObservablesKernelSource(64),
      buildWgslObservablesKernelSource(256),
    ];

    for (const source of builds) {
      expect(source).not.toContain("philox");
      expect(source).not.toContain("Philox");
      expect(source).not.toContain("PHILOX");
    }
  });
});

describe("the WGSL generator has the structure that makes it Philox4x32-10", () => {
  it("declares the two round multipliers and the two Weyl bumps", () => {
    expect(WGSL_PHILOX_FNS).toContain("const PHILOX_M0: u32 = 0xD2511F53u;");
    expect(WGSL_PHILOX_FNS).toContain("const PHILOX_M1: u32 = 0xCD9E8D57u;");
    expect(WGSL_PHILOX_FNS).toContain("const PHILOX_W0: u32 = 0x9E3779B9u;");
    expect(WGSL_PHILOX_FNS).toContain("const PHILOX_W1: u32 = 0xBB67AE85u;");
  });

  /**
   * Ten rounds with the key bumped between them, not before the first. The loop
   * starts at 1 because round 0 is taken outside it — so a change to either the
   * bound or the pre-loop call is a change to the round count, and both are
   * pinned.
   */
  it("runs ten rounds with the first outside the bump loop", () => {
    expect(WGSL_PHILOX_FNS).toContain("var c = philox4x32Round(ctr, key);");
    expect(WGSL_PHILOX_FNS).toContain("for (var r = 1u; r < 10u; r = r + 1u) {");
    expect(WGSL_PHILOX_FNS).toContain("k = vec2<u32>(k.x + PHILOX_W0, k.y + PHILOX_W1);");
  });

  it("applies the round permutation, including which multiply feeds which lane", () => {
    expect(WGSL_PHILOX_FNS).toContain("let m0 = philoxMulhilo32(PHILOX_M0, ctr.x);");
    expect(WGSL_PHILOX_FNS).toContain("let m1 = philoxMulhilo32(PHILOX_M1, ctr.z);");
    expect(WGSL_PHILOX_FNS).toContain(
      "return vec4<u32>((m1.x ^ ctr.y) ^ key.x, m1.y, (m0.x ^ ctr.w) ^ key.y, m0.y);",
    );
  });

  /**
   * The high word comes from 16-bit halves and the low word from the wrapping
   * product. Checking the halves are present matters because the alternative a
   * reader might reach for — `a * b` for both words — is silently wrong in a way
   * no amount of sampling reveals: the low word would be right every time.
   */
  it("assembles the high word from 16-bit halves and takes the low word from the wrapping product", () => {
    expect(WGSL_PHILOX_FNS).toContain("let mid = ((ll >> 16u) + (lh & 0xFFFFu)) + (hl & 0xFFFFu);");
    expect(WGSL_PHILOX_FNS).toContain("(((hh + (lh >> 16u)) + (hl >> 16u)) + (mid >> 16u))");
    expect(WGSL_PHILOX_FNS).toContain("return vec2<u32>(hi, a * b);");
  });

  /**
   * The conversion that must not be `f32(word) / 4294967296.0`. This is asserted
   * on the text rather than only on the CPU twin because it is the exact line a
   * future reader is most likely to "simplify" — it looks like an awkward
   * spelling of an obvious thing, and the obvious thing is wrong.
   */
  it("converts through the top 24 bits, never the whole word", () => {
    expect(WGSL_PHILOX_FNS).toContain("return f32(word >> 8u) * (1.0 / 16777216.0);");

    // Comment lines are stripped before this assertion, and deliberately: the
    // comment above that line *names* the wrong divisor in order to say not to
    // use it, and a bare substring check on the whole fragment fires on the
    // warning as readily as on the mistake. It did, the first time this ran.
    const code = WGSL_PHILOX_FNS.split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    expect(code).not.toContain("4294967296.0");
  });

  it("reads and writes no binding, so any kernel can interpolate it", () => {
    for (const fragment of [WGSL_PHILOX_FNS, WGSL_PHILOX_REPLICATE_COUNTER]) {
      expect(fragment).not.toContain("@group");
      expect(fragment).not.toContain("@binding");
      expect(fragment).not.toContain("@compute");
      expect(fragment).not.toContain("storage");
    }
  });

  it("states the replicate-counter convention the CPU side uses", () => {
    expect(WGSL_PHILOX_REPLICATE_COUNTER).toContain(
      "return vec4<u32>(replicateIndex, 0u, 0u, 0u);",
    );
  });
});

describe("u32ToUnitFloatF32 is the CPU spelling of philoxUnitFloat", () => {
  /**
   * The bug this exists to prevent, stated as the test that catches it: the
   * naive conversion returns exactly 1.0 for the largest word, because `f32`
   * rounds 0xFFFFFFFF up to 2^32. Asserting the naive result really is 1.0 keeps
   * the rationale honest — without it, the comment above the function is just a
   * claim.
   */
  it("would return exactly 1.0 through the whole word, which is why it does not", () => {
    expect(Math.fround(0xffffffff) / 4294967296).toBe(1);
    expect(u32ToUnitFloatF32(0xffffffff)).toBeLessThan(1);
  });

  it("stays in [0, 1) across the whole word range", () => {
    const words = [0, 1, 0xff, 0x100, 0x7fffffff, 0x80000000, 0xfffffeff, 0xffffffff];
    for (const w of words) {
      const u = u32ToUnitFloatF32(w);
      expect(u, `word 0x${w.toString(16)}`).toBeGreaterThanOrEqual(0);
      expect(u, `word 0x${w.toString(16)}`).toBeLessThan(1);
    }
  });

  it("is exactly representable in f32, so the two arms cannot differ by rounding", () => {
    for (let i = 0; i < 10000; i += 1) {
      const w = (Math.imul(i, 2654435761) >>> 0) ^ 0x9e3779b9;
      const u = u32ToUnitFloatF32(w);
      expect(Math.fround(u)).toBe(u);
    }
  });

  it("peaks at (2^24 - 1) / 2^24", () => {
    expect(u32ToUnitFloatF32(0xffffffff)).toBe((16777216 - 1) / 16777216);
  });
});
