/**
 * PCG32 (XSH-RR variant, O'Neill 2014) seeded PRNG.
 *
 * Deterministic reproducibility (§8.5, ADR-011) requires that the same seed
 * always produce the same sequence, and that Monte Carlo replicates draw from
 * independent, non-overlapping streams rather than a single shared generator.
 * PCG32's stream (`inc`) parameter gives that for free: distinct odd `inc`
 * values are different, uncorrelated sequences from the same underlying LCG.
 */

const MASK64 = (1n << 64n) - 1n;
const MULT = 6364136223846793005n;

export class PCG32 {
  private state: bigint;
  private readonly inc: bigint;
  private cachedGaussian: number | null = null;

  constructor(seed: bigint, streamId: bigint = 0n) {
    this.inc = ((streamId << 1n) | 1n) & MASK64;
    this.state = 0n;
    this.step();
    this.state = (this.state + seed) & MASK64;
    this.step();
  }

  /** Derive an independent substream from this generator's seed lineage. */
  substream(streamId: bigint): PCG32 {
    return new PCG32(this.state & MASK64, streamId);
  }

  private step(): bigint {
    const oldState = this.state;
    this.state = (oldState * MULT + this.inc) & MASK64;
    return oldState;
  }

  nextU32(): number {
    const oldState = this.step();
    const xorshifted = Number((((oldState >> 18n) ^ oldState) >> 27n) & 0xffffffffn);
    const rot = Number(oldState >> 59n);
    return ((xorshifted >>> rot) | (xorshifted << (-rot & 31))) >>> 0;
  }

  /** Uniform double in [0, 1). */
  nextF64(): number {
    return this.nextU32() / 4294967296;
  }

  /** Standard normal via Box–Muller, caching the paired sample. */
  nextGaussian(): number {
    if (this.cachedGaussian !== null) {
      const g = this.cachedGaussian;
      this.cachedGaussian = null;
      return g;
    }
    let u1 = this.nextF64();
    while (u1 === 0) u1 = this.nextF64();
    const u2 = this.nextF64();
    const r = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    this.cachedGaussian = r * Math.sin(theta);
    return r * Math.cos(theta);
  }
}
