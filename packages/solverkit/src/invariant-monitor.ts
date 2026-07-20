import type { EvalContext, InvariantSpec, Model } from "@ballista/engine";
import type { Sink, SolveReport, StepResult, Stepper } from "./types.js";

/** Frozen residual trace produced by {@link InvariantMonitor.channel} (§3.8, §5.1). */
export interface InvariantResidualChannel {
  readonly name: string;
  readonly t: Float64Array;
  /** R(t) = value(t) - value(0) - integral(power, 0, t) (eq. 3.19's R_E for the energy invariant). */
  readonly residual: Float64Array;
}

/** Gauss-Legendre nodes/weights on [-1, 1] for n = 1..4 points (Abramowitz & Stegun 25.4.29-30). */
const GAUSS_LEGENDRE: ReadonlyMap<
  number,
  { readonly nodes: readonly number[]; readonly weights: readonly number[] }
> = new Map([
  [1, { nodes: [0], weights: [2] }],
  [2, { nodes: [-0.5773502691896257, 0.5773502691896257], weights: [1, 1] }],
  [
    3,
    {
      nodes: [-0.7745966692414834, 0, 0.7745966692414834],
      weights: [0.5555555555555556, 0.8888888888888888, 0.5555555555555556],
    },
  ],
  [
    4,
    {
      nodes: [-0.8611363115940526, -0.3399810435848563, 0.3399810435848563, 0.8611363115940526],
      weights: [0.3478548451374538, 0.6521451548625461, 0.6521451548625461, 0.3478548451374538],
    },
  ],
]);

const MAX_GAUSS_NODES = 4;

/**
 * n-point Gauss-Legendre quadrature is exact for polynomials up to degree
 * 2n-1, giving local (per-step) error O(h^(2n+1)) -- to match a stepper of
 * global order p (local truncation error O(h^(p+1))), n must satisfy
 * 2n+1 >= p+1, i.e. n >= p/2. Clamped to the largest tabulated rule since no
 * currently-registered stepper exceeds order 5.
 */
function gaussNodeCountForOrder(order: number): number {
  return Math.min(MAX_GAUSS_NODES, Math.max(1, Math.ceil(order / 2)));
}

const DEFAULT_INITIAL_CAPACITY = 64;

/**
 * `InvariantMonitor` sink (P2.37, §3.8 eq. 3.19, §5.1): tracks the residual
 * R(t) = value(t) - value(0) - integral(power, 0, t) of a declared
 * `InvariantSpec` (by default "energy") as a first-class diagnostic
 * channel. `power` (dE/dt = F_aero.v for the energy invariant) is
 * quadrature-accumulated per accepted step at Gauss-Legendre nodes whose
 * count is chosen so the quadrature's own local error matches or exceeds
 * the stepper's local truncation order (see {@link gaussNodeCountForOrder}) --
 * otherwise the residual would just measure quadrature error instead of
 * solver error. This requires evaluating the state *inside* each step, so
 * it reads `stepper.interpolant` (dense output) when available; a stepper
 * without one (no `HermiteDenseOutputStepper` wrap, no native dense output)
 * falls back to trapezoidal quadrature on the step's endpoints alone,
 * which under-matches any stepper of order > 2.
 *
 * Both `model.rhs` (to refresh `ctx`'s environment sample before the
 * invariant reads it, mirroring how every other invariant/force evaluation
 * in this codebase is only meaningful right after an rhs call for the same
 * state) and the invariant's `evaluate`/`power` are re-run at every
 * quadrature node, so this sink is opt-in (like `TrajectoryRecorder`) --
 * batch/Monte Carlo runs that don't need it skip the extra rhs calls
 * entirely by not attaching it.
 */
export class InvariantMonitor implements Sink {
  readonly id: string;

  private readonly ctx: EvalContext;
  private readonly stepper: Stepper;
  private readonly invariant: InvariantSpec;
  private readonly quadrature: {
    readonly nodes: readonly number[];
    readonly weights: readonly number[];
  };

  private model: Model | undefined;
  private readonly yNode: Float64Array;
  private readonly rhsScratch: Float64Array;
  private readonly yPrev: Float64Array;

  private value0 = 0;
  private workIntegral = 0;
  private tPrev = 0;

  private tBuf: Float64Array;
  private residualBuf: Float64Array;
  private count = 0;
  private channelSnapshot: InvariantResidualChannel | undefined;

  constructor(
    model: Model,
    ctx: EvalContext,
    stepper: Stepper,
    invariantName: string = "energy",
    initialCapacity: number = DEFAULT_INITIAL_CAPACITY,
  ) {
    const spec = model.invariants?.find((inv) => inv.name === invariantName);
    if (!spec) {
      throw new Error(`InvariantMonitor: model declares no invariant named "${invariantName}"`);
    }
    if (!spec.power) {
      throw new Error(
        `InvariantMonitor: invariant "${invariantName}" declares no power() -- work-integral quadrature needs one`,
      );
    }

    this.id = `invariant-monitor:${invariantName}`;
    this.ctx = ctx;
    this.stepper = stepper;
    this.invariant = spec;
    this.quadrature = GAUSS_LEGENDRE.get(gaussNodeCountForOrder(stepper.info.order))!;

    this.yNode = new Float64Array(model.dim);
    this.rhsScratch = new Float64Array(model.dim);
    this.yPrev = new Float64Array(model.dim);

    this.tBuf = new Float64Array(Math.max(1, initialCapacity));
    this.residualBuf = new Float64Array(Math.max(1, initialCapacity));
  }

  /** @inheritDoc */
  start(model: Model, t0: number, y0: Float64Array): void {
    this.model = model;
    model.rhs(t0, y0, this.rhsScratch, this.ctx);
    this.value0 = this.invariant.evaluate(t0, y0, this.ctx);
    this.workIntegral = 0;
    this.tPrev = t0;
    this.yPrev.set(y0);
    this.count = 0;
    this.recordRow(t0, 0);
  }

  /** @inheritDoc */
  accept(t: number, y: Float64Array, _step: StepResult): void {
    const model = this.model;
    if (!model) throw new Error("InvariantMonitor.accept called before start()");

    const h = t - this.tPrev;
    if (h > 0) {
      this.workIntegral += this.stepper.interpolant
        ? this.quadratureWork(model, h)
        : this.trapezoidalWork(model, h, y);
    }

    model.rhs(t, y, this.rhsScratch, this.ctx);
    const value = this.invariant.evaluate(t, y, this.ctx);
    this.recordRow(t, value - this.value0 - this.workIntegral);

    this.tPrev = t;
    this.yPrev.set(y);
  }

  /** @inheritDoc */
  finish(_report: SolveReport): void {
    this.channelSnapshot = Object.freeze({
      name: this.invariant.name,
      t: this.tBuf.subarray(0, this.count),
      residual: this.residualBuf.subarray(0, this.count),
    });
  }

  /** The frozen residual trace; only valid after `finish` has run. */
  get channel(): InvariantResidualChannel {
    if (!this.channelSnapshot) {
      throw new Error("InvariantMonitor.channel read before finish()");
    }
    return this.channelSnapshot;
  }

  /** Gauss-Legendre quadrature of `power` over [tPrev, tPrev+h] via the stepper's dense output. */
  private quadratureWork(model: Model, h: number): number {
    const { nodes, weights } = this.quadrature;
    let stepWork = 0;
    for (let i = 0; i < nodes.length; i++) {
      const theta = (nodes[i]! + 1) / 2;
      this.stepper.interpolant!(theta, this.yNode);
      const tNode = this.tPrev + theta * h;
      model.rhs(tNode, this.yNode, this.rhsScratch, this.ctx);
      stepWork += weights[i]! * this.invariant.power!(tNode, this.yNode, this.ctx);
    }
    return (h / 2) * stepWork;
  }

  /** Endpoints-only fallback (order 2) for steppers with no dense output. */
  private trapezoidalWork(model: Model, h: number, y: Float64Array): number {
    model.rhs(this.tPrev, this.yPrev, this.rhsScratch, this.ctx);
    const powerStart = this.invariant.power!(this.tPrev, this.yPrev, this.ctx);
    const tEnd = this.tPrev + h;
    model.rhs(tEnd, y, this.rhsScratch, this.ctx);
    const powerEnd = this.invariant.power!(tEnd, y, this.ctx);
    return 0.5 * h * (powerStart + powerEnd);
  }

  private recordRow(t: number, residual: number): void {
    if (this.count === this.tBuf.length) this.grow();
    this.tBuf[this.count] = t;
    this.residualBuf[this.count] = residual;
    this.count++;
  }

  private grow(): void {
    const newCapacity = this.tBuf.length * 2;
    const grownT = new Float64Array(newCapacity);
    grownT.set(this.tBuf);
    this.tBuf = grownT;
    const grownResidual = new Float64Array(newCapacity);
    grownResidual.set(this.residualBuf);
    this.residualBuf = grownResidual;
  }
}
