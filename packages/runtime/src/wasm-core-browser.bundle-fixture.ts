import {
  OBS,
  PARAM,
  WasmRk4Kernel,
  createFetchWasmArtifactSource,
  instantiateBestBrowserKernel,
  instantiateBrowserKernel,
  wasmSimdSupported,
  type WasmArtifactSource,
} from "@ballista/wasm-core";

/**
 * A real browser consumer of `@ballista/wasm-core` (P0.133).
 *
 * `wasm-core-browser.bundle.test.ts` builds this through Vite/Rollup and then
 * *runs the built chunk*, so everything here has to survive bundling rather
 * than merely typecheck. It is deliberately a plain module with no DOM and no
 * Node: the only environment-shaped thing it touches is `fetch`, and that
 * arrives through the injected {@link WasmArtifactSource}.
 */

/** A short drag-affected flight, small enough to run inside a test. */
const WORKLOAD = {
  params: { mass: 0.145, area: 0.004, cd: 0.47, rho: 1.225, g: 9.81, wx: 0, wy: 0 },
  state: [0, 0, 30, 40] as const,
  t0: 0,
  h: 1e-3,
  steps: 1000,
} as const;

function integrate(kernel: WasmRk4Kernel): readonly number[] {
  kernel.setParams(WORKLOAD.params);
  kernel.setState(WORKLOAD.state);
  kernel.stepN(WORKLOAD.t0, WORKLOAD.h, WORKLOAD.steps);
  return [...kernel.state];
}

export interface BrowserKernelProbe {
  /** Final state from the scalar artifact. */
  readonly scalarFinal: readonly number[];
  /** Final state from whichever artifact `instantiateBestBrowserKernel` chose. */
  readonly bestFinal: readonly number[];
  /** Whether the instance `instantiateBestBrowserKernel` returned carries the SIMD path. */
  readonly bestHasSimd: boolean;
  /** Whether this engine validates simd128 at all. */
  readonly simdSupported: boolean;
  /** Whether an explicitly-fetched simd128 artifact instantiated and reports its SIMD path. */
  readonly explicitSimdHasSimd: boolean | undefined;
  /** Final state from that explicitly-fetched simd128 instance. */
  readonly explicitSimdFinal: readonly number[] | undefined;
}

/**
 * Instantiates the kernels the way a browser would and integrates one flight
 * through each.
 *
 * The source is a parameter with the fetching default, so the test can serve
 * the committed bytes from disk while the code under test still goes through
 * `createFetchWasmArtifactSource`'s own call path.
 */
export async function probeBrowserKernels(
  source: WasmArtifactSource = createFetchWasmArtifactSource(),
): Promise<BrowserKernelProbe> {
  const scalar = await instantiateBrowserKernel(source);
  const best = await instantiateBestBrowserKernel(source);

  const simdSupported = wasmSimdSupported();
  let explicitSimd: WasmRk4Kernel | undefined;
  if (simdSupported) {
    // Not the same call as `best`: this asks for the simd128 artifact by name,
    // so a `best` that silently fell back to the scalar bytes cannot stand in
    // for it. This is the half of the criterion that says "and the simd128
    // kernel".
    explicitSimd = await WasmRk4Kernel.instantiate(await source.readSimd());
  }

  return {
    scalarFinal: integrate(scalar),
    bestFinal: integrate(best),
    bestHasSimd: best.hasSimd,
    simdSupported,
    explicitSimdHasSimd: explicitSimd?.hasSimd,
    explicitSimdFinal: explicitSimd === undefined ? undefined : integrate(explicitSimd),
  };
}

/** Re-exported so the built chunk can be checked for the kernel's own constants. */
export const PROBE_SLOTS = { PARAM, OBS } as const;
