import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { WGSL_PLANAR_STEP_FNS, WGSL_PLANAR_STRUCTS } from "./wgsl-planar-physics.js";
import { buildWgslRk4KernelSource, WGSL_RK4_KERNEL_SOURCE } from "./wgsl-rk4-kernel.js";
import { buildWgslObservablesKernelSource } from "./wgsl-observables-kernel.js";

/**
 * SHA-256 and length of the shader text as it stood when P7.14 measured it
 * bit-identical to the CPU reference on a real device, and before P7.16
 * extracted the shared fragments out of it.
 *
 * This is the guard that lets that measurement stand without being re-run. The
 * extraction was a pure text move -- the fragments were sliced out of the source
 * the builder already produced, not retyped from it -- and "pure text move" is a
 * claim, so it is checked rather than asserted.
 *
 * **If this test fails, the recorded agreement result in
 * `scripts/gpu-rk4-agreement-results.json` no longer describes the shader that
 * ships.** The fix is to re-measure with `pnpm check:gpu-rk4-agreement`, not to
 * update the digest.
 */
const P7_14_KERNEL_SHA256 = "0a12b86645c91341d71b452564ae78429e29cd0f5f7298490a366217af889d3a";
const P7_14_KERNEL_LENGTH = 2802;

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

describe("extracting the shared physics did not change the shader P7.14 measured", () => {
  it("still produces the exact text the recorded agreement result was measured on", () => {
    expect(WGSL_RK4_KERNEL_SOURCE).toHaveLength(P7_14_KERNEL_LENGTH);
    expect(sha256(WGSL_RK4_KERNEL_SOURCE)).toBe(P7_14_KERNEL_SHA256);
  });

  it("keeps the default and the built default identical, as before the extraction", () => {
    expect(buildWgslRk4KernelSource(64)).toBe(WGSL_RK4_KERNEL_SOURCE);
  });
});

describe("both kernels interpolate the same physics, not two copies of it", () => {
  const rk4 = WGSL_RK4_KERNEL_SOURCE;
  const observables = buildWgslObservablesKernelSource(64);

  it("puts the shared structs verbatim in both", () => {
    expect(rk4).toContain(WGSL_PLANAR_STRUCTS);
    expect(observables).toContain(WGSL_PLANAR_STRUCTS);
  });

  it("puts the shared rhs and RK4 step verbatim in both", () => {
    expect(rk4).toContain(WGSL_PLANAR_STEP_FNS);
    expect(observables).toContain(WGSL_PLANAR_STEP_FNS);
  });

  it("declares rhs and rk4Step exactly once in each kernel", () => {
    for (const source of [rk4, observables]) {
      expect(source.match(/fn rhs\(/g)).toHaveLength(1);
      expect(source.match(/fn rk4Step\(/g)).toHaveLength(1);
    }
  });

  it("keeps the arithmetic the shared text is responsible for out of the observables kernel's own code", () => {
    // Everything after the shared fragment is the reduction, and none of it may
    // re-spell the model. A second `p.cd` or `p.rho` outside the shared text
    // would mean the physics had been copied after all.
    const ownCode = observables.split(WGSL_PLANAR_STEP_FNS)[1] ?? "";
    expect(ownCode).not.toContain("p.cd");
    expect(ownCode).not.toContain("p.rho");
    expect(ownCode).not.toContain("p.mass");
  });
});
