# @ballista/wasm-core

The `ballista-core` Rust crate (blueprint §10.2) compiled to
`wasm32-unknown-unknown`, plus the host binding and the tests that hold it to
the TypeScript engine's results. Landed by **P7.07**.

```
crate/                       the Rust crate: RK4 + gravity + quadratic-drag RHS
src/wasm-rk4-backend.ts      the host binding (Float64Array views over wasm memory)
src/simd-benchmark.ts        P7.09's workload, baselines and verdict rule
src/generated/*.wasm         the two committed build outputs
```

Build: `pnpm build:wasm` (builds both). Verify the committed artifacts are
current: `pnpm check:wasm-artifact`. Measure the SIMD speedup: `pnpm bench:simd`.

## What it is for

P7.07 is a spike. Its job was to answer one question — can the numeric core run
in WebAssembly and produce _the same numbers_ — before P7.08–P7.12 build a batch
API, SIMD inner loops and a heterogeneous executor on top of the answer.

The answer is yes, exactly: the WASM kernel is **bit-identical** to
`ClassicalRK4Stepper` over the planar projectile model, 0 ULP, across a
2000-step flight compared at every step and across a spread of states and step
sizes. The criterion asked for agreement within 1e-15; that would have been a
weaker claim, and the section below explains why the difference matters.

## There are two artifacts, and the choice is made before compilation

P7.09 added an f64x2 SIMD batch path, and a module containing simd128
instructions **fails validation** on an engine without the proposal -- at
compile time, not at the call site. So one binary cannot serve both engines:

```
src/generated/ballista-core.wasm        no target features; runs anywhere
src/generated/ballista-core.simd.wasm   -C target-feature=+simd128
```

`wasmSimdSupported()` validates a 43-byte module whose only body is
`v128.const 0; drop`, and `WasmRk4Kernel.instantiateBest()` picks accordingly.
`kernel.hasSimd` reports which artifact actually loaded -- read from the
module's own `simd_enabled` export rather than from the detect -- because a
feature detect never checked against its own outcome is a branch, not a detect.

`batchRunSimd()` on a scalar instance throws rather than falling back silently:
a silent fallback would show up as a 1.0x benchmark with no explanation.

### The SIMD path is bit-identical to the scalar one, not close to it

The lanes are **replicates, not state components**. That is the whole design.
The RHS couples `[x, y, vx, vy]` -- `speed_rel` is `sqrt(vrel_x² + vrel_y²)`, a
reduction _across_ those two lanes -- so an f64x2 laid over the state vector
needs a shuffle and a horizontal add, and reassociation of exactly that kind is
what P7.07 measured to cost 1 ULP. Across replicates there is no reduction:
lane 0 is one trajectory, lane 1 another, they never interact, and every scalar
operation becomes one lane-wise instruction in the same order.

simd128 has no fused multiply-add and `f64x2.sqrt` is correctly rounded per
lane, so there is nothing left for the two paths to disagree about. 0 ULP,
asserted with `Object.is` over every slot of 1001 replicates.

**This ends the moment relaxed-simd is enabled.** `f64x2.relaxed_madd` is
permitted to fuse. Do not add `+relaxed-simd` to this crate without re-deriving
every claim above.

Not built: **f32x4**. Half the mantissa is a different answer, not a tolerance;
it would break the 0-ULP chain back to `ClassicalRK4Stepper` and cannot meet
P7.11's `max rel. diff < 1e-12` at all. The task title named it as a means, the
validation line named the end.

### The measured speedup, and what is honestly not explained about it

2.19x against the committed scalar artifact (criterion: >=1.8x), recorded in
`scripts/simd-speedup-results.json`. f64x2 has two lanes, so that is **above**
the ceiling the claim commit predicted, and the excess is only partly accounted
for: a control giving the scalar path local rather than module-level RK4
scratch buys 1.05x, leaving 2.08x against the fairest baseline. That residual
is not per-replicate overhead and not branch behaviour -- the ratio is stable
across three (replicates x steps) splits and on an ensemble where the
running-max branch never fires. It is recorded as unattributed. Do not repeat a
cause for it that has not been measured.

## Two decisions worth knowing before changing anything here

### There is no wasm-bindgen

The task title proposed it. It is not used, and that is deliberate — the same
reading P7.06 applied to "pooled buffers" and P7.05 to `fuseForces`: the title
names a _means_ and the validation line names the _end_.

The kernel's entire interface is `f64` over linear memory. `extern "C"` plus
`WebAssembly.Memory` gives that directly, and the host binding is ~40 lines of
`Float64Array` views. wasm-bindgen exists to marshal rich types across the
boundary, and this crate has none. It would also put a generated glue layer in
charge of the memory layout that **P7.08's zero-copy batch API needs to own**,
and it adds a build-time binary (`wasm-bindgen-cli`) that neither the dev
environment nor CI has. If a later task needs strings, structs or JS objects
across the boundary, that is the point to reconsider.

### The `.wasm` is committed, and that is load-bearing

CI has no Rust toolchain. If the artifact were built rather than committed, the
one test that checks P7.07's criterion would skip on every CI run, and the
criterion would be verified nowhere. Committing it means CI runs the real
comparison against the real binary.

The cost is that a build output in version control can drift from its source.
`wasm-artifact-freshness.test.ts` pays that down: wherever cargo and the wasm32
target exist it rebuilds and compares bytes, and elsewhere it skips. So a
drifted artifact fails for everyone who can rebuild it. **A skip is not a
pass** — if this only ever skips, a stale artifact could sit in the tree
indefinitely. Revisit if P7.11's equivalence CI gains a Rust toolchain.

## Why the test asserts bit-identity and not 1e-15

The criterion reads "matches TS within 1e-15 per step (same order of ops)". The
parenthesis is the substance. Two implementations that agree mathematically can
differ in the last few ULP, and a tolerance hides exactly the divergence the
parenthesis is there to prevent.

This was measured rather than assumed. Rewriting the final update from
`y[i] + h * (b0*k0 + b1*k1 + ...)` to the accumulate-as-you-go
`((y[i] + h*b0*k0) + h*b1*k1) + ...` — the reassociation
`explicit-rk-kernel.ts` warns about in its own doc comment — produces a **1 ULP
divergence**, which the bit-identity assertions catch in three tests. At these
magnitudes 1 ULP is around 1e-16 relative, so **the criterion as literally
written would have passed that broken build.**

The converse was also measured. RK4's `a` rows contain explicit zeros
(`[0, 0.5]`, `[0, 0, 1]`) which the tableau-driven TS loop multiplies rather
than skips. Skipping them in the port changes nothing — adding ±0.0 to a finite
accumulator is exact — so that transcription choice is defensible but is _not_
what makes the port exact. The grouping of the final increment is.

Three properties make 0 ULP reachable at all, and breaking any of them ends it:

- **No FMA on either side.** The WebAssembly MVP has no fused-multiply-add
  instruction, and rustc never enables fast-math. `a * b + c` rounds twice on
  both sides.
- **`sqrt` is the hardware instruction on both sides.** `f64::sqrt` lowers to
  `f64.sqrt`; JavaScript's `Math.sqrt` is required to be correctly rounded.
  This is the only reason the crate uses `std` rather than `no_std`.
- **`opt-level = 3` and LTO are safe.** LLVM may not reassociate floating-point
  arithmetic without fast-math, so optimisation cannot change the result.

## Scope, honestly

This kernel targets exactly one configuration: `ConstantAtmosphere`,
`UniformGravity`, `UniformWind`, `ConstantCd`, gravity applied before drag. It
computes neither Reynolds nor Mach, because with a constant `Cd` they cannot
affect the result — an unobservable divergence today and an observable one the
moment a `Cd(Re)` model is wired in, which is why the equivalence test pins
`ConstantCd`. It is a spike, not a backend: nothing in the repository depends on
it, and `.dependency-cruiser.cjs` enforces that until P7.10 adds it to
`runtime`'s allowed imports.
