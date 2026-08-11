import type { EvalContext } from "@ballista/engine";
import { type AimBounds, aimActiveSet, validateAimBounds } from "./constraints.js";
import {
  type NelderMeadBound,
  type NelderMeadOptions,
  type NelderMeadResult,
  nelderMead,
} from "./nelder-mead.js";
import { type NewtonShootingOptions, newtonShooting } from "./newton-shooting.js";
import {
  type Aim,
  type ResidualFunction,
  type ShootingProblem,
  createShootingResidual,
} from "./shooting-residual.js";
import { smartInitialAim } from "./smart-init.js";

/**
 * Wind-robust aim (§7 Phase 5, P5.17): the aim that minimizes a risk measure of
 * the miss over an *ensemble* of winds, rather than the aim that hits exactly
 * under one of them.
 *
 * **Why the two answers differ, which is the whole content of the task.**
 * P5.06's Newton solve drives the P5.04 residual to zero for the wind it is
 * handed. Call that the *nominal* aim. It is optimal only if that wind is what
 * actually blows. Fire the same shot into a stronger gust and it falls short,
 * because a headwind can only shorten the range — so the nominal aim's miss
 * distribution is one-sided: zero in the nominal case and a deficit in every
 * windier one. Giving up a little range accuracy in the nominal case buys back
 * more than it costs in the gust case, and the aim that strikes that balance is
 * a different aim. That gap is what {@link RobustAimResult.shift} measures and
 * what this task's validation criterion asks for.
 *
 * **Why the two aims cannot simply both be made to hit.** With two scenarios
 * there are two conditions and two unknowns, which looks solvable. It is not:
 * for any fixed `(θ, v₀)` a stronger headwind gives a *strictly* shorter range,
 * so `R(θ, v₀; w_gust) < R(θ, v₀; w_nominal)` everywhere and the two conditions
 * `R = x*` are inconsistent. There is no wind-insensitive aim to find, and the
 * minimum risk is strictly positive. A solver reporting zero risk on a
 * multi-scenario ensemble has a bug.
 *
 * **Why the outer loop is derivative-free.** A gradient here would need the
 * derivative of every scenario's impact with respect to the aim — P5.05's
 * Jacobian once per scenario per step — and that Jacobian is rank 1 for a
 * ground-impact terminal event (see P5.05/P5.06), so the assembled system is
 * ill-conditioned in exactly the direction the risk measure cares least about.
 * P5.11's {@link nelderMead} needs no derivative, already carries box bounds and
 * restarts, and the objective is cheap enough at the ensemble sizes this task is
 * for. The cost model is explicit rather than hidden:
 * {@link RobustAimResult.integrations} counts trajectories, which is
 * `evaluations × scenarios`.
 *
 * **THE TWO-VARIABLE PROBLEM IS UNBOUNDED, AND THAT IS PHYSICS, NOT A BUG.**
 * Wind acts on the shot for as long as the shot is in the air, so shortening the
 * time of flight shrinks every scenario's spread at once. Firing flatter and
 * faster does exactly that, and nothing in the objective pushes back: as
 * `v₀ → ∞` with `θ → 0` chosen to keep the target in reach, the time of flight
 * tends to zero and so does the risk. The infimum is 0 and it is not attained.
 * Measured on this module's own exhibit (1 kg 5 cm sphere, `Cd` 0.47, target
 * 400 m downrange, headwind −6 m/s versus gust −16 m/s, equal weights): an
 * unbounded two-variable solve walks off to `θ ≈ 3.1e-4 rad, v₀ ≈ 3.59e3 m/s`,
 * cutting RMS miss from 45.49 m to 0.60 m and still descending when the
 * iteration limit stops it. That is a real answer to the question as posed and a
 * useless answer to the question meant, so:
 *
 * - Use {@link RobustAimOptions.vary} `"theta"` to hold the launch speed fixed.
 *   This is the well-posed form and the one a launcher actually faces — the
 *   speed is a property of the machine — and its optimum is *interior*: at fixed
 *   `v₀` the elevation trades range against time of flight, so there is a real
 *   balance to strike rather than a boundary to run to.
 * - Or supply {@link RobustAimOptions.bounds}. Bounds make the answer finite but
 *   do not make it interior: the minimizer lands *on* the speed cap, because the
 *   descent direction still points at more speed. A bounded solve reports which
 *   faces are active via {@link robustAimIsFeasible} and P5.16's `aimActiveSet`.
 *
 * **Conditioning, stated rather than papered over.** Even bounded, `R(θ, v₀)` is
 * not injective — a whole curve of aims shares any given range — and the
 * scenarios' ranges are strongly correlated functions of the aim, so the
 * two-variable risk surface is a *valley*, not a bowl. The risk at the bottom is
 * far better determined than the position along it, and the optimizer may
 * legitimately stop with `"max-restarts"` or `"max-iterations"` rather than
 * `"converged"`. Compare {@link RobustAimResult.risk}, which is what the
 * trade-off pins down, and distrust a large one-coordinate
 * {@link RobustAimResult.shift} that did not move the risk with it.
 *
 * **Integrator.** Wind enters through the drag force's relative velocity, so
 * every scenario here is *dissipative*. These solves therefore run on the
 * embedded Runge–Kutta path {@link createShootingResidual} already requires (it
 * insists on a stepper with a dense-output interpolant). No symplectic scheme is
 * admissible for this problem and none is used: symplectic integration is for
 * conservative dynamics only.
 */

/**
 * One realization of the uncertain wind, with the probability weight attached.
 *
 * Carries an {@link EvalContext} rather than a wind model so that a scenario can
 * differ in *any* environmental respect the context expresses — a gust that also
 * arrives with a density change is one scenario, not two — while the projectile,
 * the model, the target and the launch point stay shared with the base problem
 * and cannot drift between scenarios.
 */
export interface WindScenario {
  /**
   * Human-readable name, used in {@link ScenarioMiss.label} and in error
   * messages. Defaults to the scenario's index.
   */
  readonly label?: string;
  /**
   * Relative likelihood. Must be finite and strictly positive. Weights are
   * normalized internally, so `[1, 1]` and `[7, 7]` describe the same ensemble;
   * a zero weight is rejected rather than normalized away, because a scenario
   * that cannot influence the answer is a mistake in the caller's ensemble
   * rather than a thing to silently integrate.
   */
  readonly weight: number;
  /** Environment and projectile parameters under this realization. */
  readonly ctx: EvalContext;
}

/**
 * How a spread of misses is collapsed into the one number being minimized.
 *
 * All three are reported in **metres**, so they are directly comparable with a
 * miss distance and with each other. `"mean-square"` is the root-mean-square
 * miss rather than the mean square itself for that reason; the square root is
 * monotone, so it does not move the minimizer.
 */
export type RiskMeasure =
  /**
   * Root mean square miss, `√(Σ ŵᵢ mᵢ²)`. The default, and the only one of the
   * three that is **smooth**: squaring removes the kink that `|miss|` has where
   * a scenario's miss passes through zero. Penalizes a large miss
   * disproportionately, which is usually what "robust" is meant to buy.
   */
  | "mean-square"
  /**
   * Weighted mean miss, `Σ ŵᵢ mᵢ`. Kinked wherever a scenario's miss changes
   * sign, which Nelder–Mead tolerates and a gradient method would not.
   */
  | "mean-absolute"
  /**
   * Largest miss over the ensemble, `maxᵢ mᵢ` — minimax, ignoring the weights
   * entirely except that a scenario must be present to count. Weights are still
   * required and still validated, so switching measures cannot silently change
   * which scenarios are in play.
   */
  | "worst-case";

/** What one scenario did at one aim. */
export interface ScenarioMiss {
  /** {@link WindScenario.label}, or the index as a string when none was given. */
  readonly label: string;
  /** The scenario's weight after normalization; sums to 1 across the ensemble. */
  readonly weight: number;
  /**
   * Miss distance in metres, or `null` when the flight failed (no impact inside
   * the time span, a rejected step, an inadmissible aim). `null` rather than a
   * large number so that a failure cannot be mistaken for a bad-but-real shot.
   */
  readonly miss: number | null;
  /**
   * The miss *vector* — P5.04's residual, impact minus target, in the layout's
   * axis order — or `null` on failure. Retained because the sign is what says
   * whether a shot fell short or overshot, and {@link miss} throws that away.
   */
  readonly missVector: readonly number[] | null;
}

/**
 * Which components of the aim the optimizer is allowed to move.
 *
 * Exists because the choice changes whether the problem is well posed at all —
 * see the note on unboundedness in this module's header. `"theta"` is the
 * physically ordinary case and the one with an interior optimum.
 */
export type VaryAim =
  /** Both `θ` and `v₀`. Unbounded unless {@link RobustAimOptions.bounds} is set. */
  | "both"
  /** Elevation only; launch speed held at the starting aim's. Well posed. */
  | "theta"
  /** Launch speed only; elevation held at the starting aim's. */
  | "speed";

/** Tuning for {@link robustAim}. Every field has a defensible default. */
export interface RobustAimOptions {
  /** Which risk measure to minimize. Defaults to `"mean-square"`. */
  readonly risk?: RiskMeasure;
  /**
   * Which aim components to optimize. Defaults to `"both"`, which matches the
   * task's wording but is unbounded without {@link bounds}; `"theta"` is the
   * well-posed form.
   */
  readonly vary?: VaryAim;
  /**
   * Miss, in metres, within which the nominal baseline counts as a hit. Above it
   * the result's status is `"nominal-failed"`, because a baseline that does not
   * hit is not a baseline. Defaults to `1e-6`.
   */
  readonly nominalTolerance?: number;
  /**
   * Box bounds on the aim, in P5.16's vocabulary so that a caller already
   * holding an {@link AimBounds} does not have to restate it. Passed through to
   * the optimizer, which enforces them by coordinate transform, so the returned
   * aim is feasible by construction rather than by projection afterwards.
   */
  readonly bounds?: AimBounds;
  /**
   * Which scenario counts as nominal — the one whose wind the baseline aim is
   * solved against. Defaults to `0`.
   */
  readonly nominalIndex?: number;
  /**
   * Use this aim as the nominal baseline instead of solving for one. Skips the
   * inner Newton solve entirely, which is the way to compare against an aim that
   * came from somewhere else (a min-energy solution, a UI slider, a previous
   * run).
   */
  readonly nominalAim?: Aim;
  /**
   * Where the optimizer starts. Defaults to the nominal aim, which is the right
   * default precisely because the answer is expected to be near it.
   */
  readonly initialAim?: Aim;
  /**
   * Initial simplex edge as `[θ in radians, v₀ in m/s]`. Defaults to
   * `[0.02, 1]`.
   *
   * Not left to {@link NelderMeadOptions.initialStep}'s relative-5% rule,
   * because the two coordinates are in unrelated units and that rule reads the
   * numbers rather than the physics: at a typical aim of `0.65 rad, 95 m/s` it
   * would take a `0.033 rad` step against a `4.75 m/s` one. Those are not
   * comparable perturbations of a shot — the speed edge moves the impact point
   * several times further than the angle edge does — and the resulting simplex
   * explores one axis far more aggressively than the other. The default here is
   * a deliberately modest, roughly balanced pair for the 100 m-to-1 km problems
   * this phase works with, on the assumption that the robust aim is a small
   * correction to the nominal one.
   */
  readonly initialStep?: readonly [number, number];
  /** Passed to the inner {@link newtonShooting} solve for the nominal aim. */
  readonly newton?: NewtonShootingOptions;
  /**
   * Passed to {@link nelderMead}. `bounds` and `initialStep` are owned by the
   * fields above and are excluded here so there is one place each is set.
   */
  readonly nelderMead?: Omit<NelderMeadOptions, "bounds" | "initialStep">;
}

/** Why {@link robustAim} stopped. */
export type RobustAimStatus =
  /** The optimizer converged and the nominal baseline is trustworthy. */
  | "converged"
  /**
   * The optimizer stopped without certifying — commonly `"max-restarts"` in the
   * valley described above. The aim is the best found and its risk is still a
   * genuine measurement; it is simply not certified as the minimum.
   */
  | "not-converged"
  /**
   * The nominal Newton solve did not converge, so the baseline the comparison is
   * stated against is not a hit. The robust optimization still ran and its
   * result is still returned; the *comparison* is what is compromised.
   */
  | "nominal-failed";

/** What {@link robustAim} returns. */
export interface RobustAimResult {
  readonly status: RobustAimStatus;
  /** The robust aim: the minimizer of {@link riskMeasure} over the ensemble. */
  readonly aim: Aim;
  /** The risk at {@link aim}, in metres. */
  readonly risk: number;
  /** The baseline: the aim that hits under the nominal scenario alone. */
  readonly nominalAim: Aim;
  /** The same risk measure evaluated at {@link nominalAim}, in metres. */
  readonly nominalRisk: number;
  /**
   * The nominal aim's miss under the nominal scenario alone, in metres —
   * recomputed from the returned aim, so it is the evidence for
   * `"nominal-failed"` rather than a restatement of an inner solver's own
   * verdict. A sound baseline has this at zero to solver tolerance.
   */
  readonly nominalMiss: number;
  /** Which components the optimizer was allowed to move. */
  readonly varied: VaryAim;
  /**
   * `nominalRisk - risk`, in metres: what robustness bought. Non-negative
   * whenever the optimizer did its job, since the nominal aim is in the feasible
   * set the optimizer searched.
   */
  readonly riskReduction: number;
  /**
   * `aim - nominalAim`, componentwise. **This is the task's validation
   * criterion**: a non-zero shift is the measured statement that the robust aim
   * differs from the nominal one.
   */
  readonly shift: { readonly theta: number; readonly speed: number };
  /** Per-scenario outcome at {@link aim}. */
  readonly misses: readonly ScenarioMiss[];
  /** Per-scenario outcome at {@link nominalAim}, for the side-by-side. */
  readonly nominalMisses: readonly ScenarioMiss[];
  /** Which measure was minimized. */
  readonly riskMeasure: RiskMeasure;
  /** The raw optimizer result, including its status and history. */
  readonly optimizer: NelderMeadResult;
  /**
   * Trajectory integrations spent, across the nominal solve, the optimization
   * and the two reporting passes. The honest cost of the answer.
   */
  readonly integrations: number;
}

const DEFAULT_INITIAL_STEP: readonly [number, number] = [0.02, 1];

/** Maps P5.16's {@link AimBounds} onto the optimizer's per-coordinate boxes. */
function toNelderMeadBounds(bounds: AimBounds): readonly NelderMeadBound[] {
  const theta: NelderMeadBound = {};
  const speed: NelderMeadBound = {};
  return [
    Object.assign(
      theta,
      bounds.thetaMin === undefined ? {} : { lower: bounds.thetaMin },
      bounds.thetaMax === undefined ? {} : { upper: bounds.thetaMax },
    ),
    Object.assign(
      speed,
      bounds.speedMin === undefined ? {} : { lower: bounds.speedMin },
      bounds.speedMax === undefined ? {} : { upper: bounds.speedMax },
    ),
  ];
}

function validateScenarios(scenarios: readonly WindScenario[]): void {
  if (scenarios.length === 0) {
    throw new RangeError(
      "robustAim: the wind ensemble is empty; at least one scenario is required",
    );
  }
  scenarios.forEach((scenario, index) => {
    const name = scenario.label ?? String(index);
    if (!Number.isFinite(scenario.weight)) {
      throw new RangeError(
        `robustAim: scenario ${name} has a non-finite weight (${scenario.weight})`,
      );
    }
    if (scenario.weight <= 0) {
      throw new RangeError(
        `robustAim: scenario ${name} has weight ${scenario.weight}; weights must be strictly ` +
          "positive. A scenario that cannot influence the answer should be removed from the " +
          "ensemble rather than given zero weight.",
      );
    }
  });
}

/** Euclidean length of a miss vector, in metres. */
function magnitude(vector: readonly number[]): number {
  let sum = 0;
  for (const component of vector) sum += component * component;
  return Math.sqrt(sum);
}

/**
 * Collapses per-scenario misses into the risk, in metres.
 *
 * Returns `NaN` when any scenario failed to produce an impact. That is
 * deliberate and it is the documented contract of
 * {@link ObjectiveFunction}: Nelder–Mead reads `NaN` as "this region is not
 * admissible" and retreats from it, which is the correct response to an aim
 * whose flight does not land. Substituting a large finite penalty instead would
 * invent a gradient pointing somewhere the physics never said.
 */
function collapse(misses: readonly ScenarioMiss[], measure: RiskMeasure): number {
  if (misses.some((entry) => entry.miss === null)) return Number.NaN;

  switch (measure) {
    case "mean-square": {
      let sum = 0;
      for (const entry of misses) sum += entry.weight * (entry.miss as number) ** 2;
      return Math.sqrt(sum);
    }
    case "mean-absolute": {
      let sum = 0;
      for (const entry of misses) sum += entry.weight * (entry.miss as number);
      return sum;
    }
    case "worst-case": {
      let worst = 0;
      for (const entry of misses) worst = Math.max(worst, entry.miss as number);
      return worst;
    }
  }
}

/**
 * Solves for the aim that minimizes {@link RiskMeasure} of the miss across a
 * weighted ensemble of winds, and reports it alongside the nominal aim it is
 * being contrasted with.
 *
 * @param problem The shared problem: model, target, launch point, solver config
 *   and stepper. Its own `ctx` is the fallback for a scenario, but every
 *   scenario supplies its own, so `problem.ctx` is only read if a caller
 *   constructs a scenario from it.
 * @param scenarios The wind ensemble. At least one, all weights positive.
 */
export function robustAim(
  problem: ShootingProblem,
  scenarios: readonly WindScenario[],
  options: RobustAimOptions = {},
): RobustAimResult {
  validateScenarios(scenarios);
  const measure = options.risk ?? "mean-square";
  const nominalIndex = options.nominalIndex ?? 0;
  if (!Number.isInteger(nominalIndex) || nominalIndex < 0 || nominalIndex >= scenarios.length) {
    throw new RangeError(
      `robustAim: nominalIndex ${nominalIndex} is not an index into an ensemble of ` +
        `${scenarios.length} scenario(s)`,
    );
  }
  if (options.bounds !== undefined) validateAimBounds(options.bounds);

  const vary = options.vary ?? "both";
  const nominalTolerance = options.nominalTolerance ?? 1e-6;
  const totalWeight = scenarios.reduce((sum, scenario) => sum + scenario.weight, 0);
  const labels = scenarios.map((scenario, index) => scenario.label ?? String(index));
  const weights = scenarios.map((scenario) => scenario.weight / totalWeight);

  // Built once, not per evaluation: createShootingResidual validates the target
  // and prepares the flight closure, and the optimizer calls this hundreds of
  // times.
  let integrations = 0;
  const residuals: readonly ResidualFunction[] = scenarios.map((scenario) => {
    const perScenario = createShootingResidual({ ...problem, ctx: scenario.ctx });
    return (aim: Aim) => {
      integrations += 1;
      return perScenario(aim);
    };
  });

  const missesAt = (aim: Aim): ScenarioMiss[] =>
    residuals.map((residual, index) => {
      const evaluated = residual(aim);
      const vector = evaluated.ok ? evaluated.residual : null;
      return {
        label: labels[index] as string,
        weight: weights[index] as number,
        miss: vector === null ? null : magnitude(vector),
        missVector: vector,
      };
    });

  const riskAt = (aim: Aim): number => collapse(missesAt(aim), measure);

  // --- the nominal baseline ------------------------------------------------ //

  const nominalProblem: ShootingProblem = {
    ...problem,
    ctx: (scenarios[nominalIndex] as WindScenario).ctx,
  };
  const step = options.initialStep ?? DEFAULT_INITIAL_STEP;

  /**
   * Runs the optimizer over whichever components {@link vary} allows, holding
   * the rest at `anchor`. One place builds the coordinate packing so the nominal
   * pass and the robust pass cannot disagree about it.
   */
  const optimize = (objective: (aim: Aim) => number, anchor: Aim): NelderMeadResult => {
    const boxes = options.bounds === undefined ? undefined : toNelderMeadBounds(options.bounds);
    const shared = { ...options.nelderMead };
    if (vary === "both") {
      return nelderMead(
        (x) => objective({ theta: x[0] as number, speed: x[1] as number }),
        [anchor.theta, anchor.speed],
        {
          ...shared,
          ...(boxes === undefined ? {} : { bounds: boxes }),
          initialStep: [step[0], step[1]],
        },
      );
    }
    if (vary === "theta") {
      return nelderMead(
        (x) => objective({ theta: x[0] as number, speed: anchor.speed }),
        [anchor.theta],
        {
          ...shared,
          ...(boxes === undefined ? {} : { bounds: [boxes[0] as NelderMeadBound] }),
          initialStep: [step[0]],
        },
      );
    }
    return nelderMead(
      (x) => objective({ theta: anchor.theta, speed: x[0] as number }),
      [anchor.speed],
      {
        ...shared,
        ...(boxes === undefined ? {} : { bounds: [boxes[1] as NelderMeadBound] }),
        initialStep: [step[1]],
      },
    );
  };

  /** Unpacks an optimizer point back into an aim, mirroring {@link optimize}. */
  const toAim = (x: readonly number[], anchor: Aim): Aim => {
    if (vary === "both") return { theta: x[0] as number, speed: x[1] as number };
    if (vary === "theta") return { theta: x[0] as number, speed: anchor.speed };
    return { theta: anchor.theta, speed: x[0] as number };
  };

  const nominalResidual = residuals[nominalIndex] as ResidualFunction;
  const nominalMissAt = (aim: Aim): number => {
    const evaluated = nominalResidual(aim);
    return evaluated.ok && evaluated.residual !== null ? magnitude(evaluated.residual) : Number.NaN;
  };

  let nominalAim: Aim;
  if (options.nominalAim !== undefined) {
    nominalAim = options.nominalAim;
  } else if (vary === "both") {
    // Newton is the right tool when both components are free: it is quadratic
    // where the simplex is not, and P5.06 already handles the rank deficiency.
    nominalAim = newtonShooting(
      nominalResidual,
      smartInitialAim(nominalProblem),
      options.newton,
    ).aim;
  } else {
    // With a component pinned, the hit condition is one equation in one unknown
    // and Newton's two-variable step does not apply. Minimizing the nominal
    // scenario's miss alone finds the same thing with the machinery already here.
    //
    // The seed's *held* component decides whether the target is reachable at all,
    // so it is taken from a full two-variable solve rather than from
    // `smartInitialAim` directly. Seeding the held speed from the initial guess
    // instead would routinely pin it below the speed the target needs and report
    // `"nominal-failed"` for a problem that is perfectly solvable -- a launch
    // speed that cannot reach the target makes every elevation a miss.
    const seed =
      options.initialAim ??
      newtonShooting(nominalResidual, smartInitialAim(nominalProblem), options.newton).aim;
    const solve = optimize(nominalMissAt, seed);
    nominalAim = toAim(solve.x, seed);
  }
  // Judged from the outside, on the returned aim, rather than from a flag the
  // inner solver set about itself -- the same discipline P5.16's criterion uses.
  const nominalMiss = nominalMissAt(nominalAim);
  const nominalFailed = !(nominalMiss <= nominalTolerance);

  // --- the robust aim ----------------------------------------------------- //

  const start = options.initialAim ?? nominalAim;
  const optimizer = optimize(riskAt, start);
  const aim: Aim = toAim(optimizer.x, start);

  // --- reporting ---------------------------------------------------------- //

  const misses = missesAt(aim);
  const nominalMisses = missesAt(nominalAim);
  const risk = collapse(misses, measure);
  const nominalRisk = collapse(nominalMisses, measure);

  const status: RobustAimStatus = nominalFailed
    ? "nominal-failed"
    : optimizer.converged
      ? "converged"
      : "not-converged";

  return {
    status,
    aim,
    risk,
    nominalAim,
    nominalRisk,
    nominalMiss,
    varied: vary,
    riskReduction: nominalRisk - risk,
    shift: { theta: aim.theta - nominalAim.theta, speed: aim.speed - nominalAim.speed },
    misses,
    nominalMisses,
    riskMeasure: measure,
    optimizer,
    integrations,
  };
}

/**
 * Whether an aim sits inside the bounds it was solved under, recomputed from the
 * returned aim with P5.16's {@link aimActiveSet} rather than read off anything
 * {@link robustAim} asserted about itself.
 *
 * Exists so that a caller — and this task's own tests — can check feasibility
 * from the outside, the way P5.16's criterion is checked.
 */
export function robustAimIsFeasible(result: RobustAimResult, bounds: AimBounds): boolean {
  return aimActiveSet(result.aim, bounds).feasible;
}
