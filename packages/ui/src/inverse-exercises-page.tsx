/**
 * Inverse-problem exercise page (P0.108, the UI P5.28 deliberately did not
 * build). Purely presentational, mirroring `ConvergenceStudyPage`'s split:
 * the caller (the app-level route) owns the draft answers, owns calling
 * `checkAnswer` (`@ballista/runtime`), and hands both down.
 *
 * **The page never calls `recompute`.** That is the one thing about this
 * data a renderer can get expensively wrong: `checkAnswer` grades against a
 * stored key and integrates nothing, while `InverseExercise.recompute` runs
 * the solvers and exists only so the key can be audited. Nothing here
 * touches it, and nothing here needs a worker as a result.
 *
 * **And the page never reads `check.expected` directly** — it goes through
 * `revealedSolution`, which withholds it from a wrong attempt. See
 * `inverse-exercises-page-logic.ts`'s header for why that is the rule this
 * feature turns on.
 */
import type { ExerciseCheck, ExerciseId, InverseExercise } from "@ballista/runtime";
import {
  exerciseStatus,
  formatGiven,
  formatSetProgress,
  formatTolerance,
  isSubmittable,
  revealedInsight,
  revealedSolution,
} from "./inverse-exercises-page-logic.js";

export interface InverseExercisesPageProps {
  readonly exercises: readonly InverseExercise[];
  /** Raw text of each answer box, keyed by exercise id. */
  readonly drafts: Partial<Record<ExerciseId, string>>;
  /** The grade for each exercise that has been submitted. */
  readonly checks: Partial<Record<ExerciseId, ExerciseCheck>>;
  readonly onDraftChange: (id: ExerciseId, raw: string) => void;
  readonly onSubmit: (id: ExerciseId) => void;
}

export function InverseExercisesPage({
  exercises,
  drafts,
  checks,
  onDraftChange,
  onSubmit,
}: InverseExercisesPageProps) {
  const graded = exercises
    .map((exercise) => checks[exercise.id])
    .filter((check): check is ExerciseCheck => check !== undefined);

  return (
    <div class="inverse-exercises-page" data-testid="inverse-exercises-page">
      <h1>Inverse-Problem Exercises</h1>
      <p class="inverse-exercises-page-summary" data-testid="inverse-exercises-summary">
        The simulator runs forwards: pick an aim, see where it lands. These five run the other way —
        you are given where the shot must land and asked for the aim. Each one is a different
        inverse problem, so finishing the set means meeting five methods rather than turning one
        crank five times.
      </p>
      <p class="inverse-exercises-page-progress" data-testid="inverse-exercises-progress">
        {formatSetProgress(graded, exercises.length)}
      </p>

      <ol class="inverse-exercises-page-list">
        {exercises.map((exercise, index) =>
          exerciseCard({
            exercise,
            index: index + 1,
            draft: drafts[exercise.id] ?? "",
            check: checks[exercise.id],
            onDraftChange,
            onSubmit,
          }),
        )}
      </ol>
    </div>
  );
}

/**
 * One exercise card.
 *
 * A plain function called directly rather than a `<ExerciseCard />` element,
 * and that is deliberate: this package's page tests inspect the raw vnode
 * tree (`density-altitude-page.test.tsx`'s `findByTestId`), and a component
 * *element* is an unexpanded node whose children the walk cannot see. Calling
 * it inlines the card's vnodes into the page's own tree, which is what keeps
 * the established test style working on a page that is not flat. The `key`
 * lives on the `<li>` the function returns.
 */
interface ExerciseCardProps {
  readonly exercise: InverseExercise;
  readonly index: number;
  readonly draft: string;
  readonly check: ExerciseCheck | undefined;
  readonly onDraftChange: (id: ExerciseId, raw: string) => void;
  readonly onSubmit: (id: ExerciseId) => void;
}

function exerciseCard({
  exercise,
  index,
  draft,
  check,
  onDraftChange,
  onSubmit,
}: ExerciseCardProps) {
  const { id, answer } = exercise;
  const status = exerciseStatus(check);
  const solution = revealedSolution(exercise, check);
  const insight = revealedInsight(exercise, check);
  const inputId = `inverse-exercise-answer-${id}`;

  return (
    <li
      key={id}
      class={`inverse-exercises-page-card is-${status}`}
      data-testid={`inverse-exercise-${id}`}
    >
      <h2>
        {index}. {exercise.title}
      </h2>
      <p data-testid={`inverse-exercise-prompt-${id}`}>{exercise.prompt}</p>

      <ul class="inverse-exercises-page-givens" data-testid={`inverse-exercise-givens-${id}`}>
        {exercise.givens.map((given) => (
          <li key={given.label}>{formatGiven(given)}</li>
        ))}
      </ul>

      <p class="inverse-exercises-page-method" data-testid={`inverse-exercise-method-${id}`}>
        Method: {exercise.method}
      </p>

      <ol class="inverse-exercises-page-steps" data-testid={`inverse-exercise-steps-${id}`}>
        {exercise.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>

      <div class="inverse-exercises-page-answer">
        <label for={inputId}>
          {answer.quantity}
          {answer.unit === "" ? "" : ` (${answer.unit})`}
        </label>
        <input
          id={inputId}
          type="text"
          inputMode="decimal"
          value={draft}
          data-testid={`inverse-exercise-input-${id}`}
          onInput={(event) => onDraftChange(id, (event.currentTarget as HTMLInputElement).value)}
        />
        <button
          type="button"
          disabled={!isSubmittable(draft)}
          data-testid={`inverse-exercise-submit-${id}`}
          onClick={() => onSubmit(id)}
        >
          Check
        </button>
        <span class="inverse-exercises-page-tolerance">within {formatTolerance(exercise)}</span>
      </div>

      {check === undefined ? null : (
        <p
          class={`inverse-exercises-page-feedback is-${status}`}
          role="status"
          data-testid={`inverse-exercise-feedback-${id}`}
        >
          {check.feedback}
        </p>
      )}

      {solution === undefined ? null : (
        <p class="inverse-exercises-page-solution" data-testid={`inverse-exercise-solution-${id}`}>
          Reference solution: {solution}
        </p>
      )}

      {insight === undefined ? null : (
        <p class="inverse-exercises-page-insight" data-testid={`inverse-exercise-insight-${id}`}>
          {insight}
        </p>
      )}
    </li>
  );
}
