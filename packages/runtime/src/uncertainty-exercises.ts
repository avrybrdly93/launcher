/**
 * P6.29 "exercise content: uncertainty lab (3 guided studies with auto-check)"
 * (ROADMAP seq 253, validation "checkers pass on reference solutions").
 *
 * Phase 6 gave the platform a Monte Carlo engine. This lab is about the part
 * that engine cannot supply: knowing which number answers which question. All
 * three studies below read the *same* kind of output — a column of ranges from
 * a study of 96 replicates — and the whole lab is the observation that three
 * different questions about that one column have three different answers, none
 * of which is a substitute for the others.
 *
 * **The three are three different estimators, not one estimator three times.**
 *
 * | # | Question | Estimator | Module |
 * | - | -------- | --------- | ------ |
 * | 1 | How wide is the outcome spread? | sample standard deviation | `mc-stats` |
 * | 2 | How well do we know its mean? | Student-`t` interval | `confidence-interval` |
 * | 3 | How often does it exceed a line? | Wilson score interval | `hit-probability` |
 *
 * Studies 1 and 2 deliberately run on the *same* study, because their contrast
 * is the single most useful thing in the lab: σ̂ describes the world and does
 * not shrink when you buy more replicates, while the half-width on the mean
 * describes your own ignorance and falls as `1/√N`. Reading the first as the
 * second is the most common error in this whole subject, and putting the two
 * questions on one dataset is what makes the difference visible rather than
 * asserted. Study 3 moves to a different study because a proportion is a
 * different animal again — its uncertainty is asymmetric, and near 0 or 1 the
 * textbook interval runs off the end of the scale.
 *
 * ## Where the reference solutions come from
 *
 * From the three studies P6.28 pinned in `golden-mc-store.ts`, not from a
 * fourth invented set. That matters for the validation criterion: a guided
 * study whose checker has no pinned reference is grading itself. Because those
 * studies are bit-pinned and seeded, every answer here is a deterministic
 * function of a fixture that a separate regression test already guards, so an
 * answer key going stale is a *test failure* in
 * `golden-mc-results.test.ts` before it is ever a wrong grade.
 *
 * Studies 1 and 2 use `drag-free-velocity-spread`; study 3 uses
 * `magnus-drive-velocity-spread`. The third golden,
 * `raised-release-mass-lognormal`, is not the subject of an exercise — it is
 * cited as measured evidence inside study 1's insight, and
 * `uncertainty-exercises.test.ts` asserts the number quoted there rather than
 * letting the prose make an unchecked claim.
 *
 * ## Why every stored solution is also recomputable
 *
 * Same rule as the inverse lab: a key that is merely pinned records whatever
 * the code said on the day it was written, including whatever it got wrong. So
 * each study carries both a stored {@link AnswerKey.solution} and a
 * {@link UncertaintyExercise.recompute} deriving it from the real MC pipeline,
 * and the test asserts they agree.
 *
 * Study 1 goes further and is checked against a closed form that owes nothing
 * to this codebase. A drag-free shot from ground level has range
 * `R = 2·vx₀·vy₀/g` exactly, so with independent normal `vx₀, vy₀` the
 * population variance of `R` is available in closed form,
 * `Var(XY) = μx²σy² + μy²σx² + σx²σy²` scaled by `(2/g)²`. That is what makes
 * study 1 evidence rather than a fixture agreeing with itself — and, as its
 * insight says, the gap between that exact number and the 96-replicate
 * estimate is the lesson.
 */
import { meanConfidenceInterval, wilsonInterval } from "@ballista/analysis";
import {
  classifyMiss,
  gradeAgainstKey,
  type AnswerKey,
  type MissScale,
} from "./exercise-grading.js";
import { runGoldenMcStudy } from "./golden-mc-store.js";
import type { McColumns } from "./mc-job.js";

/** The confidence level studies 2 and 3 both work at. */
const LEVEL = 0.95;

/** The golden study studies 1 and 2 share. */
const SPREAD_STUDY = "drag-free-velocity-spread";

/** The golden study study 3 uses. */
const EXCEEDANCE_STUDY = "magnus-drive-velocity-spread";

/**
 * The range, in metres, that study 3 asks how often is exceeded.
 *
 * Chosen so the proportion is small enough for the Wilson and Wald intervals
 * to visibly disagree — 8 of 96 replicates clear it — without being so rare
 * that the answer is dominated by whether a single replicate happened to make
 * it. At this count the two intervals' lower bounds differ by 1.5 percentage
 * points, which is the entire point of the study.
 */
const EXCEEDANCE_THRESHOLD = 265;

/**
 * The landed subset of one observable column.
 *
 * Every statistic in this lab is over the landed replicates, matching
 * `mcStats`, which uses `landedCount` as its denominator. All three golden
 * studies happen to land all 96, so this filter never actually bites today —
 * it is here because a study that stops landing everything must change the
 * answers rather than silently keep them.
 */
function landedRanges(columns: McColumns): number[] {
  const out: number[] = [];
  for (let i = 0; i < columns.landed.length; i += 1) {
    if (columns.landed[i] === 1) out.push(columns.range[i]!);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Study 1 — the spread of the outcome                                 */
/* ------------------------------------------------------------------ */

function rangeStandardDeviation(): number {
  return Math.sqrt(runGoldenMcStudy(SPREAD_STUDY).stats.range.variance);
}

/* ------------------------------------------------------------------ */
/* Study 2 — the uncertainty of the mean                               */
/* ------------------------------------------------------------------ */

function rangeMeanHalfWidth(): number {
  const { columns } = runGoldenMcStudy(SPREAD_STUDY);
  const interval = meanConfidenceInterval(landedRanges(columns), LEVEL);
  if (interval === null) {
    throw new Error("uncertainty-exercises: the spread study landed fewer than two replicates");
  }
  return interval.halfWidth;
}

/* ------------------------------------------------------------------ */
/* Study 3 — the uncertainty of a proportion                           */
/* ------------------------------------------------------------------ */

/** How many landed replicates cleared {@link EXCEEDANCE_THRESHOLD}, and out of how many. */
export function exceedanceCount(): { readonly hits: number; readonly landed: number } {
  const values = landedRanges(runGoldenMcStudy(EXCEEDANCE_STUDY).columns);
  return {
    hits: values.filter((r) => r > EXCEEDANCE_THRESHOLD).length,
    landed: values.length,
  };
}

/** The Wilson lower bound as a percentage — the answer study 3 asks for. */
function exceedanceWilsonLowerPercent(): number {
  const { hits, landed } = exceedanceCount();
  return 100 * wilsonInterval(hits, landed, LEVEL).lower;
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** A quantity the learner is given before starting. */
export interface UncertaintyGiven {
  readonly label: string;
  readonly value: number;
  readonly unit: string;
}

/** The three study ids, in the order they are meant to be worked. */
export type UncertaintyExerciseId = "outcome-spread" | "mean-half-width" | "exceedance-lower-bound";

/** One guided uncertainty study. */
export interface UncertaintyExercise {
  readonly id: UncertaintyExerciseId;
  readonly title: string;
  /** The question, in one or two sentences. */
  readonly prompt: string;
  /** The pinned golden study this is asked about. */
  readonly study: string;
  /** What the learner starts from. */
  readonly givens: readonly UncertaintyGiven[];
  /** The estimator this study is teaching, named as `@ballista/analysis` names it. */
  readonly method: string;
  /** Guidance, in the order it should be read. Never contains the answer. */
  readonly steps: readonly string[];
  /** What the study is actually about, revealed after a correct answer. */
  readonly insight: string;
  readonly answer: AnswerKey;
  /**
   * Recompute the solution from the MC pipeline, in {@link AnswerKey.unit}.
   *
   * Runs 96 replicates, so it is far too slow for grading. It exists so the
   * stored key can be audited rather than trusted.
   */
  readonly recompute: () => number;
}

/** How one submitted answer was graded. */
export interface UncertaintyCheck {
  readonly id: UncertaintyExerciseId;
  /** What the learner submitted, in the study's unit. */
  readonly submitted: number;
  /** The stored reference solution. */
  readonly expected: number;
  /** `|submitted - expected|`, or `NaN` for a non-finite submission. */
  readonly error: number;
  readonly tolerance: number;
  readonly correct: boolean;
  /** One sentence the learner can act on. Never restates the answer when wrong. */
  readonly feedback: string;
}

/* ------------------------------------------------------------------ */
/* The set                                                             */
/* ------------------------------------------------------------------ */

/**
 * The three studies, in working order.
 *
 * Solutions are the values `recompute` produces, transcribed to more digits
 * than any tolerance here consults, so that a drift in the MC pipeline shows up
 * in the test as a disagreement rather than being absorbed.
 */
export const UNCERTAINTY_EXERCISES: readonly UncertaintyExercise[] = [
  {
    id: "outcome-spread",
    title: "How wide is the landing spread?",
    prompt:
      "A drag-free shot leaves the ground with both velocity components uncertain: vx₀ and vy₀ " +
      "are independent normals about 21.213 m/s with a standard deviation of 2 m/s each. " +
      "Run the 96-replicate study and report the standard deviation of the range, in metres.",
    study: SPREAD_STUDY,
    givens: [
      { label: "mean vx₀", value: 21.213, unit: "m/s" },
      { label: "mean vy₀", value: 21.213, unit: "m/s" },
      { label: "σ on each velocity component", value: 2, unit: "m/s" },
      { label: "replicates", value: 96, unit: "" },
    ],
    method: "sample standard deviation over the landed subset (mcStats, Welford variance)",
    steps: [
      "Take the range column over the replicates that landed. `mcStats` reports variance over exactly that subset, and `landedCount` is its denominator.",
      "Take the square root of the variance, not of anything else. In particular this is not the standard error — that is study 2.",
      "Use the sample variance, dividing by n − 1 rather than n. The tolerance here is tight enough to tell the two apart, deliberately.",
      "Before you look at the answer: predict it. R = 2·vx₀·vy₀/g exactly for a drag-free ground-to-ground shot, so you can propagate the two velocity spreads through that product by hand.",
    ],
    insight:
      "This is a property of the world, not of your sample size: buy ten times the replicates and " +
      "it does not shrink. It is also further from the truth than it looks. The exact population " +
      "value follows from Var(XY) = μx²σy² + μy²σx² + σx²σy² and is 12.2636 m; 96 replicates " +
      "estimated 11.2993 m, which is 7.9% low — about one standard error of an SD estimate at " +
      "this n (σ/√(2(n−1)) ≈ 0.89 m). The estimate is not wrong, it is uncertain, and study 2 is " +
      "about how to say so. For contrast, the raised-release study's 5% lognormal spread on " +
      "projectile mass moves its range by only 0.032% — which spread matters is a property of " +
      "the physics, not of how carefully you sampled.",
    answer: {
      quantity: "standard deviation of range",
      unit: "m",
      solution: 11.299324111396446,
      tolerance: 0.05,
      toleranceNote:
        "0.05 m is chosen to discriminate the one substantive mistake this study invites: " +
        "dividing by n instead of n − 1 gives 11.2403 m, 0.059 m away, which this tolerance " +
        "rejects. It is far looser than the pipeline's own reproducibility (the study is " +
        "bit-pinned) and far tighter than reporting the standard error (1.15 m) or the exact " +
        "population value (12.26 m), so it grades the estimator rather than the arithmetic.",
    },
    recompute: rangeStandardDeviation,
  },
  {
    id: "mean-half-width",
    title: "How well do you know the mean?",
    prompt:
      "Same study, same 96 replicates. Report the half-width of the two-sided 95% confidence " +
      "interval for the mean range, in metres.",
    study: SPREAD_STUDY,
    givens: [
      { label: "replicates", value: 96, unit: "" },
      { label: "confidence level", value: LEVEL, unit: "" },
    ],
    method: "Student-t interval for a mean (meanConfidenceInterval)",
    steps: [
      "Start from study 1's answer. The standard error of the mean is that standard deviation divided by √n — and it is not the answer, it is one factor of it.",
      "Multiply by the two-sided critical value at 95%. The question is which distribution supplies it.",
      "You have 96 samples and you estimated the standard deviation from the same 96, so the multiplier is a t quantile at n − 1 = 95 degrees of freedom, not a normal quantile.",
      "Check the direction of your own error: is a t multiplier larger or smaller than 1.96, and why must it be?",
    ],
    insight:
      "This number and study 1's answer measure different things, and confusing them is the most " +
      "common error in the subject. σ̂ = 11.30 m describes the world and is indifferent to your " +
      "sample size; this half-width, 2.29 m, describes your ignorance about one number and falls " +
      "as 1/√N — quadruple the replicates and it halves, while σ̂ does not move. The multiplier " +
      "matters too, though less than people fear: using 1.96 instead of t₉₅ = 1.9853 gives " +
      "2.2603 m, understating the band by 1.3%. At n = 96 that is small; at n = 10 it is not, " +
      "and the habit of reaching for 1.96 does not know the difference.",
    answer: {
      quantity: "95% confidence half-width on the mean range",
      unit: "m",
      solution: 2.2894558547524175,
      tolerance: 0.02,
      toleranceNote:
        "0.02 m is set deliberately tight enough to reject the z-instead-of-t answer, which is " +
        "2.2603 m and 0.029 m away — that substitution is the mistake the study exists to " +
        "catch, so a tolerance that accepted it would grade nothing. Reporting the standard " +
        "error alone (1.15 m), the full width (4.58 m) or study 1's σ̂ all miss by far more.",
    },
    recompute: rangeMeanHalfWidth,
  },
  {
    id: "exceedance-lower-bound",
    title: "How often does it carry past the line?",
    prompt:
      "Switch to the Magnus study — gravity, quadratic drag and spin, 96 replicates with " +
      "uncertain launch velocity. Some replicates carry past 265 m. Report the lower bound of " +
      "the 95% Wilson score interval for that proportion, as a percentage.",
    study: EXCEEDANCE_STUDY,
    givens: [
      { label: "threshold range", value: EXCEEDANCE_THRESHOLD, unit: "m" },
      { label: "replicates", value: 96, unit: "" },
      { label: "confidence level", value: LEVEL, unit: "" },
    ],
    method: "Wilson score interval for a binomial proportion (wilsonInterval)",
    steps: [
      "Count the landed replicates whose range exceeds the threshold. That count is an integer and there is nothing uncertain about it — the uncertainty is in what it implies about the underlying probability.",
      "Do not reach for p̂ ± z·√(p̂(1−p̂)/n). That is the Wald interval, and it is the one this study is asking you not to use.",
      "Use the Wilson score interval instead: it inverts the score test rather than assuming the estimate is normal about the truth, and it stays inside [0, 1] by construction.",
      "Report the lower bound, as a percentage, not the point estimate and not the centre — the Wilson centre is not p̂, which is itself worth noticing.",
    ],
    insight:
      "8 of 96 replicates cleared the line, so p̂ = 8.33%, and the honest floor is 4.28% rather " +
      "than the Wald interval's 2.81% — a 1.5-point difference on a quantity smaller than 10%. " +
      "The Wald interval is badly behaved exactly where questions like this get asked: near the " +
      "tail it is too wide on one side, too narrow on the other, and at a low enough count its " +
      "lower bound goes negative, which is not a probability. Notice also that the Wilson " +
      "centre, 9.94%, is not p̂ — the interval is asymmetric because the quantity is bounded, " +
      "and any summary that reports a single ± has already thrown that away.",
    answer: {
      quantity: "Wilson 95% lower bound on the exceedance probability",
      unit: "%",
      solution: 4.283062415096723,
      tolerance: 0.05,
      toleranceNote:
        "0.05 percentage points. The three answers this study is designed to reject are all far " +
        "outside it: the Wald lower bound (2.81), the point estimate p̂ (8.33) and the Wilson " +
        "centre (9.94). It is loose enough that a learner evaluating the Wilson formula by hand " +
        "at four significant figures still passes.",
    },
    recompute: exceedanceWilsonLowerPercent,
  },
];

/** Every study id, in working order. */
export const UNCERTAINTY_EXERCISE_IDS: readonly UncertaintyExerciseId[] = UNCERTAINTY_EXERCISES.map(
  (exercise) => exercise.id,
);

/** Look one up by id. Throws rather than returning undefined, so a typo fails loudly. */
export function getUncertaintyExercise(id: UncertaintyExerciseId): UncertaintyExercise {
  const exercise = UNCERTAINTY_EXERCISES.find((candidate) => candidate.id === id);
  if (exercise === undefined) {
    throw new Error(`getUncertaintyExercise: no study with id "${id}"`);
  }
  return exercise;
}

/** Wrong-answer wording, per band. Kept next to the bands so the two cannot drift. */
const MISS_ADVICE: Record<MissScale, string> = {
  "just outside":
    "That is a precision issue rather than a method one — you have the right estimator.",
  outside: "Close, but check which quantity the question asked for before re-deriving it.",
  "well outside": "That looks like a different estimator, not a slip. Re-read the method line.",
};

/**
 * Grade one answer against the stored key.
 *
 * The comparison itself is {@link gradeAgainstKey}, shared with the inverse
 * lab; what is local here is the wording. A learner who has confused the
 * spread with the standard error needs to be told to look at *which quantity*,
 * not to check a bracket, which is why the two labs do not share a sentence.
 */
export function checkUncertaintyAnswer(
  exercise: UncertaintyExercise,
  submitted: number,
): UncertaintyCheck {
  const { tolerance, unit } = exercise.answer;
  const { nonFinite, ...graded } = gradeAgainstKey(exercise.answer, submitted);

  if (nonFinite) {
    return {
      id: exercise.id,
      ...graded,
      feedback: "That is not a number — enter your answer as a decimal value.",
    };
  }

  if (graded.correct) {
    return { id: exercise.id, ...graded, feedback: exercise.insight };
  }

  // Direction, magnitude and a nudge — but never the number itself, or the
  // second attempt is not an attempt.
  const { direction, scale } = classifyMiss(exercise.answer, submitted);
  return {
    id: exercise.id,
    ...graded,
    feedback:
      `Too ${direction}, and ${scale} the ${tolerance} ${unit} tolerance. ` +
      `${MISS_ADVICE[scale]}`,
  };
}

/** Grade a whole attempt at the lab. Ids absent from `answers` are left ungraded. */
export function checkAllUncertainty(
  answers: Partial<Record<UncertaintyExerciseId, number>>,
): readonly UncertaintyCheck[] {
  return UNCERTAINTY_EXERCISES.filter((exercise) => answers[exercise.id] !== undefined).map(
    (exercise) => checkUncertaintyAnswer(exercise, answers[exercise.id]!),
  );
}
