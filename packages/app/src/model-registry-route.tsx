/**
 * Model Registry route (§6.3 "distinct route"; P4.30 "Model registry UI:
 * model picker (projectile 2D/2D+spin/3D)"). Owns a standalone
 * `ScenarioSpec` (seeded from `DEFAULT_SCENARIO`, not the main `App`'s
 * shared session -- this exhibit is a picker demo, not a scenario editor)
 * and re-resolves it through `resolveModel` (`@ballista/runtime`) on every
 * change, mirroring `terrain-editor-route.tsx`'s "live state (here) +
 * presentational rendering (`ModelPickerPanel`, `@ballista/ui`)" split.
 *
 * `resolved` is a `useMemo` keyed on `scenario`, so picking a different
 * model kind synchronously re-runs `resolveModel` on the next render --
 * this is what makes "switching model regenerates channels/controls" (this
 * task's validation criterion) true end-to-end, not just at
 * `ModelPickerPanel`'s own UI-side channel lookup: the "Resolved model"
 * section below reads `resolved.model.channels`/`.dim` straight off the
 * real `Model` instance `resolveModel` just built, so the picker and the
 * actual resolver can never disagree about what a kind switch produces.
 *
 * `resolveModel` can throw (`createSpatialProjectileModel`'s own
 * unsupported-force-id guard, see `scenario-resolver.ts`'s doc comment) --
 * caught here and surfaced as an inline error rather than crashing the
 * route, so a future force/kind combination that isn't wired yet fails
 * predictably in the UI too.
 */

import type { ScenarioSpec } from "@ballista/engine";
import { DEFAULT_SCENARIO, resolveModel } from "@ballista/runtime";
import { ModelPickerPanel } from "@ballista/ui";
import { useMemo, useState } from "preact/hooks";
import "./solver-lab-route.css";

interface Resolved {
  readonly ok: boolean;
  readonly dim?: number;
  readonly channels?: readonly { readonly name: string; readonly unit: string }[];
  readonly error?: string;
}

function resolve(scenario: ScenarioSpec): Resolved {
  try {
    const { model } = resolveModel(scenario);
    return { ok: true, dim: model.dim, channels: model.channels };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function ModelRegistryRoute() {
  const [scenario, setScenario] = useState<ScenarioSpec>(DEFAULT_SCENARIO);
  const resolved = useMemo(() => resolve(scenario), [scenario]);

  return (
    <div class="solver-lab-route" data-testid="model-registry-route">
      <a href="#/" class="solver-lab-route-back" data-testid="model-registry-back-link">
        &larr; Back to simulator
      </a>
      <h1>Model Registry</h1>
      <p>
        Pick which physics model this scenario resolves to. Switching models changes both the state
        channels the model exposes and the extra controls this panel offers for that model's own
        parameters.
      </p>

      <ModelPickerPanel
        model={scenario.model}
        initialConditions={scenario.initialConditions}
        onChange={({ model, initialConditions }) =>
          setScenario((prev) => ({ ...prev, model, initialConditions }))
        }
      />

      {resolved.ok ? (
        <div data-testid="model-registry-resolved">
          <p>
            Resolved model dimension:{" "}
            <strong data-testid="model-registry-dim">{resolved.dim}</strong>
          </p>
          <ul data-testid="model-registry-resolved-channels">
            {resolved.channels!.map((channel) => (
              <li
                key={channel.name}
                data-testid={`model-registry-resolved-channel-${channel.name}`}
              >
                {channel.name} ({channel.unit})
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p data-testid="model-registry-error" role="alert">
          {resolved.error}
        </p>
      )}
    </div>
  );
}
