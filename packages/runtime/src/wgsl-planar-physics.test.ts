import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  WGSL_PLANAR_COMPENSATED_STEP_FNS,
  WGSL_PLANAR_STEP_FNS,
  WGSL_PLANAR_STRUCTS,
} from "./wgsl-planar-physics.js";
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

/**
 * P0.136's shader half.
 *
 * The device arm of the criterion is measured by `pnpm check:gpu-observables`
 * against a real adapter; these tests are the part that can be settled from the
 * text alone, and they are chosen to be the parts a device run would *not*
 * catch. A device run compares numbers, so it cannot tell a compensated march
 * that is subtly not `roundedKahanAdd` from one that is -- it would simply
 * report a smaller improvement and look like a pass.
 */
describe("the compensated mode is opt-in and does not disturb the measured text", () => {
  it("leaves every existing kernel free of the compensated fragment", () => {
    // The whole point of a separate constant. If this fails, the pinned SHA
    // above is next, and every recorded device measurement is stale.
    expect(WGSL_RK4_KERNEL_SOURCE).not.toContain("rk4StepCompensated");
    expect(buildWgslObservablesKernelSource(64)).not.toContain("rk4StepCompensated");
  });

  it("does not redeclare rhs, which it calls from the shared fragment", () => {
    // It must be interpolated *after* WGSL_PLANAR_STEP_FNS, never instead of
    // it: a second `fn rhs` would be the copied-physics failure the shared
    // fragment exists to prevent, wearing a new name.
    expect(WGSL_PLANAR_COMPENSATED_STEP_FNS).not.toContain("fn rhs(");
    expect(WGSL_PLANAR_COMPENSATED_STEP_FNS).toContain("rhs(y, p)");
  });
});

describe("the compensated step differs from the plain step only in its accumulation", () => {
  /** The stage block: everything from the tableau down to `weighted`. */
  function stages(source: string): string {
    const start = source.indexOf("  let a10 = 0.5;");
    const end = source.indexOf("weighted = ");
    return source.slice(start, end);
  }

  it("reproduces the plain step's stages character for character", () => {
    // The two functions must not drift. If someone "tidies" one tableau, this
    // catches it -- and it is the failure the shared-fragment docstring warns
    // about, since the copies agree on the day they are made.
    expect(stages(WGSL_PLANAR_COMPENSATED_STEP_FNS)).toBe(stages(WGSL_PLANAR_STEP_FNS));
    expect(stages(WGSL_PLANAR_COMPENSATED_STEP_FNS)).not.toHaveLength(0);
  });

  it("spells roundedKahanAdd's three operations in its documented order", () => {
    // y = term - comp; t = sum + y; comp = (t - sum) - y.
    expect(WGSL_PLANAR_COMPENSATED_STEP_FNS).toContain("let yc = increment - c;");
    expect(WGSL_PLANAR_COMPENSATED_STEP_FNS).toContain("let t = y + yc;");
    expect(WGSL_PLANAR_COMPENSATED_STEP_FNS).toContain("let cNext = (t - y) - yc;");
  });

  it("parenthesises the residual as (t - y) - yc rather than t - y - yc", () => {
    // Under rounding these are different computations and only the first is the
    // error-free transformation. A shader that dropped the parentheses would
    // still run, still compile, and still look compensated -- and would quietly
    // give back much of the improvement. Nothing else in the suite would notice.
    expect(WGSL_PLANAR_COMPENSATED_STEP_FNS).not.toMatch(/cNext = t - y - yc/);
  });

  it("applies the compensation at y + increment and nowhere else", () => {
    // stepPlanarRk4's own comment records why this is the only place it can act:
    // the low bits are gone once the new state is written. A compensated stage
    // update would be a different algorithm from the CPU arm it must reproduce.
    const body = WGSL_PLANAR_COMPENSATED_STEP_FNS;
    expect(body).toContain("let increment = h * weighted;");
    expect(body.match(/- c;/g)).toHaveLength(1);
  });

  it("returns the residual so a march can carry it across steps", () => {
    // A step that compensated internally and dropped the residual would hold
    // rounding to O(eps) within one step -- which is nothing, since one step
    // barely accumulates -- and report itself as compensated.
    expect(WGSL_PLANAR_COMPENSATED_STEP_FNS).toContain("struct CompensatedState");
    expect(WGSL_PLANAR_COMPENSATED_STEP_FNS).toContain("return CompensatedState(t, cNext);");
  });
});
