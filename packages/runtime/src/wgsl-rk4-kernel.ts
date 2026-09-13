/**
 * The WGSL fixed-step RK4 compute kernel: one thread = one trajectory (P7.14).
 *
 * ## What ships here, and what deliberately does not
 *
 * This module is the **shader source and its binding layout, as data**. It does
 * not create a device, a pipeline, a buffer or a bind group, and it dispatches
 * nothing.
 *
 * That is a seam, not an omission. P7.13 established that this container has no
 * `navigator.gpu` and no adapter -- its probe returns `no-navigator-gpu` here as
 * the *default* path rather than the hard case -- so a dispatch layer written
 * now could not be executed, and hand-typing `GPUBuffer`, `GPUBindGroup` and
 * `GPUComputePipeline` structural types to drive a device that does not exist
 * would be untestable scaffolding. P7.15 ("GPU parameter upload: storage buffers
 * for param/IC arrays; workgroup sizing sweep") is exactly that task, and it is
 * the one that can measure a workgroup sweep. P7.13's probe destroys the device
 * it creates, deliberately, so P7.15 requests its own.
 *
 * **Nothing in this module has been executed on a GPU.** No agreement figure,
 * trajectory count or speedup is claimed anywhere in it. What is claimed is
 * structural, and every structural claim is asserted in
 * `wgsl-rk4-kernel.test.ts`.
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
 *    avoid `Math.hypot`.
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
 * The compute shader.
 *
 * Transcribed from `planar-rk4-precision-reference.ts`. The stages are written
 * out longhand rather than looped over a tableau array: WGSL has no dynamic
 * indexing of a `const` array without a uniformity analysis the loop would not
 * satisfy, and unrolling makes the operation order visible at the point a
 * reader checks it against the CPU reference.
 */
export const WGSL_RK4_KERNEL_SOURCE = /* wgsl */ `
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

@compute @workgroup_size(${WGSL_WORKGROUP_SIZE})
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
