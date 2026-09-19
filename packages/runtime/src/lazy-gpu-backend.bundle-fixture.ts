/**
 * Minimal real consumer of {@link ./lazy-gpu-backend.js}'s dynamic import, used
 * only as a Rollup/Vite build entry point by `lazy-gpu-backend.bundle.test.ts`
 * to verify the GPU path lands in its own dynamic-import chunk rather than the
 * initial bundle (P7.30's validation criterion).
 *
 * **It imports the capability probe eagerly and on purpose.** That is what a
 * real caller does -- probe first, dispatch only if there is an adapter -- and
 * building the fixture without it would make the test prove something easier
 * than the thing being claimed: that a module importing *nothing* GPU-shaped
 * has no GPU code in its entry chunk. With the probe statically imported, the
 * entry chunk genuinely reaches for `@ballista/runtime`'s GPU-adjacent surface,
 * and the assertion that the WGSL sources are still absent from it means
 * something.
 *
 * Stands in for the future scheduler call site. Not part of this package's
 * public API, so it is deliberately not re-exported from `index.ts`, matching
 * `lazy-plotly-pane.bundle-fixture.ts`'s precedent.
 */
import { loadGpuComputeModule } from "./lazy-gpu-backend.js";
import { probeWebGpu, type GpuLike } from "./webgpu-capability.js";

/**
 * Probe eagerly, load the kernel only if the probe says there is something to
 * run it on -- the exact shape the lazy boundary exists to serve.
 */
export async function dispatchOnDemand(gpu: GpuLike | undefined): Promise<string | undefined> {
  const probe = await probeWebGpu(gpu);
  if (!probe.supported) return undefined;

  const { kernel } = await loadGpuComputeModule();
  return kernel.WGSL_RK4_KERNEL_SOURCE;
}
