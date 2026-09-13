/**
 * The WGSL fixed-step RK4 compute kernel: one thread = one trajectory (P7.14).
 *
 * ## What ships here, and where the rest of it lives
 *
 * This module is the **shader source and its binding layout, as data**. It
 * creates no device, pipeline, buffer or bind group and dispatches nothing; that
 * is `wgsl-rk4-dispatch.ts`, which arrived in the 99th run.
 *
 * **The paragraph that used to stand here said nothing in this module had been
 * executed on a GPU, and that is no longer true.** It has: 10000 trajectories on
 * a real WebGPU device, **bit-identical** to the f32 CPU reference on every
 * channel -- 0 ULP, 40000 of 40000 values. `scripts/gpu-rk4-agreement-results.json`
 * records the measurement and the adapter.
 *
 * The reasoning that justified the seam was half right and is worth keeping
 * straight, because it was wrong in an instructive way. P7.13 established that
 * *Node* has no `navigator.gpu`, which is true. What did not follow is that this
 * environment has no GPU at all: WebGPU is exposed only in a **secure context**,
 * so a page on `about:blank` reports no `navigator.gpu` while the same browser
 * served over `http://127.0.0.1` reports one, and Chromium ships SwiftShader's
 * Vulkan ICD inside its own build, so a **software** adapter is available with the
 * right flags.
 *
 * **Software is the word that bounds what the measurement proves.** It settles
 * correctness, which is what P7.14's criterion asks about. It settles nothing
 * about throughput, and no timing or speedup figure appears in this module or in
 * the measurement script. P7.15 keeps the workgroup sweep and P7.20 the
 * throughput target; both need real hardware. P7.13's probe destroys the device it
 * creates, deliberately, so the dispatch layer requests its own.
 *
 * ## The specification is executable, and it lives in solverkit
 *
 * `@ballista/solverkit`'s `planar-rk4-precision-reference.ts` is this kernel's
 * reference: the same model, the same tableau, the same operation order, with
 * every intermediate rounded to binary32. The shader below is a transcription of
 * it. When a GPU is available, that module is the thing to compare against --
 * **not** `SolverConfig.precision = "float32"`, which rounds only the accepted
 * state between steps and leaves the stages in f64.
 *
 * P7.14 measured how much that distinction costs: the two modes differ by at
 * worst 1.502e-6 relative over twelve fixtures, roughly 66x inside the 1e-4 gate
 * the criterion names. So the choice does not change the verdict at that
 * tolerance. It is recorded because it changes what the number *means*, and
 * because the next tightening of the tolerance would make it matter.
 *
 * ## Three things about the arithmetic that are load bearing
 *
 * 1. **The operation order is the repository's**, matching
 *    `batched-ensemble-kernel.ts` and `wasm-core/crate/src/lib.rs`: stage values
 *    accumulate `(h * a) * k` term by term with the **zero `a` entries
 *    multiplied rather than skipped**; the combine forms the whole weighted sum
 *    before a single multiply by `h`; drag's factor is
 *    `(((0.5 * rho) * cd) * area) * speedRel`. WGSL's `*` and `+` are
 *    left-associative as JavaScript's are, so writing the expressions in the
 *    same shape is sufficient.
 *
 * 2. **`sqrt(a*a + b*b)`, never a `length()` builtin.** `length` is permitted a
 *    different error bound and a correctly-rounded implementation would disagree
 *    with both the CPU reference and the WASM kernel, which for the same reason
 *    avoid `Math.hypot`. **The 99th run substituted `length()` as a control and
 *    the result was bit-identical**, so the GPU/CPU comparison is blind to this
 *    substitution on SwiftShader and the source-level check in this module's test
 *    file is the only thing protecting the property where it would matter. That
 *    makes the correspondence test load bearing rather than belt-and-braces; do
 *    not delete it on the grounds that a numerical comparison now exists.
 *
 * 3. **FMA contraction is the one hazard this module cannot close, and it is
 *    stated rather than hidden.** WGSL does not forbid an implementation from
 *    contracting `a * b + c` into a fused multiply-add, and a fused form rounds
 *    once where the reference rounds twice. The WASM side has no such freedom --
 *    the WebAssembly MVP has no FMA instruction, which is why
 *    `backend-equivalence` can assert bit-identity there. **A GPU comparison
 *    therefore cannot assume bit-identity**, and P7.14's tolerance-based
 *    criterion is the right shape for that reason even though its *metric* is
 *    wrong (see the note on the relative gate below). The expressions below are
 *    written with explicit parenthesisation to give a contracting compiler as
 *    little latitude as possible, but that is mitigation, not a guarantee.
 *
 *    **Measured, and the distinction survives the measurement:** SwiftShader
 *    contracts none of them -- the 99th run's 1e4-trajectory comparison is exact.
 *    That is evidence about one implementation and not about the hazard, which is
 *    a licence in the specification rather than a behaviour of a compiler, so the
 *    gate keeps a small non-zero ULP budget instead of being tightened to the
 *    exactness that happens to hold here.
 *
 * ## The criterion's metric is wrong, and P7.15+ should not adopt it as written
 *
 * P7.14's validation line is "1e4 trajectories match CPU f32 mode within 1e-4
 * rel". Measured on this model at h=0.001, comparing true-f32 against f64 --
 * the comparison that line describes -- the absolute error on `vy` is flat at
 * ~3e-6 across the apex while the relative error moves by a factor of 310 and
 * crosses the gate between t=2.150s and t=2.200s. Nothing about the kernel's
 * accuracy changes there; the denominator passes through zero.
 *
 * P7.11 hit the same problem on the backend-equivalence golden and resolved it
 * by gating on ULP with the relative figure kept as documentation. The same
 * resolution applies here, with the FMA caveat above meaning a small ULP budget
 * rather than zero. `planar-rk4-precision-reference.test.ts` carries the
 * measurement.
 *
 * ## Divergence-free by construction
 *
 * The blueprint's §4.10 table picks fixed-step RK4 for ensembles precisely
 * because it gives "divergence-free control flow for GPU". The kernel honours
 * that: the step loop has a **uniform trip count** taken from the config
 * uniform, there is no early exit, no per-thread branch on state, and no
 * dynamic indexing. The only branch is the out-of-range guard at entry, which
 * is uniform within every workgroup except the last.
 */

/** State dimension `[x, y, vx, vy]`, matching `PLANAR_CHANNELS`. */
export const WGSL_STATE_DIM = 4;

/** Number of `f32` parameters per trajectory, matching `wasm-core`'s `ParamSlot`. */
export const WGSL_PARAM_COUNT = 7;

/**
 * Workgroup size along x.
 *
 * 64 is a starting value, not a measured optimum: it is a multiple of both the
 * 32-lane and 64-lane subgroup widths in common use, so it wastes no lanes on
 * either. **P7.15 is the task that sweeps this and records the best size per
 * adapter class**; nothing here claims 64 is best, and the constant is exported
 * so that sweep can vary it rather than editing the shader text.
 */
export const WGSL_WORKGROUP_SIZE = 64;

/**
 * Binding layout of the kernel's one bind group, as data.
 *
 * Exported so P7.15's pipeline setup and this module's tests read the same
 * numbers rather than two hand-kept copies drifting apart.
 */
export const WGSL_BINDINGS = {
  /** `array<Params>`, one per trajectory. Read-only storage. */
  params: 0,
  /** `array<f32>`, `WGSL_STATE_DIM` per trajectory. Read-only storage. */
  initialStates: 1,
  /** `array<f32>`, `WGSL_STATE_DIM` per trajectory. Written by the kernel. */
  finalStates: 2,
  /** `Config`: step size, step count, trajectory count. Uniform. */
  config: 3,
} as const;

/** The kernel's entry point name, for `GPUComputePipeline`'s `entryPoint`. */
export const WGSL_ENTRY_POINT = "main";

/**
 * Bytes per `Params` struct in a storage buffer.
 *
 * Seven `f32` at alignment 4 gives a 28-byte stride under WGSL's default
 * layout rules. Exported because the host must pack the parameter array to
 * exactly this stride, and a mismatch there produces silently wrong physics
 * rather than an error.
 */
export const WGSL_PARAMS_STRIDE_BYTES = WGSL_PARAM_COUNT * 4;

/**
 * Largest workgroup size any conformant WebGPU implementation is required to
 * accept, and therefore the largest a sweep may try without first reading the
 * device's own limits.
 *
 * The WebGPU specification's default `maxComputeWorkgroupSizeX` and
 * `maxComputeInvocationsPerWorkgroup` are both 256. A device may report more,
 * and P7.15's sweep reads the reported values rather than this constant --
 * `planWorkgroupSweep` takes the limits as arguments for exactly that reason.
 * This constant is the *portable* ceiling, used where no device is in hand: a
 * source built above it is not wrong, it is merely not guaranteed to compile
 * anywhere.
 */
export const WGSL_MAX_PORTABLE_WORKGROUP_SIZE = 256;

/**
 * Builds the compute shader with a chosen `@workgroup_size` literal.
 *
 * ## Why a builder rather than a string replace at the call site
 *
 * P7.15 sweeps the workgroup size, and the obvious way to do that is
 * `WGSL_RK4_KERNEL_SOURCE.replace("@workgroup_size(64)", ...)` -- which the
 * dispatch tests do today, in one place, deliberately. As the *product* code's
 * mechanism it is a bad one: the literal `64` appears in the pattern, so the
 * replace silently becomes a no-op the day {@link WGSL_WORKGROUP_SIZE}
 * changes, and a no-op here does not fail. It produces a source whose declared
 * size still says 64, which {@link runWgslRk4}'s guard then rejects with a
 * message about the caller's argument -- so the failure surfaces one layer away
 * from its cause.
 *
 * Interpolating the literal once, here, removes that whole class. There is one
 * spelling of the shader and the size is a parameter of it.
 *
 * ## Only the literal varies
 *
 * The returned source differs from {@link WGSL_RK4_KERNEL_SOURCE} in exactly
 * the `@workgroup_size(N)` literal and in nothing else -- not the arithmetic,
 * not the operation order, not the bindings. That matters because a workgroup
 * sweep compares timings across sources, and a source that also differed in its
 * arithmetic would make the comparison measure two things. It is asserted
 * rather than intended: `wgsl-rk4-kernel.test.ts` rebuilds the default size and
 * checks the result is character-identical, and checks that substituting the
 * literal back into any swept source recovers the default exactly.
 *
 * ## Transcription
 *
 * Transcribed from `planar-rk4-precision-reference.ts`. The stages are written
 * out longhand rather than looped over a tableau array: WGSL has no dynamic
 * indexing of a `const` array without a uniformity analysis the loop would not
 * satisfy, and unrolling makes the operation order visible at the point a
 * reader checks it against the CPU reference.
 *
 * @param workgroupSize positive integer. Not bounded above here: the ceiling is
 *   a property of the device, and {@link WGSL_MAX_PORTABLE_WORKGROUP_SIZE} is
 *   the portable one for callers with no device in hand.
 * @throws RangeError if `workgroupSize` is not a positive integer.
 */
export function buildWgslRk4KernelSource(workgroupSize: number): string {
  if (!Number.isInteger(workgroupSize) || workgroupSize <= 0) {
    throw new RangeError(`workgroup size must be a positive integer, got ${workgroupSize}`);
  }
  return /* wgsl */ `
struct Params {
  mass: f32,
  area: f32,
  cd: f32,
  rho: f32,
  g: f32,
  windX: f32,
  windY: f32,
}

struct Config {
  h: f32,
  steps: u32,
  count: u32,
  _pad: u32,
}

@group(0) @binding(0) var<storage, read> params: array<Params>;
@group(0) @binding(1) var<storage, read> initialStates: array<f32>;
@group(0) @binding(2) var<storage, read_write> finalStates: array<f32>;
@group(0) @binding(3) var<uniform> config: Config;

// The planar rhs, operation-for-operation from wasm-core's rhs and the CPU
// f32 reference. speedRel uses sqrt(a*a + b*b) and NOT length(), which is
// permitted a different error bound.
fn rhs(y: vec4<f32>, p: Params) -> vec4<f32> {
  let vx = y.z;
  let vy = y.w;

  let vRelX = vx - p.windX;
  let vRelY = vy - p.windY;
  let speedRel = sqrt((vRelX * vRelX) + (vRelY * vRelY));

  // GravityForce: unary minus binds tighter than *, so this is (-mass) * g.
  var f0 = 0.0;
  var f1 = (-p.mass) * p.g;

  // QuadraticDragForce, left-associated verbatim.
  let k = (((0.5 * p.rho) * p.cd) * p.area) * speedRel;
  f0 = f0 + ((-k) * vRelX);
  f1 = f1 + ((-k) * vRelY);

  return vec4<f32>(vx, vy, f0 / p.mass, f1 / p.mass);
}

// One classical RK4 step. The zero 'a' entries are multiplied rather than
// skipped, and the combine sums over stages before the single multiply by h.
fn rk4Step(y: vec4<f32>, h: f32, p: Params) -> vec4<f32> {
  let a10 = 0.5;
  let a20 = 0.0;
  let a21 = 0.5;
  let a30 = 0.0;
  let a31 = 0.0;
  let a32 = 1.0;
  let b0 = 1.0 / 6.0;
  let b1 = 1.0 / 3.0;
  let b2 = 1.0 / 3.0;
  let b3 = 1.0 / 6.0;

  let k0 = rhs(y, p);

  let s1 = y + ((h * a10) * k0);
  let k1 = rhs(s1, p);

  let s2 = (y + ((h * a20) * k0)) + ((h * a21) * k1);
  let k2 = rhs(s2, p);

  let s3 = ((y + ((h * a30) * k0)) + ((h * a31) * k1)) + ((h * a32) * k2);
  let k3 = rhs(s3, p);

  let weighted = (((vec4<f32>(0.0) + (b0 * k0)) + (b1 * k1)) + (b2 * k2)) + (b3 * k3);
  return y + (h * weighted);
}

@compute @workgroup_size(${workgroupSize})
fn ${WGSL_ENTRY_POINT}(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= config.count) {
    return;
  }

  let base = index * ${WGSL_STATE_DIM}u;
  var y = vec4<f32>(
    initialStates[base + 0u],
    initialStates[base + 1u],
    initialStates[base + 2u],
    initialStates[base + 3u],
  );
  let p = params[index];
  let h = config.h;

  // Uniform trip count: every thread takes exactly config.steps steps, with no
  // early exit and no branch on state. This is what makes the kernel
  // divergence-free, which is why the blueprint picks fixed-step RK4 for
  // ensembles in the first place (section 4.10).
  for (var n: u32 = 0u; n < config.steps; n = n + 1u) {
    y = rk4Step(y, h, p);
  }

  finalStates[base + 0u] = y.x;
  finalStates[base + 1u] = y.y;
  finalStates[base + 2u] = y.z;
  finalStates[base + 3u] = y.w;
}
`;
}

/**
 * The compute shader at the default {@link WGSL_WORKGROUP_SIZE}.
 *
 * Derived from {@link buildWgslRk4KernelSource} rather than written out a
 * second time, so the default and every swept source are the same text by
 * construction and not by inspection.
 */
export const WGSL_RK4_KERNEL_SOURCE = buildWgslRk4KernelSource(WGSL_WORKGROUP_SIZE);
