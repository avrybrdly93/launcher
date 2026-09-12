/**
 * The compute-capability panel (P7.13): what hardware this machine offers, and
 * what will consequently run.
 *
 * **Ordered outcome-first.** The headline says what is running before anything
 * says what is missing, because a user on a machine with no WebGPU is not
 * looking for a diagnosis — they are looking for confirmation that the
 * simulation still works. The WebGPU detail sits below it, and on an
 * unsupported machine it explains the reason and what (if anything) would
 * change it.
 *
 * **Nothing is retyped from `@ballista/runtime`.** Labels, the plan's reason
 * and the limit keys all come from the report, so a change to the backend
 * preference order or the reported limits shows up here without an edit. The
 * prose that *is* this panel's own — the four unsupported explanations —
 * lives in `webgpu-capability-panel-logic.ts` where it can be asserted.
 *
 * The panel takes a report rather than probing. Detection is async and the
 * caller owns when it happens; a component that probed in an effect would make
 * the panel untestable without faking a GPU and would re-probe on every mount.
 */

import type { ComputeCapabilityReport } from "@ballista/runtime";

import {
  UNSUPPORTED_EXPLANATIONS,
  describeAdapter,
  describeParallelism,
  headlineFor,
  limitRows,
} from "./webgpu-capability-panel-logic.js";

export interface WebGpuCapabilityPanelProps {
  /**
   * The completed report, or `null` while the probe is still running.
   *
   * `null` renders a "detecting" line rather than nothing: a panel that is
   * blank until an async probe resolves is indistinguishable from one that has
   * failed, which is the un-graceful shape this task is about.
   */
  readonly report: ComputeCapabilityReport | null;
}

export function WebGpuCapabilityPanel({ report }: WebGpuCapabilityPanelProps) {
  if (report === null) {
    return (
      <section class="capability-panel" data-testid="capability-panel">
        <h3 class="capability-panel__title">Compute capability</h3>
        <p class="capability-panel__pending" data-testid="capability-pending">
          Detecting available compute backends&hellip;
        </p>
      </section>
    );
  }

  const { webgpu, plan } = report;

  return (
    <section class="capability-panel" data-testid="capability-panel">
      <h3 class="capability-panel__title">Compute capability</h3>

      <p class="capability-panel__headline" data-testid="capability-headline">
        <span class={`capability-panel__badge capability-panel__badge--${plan.kind}`}>
          {plan.kind === "gpu" ? "GPU" : "CPU"}
        </span>{" "}
        {headlineFor(report)}
      </p>

      <p class="capability-panel__reason" data-testid="capability-plan-reason">
        {plan.reason}
      </p>

      <p class="capability-panel__parallelism" data-testid="capability-parallelism">
        Machine capacity: {describeParallelism(report)}.
      </p>

      <h4 class="capability-panel__subtitle">WebGPU</h4>

      {webgpu.supported ? (
        <div data-testid="capability-webgpu-supported">
          <p class="capability-panel__status capability-panel__status--ok">
            Available on this machine.
          </p>
          <dl class="capability-panel__facts">
            <dt>Adapter</dt>
            <dd data-testid="capability-adapter">{describeAdapter(webgpu.adapter)}</dd>
            <dt>Features</dt>
            <dd data-testid="capability-features">
              {webgpu.features.length === 0 ? "None reported" : webgpu.features.join(", ")}
            </dd>
          </dl>
          <table class="capability-panel__limits" data-testid="capability-limits">
            <caption>Adapter limits used by the Phase 7 compute path</caption>
            <tbody>
              {limitRows(webgpu.limits).map((row) => (
                <tr key={row.key} data-testid={`capability-limit-${row.key}`}>
                  <th scope="row">{row.label}</th>
                  <td>{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div data-testid="capability-webgpu-unsupported">
          <p
            class="capability-panel__status capability-panel__status--absent"
            data-testid="capability-unsupported-summary"
          >
            {UNSUPPORTED_EXPLANATIONS[webgpu.reason].summary}
          </p>
          <p class="capability-panel__remedy" data-testid="capability-unsupported-remedy">
            {UNSUPPORTED_EXPLANATIONS[webgpu.reason].remedy}
          </p>
          {webgpu.error !== null && (
            <p class="capability-panel__error" data-testid="capability-unsupported-error">
              Reported error: <code>{webgpu.error}</code>
            </p>
          )}
          {/*
            Deliberately NOT "results are identical to the GPU path". There is
            no GPU path yet (P7.14), and when there is it will be f32 while this
            one is f64 -- P7.17 exists because f32 is expected to be inadequate
            for some scenario classes. A reassurance that will be false later is
            not a reassurance.
          */}
          <p class="capability-panel__fallback" data-testid="capability-fallback">
            The simulation is unaffected: it runs on {plan.label}, in double precision. This is the
            path every result in this application is currently computed on, not a degraded
            substitute for one.
          </p>
        </div>
      )}
    </section>
  );
}
