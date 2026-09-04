/**
 * The grading primitives the exercise labs share.
 *
 * Extracted when P6.29 (uncertainty lab) needed the same comparison P5.28
 * (`inverse-exercises.ts`) had already worked out. The argument below — why the
 * comparison is inclusive, and why "inclusive" costs a few ulps rather than
 * being free — is subtle enough that two copies of it would eventually
 * disagree, and the copy that drifted would be the one grading a learner.
 *
 * What is *not* here is anything a lab should own: the id type, the prompt,
 * the feedback wording. Each lab builds its own sentence from
 * {@link classifyMiss}, because "check the branch you solved on" is advice
 * about root-finding and means nothing to someone estimating a proportion.
 */

/**
 * Ulps of headroom {@link gradeAgainstKey} allows past the stated tolerance,
 * so that an answer sitting exactly on the boundary is graded as meeting it.
 *
 * Four, because forming the boundary costs at most one rounding on the
 * subtraction and one on the addition that produced the submission, and two
 * more is free: the gap between this and the smallest wrong answer any
 * exercise can produce is enormous. The loosest tolerance in either lab is
 * 0.5 m and the slack it buys is under 1.4e-14 m.
 */
export const BOUNDARY_ULPS = 4;

/** The stored reference answer for one exercise, in the unit the question asks in. */
export interface AnswerKey {
  /** What is being asked for, e.g. "standard deviation of range". */
  readonly quantity: string;
  /** The unit the learner answers in. */
  readonly unit: string;
  /**
   * The stored reference solution, in {@link unit}.
   *
   * Every lab using this must also carry a way to *recompute* it from the real
   * pipeline, and assert in its tests that the two agree. A key that is merely
   * pinned records whatever the code said on the day it was written, including
   * whatever it got wrong.
   */
  readonly solution: number;
  /** Absolute tolerance in {@link unit}, inclusive at the boundary. */
  readonly tolerance: number;
  /** Why this tolerance and not a tighter or looser one. */
  readonly toleranceNote: string;
}

/** The unit-free part of grading one submission. */
export interface GradedAnswer {
  /** What the learner submitted, in the exercise's unit. */
  readonly submitted: number;
  /** The stored reference solution. */
  readonly expected: number;
  /** `|submitted - expected|`, or `NaN` for a non-finite submission. */
  readonly error: number;
  readonly tolerance: number;
  readonly correct: boolean;
  /** True when the submission was not a number at all. */
  readonly nonFinite: boolean;
}

/**
 * Compare a submission against a stored key.
 *
 * **The comparison is absolute and inclusive at the boundary.** An answer
 * exactly at `solution + tolerance` has met the stated tolerance, and an
 * exclusive test would make the published tolerance a lie by one ulp.
 *
 * **And "inclusive" has to be bought, not assumed, because the boundary is not
 * a representable number.** `solution + tolerance` is a rounded double, so its
 * distance back from `solution` is not `tolerance` — for the inverse lab's
 * first exercise it comes out 7.1e-16 too large, and a naive
 * `error <= tolerance` grades the exact boundary *wrong*. The excess is bounded
 * by a couple of ulps of the operands, so that is exactly what
 * {@link BOUNDARY_ULPS} allows back. It is a representation correction and
 * nothing more: the smallest genuinely-wrong answer either lab can receive is
 * more than ten orders of magnitude outside it.
 *
 * **A non-finite submission is wrong, not an error.** `NaN` is what an empty
 * input box parses to, and a thrown exception is the wrong response to a
 * learner who has not answered yet.
 */
export function gradeAgainstKey(key: AnswerKey, submitted: number): GradedAnswer {
  const { solution, tolerance } = key;

  if (!Number.isFinite(submitted)) {
    return {
      submitted,
      expected: solution,
      error: Number.NaN,
      tolerance,
      correct: false,
      nonFinite: true,
    };
  }

  const error = Math.abs(submitted - solution);
  const slack =
    BOUNDARY_ULPS * Number.EPSILON * Math.max(Math.abs(submitted), Math.abs(solution), tolerance);
  return {
    submitted,
    expected: solution,
    error,
    tolerance,
    correct: error <= tolerance + slack,
    nonFinite: false,
  };
}

/** Which side of the answer a wrong submission fell on. */
export type MissDirection = "high" | "low";

/** How far outside the tolerance a wrong submission fell. */
export type MissScale = "just outside" | "outside" | "well outside";

/** The shape of a wrong answer, for a lab to turn into its own sentence. */
export interface MissClassification {
  readonly direction: MissDirection;
  readonly scale: MissScale;
}

/**
 * Describe a wrong submission by direction and magnitude.
 *
 * The bands are deliberately coarse. Their job is to tell a learner whether
 * they have a method problem or an arithmetic one — "well outside" means the
 * approach is wrong, "just outside" means it is right and the rounding is not
 * — and a finer scale would imply a precision the grader does not have.
 */
export function classifyMiss(key: AnswerKey, submitted: number): MissClassification {
  const error = Math.abs(submitted - key.solution);
  return {
    direction: submitted > key.solution ? "high" : "low",
    scale:
      error > 10 * key.tolerance
        ? "well outside"
        : error > 2 * key.tolerance
          ? "outside"
          : "just outside",
  };
}
