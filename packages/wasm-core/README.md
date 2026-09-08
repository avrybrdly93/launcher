# @ballista/wasm-core

The `ballista-core` Rust crate (blueprint §10.2) compiled to
`wasm32-unknown-unknown`, plus the host binding and the tests that hold it to
the TypeScript engine's results. Landed by **P7.07**.

```
crate/                  the Rust crate: RK4 + gravity + quadratic-drag RHS
src/wasm-rk4-backend.ts the host binding (Float64Array views over wasm memory)
src/generated/*.wasm    the committed build output
```

Build: `pnpm build:wasm`. Verify the committed artifact is current:
`pnpm check:wasm-artifact`.

## What it is for

P7.07 is a spike. Its job was to answer one question — can the numeric core run
in WebAssembly and produce _the same numbers_ — before P7.08–P7.12 build a batch
API, SIMD inner loops and a heterogeneous executor on top of the answer.

The answer is yes, exactly: the WASM kernel is **bit-identical** to
`ClassicalRK4Stepper` over the planar projectile model, 0 ULP, across a
2000-step flight compared at every step and across a spread of states and step
sizes. The criterion asked for agreement within 1e-15; that would have been a
weaker claim, and the section below explains why the difference matters.

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
