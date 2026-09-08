//! Ballista numeric core (P7.07): classical RK4 over the planar projectile
//! model with gravity and quadratic drag, compiled to `wasm32-unknown-unknown`.
//!
//! # What this is a port of, and why that phrasing matters
//!
//! This is not an independent implementation of RK4. It is a transcription of
//! two specific TypeScript functions, and the thing it has to reproduce is
//! their **floating-point operation order**, not their mathematics:
//!
//! - `packages/solverkit/src/explicit-rk-kernel.ts` :: `stepExplicitRK`
//! - `packages/engine/src/planar-projectile-model.ts` :: the `rhs` closure,
//!   with `GravityForce` and `QuadraticDragForce` from `forces.ts`
//!
//! P7.07's criterion is "WASM result matches TS within 1e-15 per step (same
//! order of ops)". The parenthesis is the whole task. Two implementations that
//! agree mathematically can differ in the last few ULP, and a 1e-15 tolerance
//! would hide that; the aim here is 0 ULP, and the equivalence test asserts
//! exactly that with `Object.is` on raw doubles rather than a tolerance.
//!
//! Three places where the obvious Rust differs from the TS, all of them load
//! bearing:
//!
//! 1. **The zero `a` entries are multiplied, not skipped.** RK4's rows are
//!    `[]`, `[0.5]`, `[0, 0.5]`, `[0, 0, 1]`. A hand-written RK4 skips the
//!    zeros; the TS kernel is tableau-driven and evaluates `h * 0.0 * k[j][i]`
//!    for them. Adding `±0.0` to a finite accumulator is exact, so this cannot
//!    change a finite result -- but it is not exact for every input (adding
//!    `+0.0` to `-0.0` gives `+0.0`), and reproducing the loop as written costs
//!    nothing and removes the question.
//! 2. **The final increment is summed over stages before the single multiply
//!    by `h`.** `y[i] + h * (b0*k0 + b1*k1 + ...)`, never
//!    `((y[i] + h*b0*k0) + h*b1*k1) + ...`. These round differently and the TS
//!    kernel's own doc comment calls this out.
//! 3. **Left-to-right associativity is preserved verbatim**: `h * a * k` is
//!    `(h * a) * k`, and drag's `k` factor is `(((0.5 * rho) * cd) * area) *
//!    speed_rel`. Rust and JS both evaluate `*` left-associatively, so writing
//!    the expression in the same shape is sufficient.
//!
//! No FMA contraction can occur on either side: the WebAssembly MVP has no
//! fused-multiply-add instruction, and rustc never enables fast-math.
//!
//! # ABI
//!
//! Plain `extern "C"` over linear memory, no wasm-bindgen. The exported
//! [`state_ptr`] and [`params_ptr`] hand out addresses into this module's own
//! statics so the host can build `Float64Array` views over them and read and
//! write state without copying -- which is the shape P7.08's zero-copy batch
//! API needs. A bindgen glue layer would own that layout instead.
//!
//! Single-threaded by construction: `wasm32-unknown-unknown` without the
//! threads proposal has one linear memory and one instance per host `Worker`,
//! so the `static mut` state below is not shared. P7.12 revisits that.

// `std`, not `no_std`, for exactly one reason: `f64::sqrt` is a `std` method,
// and on `wasm32-unknown-unknown` it lowers to the single `f64.sqrt`
// instruction -- the correctly-rounded hardware square root, which is what
// JavaScript's `Math.sqrt` is also required to be. Reimplementing it in
// `no_std` would be reimplementing the one operation that has to agree
// exactly. Nothing else here touches the standard library; there is no
// allocation, no formatting and no I/O, and `panic = "abort"` keeps the
// unwinder out.

/// State dimension: `[x, y, vx, vy]`, matching `PLANAR_CHANNELS`.
pub const DIM: usize = 4;

const X: usize = 0;
const Y: usize = 1;
const VX: usize = 2;
const VY: usize = 3;

/// Number of `f64` slots in the parameter block. See [`ParamSlot`].
pub const PARAM_COUNT: usize = 7;

/// Indices into the parameter block the host writes through [`params_ptr`].
///
/// Kept as a flat `f64` array rather than a `#[repr(C)]` struct so the host
/// side is one `Float64Array` view with named indices, and so adding a
/// parameter is an append rather than a layout negotiation.
#[repr(usize)]
pub enum ParamSlot {
    /// Projectile mass, kg.
    Mass = 0,
    /// Reference area, m^2.
    Area = 1,
    /// Drag coefficient. Constant here: this port targets `ConstantCd`, so
    /// `cd(re, mach)` is a value rather than a call, and `re`/`mach` are not
    /// computed at all. A Reynolds- or Mach-dependent model is a later task.
    Cd = 2,
    /// Air density, kg/m^3 (`ConstantAtmosphere`).
    Rho = 3,
    /// Gravitational acceleration, m/s^2 (`UniformGravity`).
    G = 4,
    /// Wind x-component, m/s (`UniformWind`; `ZeroWind` is this at 0).
    Wx = 5,
    /// Wind y-component, m/s.
    Wy = 6,
}

/// The classical RK4 tableau (§4.4, eq. 4.6), byte-for-byte the values in
/// `RK4_TABLEAU`. The `a` rows are stored padded to `STAGES` with the leading
/// entries live so the stage loop can read a fixed-length slice; `a_len` gives
/// each row's true length, which is what makes the zero entries at
/// `a[2][0]` and `a[3][0..2]` participate exactly as they do in TypeScript.
const STAGES: usize = 4;
const C: [f64; STAGES] = [0.0, 0.5, 0.5, 1.0];
const A: [[f64; STAGES]; STAGES] = [
    [0.0, 0.0, 0.0, 0.0],
    [0.5, 0.0, 0.0, 0.0],
    [0.0, 0.5, 0.0, 0.0],
    [0.0, 0.0, 1.0, 0.0],
];
const A_LEN: [usize; STAGES] = [0, 1, 2, 3];
const B: [f64; STAGES] = [1.0 / 6.0, 1.0 / 3.0, 1.0 / 3.0, 1.0 / 6.0];

static mut STATE: [f64; DIM] = [0.0; DIM];
static mut PARAMS: [f64; PARAM_COUNT] = [0.0; PARAM_COUNT];

// Scratch, allocated once at module instantiation and reused. The blueprint's
// "the hot path allocates nothing" invariant (§8) applies here as much as it
// does on the TypeScript side; there is no allocator in this binary at all.
static mut K: [[f64; DIM]; STAGES] = [[0.0; DIM]; STAGES];
static mut Y_STAGE: [f64; DIM] = [0.0; DIM];
static mut Y_NEXT: [f64; DIM] = [0.0; DIM];

/// Address of the 4-element state vector `[x, y, vx, vy]`.
///
/// The host builds one `Float64Array(memory.buffer, state_ptr(), DIM)` at
/// instantiation and keeps it: reads and writes through it are the state, with
/// no copy in either direction.
#[no_mangle]
pub extern "C" fn state_ptr() -> *mut f64 {
    &raw mut STATE as *mut f64
}

/// Address of the [`PARAM_COUNT`]-element parameter block.
#[no_mangle]
pub extern "C" fn params_ptr() -> *mut f64 {
    &raw mut PARAMS as *mut f64
}

/// State dimension, so the host does not hard-code it.
#[no_mangle]
pub extern "C" fn dim() -> usize {
    DIM
}

/// Parameter-block length, so the host does not hard-code it.
#[no_mangle]
pub extern "C" fn param_count() -> usize {
    PARAM_COUNT
}

/// The planar projectile RHS with gravity and quadratic drag, in the operation
/// order `planar-projectile-model.ts` uses.
///
/// Mirrors the TS exactly, including the parts that look redundant:
/// `specializeForces` zeroes the accumulator and then applies gravity **before**
/// drag, so `f[1]` is `(0 + -(mass * g)) + (-k * v_rel_y)` and not the other
/// grouping. `re` and `mach` are computed in the TS `rhs` and then consumed only
/// by `cd(re, mach)`; with `ConstantCd` they cannot affect the result, so they
/// are not computed here. That is the one intentional divergence and it is
/// unobservable by construction -- a Reynolds-dependent `Cd` would make it
/// observable, which is why the host-side test pins `ConstantCd`.
#[inline]
fn rhs(_t: f64, y: &[f64; DIM], out: &mut [f64; DIM], p: &[f64; PARAM_COUNT]) {
    let mass = p[ParamSlot::Mass as usize];
    let area = p[ParamSlot::Area as usize];
    let cd = p[ParamSlot::Cd as usize];
    let rho = p[ParamSlot::Rho as usize];
    let g = p[ParamSlot::G as usize];
    let wx = p[ParamSlot::Wx as usize];
    let wy = p[ParamSlot::Wy as usize];

    let vx = y[VX];
    let vy = y[VY];

    // ctx.vRel = v - w; ctx.speedRel = norm(vRel), and `norm` is
    // sqrt(a0*a0 + a1*a1) -- not hypot, which is correctly rounded and would
    // therefore disagree.
    let vrel_x = vx - wx;
    let vrel_y = vy - wy;
    let speed_rel = (vrel_x * vrel_x + vrel_y * vrel_y).sqrt();

    // out[0] = 0; out[1] = 0;
    let mut f0 = 0.0_f64;
    let mut f1 = 0.0_f64;

    // GravityForce::accumulate. Unary minus binds tighter than `*` in both
    // languages, so this is `(-mass) * g`, as in the TS.
    f1 += -mass * g;

    // QuadraticDragForce::accumulate.
    let k = 0.5 * rho * cd * area * speed_rel;
    f0 += -k * vrel_x;
    f1 += -k * vrel_y;

    out[X] = vx;
    out[Y] = vy;
    out[VX] = f0 / mass;
    out[VY] = f1 / mass;
}

/// One classical RK4 step, transcribed from `stepExplicitRK`.
///
/// `t` is threaded through for shape only: this model's RHS is autonomous
/// (a constant atmosphere, constant gravity and a uniform wind have no time
/// dependence), so `t + C[s] * h` is computed and discarded. It is kept
/// because dropping it would make the port stop being a transcription, and a
/// time-dependent wind model would need it back.
fn rk4_step(
    t: f64,
    y: &[f64; DIM],
    h: f64,
    p: &[f64; PARAM_COUNT],
    k: &mut [[f64; DIM]; STAGES],
    y_stage: &mut [f64; DIM],
    y_next: &mut [f64; DIM],
) {
    for s in 0..STAGES {
        let a_len = A_LEN[s];
        for i in 0..DIM {
            let mut yi = y[i];
            // Iterates the row's true length, so stage 2 evaluates
            // `h * 0.0 * k[0][i]` and stage 3 evaluates two such terms,
            // exactly as the tableau-driven TS loop does.
            for j in 0..a_len {
                yi += h * A[s][j] * k[j][i];
            }
            y_stage[i] = yi;
        }
        let mut ks = [0.0_f64; DIM];
        // `t + C[s] * h`, exactly as the TS kernel forms it. This RHS is
        // autonomous so the value is discarded, but computing it keeps this a
        // transcription rather than a paraphrase, and a time-dependent wind
        // model needs it to already be correct.
        rhs(t + C[s] * h, y_stage, &mut ks, p);
        k[s] = ks;
    }

    for i in 0..DIM {
        // Summed over stages first, multiplied by h once. See the module doc.
        let mut increment = 0.0_f64;
        for s in 0..STAGES {
            increment += B[s] * k[s][i];
        }
        y_next[i] = y[i] + h * increment;
    }
}

/// Advances the shared state by one RK4 step of size `h` from time `t`.
///
/// Reads and writes [`state_ptr`]'s buffer in place, so the host's view sees
/// the new state with no copy and no return value to marshal.
#[no_mangle]
pub extern "C" fn step(t: f64, h: f64) {
    unsafe {
        let y = &*(&raw const STATE);
        let p = &*(&raw const PARAMS);
        rk4_step(
            t,
            y,
            h,
            p,
            &mut *(&raw mut K),
            &mut *(&raw mut Y_STAGE),
            &mut *(&raw mut Y_NEXT),
        );
        STATE = *(&raw const Y_NEXT);
    }
}

/// Advances the shared state by `n` RK4 steps of size `h` from time `t0`.
///
/// Equivalent to `n` calls to [`step`] and exists so a comparison run does not
/// pay one host-to-wasm boundary crossing per step. Advances `t` by summing
/// `t0 + (i as f64) * h` rather than accumulating `t += h`; both are discarded
/// by this autonomous RHS, but the multiply form is what does not drift, and
/// baking in the drifting form would be a trap for the first time-dependent
/// model that arrives.
#[no_mangle]
pub extern "C" fn step_n(t0: f64, h: f64, n: usize) {
    for i in 0..n {
        step(t0 + (i as f64) * h, h);
    }
}
