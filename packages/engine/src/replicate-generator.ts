/**
 * Replicate generator -- turns a {@link UncertainScenarioSpec} and a replicate
 * index into a drawn parameter vector and a concrete {@link ScenarioSpec}
 * (P6.03, blueprint §7 phase 6, §8.5/ADR-011).
 *
 * This task's validation criterion is *"replicate i identical regardless of
 * batch partitioning"*, and the whole design exists to make that a property of
 * the construction rather than something a test happens to observe.
 *
 * ## One substream per (replicate, overlay) pair
 *
 * The obvious implementation gives replicate `i` a single generator and draws
 * the overlays from it in order. That satisfies the criterion, and it is still
 * wrong, for a reason that only shows up when a study is edited rather than
 * re-run: **distributions consume different numbers of raw uniforms**. A
 * `normal` draw takes two (Box-Muller, {@link PCG32.nextGaussian}), a
 * `uniform` takes one, a truncated variant takes one through the inverse CDF.
 * So changing overlay 0 from `uniform` to `normal` shifts every subsequent
 * parameter's draw in every replicate, and a study whose author changed one
 * distribution would see all the others move too. Comparing two studies that
 * differ in one parameter -- which is the entire point of P6.17's sensitivity
 * work -- would be comparing two unrelated ensembles.
 *
 * Giving each `(replicate, overlay)` pair its own PCG32 stream removes that
 * coupling completely: a parameter's draw is a function of the study seed, the
 * replicate index and the overlay index, and of nothing else. Batch
 * partitioning independence then follows for free, because no part of the
 * derivation can see how the work was split.
 *
 * ## Why the stream id is injective, and why that needed care
 *
 * {@link PCG32}'s constructor forms its increment as `(streamId << 1) | 1`
 * masked to 64 bits, so the top bit of a 64-bit `streamId` is **discarded**:
 * `s` and `s + 2^63` are the same stream. A hash of `(i, j)` into 64 bits is
 * therefore not enough on its own -- it is two-to-one onto the streams.
 *
 * So the stream id here is not hashed. It is the plain mixed-radix number
 * `i * OVERLAY_STRIDE + j`, which is injective by construction for
 * `j < OVERLAY_STRIDE`, and which {@link MAX_REPLICATE_INDEX} keeps below
 * `2^63` so no wrap can fold two pairs together. Both bounds are checked
 * rather than assumed. What *is* hashed is the seed: each pair gets a
 * {@link splitmix64}-derived 64-bit seed, so adjacent `(i, j)` pairs start
 * from far-apart states instead of from an arithmetic progression, which is
 * the property nearby PCG streams alone would not give.
 *
 * ## What this module deliberately does not do
 *
 * - **It does not vary `base.seed`.** The base scenario's own seed fixes its
 *   stochastic elements -- the frozen OU wind path of ADR-011 -- and giving
 *   each replicate its own wind realization is P6.16, a separate task with its
 *   own determinism criterion. Every replicate produced here carries the
 *   study's single nominal wind, which is correct for a study whose
 *   uncertainty is in the parameters. P6.16 can build on
 *   {@link writeSpecNumberAtPath} exactly as this module builds on P6.02's
 *   reader.
 * - **It does not integrate anything.** Batching replicates through the solver
 *   and recording observables is P6.04; reducing them in a fixed order is
 *   P6.05.
 */

import {
  sampleDistribution,
  sampleDistributionAntithetic,
  type AntitheticSense,
} from "./distribution.js";
import { PCG32 } from "./random.js";
import { scenarioSpecSchema, type ScenarioSpec } from "./scenario-spec.js";
import { readSpecNumberAtPath, type UncertainScenarioSpec } from "./uncertain-scenario-spec.js";

const MASK64 = (1n << 64n) - 1n;

/**
 * Number of stream ids reserved per replicate, and therefore the maximum
 * number of overlays a study may carry.
 *
 * 2^20 is about a million uncertain parameters -- six orders of magnitude
 * above any real study -- and is chosen generously on purpose: the point of
 * the stride is that the packing `i * stride + j` is injective, and a stride
 * that could plausibly be reached would make that guarantee fragile.
 */
export const OVERLAY_STRIDE = 1 << 20;

/**
 * Largest replicate index whose stream id is guaranteed distinct from every
 * other pair's.
 *
 * `i * OVERLAY_STRIDE + j` must stay below `2^63`, because {@link PCG32}
 * discards the 64th bit of a stream id (see the module doc). With a 2^20
 * stride that caps `i` at `2^43`, and this constant is one below it. It is
 * also comfortably inside `Number.MAX_SAFE_INTEGER`, so the index stays an
 * exact JavaScript number rather than needing a `bigint` at the API surface.
 */
export const MAX_REPLICATE_INDEX = 2 ** 43 - 1;

/**
 * SplitMix64's finalizing mixer (Steele, Lea & Flood 2014).
 *
 * A bijection on 64 bits, which is what makes it safe here: it cannot map two
 * distinct inputs to the same derived seed. Used to turn the study seed and
 * the `(replicate, overlay)` pair into a well-spread starting state, so two
 * adjacent pairs do not begin one increment apart.
 */
function splitmix64(input: bigint): bigint {
  let z = input & MASK64;
  z = (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n;
  z &= MASK64;
  z = (z ^ (z >> 27n)) * 0x94d049bb133111ebn;
  z &= MASK64;
  return (z ^ (z >> 31n)) & MASK64;
}

/**
 * The PCG32 stream id for one uncertain parameter of one replicate.
 *
 * Injective over `0 <= replicateIndex <= MAX_REPLICATE_INDEX` and
 * `0 <= overlayIndex < OVERLAY_STRIDE`; see the module doc for why that
 * matters and why it is not a hash.
 *
 * Exported because it is the concrete statement of this task's reproducibility
 * promise, and a test that only compared generated values could not tell an
 * injective assignment from a lucky one.
 */
export function replicateStreamId(replicateIndex: number, overlayIndex: number): bigint {
  return BigInt(replicateIndex) * BigInt(OVERLAY_STRIDE) + BigInt(overlayIndex);
}

/**
 * The 64-bit seed one uncertain parameter of one replicate starts from.
 *
 * The stream id above is deliberately *not* hashed, because hashing would
 * break its injectivity. That leaves the streams themselves in an arithmetic
 * progression, and streams of an LCG-backed generator whose increments differ
 * by a small constant are the case PCG's own documentation is most cautious
 * about -- distinct sequences, but not chosen independently. Hashing the seed
 * is what buys back the independence: two pairs one stream apart begin from
 * states with no arithmetic relationship.
 *
 * Exported for the same reason {@link replicateStreamId} is: it is a claim,
 * and a test that only compared drawn values could not distinguish "the seeds
 * are well separated" from "the streams differ, so the values differ anyway".
 * Removing the hash from this function passes every value-level assertion in
 * this module's tests, which is precisely why it has its own.
 */
export function replicateSeed(
  studySeed: number,
  replicateIndex: number,
  overlayIndex: number,
): bigint {
  const stream = replicateStreamId(replicateIndex, overlayIndex);
  return splitmix64(BigInt(studySeed) ^ splitmix64(stream));
}

/**
 * The generator that draws one uncertain parameter of one replicate.
 *
 * Depends on exactly three things -- the study seed, the replicate index and
 * the overlay index -- which is the criterion of this task restated as a
 * signature.
 */
export function replicateRng(
  studySeed: number,
  replicateIndex: number,
  overlayIndex: number,
): PCG32 {
  return new PCG32(
    replicateSeed(studySeed, replicateIndex, overlayIndex),
    replicateStreamId(replicateIndex, overlayIndex),
  );
}

/**
 * Returns a copy of `spec` with the number at `path` replaced by `value`.
 *
 * The original is never mutated. Only the objects **along the path** are
 * copied -- everything else is shared with `spec`, which is what keeps a
 * 10^4-replicate study from cloning a tabulated drag curve ten thousand times
 * (P6.04 budgets 50 MB for exactly this run). Specs are treated as immutable
 * data everywhere in the engine, so the sharing is safe; a caller that mutated
 * a returned spec in place would corrupt the base, and must not.
 *
 * Throws if the path does not resolve to a finite number in `spec`. A parsed
 * {@link UncertainScenarioSpec} cannot reach that -- its refinement already
 * proved every overlay path resolves -- so the throw is for direct callers.
 * Prototype keys are refused for the same reason {@link readSpecNumberAtPath}
 * refuses them: a path is data and may have arrived in a shared URL.
 *
 * Exported as the write counterpart of P6.02's reader, so P6.16's per-replicate
 * wind seed has one definition of what a path means rather than a second.
 */
export function writeSpecNumberAtPath(
  spec: ScenarioSpec,
  path: string,
  value: number,
): ScenarioSpec {
  if (readSpecNumberAtPath(spec, path) === undefined) {
    throw new Error(
      `writeSpecNumberAtPath: "${path}" does not resolve to a finite number in this spec`,
    );
  }
  const segments = path.split(".");
  const write = (node: unknown, depth: number): unknown => {
    const segment = segments[depth]!;
    const container = node as Record<string, unknown>;
    const replacement =
      depth === segments.length - 1 ? value : write(container[segment], depth + 1);
    return { ...container, [segment]: replacement };
  };
  return write(spec, 0) as ScenarioSpec;
}

/** One realization of a study: which replicate it is, what was drawn, and the scenario that produces. */
export interface Replicate {
  /** The replicate's index in the study, `0 <= index < study.replicates`. */
  readonly index: number;
  /**
   * The drawn values, in overlay order -- index `j` is `study.overlays[j]`'s
   * draw. Kept alongside the spec because P6.17's sensitivity analysis and
   * P6.09's scatter plots want the input vector, and recovering it by reading
   * the paths back out of the spec would be both slower and a second
   * definition of the mapping.
   */
  readonly values: readonly number[];
  /** The base scenario with every drawn value written back; validated. */
  readonly spec: ScenarioSpec;
}

/**
 * Generates replicate `index` of `study`.
 *
 * The result depends only on the study and the index. Calling this for index
 * `i` alone, or generating `0..N-1` and taking element `i`, or asking a worker
 * pool of any size for a range containing `i`, all produce the identical
 * object -- which is this task's validation criterion.
 *
 * The produced spec is re-parsed by {@link scenarioSpecSchema}, and a failure
 * throws rather than being dropped. Both alternatives are worse: integrating a
 * negative mass would poison the estimator silently, and *discarding* the
 * replicate would be rejection sampling on the output, which changes the
 * distribution being estimated and biases the mean. A study that can draw an
 * invalid parameter is misspecified, and P6.01's truncated distributions are
 * the fix; the message says so. Re-parsing costs about 25 microseconds per
 * replicate (measured), so 10^4 replicates pay a quarter of a second against
 * the same number of trajectory integrations -- there is no case for making
 * this optional.
 *
 * @throws if `index` is not an integer in `[0, MAX_REPLICATE_INDEX]`, if the
 *   study carries more than {@link OVERLAY_STRIDE} overlays, or if the drawn
 *   spec fails the base schema.
 */
export function generateReplicate(study: UncertainScenarioSpec, index: number): Replicate {
  return buildReplicate(study, index, "direct");
}

/**
 * The single definition of "replicate `index` of `study`", parameterised by
 * which half of an antithetic pair it is (P6.12).
 *
 * Both entry points route through here so that the validation, the error
 * messages and the substream derivation cannot drift between the primary and
 * its partner -- a partner built by a second, parallel implementation would be
 * free to accept a parameter vector the primary rejects.
 */
function buildReplicate(
  study: UncertainScenarioSpec,
  index: number,
  sense: AntitheticSense,
): Replicate {
  if (!Number.isInteger(index) || index < 0 || index > MAX_REPLICATE_INDEX) {
    throw new Error(
      `generateReplicate: replicate index must be an integer in [0, ${MAX_REPLICATE_INDEX}], got ${index}`,
    );
  }
  if (study.overlays.length > OVERLAY_STRIDE) {
    throw new Error(
      `generateReplicate: a study may carry at most ${OVERLAY_STRIDE} overlays ` +
        `(the substream stride), got ${study.overlays.length}`,
    );
  }

  const values: number[] = [];
  let spec: ScenarioSpec = study.base;
  study.overlays.forEach((overlay, overlayIndex) => {
    const rng = replicateRng(study.seed, index, overlayIndex);
    const value =
      sense === "direct"
        ? sampleDistribution(overlay.distribution, rng)
        : sampleDistributionAntithetic(overlay.distribution, rng);
    values.push(value);
    spec = writeSpecNumberAtPath(spec, overlay.path, value);
  });

  const parsed = scenarioSpecSchema.safeParse(spec);
  if (!parsed.success) {
    const drawn = study.overlays
      .map((overlay, overlayIndex) => `${overlay.path}=${values[overlayIndex]}`)
      .join(", ");
    throw new Error(
      `generateReplicate: replicate ${index} drew a parameter vector the base schema rejects ` +
        `(${drawn}): ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}. ` +
        "A distribution whose support reaches invalid values needs a truncated variant (P6.01).",
    );
  }

  return { index, values, spec: parsed.data };
}

/**
 * Generates the antithetic partner of replicate `index` (P6.12).
 *
 * Draws from the *same* `(replicate, overlay)` substreams as
 * {@link generateReplicate} for the same index, and mirrors each draw through
 * {@link sampleDistributionAntithetic}. The pair therefore shares nothing but
 * its randomness: every marginal law is unchanged, and each drawn parameter is
 * the reflection of its partner's.
 *
 * Reusing the index's own substreams rather than allocating fresh ones is what
 * makes the pairing a property of the construction, exactly as P6.03's
 * batch-partition independence is. A partner generated alone, or as part of a
 * batch of any size, is the same object, and no scheduler can pair the wrong
 * two replicates because the pairing is not something the scheduler chooses.
 */
export function generateAntitheticReplicate(
  study: UncertainScenarioSpec,
  index: number,
): Replicate {
  return buildReplicate(study, index, "reflected");
}

/**
 * The primary and its partner, in that order (P6.12).
 *
 * The natural unit for an antithetic estimator: the variance reduction comes
 * from averaging *within* a pair before averaging across pairs, so the pair is
 * what a caller should reduce over. Returned as a tuple rather than two calls
 * so that a caller cannot accidentally pair replicate `i` with the partner of
 * `j`.
 */
export function generateAntitheticPair(
  study: UncertainScenarioSpec,
  index: number,
): readonly [primary: Replicate, partner: Replicate] {
  return [generateReplicate(study, index), generateAntitheticReplicate(study, index)];
}

/**
 * Lazily generates `study`'s replicates as antithetic pairs, in index order
 * (P6.12).
 *
 * Yields `2 * ceil(study.replicates / 2)` replicates -- pair `k` is primary `k`
 * followed by its partner -- so an odd `replicates` produces one extra rather
 * than a half pair. Truncating instead would leave the final primary unmatched,
 * and an unmatched draw does not have the pair's variance and would bias the
 * estimator's own error bars downward; rounding up keeps every replicate inside
 * a complete pair, which is the assumption the pair-mean estimator rests on.
 *
 * This is the *option* of P6.12's title. {@link replicates} remains the default
 * because antithetic sampling helps only for observables monotone in the drawn
 * parameters and hurts for ones symmetric about the draw's mean; see
 * {@link sampleDistributionAntithetic}'s note.
 */
export function* antitheticReplicates(study: UncertainScenarioSpec): Generator<Replicate> {
  const pairs = Math.ceil(study.replicates / 2);
  for (let index = 0; index < pairs; index += 1) {
    yield generateReplicate(study, index);
    yield generateAntitheticReplicate(study, index);
  }
}

/**
 * Generates the contiguous range `[start, start + count)` of `study`.
 *
 * This is the shape a worker job takes (P6.04): a pool hands each worker a
 * range, and because every replicate is derived from its own index, the
 * partition it chose cannot affect any result. `count` is allowed to run past
 * `study.replicates` only in the sense that this function does not check it --
 * bounding a batch to the study's `N` is the scheduler's job, and refusing it
 * here would stop a test from generating a replicate to compare against.
 */
export function generateReplicateRange(
  study: UncertainScenarioSpec,
  start: number,
  count: number,
): Replicate[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`generateReplicateRange: count must be a non-negative integer, got ${count}`);
  }
  const batch: Replicate[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    batch.push(generateReplicate(study, start + offset));
  }
  return batch;
}

/**
 * Lazily generates every replicate of `study`, in index order.
 *
 * A generator rather than an array because P6.04 budgets 50 MB for 10^4
 * replicates and a materialized array of specs would spend most of it before
 * the first trajectory is integrated.
 */
export function* replicates(study: UncertainScenarioSpec): Generator<Replicate> {
  for (let index = 0; index < study.replicates; index += 1) {
    yield generateReplicate(study, index);
  }
}
