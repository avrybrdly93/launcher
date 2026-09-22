/**
 * Inverse-exercises page's non-rendering logic (P0.108, the UI follow-on to
 * P5.28). Split out from `inverse-exercises-page.tsx` per this package's
 * `<feature>-page-logic.ts` convention (`density-altitude-page-logic.ts`,
 * `neglected-effects-page-logic.ts`): everything here is directly testable
 * without a DOM.
 *
 * ## The one rule this module exists to enforce
 *
 * `ExerciseCheck` carries `expected` whether or not the attempt was correct,
 * because the *checker* needs it to compute `error`. The lab's contract is
 * that a wrong attempt is never told the answer — `inverse-exercises.test.ts`
 * asserts the failure feedback does not contain it — and a page that rendered
 * `check.expected` unconditionally would undo that without failing anything,
 * since nothing before this task rendered a check at all.
 *
 * So the page does not read `check.expected`. It calls
 * {@link revealedSolution}, which returns the number only on a correct
 * attempt and `undefined` otherwise, and `inverse-exercises-page-logic.test.ts`
 * grades that directly rather than only through the rendered output.
 */
import type { ExerciseCheck, ExerciseGiven, InverseExercise } from "@ballista/runtime";

/** Where one exercise stands, for a page that shows all five at once. */
export type ExerciseStatus = "unanswered" | "correct" | "incorrect";

/**
 * An empty box is "not answered yet", not "answered wrongly".
 *
 * `Number("")` is 0, which would grade an untouched box as a confident wrong
 * answer, so the empty case is handled before parsing rather than after.
 * Everything else — "abc", "1.2.3", a lone minus sign — becomes `NaN`, which
 * `checkAnswer` already treats as a non-finite submission with its own
 * feedback. `NaN` is therefore the *only* failure mode this function has, and
 * callers never need a second branch for "unparseable".
 */
export function parseAnswerInput(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed === "") return Number.NaN;
  return Number(trimmed);
}

/** `true` when a box holds something worth grading. */
export function isSubmittable(raw: string): boolean {
  return raw.trim() !== "";
}

/**
 * "launch speed: 80 m/s", or "drag coefficient: 0" for the dimensionless
 * ones — three of the five exercises give `C_d` with an empty `unit`, and
 * "0 " with a trailing space is the kind of detail that only shows up once
 * it is on screen.
 */
export function formatGiven(given: ExerciseGiven): string {
  const value = formatNumber(given.value);
  return given.unit === "" ? `${given.label}: ${value}` : `${given.label}: ${value} ${given.unit}`;
}

/**
 * Enough digits for the small ones (the ball radius is 0.0366 m) without
 * printing `80.00000` for the round ones.
 */
function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(6)));
}

/** The tolerance a learner is being held to, in the answer's own unit. */
export function formatTolerance(exercise: InverseExercise): string {
  const { tolerance, unit } = exercise.answer;
  return unit === "" ? `±${tolerance}` : `±${tolerance} ${unit}`;
}

/** Three-way status for one exercise, given whatever check it has (if any). */
export function exerciseStatus(check: ExerciseCheck | undefined): ExerciseStatus {
  if (check === undefined) return "unanswered";
  return check.correct ? "correct" : "incorrect";
}

/**
 * The stored solution, **only** on a correct attempt.
 *
 * This is the whole point of the module — see the header. `undefined` for an
 * ungraded or wrong attempt, so a caller that forgets to branch renders
 * nothing rather than the answer.
 */
export function revealedSolution(
  exercise: InverseExercise,
  check: ExerciseCheck | undefined,
): string | undefined {
  if (check === undefined || !check.correct) return undefined;
  const { unit } = exercise.answer;
  const value = formatNumber(check.expected);
  return unit === "" ? value : `${value} ${unit}`;
}

/**
 * The insight, likewise only on a correct attempt.
 *
 * `checkAnswer` already puts the insight in `feedback` when the answer is
 * right, so this returns the exercise's own copy rather than re-deriving it
 * — but it is a separate function because the page shows the insight in its
 * own region with its own testid, and "show the insight" and "show the
 * feedback line" are different questions that happen to share an answer
 * today.
 */
export function revealedInsight(
  exercise: InverseExercise,
  check: ExerciseCheck | undefined,
): string | undefined {
  if (check === undefined || !check.correct) return undefined;
  return exercise.insight;
}

/** "2 of 5 correct" — the set-level line, and what `checkAll` is for. */
export function formatSetProgress(checks: readonly ExerciseCheck[], total: number): string {
  const correct = checks.filter((check) => check.correct).length;
  return `${correct} of ${total} correct`;
}
