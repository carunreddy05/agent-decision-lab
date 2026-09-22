import type { EscalationReason, Trace } from "@/domain/trace";
import { ROUTE_LABELS } from "../route-visuals";
import { PolicyBadge } from "./PolicyBadge";
import { ProbabilityBars } from "./ProbabilityBars";

/**
 * MISSING_CONFIDENCE_FALLBACK is deliberately labeled distinctly from
 * ordinary low confidence — it's a strategy-level inability to evaluate the
 * decision at all, not a measured low score. See EscalationReason's doc
 * comment in src/domain/trace.ts.
 */
const FALLBACK_REASON_LABELS: Partial<Record<EscalationReason, string>> = {
  UNCERTAINTY_FALLBACK: "Low confidence",
  MISSING_CONFIDENCE_FALLBACK: "Missing confidence fallback",
  TECHNICAL_FAILURE_FALLBACK: "Technical failure fallback",
};

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <h3 className="mb-3 text-xs font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <span className="text-neutral-500 dark:text-neutral-400">{label}</span>
      <span className="font-medium text-neutral-900 dark:text-neutral-100">{value}</span>
    </div>
  );
}

export function ResultView({ trace }: { trace: Trace }) {
  const { decision, escalation, policy, execution } = trace;
  const final = decision.final;
  const isHybrid = trace.strategy === "HYBRID";

  return (
    <div className="space-y-4">
      <Panel title="Decision">
        <div className="mb-3 flex items-center gap-2">
          <span className="rounded border border-neutral-300 px-2 py-0.5 font-mono text-xs text-neutral-500 uppercase dark:border-neutral-700 dark:text-neutral-400">
            {final.provider === "mock" ? `${final.provider} / simulated` : `${final.provider} / ${final.model}`}
          </span>
        </div>
        <Field label="Route" value={ROUTE_LABELS[final.route]} />
        {final.confidence !== undefined ? (
          <Field label="Decision confidence" value={`${Math.round(final.confidence * 100)}%`} />
        ) : (
          <Field label="Decision confidence" value="Not available for this provider" />
        )}
        <Field label="Latency (client-measured)" value={`${final.latencyMs} ms`} />
        {final.usage?.inputTokens !== undefined && (
          <Field
            label="Usage"
            value={`${final.usage.inputTokens} in / ${final.usage.outputTokens ?? 0} out tokens`}
          />
        )}
        {final.usage?.providerReportedCostUsd !== undefined && (
          <Field label="Provider-reported cost" value={`$${final.usage.providerReportedCostUsd.toFixed(6)}`} />
        )}
        {final.confidence !== undefined && (
          <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">
            Provider-reported decision signal, not a measured probability of correctness — see
            CLAUDE.md for the calibration caveat.
          </p>
        )}
        {final.probabilities ? (
          <div className="mt-3">
            <ProbabilityBars probabilities={final.probabilities} />
          </div>
        ) : (
          <p className="mt-3 text-xs text-neutral-400 dark:text-neutral-500">
            No per-route probabilities available for this provider.
          </p>
        )}
      </Panel>

      <Panel title="Escalation">
        {isHybrid ? (
          <>
            <Field
              label="Fallback"
              value={escalation.triggered ? `Yes — ${FALLBACK_REASON_LABELS[escalation.reason] ?? escalation.reason}` : "No fallback"}
            />
            {escalation.threshold !== undefined && (
              <Field label="Threshold" value={`${Math.round(escalation.threshold * 100)}%`} />
            )}
            {decision.jev && (
              <>
                <Field label="Jev initial route" value={ROUTE_LABELS[decision.jev.route]} />
                <Field
                  label="Jev confidence"
                  value={
                    decision.jev.confidence !== undefined
                      ? `${Math.round(decision.jev.confidence * 100)}%`
                      : "Missing"
                  }
                />
              </>
            )}
            {decision.claudeFallback && (
              <Field label="Claude fallback route" value={ROUTE_LABELS[decision.claudeFallback.route]} />
            )}
            <Field label="Final provider" value={final.provider} />
            {trace.hybridMeta && (
              <Field label="Total Hybrid latency" value={`${trace.hybridMeta.totalLatencyMs} ms`} />
            )}
          </>
        ) : (
          <Field
            label="Would escalate"
            value={escalation.reason === "UNCERTAINTY_FALLBACK" ? "Yes — WOULD ESCALATE" : "Not required"}
          />
        )}
        {!isHybrid && escalation.threshold !== undefined && (
          <Field label="Threshold" value={`${Math.round(escalation.threshold * 100)}%`} />
        )}
        {escalation.detail && (
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">{escalation.detail}</p>
        )}
      </Panel>

      <div className="flex items-center gap-3 py-1 text-xs font-semibold tracking-widest text-neutral-400 uppercase dark:text-neutral-600">
        <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
        AI decision ends here
        <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
      </div>

      <Panel title="Policy">
        {policy ? (
          <>
            <Field label="Proposed action" value={<code className="font-mono">{policy.action}</code>} />
            <div className="flex items-center justify-between py-1">
              <span className="text-sm text-neutral-500 dark:text-neutral-400">Result</span>
              <PolicyBadge result={policy.result} />
            </div>
            <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">{policy.reason}</p>
          </>
        ) : (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            No external action was proposed for this request — nothing for policy to evaluate.
          </p>
        )}
      </Panel>

      <Panel title="Execution">
        {execution && (
          <>
            <Field label="Tool" value={<code className="font-mono">{execution.tool}</code>} />
            <Field label="Status" value={execution.status.toUpperCase()} />
            {execution.detail && (
              <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">{execution.detail}</p>
            )}
            {execution.results && execution.results.length > 0 && (
              <ul className="mt-3 space-y-2">
                {execution.results.map((item, index) => (
                  <li
                    key={index}
                    className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm dark:border-neutral-800 dark:bg-neutral-950"
                  >
                    {Object.entries(item).map(([key, value]) => (
                      <div key={key} className="flex gap-2">
                        <span className="shrink-0 font-mono text-xs text-neutral-400 uppercase dark:text-neutral-500">
                          {key}
                        </span>
                        <span className="text-neutral-700 dark:text-neutral-200">{value}</span>
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Panel>

      <details className="rounded-lg border border-neutral-200 bg-white p-5 text-sm dark:border-neutral-800 dark:bg-neutral-900">
        <summary className="cursor-pointer text-xs font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
          Trace
        </summary>
        <div className="mt-3 space-y-1">
          <Field label="Trace ID" value={<code className="font-mono text-xs">{trace.traceId}</code>} />
          <Field label="Created" value={new Date(trace.createdAt).toLocaleString()} />
          <Field label="Strategy" value={trace.strategy} />
        </div>
        <pre className="mt-3 overflow-x-auto rounded-md bg-neutral-50 p-3 text-xs text-neutral-600 dark:bg-neutral-950 dark:text-neutral-400">
          {JSON.stringify(trace, null, 2)}
        </pre>
      </details>
    </div>
  );
}
