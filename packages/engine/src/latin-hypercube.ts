/**
 * Latin hypercube sampling of a study's uniforms (P6.14, blueprint §7 phase 6).
 *
 * Plain Monte Carlo draws each replicate's uniform independently, so with `N`
 * replicates the realised coverage of `(0, 1)` is itself random: gaps and
 * clumps of order `1/sqrt(N)` are normal, and they are what most of the
 * estimator's variance is made of when the observable is smooth. A Latin
 * hypercube removes that source of error by construction. Split `(0, 1)` into
 * `N` equal strata; take exactly one sample from each; and permute the
 * stratum-to-replicate assignment **independently per dimension**, so that
 * every one-dimensional projection of the design is perfectly stratified while
 * the dimensions stay uncorrelated (McKay, Beckman & Conover 1979).
 *
 * ## The constraint this module had to satisfy
 *
 * P6.03 makes replicate `i` a function of the study seed, `i`, and the overlay
 * index, and of nothing else. That is what gives batch-partition independence:
 * a worker pool of any size, handed any contiguous ranges, reproduces the same
 * ensemble because nothing in the derivation can observe how the work was
 * split.
 *
 * Latin hypercube sampling is inherently a *joint* construction over all `N`
 * replicates -- replicate `i`'s stratum in dimension `j` is `pi_j(i)` for a
 * permutation of `0..N-1`. The obvious implementation materialises `pi_j` with
 * Fisher-Yates and indexes it, which needs the whole permutation in hand. That
 * is fine for a scheduler holding the study, and it destroys the property
 * above for anyone asking for one replicate: generating `pi_j` costs `O(N)`, so
 * a study whose replicates are pulled one at a time costs `O(N^2)`, and a
 * worker that only knows its own range cannot build it at all without
 * agreeing with every other worker on the seed *and* the algorithm.
 *
 * So the permutation here is never materialised. It is a **keyed
 * pseudo-random permutation**, evaluated pointwise in `O(1)`: a small Feistel
 * network over a power-of-two domain, plus cycle walking down to exactly
 * `[0, N)`. `pi_j(i)` is then a pure function of `(seed, N, j, i)`, which is
 * P6.03's property with `N` added -- and `N` has to be there, because a
 * stratification into `N` bands is not defined without it.
 *
 * ## What that means for a caller, and it is a real caveat
 *
 * **Changing a study's replicate count changes every replicate it produces.**
 * Under plain Monte Carlo, raising `N` from 1000 to 2000 keeps the first 1000
 * replicates and appends 1000 more, so an estimator can be refined
 * incrementally. Under LHS it cannot: the strata are `1/2000` wide instead of
 * `1/1000`, so every sample moves. This is inherent to the method rather than
 * to this implementation -- there is no Latin hypercube that is also a prefix
 * of a larger one -- and it is the main reason LHS is an option here and not
 * the default. A convergence study that sweeps `N` is measuring a sequence of
 * unrelated designs, which is fine as long as nobody reads it as a refinement.
 *
 * ## Why a Feistel network rather than a hash
 *
 * A stratum assignment must be a *bijection*: exactly one replicate per
 * stratum is the entire content of "Latin". A hash of `(seed, N, j, i)` reduced
 * mod `N` is not one -- it collides, so some strata would take two samples and
 * others none, which is plain stratified-with-replacement sampling and gives
 * back much of the variance the method exists to remove. A Feistel network is
 * a bijection by construction, whatever the round function does, because each
 * round is invertible; that is exactly the guarantee needed, and it survives
 * any change to the mixing.
 */

import { distributionQuantile } from "./distribution.js";
import { replicateRng, writeSpecNumberAtPath, type Replicate } from "./replicate-generator.js";
import { scenarioSpecSchema, type ScenarioSpec } from "./scenario-spec.js";
import type { UncertainScenarioSpec } from "./uncertain-scenario-spec.js";

const MASK64 = (1n << 64n) - 1n;

/**
 * Rounds in the Feistel network.
 *
 * Four is the standard choice, and the Luby-Rackoff results say three already
 * suffice to make a balanced network indistinguishable from a random
 * permutation against a bounded adversary. Nothing here is adversarial -- the
 * requirement is only that strata do not correlate with replicate index in a
 * way a sensitivity study could pick up -- so four rounds is comfortable
 * margin rather than a tuned figure.
 */
const FEISTEL_ROUNDS = 4;

/**
 * Largest replicate count this module will stratify.
 *
 * The Feistel domain is the next power of two at or above `N`, split into two
 * halves; capping `N` at `2^40` keeps both halves inside the exact-integer
 * range with room to spare, and is some six orders of magnitude above the
 * `10^4` replicates P6.04 budgets for. Exceeding it is a caller error rather
 * than something to silently degrade.
 */
export const MAX_LHS_REPLICATES = 2 ** 40;

/** SplitMix64's finalizing mixer -- a bijection on 64 bits, used for key derivation. */
function splitmix64(input: bigint): bigint {
  let z = input & MASK64;
  z = (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n;
  z &= MASK64;
  z = (z ^ (z >> 27n)) * 0x94d049bb133111ebn;
  z &= MASK64;
  return (z ^ (z >> 31n)) & MASK64;
}

/**
 * The key for dimension `overlayIndex` of a study.
 *
 * Depends on the replicate count as well as the seed, because a permutation of
 * `0..N-1` is a different object for a different `N`. Depends on the overlay
 * index because the whole point is that dimensions are permuted
 * *independently*: sharing one permutation across dimensions would place every
 * replicate on the hypercube's diagonal, which is perfectly stratified in each
 * margin and a catastrophe as a design.
 */
function dimensionKey(studySeed: number, replicates: number, overlayIndex: number): bigint {
  return splitmix64(
    splitmix64(BigInt(studySeed)) ^
      splitmix64(BigInt(replicates)) ^
      splitmix64(BigInt(overlayIndex) + 0x9e3779b97f4a7c15n),
  );
}

/** Half-width in bits of the Feistel domain: the smallest `h` with `2^(2h) >= n`. */
function halfBits(n: number): number {
  let bits = 1;
  while (2 ** (2 * bits) < n) bits += 1;
  return bits;
}

/**
 * One round of the Feistel network.
 *
 * The round function may be anything at all without threatening bijectivity,
 * which is why a cheap mixer is the right choice: `splitmix64` over the round
 * index, the key and the right half, truncated to the half-width.
 */
function feistelRound(right: number, round: number, key: bigint, mask: number): number {
  const mixed = splitmix64(key ^ splitmix64(BigInt(round) * 0x9e3779b97f4a7c15n + BigInt(right)));
  return Number(mixed & BigInt(mask));
}

/**
 * The balanced Feistel permutation on `[0, 2^(2*bits))`.
 *
 * Split and recombine use arithmetic rather than `>>>` and `|` deliberately:
 * the domain reaches `2^40` at {@link MAX_LHS_REPLICATES}, and JavaScript's
 * bitwise operators truncate to 32 bits, so a shift-based split would silently
 * fold the domain for any study past about a million replicates. The halves
 * themselves stay under `2^20`, so the XOR inside the round is safe.
 */
function feistel(input: number, bits: number, key: bigint): number {
  const size = 2 ** bits;
  const mask = size - 1;
  let left = Math.floor(input / size);
  let right = input % size;
  for (let round = 0; round < FEISTEL_ROUNDS; round += 1) {
    const next = left ^ feistelRound(right, round, key, mask);
    left = right;
    right = next;
  }
  return left * size + right;
}

/**
 * The stratum replicate `replicateIndex` occupies in dimension `overlayIndex`.
 *
 * A bijection from `[0, replicates)` onto itself for each fixed dimension --
 * which is the Latin property, and is verified directly in this module's
 * tests rather than inferred from the construction.
 *
 * Cycle walking is what narrows the power-of-two Feistel domain to exactly
 * `[0, replicates)`: apply the permutation repeatedly until the image lands in
 * range. It terminates because iterating a bijection from a point inside the
 * range must eventually return to that point, and it is cheap because the
 * domain is under four times `N`, so the expected number of applications is
 * below four and independent of `N`.
 */
export function latinHypercubeStratum(
  studySeed: number,
  replicates: number,
  replicateIndex: number,
  overlayIndex: number,
): number {
  assertReplicateCount(replicates);
  if (!Number.isInteger(replicateIndex) || replicateIndex < 0 || replicateIndex >= replicates) {
    throw new Error(
      `latinHypercubeStratum: replicate index must be an integer in [0, ${replicates}), got ${replicateIndex}`,
    );
  }
  const bits = halfBits(replicates);
  const key = dimensionKey(studySeed, replicates, overlayIndex);
  let value = replicateIndex;
  // Bounded by the domain size, so a bug in `feistel` surfaces as a throw
  // rather than as a hang.
  const limit = 2 ** (2 * bits) + 1;
  for (let step = 0; step < limit; step += 1) {
    value = feistel(value, bits, key);
    if (value < replicates) return value;
  }
  throw new Error(
    "latinHypercubeStratum: cycle walking did not terminate; the Feistel permutation is not a bijection",
  );
}

function assertReplicateCount(replicates: number): void {
  if (!Number.isInteger(replicates) || replicates < 1 || replicates > MAX_LHS_REPLICATES) {
    throw new Error(
      `latin hypercube: replicate count must be an integer in [1, ${MAX_LHS_REPLICATES}], got ${replicates}`,
    );
  }
}

/**
 * The stratified uniform for one replicate and one dimension.
 *
 * `(stratum + jitter) / N`, with the jitter drawn from the replicate's own
 * `(replicate, overlay)` substream -- the same stream P6.03 gives the direct
 * draw, so the uniform still depends on nothing but the study seed, `N`, the
 * replicate index and the overlay index.
 *
 * The jitter is what keeps the estimator unbiased. Placing each sample at its
 * stratum's midpoint, `(k + 0.5) / N`, gives a lower-variance design and a
 * *biased* one: it is a deterministic quadrature rule wearing a Monte Carlo
 * costume, its error has no distribution, and the sample standard deviation
 * across replicates would no longer estimate anything. With a uniform jitter
 * each sample is still uniform on its own stratum, so the mean over replicates
 * remains an unbiased estimator of `E[f]` and its spread remains meaningful.
 */
export function latinHypercubeUniform(
  studySeed: number,
  replicates: number,
  replicateIndex: number,
  overlayIndex: number,
): number {
  const stratum = latinHypercubeStratum(studySeed, replicates, replicateIndex, overlayIndex);
  const jitter = replicateRng(studySeed, replicateIndex, overlayIndex).nextF64();
  const u = (stratum + jitter) / replicates;
  // `distributionQuantile` requires the open interval. `stratum + jitter` is in
  // `[0, N)` so `u < 1` always, but `u === 0` is reachable when stratum 0 draws
  // a jitter of exactly 0, which `nextF64` can return.
  return u > 0 ? u : Number.MIN_VALUE;
}

/**
 * Generates replicate `index` of `study` under Latin hypercube sampling
 * (P6.14).
 *
 * The result depends only on the study -- including its replicate count -- and
 * the index, so batch-partition independence carries over from P6.03
 * unchanged. See the module doc for the one behavioural difference that
 * matters: changing `study.replicates` changes every replicate, because the
 * strata themselves change.
 *
 * @throws if `index` is outside `[0, study.replicates)`, or if the drawn spec
 *   fails the base schema -- the same contract as `generateReplicate`, and for
 *   the same reason: silently dropping an invalid replicate would be rejection
 *   sampling on the output and would bias the mean.
 */
export function generateLatinHypercubeReplicate(
  study: UncertainScenarioSpec,
  index: number,
): Replicate {
  const values: number[] = [];
  let spec: ScenarioSpec = study.base;
  study.overlays.forEach((overlay, overlayIndex) => {
    const u = latinHypercubeUniform(study.seed, study.replicates, index, overlayIndex);
    const value = distributionQuantile(overlay.distribution, u);
    values.push(value);
    spec = writeSpecNumberAtPath(spec, overlay.path, value);
  });

  const parsed = scenarioSpecSchema.safeParse(spec);
  if (!parsed.success) {
    const drawn = study.overlays
      .map((overlay, overlayIndex) => `${overlay.path}=${values[overlayIndex]}`)
      .join(", ");
    throw new Error(
      `generateLatinHypercubeReplicate: replicate ${index} drew a parameter vector the base schema rejects ` +
        `(${drawn}): ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}. ` +
        "A distribution whose support reaches invalid values needs a truncated variant (P6.01).",
    );
  }

  return { index, values, spec: parsed.data };
}

/**
 * Lazily generates every replicate of `study` as a Latin hypercube, in index
 * order (P6.14).
 *
 * This is the *option* of the task's title: the `replicates` generator in
 * `replicate-generator.ts` remains the default. LHS is the better choice when
 * the observable is smooth in the drawn parameters, which is the common case
 * and the one measured in
 * `packages/analysis/src/latin-hypercube-variance-reduction.test.ts`. It has
 * little to offer when the response is dominated by a threshold or a
 * discontinuity, and it cannot be extended incrementally in `N`.
 */
export function* latinHypercubeReplicates(study: UncertainScenarioSpec): Generator<Replicate> {
  for (let index = 0; index < study.replicates; index += 1) {
    yield generateLatinHypercubeReplicate(study, index);
  }
}
