/**
 * The planar model's WGSL text, shared by every kernel that integrates it
 * (P7.16).
 *
 * ## Why this module exists
 *
 * P7.14's kernel writes back final states; P7.16's writes back reduced
 * observables. They differ in their bindings and their entry point and in
 * nothing else -- the struct layout, the rhs and the RK4 step are the same
 * arithmetic, and that arithmetic is the thing `wgsl-rk4-kernel.ts` spends
 * three numbered paragraphs justifying operation by operation.
 *
 * Copying it into a second kernel would put two spellings of it in the
 * repository, and the failure mode is not that someone notices: the copies
 * agree on the day they are made, and the day one of them changes, the *other*
 * kernel silently keeps computing the old physics. The measurement that would
 * catch it is P7.14's agreement check, which only ever compiles the first
 * kernel.
 *
 * So there is one spelling and both kernels interpolate it.
 *
 * ## The split is where the bindings go, not an arbitrary cut
 *
 * A kernel's source is `structs`, then *its own* bindings, then `stepFns`, then
 * *its own* entry point. The two shared pieces are the two that do not mention a
 * binding, which is exactly why they can be shared: nothing in them knows what
 * the kernel it lands in reads or writes.
 *
 * ## Extracted byte-for-byte, and asserted to be
 *
 * These constants were sliced out of the source `buildWgslRk4KernelSource`
 * already produced rather than retyped from it, and
 * `wgsl-planar-physics.test.ts` pins that `buildWgslRk4KernelSource(64)` still
 * produces the identical 2802 characters it produced before the extraction.
 * That matters more than tidiness: P7.14's bit-identical result on a real device
 * is a measurement of *that text*, and a refactor that altered so much as the
 * whitespace would quietly invalidate it. Re-deriving the same string is what
 * lets the result stand without re-measuring.
 *
 * The arithmetic's own rationale stays in `wgsl-rk4-kernel.ts` where it was
 * written -- the left-associated drag factor, `sqrt(a*a + b*b)` rather than
 * `length()`, the multiplied-rather-than-skipped zero tableau entries, and the
 * FMA-contraction hazard the parenthesisation mitigates but cannot close. None
 * of it changed here; only where the characters live did.
 */

/**
 * `Params` and `Config`, the two structs every planar kernel declares.
 *
 * `Config` carries `h`, `steps` and `count` for every kernel because every
 * kernel needs all three: the step size and trip count drive the march, and the
 * count drives the out-of-range guard that makes a dispatch safe when the
 * ensemble is not a multiple of the workgroup size.
 */
export const WGSL_PLANAR_STRUCTS = `struct Params {
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
}`;

/**
 * The rhs and one classical RK4 step.
 *
 * Reads no binding and writes none: it takes the state and the parameters as
 * arguments and returns the new state, which is what makes it shareable between
 * kernels whose buffers differ entirely.
 */
export const WGSL_PLANAR_STEP_FNS = `// The planar rhs, operation-for-operation from wasm-core's rhs and the CPU
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
}`;

/**
 * The compensated (two-float) accumulation mode, as a *separate* constant that a
 * kernel opts into (P0.136).
 *
 * ## Why this is not appended to {@link WGSL_PLANAR_STEP_FNS}
 *
 * P0.136 was filed expecting that adding an accumulation mode "alters the shader
 * text every downstream GPU task compiles", and therefore that P7.16's 0-ULP
 * agreement and P7.17's budgets -- both measured against *that text* -- would
 * have to be re-recorded. **They do not, and that is a consequence of this
 * split rather than a happy accident.** A kernel that does not ask for
 * compensation interpolates exactly the characters it interpolated before, so
 * `buildWgslRk4KernelSource(64)` still produces its pinned 2802 characters and
 * every recorded device measurement stands without re-measuring.
 *
 * The alternative -- a `compensated` flag threaded through `rk4Step` itself --
 * would have put a runtime branch inside the step function on a value that is
 * uniform across the whole dispatch, which is the one thing §4.10 and P7.19's
 * bisection both went out of their way to avoid.
 *
 * ## The arithmetic is `roundedKahanAdd`, operation for operation
 *
 * `roundedKahanAdd(sum, term, comp, i, round)` in `@ballista/solverkit` is
 * three rounded operations in a fixed order:
 *
 * ```
 *   y = round(term - comp)
 *   t = round(sum + y)
 *   c = round(round(t - sum) - y)
 * ```
 *
 * In WGSL every one of those operands is already `f32`, so `round` is the
 * hardware's own rounding and the three lines below are the same computation
 * with the same associations. **The subtraction order is written out --
 * `(t - y_) - yc`, never `t - y_ - yc`** -- for the reason that function's own
 * docstring gives: under rounding those are different computations and only the
 * first is the error-free transformation.
 *
 * Componentwise on a `vec4<f32>` is per-channel, which is what the CPU arm does
 * with its one-entry-per-channel `compensation` array. The channels never mix.
 *
 * ## Where the compensation is applied, and why only there
 *
 * At `y + increment`, and nowhere else. This mirrors `stepPlanarRk4`, whose
 * comment states the measured reason: the increment's low bits fall off the end
 * of the accumulator at exactly that addition, and once the new state has been
 * written they are gone -- differencing the output afterwards recovers the
 * *rounded* increment, so compensation applied from outside the stepper corrects
 * nothing. The stage arithmetic above is untouched.
 *
 * ## What this does not buy
 *
 * Nothing on the time channels. P7.17 and P7.19 both found it and the reason is
 * structural: the march recomputes `t` from `n` (`f32(n) * h`) rather than
 * accumulating it, so there is no running sum there to compensate. A future
 * reader looking for a matching improvement in the time channels will not find
 * one, and its absence is not a defect.
 */
export const WGSL_PLANAR_COMPENSATED_STEP_FNS = `// The running state and its compensation residual, the two binary32 numbers
// that make up the two-float accumulator. Returned together because WGSL has
// no multiple return and a pointer out-parameter would make the call site
// harder to read than the struct does.
struct CompensatedState {
  y: vec4<f32>,
  c: vec4<f32>,
}

// One classical RK4 step whose final accumulation is compensated. The stages
// are rk4Step's, character for character; only the last line differs.
fn rk4StepCompensated(y: vec4<f32>, c: vec4<f32>, h: f32, p: Params) -> CompensatedState {
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
  let increment = h * weighted;

  // roundedKahanAdd, componentwise. The parenthesisation of the residual is
  // load-bearing: (t - y) - yc, not t - y - yc.
  let yc = increment - c;
  let t = y + yc;
  let cNext = (t - y) - yc;
  return CompensatedState(t, cNext);
}`;
