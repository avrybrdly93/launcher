/**
 * Inverse-problem exercises route (P0.108, the UI half of P5.28). Owns the
 * state the presentational `InverseExercisesPage` (`@ballista/ui`) does not:
 * the raw text in each answer box, and the grade for each exercise that has
 * been submitted. `main.tsx` mounts this whenever
 * `location.hash === "#/inverse-exercises"`.
 *
 * **Grading happens on submit, not on keystroke, and `checkAnswer` is why
 * that is a choice rather than an accident.** It grades against P5.28's
 * stored key and integrates nothing, so it is fast enough to run on every
 * keystroke — but a learner who is halfway through typing "18.9" has typed
 * "1", and telling them "too low" for it is noise. So a draft is just text
 * until the Check button says otherwise.
 *
 * `InverseExercise.recompute` is never called here. That one *does*
 * integrate, and it exists so the key can be audited, not so a page can
 * derive it.
 */

import {
  INVERSE_EXERCISES,
  checkAnswer,
  getExercise,
  type ExerciseCheck,
  type ExerciseId,
} from "@ballista/runtime";
import { InverseExercisesPage, parseAnswerInput } from "@ballista/ui";
import { useCallback, useState } from "preact/hooks";
import "./solver-lab-route.css";

export function InverseExercisesRoute() {
  const [drafts, setDrafts] = useState<Partial<Record<ExerciseId, string>>>({});
  const [checks, setChecks] = useState<Partial<Record<ExerciseId, ExerciseCheck>>>({});

  const onDraftChange = useCallback((id: ExerciseId, raw: string) => {
    setDrafts((previous) => ({ ...previous, [id]: raw }));
    // A re-edit clears the previous grade: leaving a stale "too low" beside a
    // box whose contents have since changed is worse than showing nothing.
    setChecks((previous) => {
      if (previous[id] === undefined) return previous;
      const rest = { ...previous };
      delete rest[id];
      return rest;
    });
  }, []);

  const onSubmit = useCallback(
    (id: ExerciseId) => {
      const submitted = parseAnswerInput(drafts[id] ?? "");
      setChecks((previous) => ({ ...previous, [id]: checkAnswer(getExercise(id), submitted) }));
    },
    [drafts],
  );

  return (
    <div class="solver-lab-route" data-testid="inverse-exercises-route">
      <a href="#/" class="solver-lab-route-back" data-testid="inverse-exercises-back-link">
        &larr; Back to simulator
      </a>
      <InverseExercisesPage
        exercises={INVERSE_EXERCISES}
        drafts={drafts}
        checks={checks}
        onDraftChange={onDraftChange}
        onSubmit={onSubmit}
      />
    </div>
  );
}
