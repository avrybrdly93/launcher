/**
 * Solver panel (§6.3 panel group 5: "method dropdown (grouped: fixed /
 * adaptive / geometric / implicit), h or rtol/atol, controller I/PI";
 * P3.23). The method `<select>` groups its options with `<optgroup>`
 * (literally "grouped"); selecting a stepper from a different group swaps
 * in that group's own schema-driven params (`generateControlDescriptors`,
 * P3.18) via `toSolverConfigForStepper` (`solver-panel-logic.ts`) -- fixed
 * shows only `h`, adaptive shows only `rtol`/`atol`/`controller`, and the
 * two never render (or commit) together. That's this task's "invalid
 * combos (h with adaptive) prevented by schema" validation criterion.
 */

import type { SolverConfigSpec } from "@ballista/engine";
import { NumericControlRow } from "./numeric-control-row.js";
import { generateControlDescriptors } from "./schema-controls.js";
import {
  adaptivePanelValues,
  adaptiveSolverPanelSchema,
  fixedPanelValues,
  fixedSolverPanelSchema,
  solverGroupFor,
  SOLVER_GROUP_LABELS,
  SOLVER_STEPPER_OPTIONS,
  toSolverConfigForStepper,
} from "./solver-panel-logic.js";

export interface SolverPanelProps {
  readonly solver: SolverConfigSpec;
  readonly onChange: (next: SolverConfigSpec) => void;
}

export function SolverPanel({ solver, onChange }: SolverPanelProps) {
  function handleStepperSelect(stepperId: string): void {
    if (!solverGroupFor(stepperId)) return;
    onChange(toSolverConfigForStepper(stepperId, solver));
  }

  function handleFixedFieldChange(path: string, next: number): void {
    onChange({ ...solver, [path]: next });
  }

  function handleAdaptiveFieldChange(path: string, next: number | string): void {
    onChange({ ...solver, [path]: next });
  }

  const group = solverGroupFor(solver.stepper);

  const fixedDescriptors =
    group === "fixed"
      ? generateControlDescriptors(fixedSolverPanelSchema, fixedPanelValues(solver))
      : [];
  const adaptiveDescriptors =
    group === "adaptive"
      ? generateControlDescriptors(adaptiveSolverPanelSchema, adaptivePanelValues(solver))
      : [];

  return (
    <div class="solver-panel" data-testid="solver-panel">
      <select
        value={solver.stepper}
        data-testid="solver-stepper-select"
        onInput={(event) => handleStepperSelect(event.currentTarget.value)}
      >
        {(["fixed", "adaptive"] as const).map((groupId) => (
          <optgroup key={groupId} label={SOLVER_GROUP_LABELS[groupId]}>
            {SOLVER_STEPPER_OPTIONS.filter((option) => option.group === groupId).map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {fixedDescriptors.map((descriptor) => (
        <NumericControlRow
          key={descriptor.path}
          descriptor={descriptor}
          onChange={(next) => handleFixedFieldChange(descriptor.path, next)}
        />
      ))}

      {adaptiveDescriptors.map((descriptor) =>
        descriptor.kind === "select" ? (
          <div
            class="solver-panel-controller-row"
            key={descriptor.path}
            data-testid={`control-${descriptor.path}`}
          >
            <label>{descriptor.label}</label>
            <select
              value={String(descriptor.value)}
              data-testid={`control-${descriptor.path}-select`}
              onInput={(event) =>
                handleAdaptiveFieldChange(descriptor.path, event.currentTarget.value)
              }
            >
              {descriptor.options?.map((optionValue) => (
                <option key={optionValue} value={optionValue}>
                  {optionValue}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <NumericControlRow
            key={descriptor.path}
            descriptor={descriptor}
            onChange={(next) => handleAdaptiveFieldChange(descriptor.path, next)}
          />
        ),
      )}
    </div>
  );
}
