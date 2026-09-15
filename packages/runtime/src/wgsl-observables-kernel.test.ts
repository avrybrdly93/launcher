import { describe, expect, it } from "vitest";

import {
  buildWgslObservablesKernelSource,
  WGSL_IMPACT_BISECTION_STEPS,
  WGSL_OBSERVABLE_BINDINGS,
  WGSL_OBSERVABLE_DIM,
  WGSL_OBSERVABLE_ENTRY_POINT,
  WGSL_OBSERVABLE_OFFSETS,
  WGSL_OBSERVABLES_KERNEL_SOURCE,
} from "./wgsl-observables-kernel.js";
import { IMPACT_BISECTION_STEPS } from "./planar-observables-reduction.js";
import { WGSL_WORKGROUP_SIZE } from "./wgsl-rk4-kernel.js";

/** Comment-free view of the shader, so a phrase in prose cannot satisfy a test. */
const CODE = WGSL_OBSERVABLES_KERNEL_SOURCE.split("\n")
  .map((line) => line.replace(/\/\/.*$/, ""))
  .join("\n");

/** The kernel body after the shared physics, i.e. the code P7.16 actually adds. */
const ENTRY = CODE.slice(CODE.indexOf("@compute"));

describe("the binding layout is internally consistent", () => {
  it("assigns four distinct bindings at 0..3", () => {
    const indices = Object.values(WGSL_OBSERVABLE_BINDINGS);
    expect(new Set(indices).size).toBe(indices.length);
    expect([...indices].sort()).toEqual([0, 1, 2, 3]);
  });

  it("declares every binding in the shader at the index the constant names", () => {
    const declared = new Map<string, number>();
    for (const match of CODE.matchAll(/@group\(0\) @binding\((\d+)\) var<[^>]*>\s*(\w+)\s*:/g)) {
      declared.set(match[2]!, Number(match[1]));
    }
    for (const [name, index] of Object.entries(WGSL_OBSERVABLE_BINDINGS)) {
      expect(declared.get(name)).toBe(index);
    }
  });

  it("writes only to observables", () => {
    const written = new Set(
      [...ENTRY.matchAll(/^\s*(\w+)\[[^\]]*\]\s*=/gm)].map((match) => match[1]!),
    );
    expect(written).toEqual(new Set(["observables"]));
  });

  it("takes the observables buffer as the only read_write storage binding", () => {
    const readWrite = [
      ...CODE.matchAll(/@group\(0\) @binding\(\d+\) var<storage, read_write>\s*(\w+)/g),
    ].map((match) => match[1]!);
    expect(readWrite).toEqual(["observables"]);
  });
});

describe("the record layout matches the constants the host packs against", () => {
  it("indexes the output by the exported dimension", () => {
    expect(ENTRY).toContain(`index * ${WGSL_OBSERVABLE_DIM}u`);
  });

  it("writes exactly one value at every declared offset, and no others", () => {
    const offsets = [...ENTRY.matchAll(/observables\[obase \+ (\d+)u\]\s*=/g)].map((m) =>
      Number(m[1]),
    );
    expect([...offsets].sort((a, b) => a - b)).toEqual(
      Object.values(WGSL_OBSERVABLE_OFFSETS).sort((a, b) => a - b),
    );
    expect(offsets).toHaveLength(WGSL_OBSERVABLE_DIM);
  });

  it("names five distinct offsets spanning 0..dim-1", () => {
    const values = Object.values(WGSL_OBSERVABLE_OFFSETS);
    expect(new Set(values).size).toBe(WGSL_OBSERVABLE_DIM);
    expect(Math.min(...values)).toBe(0);
    expect(Math.max(...values)).toBe(WGSL_OBSERVABLE_DIM - 1);
  });
});

describe("the reduction is divergence-free, which the whole kernel choice rests on", () => {
  it("has exactly one branch in the entry point, the range guard", () => {
    const ifs = [...ENTRY.matchAll(/\bif\s*\(/g)];
    expect(ifs).toHaveLength(1);
    expect(ENTRY).toContain("if (index >= config.count)");
  });

  it("contains no early exit inside either loop", () => {
    const loops = [...ENTRY.matchAll(/for \(var[\s\S]*?\n {2}\}/g)].map((m) => m[0]);
    expect(loops.length).toBeGreaterThanOrEqual(2);
    for (const loop of loops) {
      expect(loop).not.toMatch(/\breturn\b/);
      expect(loop).not.toMatch(/\bbreak\b/);
      expect(loop).not.toMatch(/\bcontinue\b/);
      expect(loop).not.toMatch(/\bdiscard\b/);
    }
  });

  it("drives the step loop from a uniform trip count, not from state", () => {
    expect(ENTRY).toContain("for (var n: u32 = 0u; n < config.steps; n = n + 1u)");
  });

  it("drives the bisection from a literal trip count, not a tolerance", () => {
    expect(ENTRY).toContain(
      `for (var i: u32 = 0u; i < ${WGSL_IMPACT_BISECTION_STEPS}u; i = i + 1u)`,
    );
  });

  it("expresses every per-thread decision as select()", () => {
    // The capture, the apex update and the bisection bracket are all conditional
    // on per-thread state; if any of them were an `if`, the count above would
    // have caught it, and this pins that they are present as selects at all
    // rather than having been silently dropped.
    expect([...ENTRY.matchAll(/\bselect\(/g)].length).toBeGreaterThanOrEqual(15);
  });

  it("uses no dynamically indexed local array for the captured bracket", () => {
    // A `var bracket: array<f32, 10>` indexed by a computed value would defeat
    // the uniformity analysis; the bracket is held as named scalars instead.
    expect(ENTRY).not.toMatch(/var\s+\w+\s*:\s*array</);
  });
});

describe("the reduction does not lean on trap or NaN semantics", () => {
  it("guards the discriminant separately rather than relying on sqrt(negative)", () => {
    expect(CODE).toContain("(disc >= 0.0)");
  });

  it("guards every divisor it could divide by zero", () => {
    expect(CODE).toContain("(b != 0.0)");
    expect(CODE).toContain("(a != 0.0)");
    expect(CODE).toContain("(q != 0.0)");
  });
});

describe("the arithmetic matches the CPU reference's operation order", () => {
  it("groups the Hermite coefficients as the reference associates them", () => {
    expect(CODE).toContain("let c0 = ((2.0 * t3) - (3.0 * t2)) + 1.0;");
    expect(CODE).toContain("let c1 = (t3 - (2.0 * t2)) + theta;");
    expect(CODE).toContain("let c2 = (-(2.0 * t3)) + (3.0 * t2);");
    expect(CODE).toContain("let c3 = t3 - t2;");
    expect(CODE).toContain("return (((c0 * y0) + ((h * c1) * d0)) + (c2 * y1)) + ((h * c3) * d1);");
  });

  it("keeps the sign-stable quadratic form rather than the textbook one", () => {
    expect(CODE).toContain("let q = (-0.5) * (b + signedDisc);");
    expect(CODE).toContain("select(-sqrtDisc, sqrtDisc, b >= 0.0)");
  });

  it("associates b as (2 * h) * d0, which is how the reference parses 2 * h * d0", () => {
    expect(CODE).toContain("((2.0 * h) * d0)");
  });

  it("reconstructs the clock from n rather than accumulating it", () => {
    expect(ENTRY).toContain("let tPrev = f32(n) * h;");
    expect(ENTRY).toContain("let tNext = f32(n + 1u) * h;");
    expect(ENTRY).toContain("let hStep = tNext - tPrev;");
    // An accumulated clock would drift against a reference that does not.
    expect(ENTRY).not.toMatch(/\bt\s*=\s*t\s*\+\s*h\b/);
  });

  it("takes the same bisection count as the CPU reference", () => {
    expect(WGSL_IMPACT_BISECTION_STEPS).toBe(IMPACT_BISECTION_STEPS);
  });
});

describe("the capture semantics are the reference's", () => {
  it("refines downward crossings of v_y only", () => {
    expect(ENTRY).toContain("(vy0 >= 0.0) && (vy1 < 0.0)");
  });

  it("captures the first ground crossing only, testing impacted before setting it", () => {
    const captureLine = ENTRY.slice(ENTRY.indexOf("let crossing ="));
    expect(captureLine).toContain("(impacted < 0.5)");
    // impacted must be assigned after every select that reads it, or the
    // bracket would be overwritten on the step after the crossing.
    const crossingIdx = ENTRY.indexOf("impacted = select(impacted, 1.0, crossing);");
    const lastCapture = ENTRY.lastIndexOf("impVx1 = select(");
    expect(crossingIdx).toBeGreaterThan(lastCapture);
  });

  it("keeps the launch point and the final row as apex candidates", () => {
    expect(ENTRY).toContain("var bestHeight = y.y;");
    expect(ENTRY).toContain("let takeFinal = y.y > bestHeight;");
  });

  it("zeroes range and impact time when nothing was captured", () => {
    expect(ENTRY).toContain("select(0.0, abs(impactX - x0), didImpact)");
    expect(ENTRY).toContain("select(0.0, impT + (theta * impH), didImpact)");
  });
});

describe("the kernel is single precision throughout", () => {
  it("declares no f16 or f64 anywhere", () => {
    expect(CODE).not.toMatch(/\bf16\b/);
    expect(CODE).not.toMatch(/\bf64\b/);
  });

  it("types the state as vec4<f32>", () => {
    expect(CODE).toContain("var y = vec4<f32>(");
  });
});

describe("buildWgslObservablesKernelSource", () => {
  it("reproduces the exported default character for character", () => {
    expect(buildWgslObservablesKernelSource(WGSL_WORKGROUP_SIZE)).toBe(
      WGSL_OBSERVABLES_KERNEL_SOURCE,
    );
  });

  it("differs from the default in the workgroup literal and nowhere else", () => {
    const swept = buildWgslObservablesKernelSource(128);
    expect(swept).not.toBe(WGSL_OBSERVABLES_KERNEL_SOURCE);
    expect(swept.replace("@workgroup_size(128)", `@workgroup_size(${WGSL_WORKGROUP_SIZE})`)).toBe(
      WGSL_OBSERVABLES_KERNEL_SOURCE,
    );
  });

  it("declares the size it was asked for, and the entry point the constant names", () => {
    expect(buildWgslObservablesKernelSource(32)).toContain("@workgroup_size(32)");
    expect(CODE).toContain(`fn ${WGSL_OBSERVABLE_ENTRY_POINT}(`);
  });

  it("rejects a size that is not a positive integer", () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => buildWgslObservablesKernelSource(bad)).toThrow(RangeError);
    }
  });

  it("guards the out-of-range thread, since count need not fill the last workgroup", () => {
    expect(ENTRY).toContain("if (index >= config.count)");
    expect(ENTRY).toContain("return;");
  });
});

/**
 * P0.136's builder half.
 *
 * The digest below was computed from the source as it stood in the commit
 * *before* the `compensated` option existed, and the three sizes were compared
 * string-for-string against that build rather than eyeballed. That is what
 * turns "the default is unchanged" from a claim into a check -- and it is the
 * claim the whole design rests on, since P7.16's 0-ULP agreement and P7.17's
 * budgets were measured against this exact text.
 *
 * **If this digest fails, those recorded measurements no longer describe the
 * shader that ships.** Re-measure with `pnpm check:gpu-observables`; do not
 * update the digest.
 */
const PRE_P0136_OBSERVABLES_SHA256 =
  "b2fe7f3eb256aaa50ef06057fddcbe95286185cb4ef9d716ecb5aa913f277e1b";

describe("the compensated option leaves the default build byte-identical", () => {
  it("still produces the text the recorded device measurements were taken on", async () => {
    const { createHash } = await import("node:crypto");
    const digest = createHash("sha256").update(buildWgslObservablesKernelSource(64)).digest("hex");
    expect(digest).toBe(PRE_P0136_OBSERVABLES_SHA256);
  });

  it("treats an omitted option, an empty object and an explicit false as the same build", () => {
    // Three spellings of "default" that could plausibly diverge if the option
    // were ever read with `||` instead of `??`.
    const base = buildWgslObservablesKernelSource(64);
    expect(buildWgslObservablesKernelSource(64, {})).toBe(base);
    expect(buildWgslObservablesKernelSource(64, { compensated: false })).toBe(base);
  });

  it("keeps the default free of every compensated fragment", () => {
    const base = buildWgslObservablesKernelSource(64);
    expect(base).not.toContain("rk4StepCompensated");
    expect(base).not.toContain("CompensatedState");
    expect(base).not.toContain("var comp =");
  });
});

describe("the compensated build marches on the two-float accumulator", () => {
  const comp = buildWgslObservablesKernelSource(64, { compensated: true });

  it("declares the residual once, zero-initialised, per thread", () => {
    // Inside the entry point, after the early-return guard, so a thread that
    // returns never touches it.
    expect(comp).toContain("var comp = vec4<f32>(0.0);");
    expect(comp.match(/var comp = /g)).toHaveLength(1);
  });

  it("steps through rk4StepCompensated rather than rk4Step", () => {
    expect(comp).toContain("let stepped = rk4StepCompensated(y, comp, h, p);");
    expect(comp).toContain("let next = stepped.y;");
    // The plain step function is still *declared* -- the shared fragment is
    // interpolated whole -- but the march must not call it.
    expect(comp).not.toContain("let next = rk4Step(y, h, p);");
  });

  it("carries the residual across steps instead of discarding it", () => {
    // Without this line the accumulator resets every step and the mode is
    // compensated in name only, which no numeric comparison would flag as an
    // error -- it would simply look like a disappointing improvement.
    expect(comp).toContain("comp = stepped.c;");
  });

  it("declares rhs exactly once, and rk4Step exactly once, despite two step functions", () => {
    expect(comp.match(/fn rhs\(/g)).toHaveLength(1);
    expect(comp.match(/fn rk4Step\(/g)).toHaveLength(1);
    expect(comp.match(/fn rk4StepCompensated\(/g)).toHaveLength(1);
  });

  it("leaves the reduction, the bisection and the bindings untouched", () => {
    // Only the march changes. Everything downstream of it reads `y` and knows
    // nothing about how it was accumulated.
    const base = buildWgslObservablesKernelSource(64);
    const tail = (s: string): string => s.slice(s.indexOf("  // One bisection, after the loop"));
    expect(tail(comp)).toBe(tail(base));
  });

  it("still rejects a bad workgroup size in compensated mode", () => {
    expect(() => buildWgslObservablesKernelSource(0, { compensated: true })).toThrow(RangeError);
  });
});
