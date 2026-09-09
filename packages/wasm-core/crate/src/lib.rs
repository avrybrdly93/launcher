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

// ---------------------------------------------------------------------------
// P7.08 -- batch API
// ---------------------------------------------------------------------------

/// Number of `f64` slots each replicate writes to the observables buffer.
///
/// The layout is `[x, y, vx, vy, t_final, max_sampled_height]`:
///
/// | slot | meaning |
/// | ---- | ------- |
/// | 0..3 | the integrated state after the last step, in `PLANAR_CHANNELS` order |
/// | 4    | `t0 + (steps as f64) * h`, formed by multiply rather than accumulation |
/// | 5    | the largest `y` seen at any *step boundary*, including the initial state |
///
/// **Slot 5 is a step-boundary sample and is named as one.** It is *not*
/// `Observables.apexHeight` from `analysis/observable-sink.ts`: that value is
/// refined between the two rows bracketing the peak with a Hermite stationary
/// point, and this one is a running `max` over the sampled rows themselves.
/// They agree only in the limit of small `h`. P7.11's equivalence suite must
/// compare this against a TS-side running max over the same rows, never
/// against the refined observable, or it will report a divergence that is
/// really a difference of definition.
///
/// The *time* at which slot 5 occurred is deliberately absent. A step-boundary
/// argmax time is not `apexTime` for the same reason, and shipping the two
/// next to each other is an invitation to the comparison that must not be
/// made. A caller that needs the refined apex has to run the refined path.
///
/// Nothing here is event-localized: the batch runs a fixed step count and
/// stops, so slots 0..3 are the state at `t_final` and not an impact state.
/// Terminal-event handling in the kernel is a later task.
pub const OBS_COUNT: usize = 6;

/// `f64` slots one replicate occupies across all three batch buffers.
const SLOTS_PER_REPLICATE: usize = PARAM_COUNT + DIM + OBS_COUNT;

const PAGE_BYTES: usize = 65536;
const F64_BYTES: usize = 8;

/// Byte address of the batch arena, or 0 before the first successful
/// [`batch_init`]. Fixed once set: the arena is always the highest region in
/// linear memory, because this module is the only thing that ever grows it, so
/// raising capacity extends the arena in place rather than relocating it.
static mut ARENA_BASE: usize = 0;
/// Replicates the current arena can hold. Monotonically non-decreasing.
static mut ARENA_CAPACITY: usize = 0;

/// Ensures the arena can hold `capacity` replicates, growing linear memory if
/// it cannot. Returns false only if `memory.grow` was refused.
///
/// **This is the only place in the module that can allocate**, which is what
/// makes P7.08's "no per-call allocation" criterion measurable from the host:
/// watch `memory.buffer.byteLength`. It may move here, and nowhere else.
#[cfg(target_arch = "wasm32")]
fn ensure_capacity(capacity: usize) -> bool {
    unsafe {
        if capacity <= ARENA_CAPACITY && ARENA_BASE != 0 {
            return true;
        }
        if capacity > usize::MAX / (SLOTS_PER_REPLICATE * F64_BYTES) {
            return false;
        }
        let have_end = core::arch::wasm32::memory_size(0) * PAGE_BYTES;
        // First call anchors the arena at the current end of memory. Everything
        // the linker placed -- data, and the shadow stack, which never grows
        // into new pages -- lives below that line.
        if ARENA_BASE == 0 {
            ARENA_BASE = have_end;
        }
        let need_end = ARENA_BASE + capacity * SLOTS_PER_REPLICATE * F64_BYTES;
        if need_end > have_end {
            let pages = (need_end - have_end).div_ceil(PAGE_BYTES);
            if core::arch::wasm32::memory_grow(0, pages) == usize::MAX {
                return false;
            }
        }
        ARENA_CAPACITY = capacity;
        true
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn ensure_capacity(_capacity: usize) -> bool {
    // The arena is carved out of WebAssembly linear memory and there is no
    // equivalent on a native target. The crate still compiles as an `rlib` so
    // the RHS and stepper can be unit-tested natively; the batch API cannot.
    false
}

/// Reserves room for `capacity` replicates. Returns 1 on success, 0 if
/// `memory.grow` was refused.
///
/// Call this **once**, with the largest capacity the caller will use. It is the
/// only entry point that can grow memory, and growing detaches every
/// `ArrayBuffer` view the host holds -- including [`state_ptr`]'s and
/// [`params_ptr`]'s, which are unrelated to the batch. The host must rebuild
/// all of its views after any call that returns with a larger capacity.
///
/// Calling it again at or below the existing capacity is a no-op that grows
/// nothing, which is exactly the case the criterion's "no per-call allocation"
/// half is measured against. Raising capacity keeps the arena's base address
/// but moves the state and observable buffers, because their offsets are
/// capacity-derived, and it does not preserve any contents.
#[no_mangle]
pub extern "C" fn batch_init(capacity: usize) -> usize {
    usize::from(ensure_capacity(capacity))
}

/// Replicates the arena currently holds.
#[no_mangle]
pub extern "C" fn batch_capacity() -> usize {
    unsafe { ARENA_CAPACITY }
}

/// Observable slots per replicate, so the host does not hard-code [`OBS_COUNT`].
#[no_mangle]
pub extern "C" fn obs_count() -> usize {
    OBS_COUNT
}

/// Address of the `capacity * PARAM_COUNT` parameter block, row-major by
/// replicate. Zero before the first [`batch_init`].
#[no_mangle]
pub extern "C" fn batch_params_ptr() -> *mut f64 {
    unsafe { ARENA_BASE as *mut f64 }
}

/// Address of the `capacity * DIM` initial-state block, row-major by replicate.
#[no_mangle]
pub extern "C" fn batch_states_ptr() -> *mut f64 {
    unsafe {
        if ARENA_BASE == 0 {
            return core::ptr::null_mut();
        }
        (ARENA_BASE + ARENA_CAPACITY * PARAM_COUNT * F64_BYTES) as *mut f64
    }
}

/// Address of the `capacity * OBS_COUNT` observables block, row-major by
/// replicate. See [`OBS_COUNT`] for the per-row layout.
#[no_mangle]
pub extern "C" fn batch_observables_ptr() -> *mut f64 {
    unsafe {
        if ARENA_BASE == 0 {
            return core::ptr::null_mut();
        }
        (ARENA_BASE + ARENA_CAPACITY * (PARAM_COUNT + DIM) * F64_BYTES) as *mut f64
    }
}

/// Integrates the first `n` replicates for `steps` RK4 steps of size `h` from
/// `t0`, reading parameters and initial states from the arena and writing one
/// [`OBS_COUNT`]-slot row per replicate. Returns 1, or 0 if `n` exceeds the
/// reserved capacity (in which case nothing is written).
///
/// **Allocates nothing.** The per-replicate parameter and state copies are
/// fixed-size arrays on the shadow stack, and the RK4 scratch is the same
/// module-level `K` / `Y_STAGE` / `Y_NEXT` that [`step`] uses. There is no
/// allocator in this binary.
///
/// Each replicate is integrated by the same [`rk4_step`] the single-state path
/// calls, in the same order, so a batch row is bit-identical to running
/// [`step_n`] over that replicate's parameters and initial state. That is
/// asserted host-side with `Object.is` rather than a tolerance -- P7.07's
/// finding was that a 1e-15 tolerance would have passed a kernel whose final
/// increment had been reassociated, and a batch loop that reorders operations
/// is the same failure wearing a different hat.
#[no_mangle]
pub extern "C" fn batch_run(t0: f64, h: f64, steps: usize, n: usize) -> usize {
    unsafe {
        if ARENA_BASE == 0 || n > ARENA_CAPACITY {
            return 0;
        }
        let params_base = batch_params_ptr();
        let states_base = batch_states_ptr();
        let obs_base = batch_observables_ptr();

        for r in 0..n {
            let mut p = [0.0_f64; PARAM_COUNT];
            for (i, slot) in p.iter_mut().enumerate() {
                *slot = *params_base.add(r * PARAM_COUNT + i);
            }
            let mut y = [0.0_f64; DIM];
            for (i, slot) in y.iter_mut().enumerate() {
                *slot = *states_base.add(r * DIM + i);
            }

            // The initial state counts as a sample, so a replicate that never
            // rises still reports its launch height rather than 0.
            let mut max_sampled_y = y[Y];

            for i in 0..steps {
                rk4_step(
                    t0 + (i as f64) * h,
                    &y,
                    h,
                    &p,
                    &mut *(&raw mut K),
                    &mut *(&raw mut Y_STAGE),
                    &mut *(&raw mut Y_NEXT),
                );
                y = *(&raw const Y_NEXT);
                if y[Y] > max_sampled_y {
                    max_sampled_y = y[Y];
                }
            }

            let row = obs_base.add(r * OBS_COUNT);
            *row.add(0) = y[X];
            *row.add(1) = y[Y];
            *row.add(2) = y[VX];
            *row.add(3) = y[VY];
            // Same multiply-don't-accumulate form `step_n` uses for its stage
            // times, for the same reason: it does not drift with `steps`.
            *row.add(4) = t0 + (steps as f64) * h;
            *row.add(5) = max_sampled_y;
        }
        1
    }
}
