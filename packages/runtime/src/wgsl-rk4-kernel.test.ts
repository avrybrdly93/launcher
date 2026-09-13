import { describe, expect, it } from "vitest";
import {
  WGSL_BINDINGS,
  WGSL_ENTRY_POINT,
  WGSL_PARAMS_STRIDE_BYTES,
  WGSL_PARAM_COUNT,
  WGSL_RK4_KERNEL_SOURCE,
  WGSL_STATE_DIM,
  WGSL_WORKGROUP_SIZE,
} from "./wgsl-rk4-kernel.js";

/**
 * **These are correspondence checks, not numerical validation, and the
 * distinction is the honest part of this file.**
 *
 * Nothing here has run on a GPU. There is no `navigator.gpu` in this container
 * and no adapter in this image, so the kernel's *numbers* are unverified and no
 * test below pretends otherwise -- P7.14 stays `in-progress` for exactly that
 * reason. What these tests can do is catch the defects that are visible in the
 * source: a wrong binding index, a `length()` builtin slipping in where the
 * error bound would differ, a `break` that would make the kernel divergent, a
 * drag factor that lost its parenthesisation, a workgroup size the shader text
 * and the exported constant disagree about.
 *
 * That is worth having. Every one of those would otherwise be found by a human
 * reading a shader on a machine with a GPU, weeks later, with the discrepancy
 * charged to precision rather than to a typo.
 */

/** The source with `//` comments stripped, so a check cannot pass on a comment. */
const CODE = WGSL_RK4_KERNEL_SOURCE.split("\n")
  .map((line) => line.replace(/\/\/.*$/, ""))
  .join("\n");

describe("the binding layout is internally consistent", () => {
  it("assigns four distinct bindings at 0..3", () => {
    const indices = Object.values(WGSL_BINDINGS);
    expect(new Set(indices).size).toBe(indices.length);
    expect([...indices].sort((a, b) => a - b)).toStrictEqual([0, 1, 2, 3]);
  });

  it("declares every binding in the shader at the index the constant names", () => {
    // The failure this catches is a renumbered binding in one place only, which
    // produces a pipeline that validates and then reads the wrong buffer.
    expect(CODE).toContain(
      `@group(0) @binding(${WGSL_BINDINGS.params}) var<storage, read> params: array<Params>;`,
    );
    expect(CODE).toContain(
      `@group(0) @binding(${WGSL_BINDINGS.initialStates}) var<storage, read> initialStates: array<f32>;`,
    );
    expect(CODE).toContain(
      `@group(0) @binding(${WGSL_BINDINGS.finalStates}) var<storage, read_write> finalStates: array<f32>;`,
    );
    expect(CODE).toContain(
      `@group(0) @binding(${WGSL_BINDINGS.config}) var<uniform> config: Config;`,
    );
  });

  it("writes only to finalStates", () => {
    // params and initialStates are `read`, not `read_write`. A kernel that
    // scribbled on its inputs would corrupt later dispatches sharing the buffer.
    expect(CODE).not.toContain("var<storage, read_write> params");
    expect(CODE).not.toContain("var<storage, read_write> initialStates");
  });

  it("gives Params exactly the fields the CPU reference and wasm-core name, in order", () => {
    const struct = /struct Params \{([^}]*)\}/.exec(CODE)?.[1] ?? "";
    const fields = struct
      .split(",")
      .map((f) => f.trim().split(":")[0]?.trim())
      .filter((f): f is string => Boolean(f));
    expect(fields).toStrictEqual(["mass", "area", "cd", "rho", "g", "windX", "windY"]);
    expect(fields).toHaveLength(WGSL_PARAM_COUNT);
  });

  it("derives the storage stride from the field count", () => {
    // The host must pack the parameter array to exactly this stride; a mismatch
    // yields silently wrong physics rather than an error.
    expect(WGSL_PARAMS_STRIDE_BYTES).toBe(WGSL_PARAM_COUNT * 4);
  });
});

describe("the entry point matches the exported constants", () => {
  it("declares the workgroup size the constant names", () => {
    expect(CODE).toContain(`@workgroup_size(${WGSL_WORKGROUP_SIZE})`);
  });

  it("declares the entry point the constant names, as a compute stage", () => {
    expect(CODE).toContain("@compute");
    expect(CODE).toContain(`fn ${WGSL_ENTRY_POINT}(`);
  });

  it("indexes state by the exported dimension", () => {
    expect(CODE).toContain(`let base = index * ${WGSL_STATE_DIM}u;`);
    for (let i = 0; i < WGSL_STATE_DIM; i++) {
      expect(CODE).toContain(`finalStates[base + ${i}u]`);
      expect(CODE).toContain(`initialStates[base + ${i}u]`);
    }
  });

  it("guards the out-of-range thread, since count need not be a multiple of the workgroup", () => {
    expect(CODE).toContain("if (index >= config.count)");
  });
});

describe("the arithmetic matches the CPU reference's operation order", () => {
  it("computes speedRel as sqrt(a*a + b*b) and never uses length()", () => {
    // `length()` is permitted a different error bound; a correctly-rounded one
    // would disagree with both the CPU reference and the WASM kernel, which
    // avoid Math.hypot for the same reason.
    expect(CODE).toContain("sqrt((vRelX * vRelX) + (vRelY * vRelY))");
    expect(CODE).not.toMatch(/\blength\s*\(/);
    expect(CODE).not.toMatch(/\bdistance\s*\(/);
  });

  it("keeps the drag factor left-associated verbatim", () => {
    expect(CODE).toContain("(((0.5 * p.rho) * p.cd) * p.area) * speedRel");
  });

  it("applies unary minus to mass before multiplying by g", () => {
    expect(CODE).toContain("(-p.mass) * p.g");
  });

  it("multiplies the zero tableau entries rather than skipping them", () => {
    // The stage rows are [], [0.5], [0, 0.5], [0, 0, 1]. Skipping the zeros is
    // the obvious hand-written RK4 and would diverge from the tableau-driven
    // CPU path on signed zero.
    expect(CODE).toContain("let a20 = 0.0;");
    expect(CODE).toContain("let a30 = 0.0;");
    expect(CODE).toContain("let a31 = 0.0;");
    expect(CODE).toContain("(y + ((h * a20) * k0)) + ((h * a21) * k1)");
    expect(CODE).toContain("((y + ((h * a30) * k0)) + ((h * a31) * k1)) + ((h * a32) * k2)");
  });

  it("sums the combine over stages before the single multiply by h", () => {
    // The documented hazard: `((y + h*b0*k0) + h*b1*k1) + ...` rounds
    // differently and is the defect P7.07 actually shipped.
    expect(CODE).toContain("(((vec4<f32>(0.0) + (b0 * k0)) + (b1 * k1)) + (b2 * k2)) + (b3 * k3)");
    expect(CODE).toContain("return y + (h * weighted);");
  });

  it("uses the classical RK4 weights", () => {
    expect(CODE).toContain("let b0 = 1.0 / 6.0;");
    expect(CODE).toContain("let b1 = 1.0 / 3.0;");
    expect(CODE).toContain("let b2 = 1.0 / 3.0;");
    expect(CODE).toContain("let b3 = 1.0 / 6.0;");
  });
});

describe("the kernel is divergence-free, which is why RK4 was chosen for ensembles", () => {
  /** The body of the step loop, which is where divergence would have to appear. */
  const loopBody =
    /for \(var n: u32 = 0u; n < config\.steps; n = n \+ 1u\) \{([\s\S]*?)\n  \}/.exec(CODE)?.[1];

  it("drives the step loop from a uniform trip count", () => {
    expect(loopBody).toBeDefined();
  });

  it("contains no early exit inside the step loop", () => {
    // A `break`, `continue` or `return` conditioned on state is what turns a
    // one-thread-one-trajectory kernel into a divergent one, and it is the
    // tempting way to implement ground impact. Impact belongs to a later task
    // precisely because it cannot be done this way.
    expect(loopBody).not.toMatch(/\bbreak\b/);
    expect(loopBody).not.toMatch(/\bcontinue\b/);
    expect(loopBody).not.toMatch(/\breturn\b/);
    expect(loopBody).not.toMatch(/\bif\b/);
  });

  it("has exactly one branch in the whole kernel, the range guard", () => {
    const ifCount = (CODE.match(/\bif\s*\(/g) ?? []).length;
    expect(ifCount).toBe(1);
  });
});

describe("the kernel is single precision throughout", () => {
  it("declares no f16 or f64 anywhere", () => {
    // f16 would need the shader-f16 extension and would change the error
    // budget; f64 does not exist in WGSL at all, so a stray one is a typo that
    // would fail compilation on a device this container cannot reach.
    expect(CODE).not.toMatch(/\bf16\b/);
    expect(CODE).not.toMatch(/\bf64\b/);
  });

  it("types the state as vec4<f32>", () => {
    expect(CODE).toContain("var y = vec4<f32>(");
    expect(CODE).toContain("fn rhs(y: vec4<f32>, p: Params) -> vec4<f32>");
    expect(CODE).toContain("fn rk4Step(y: vec4<f32>, h: f32, p: Params) -> vec4<f32>");
  });

  it("types every Params field and the config step size as f32", () => {
    const struct = /struct Params \{([^}]*)\}/.exec(CODE)?.[1] ?? "";
    const types = struct
      .split(",")
      .map((f) => f.trim().split(":")[1]?.trim())
      .filter((t): t is string => Boolean(t));
    expect(types).toHaveLength(WGSL_PARAM_COUNT);
    expect(types.every((t) => t === "f32")).toBe(true);
    expect(CODE).toContain("h: f32,");
  });
});
