/**
 * Fixed limitations block appended to every generated benchmark report
 * (Phase 7A design checkpoint §23). A constant, not derived per-run, since
 * these are structural properties of the experiment itself, not of any one
 * run's results.
 */
export const BENCHMARK_LIMITATIONS: readonly string[] = [
  "This is a synthetic, hand-authored 100-case dataset — not a claim of real-world routing-traffic representativeness.",
  "Ground truth labels were authored by one human reviewer (see benchmark/reports/phase3-review.md); they are not a multi-rater consensus.",
  "The benchmark covers a single bounded task (support-request routing to one of five destinations) — results do not generalize to open-ended agentic tasks.",
  "Provider and model versions, and prompt/spec content, can drift after this report is generated; a result is only valid for the exact requestedModelIdentifier and routingSpecVersion recorded in its manifest.",
  "Latency figures reflect real network conditions between this machine and each provider's endpoint at call time — not a controlled, isolated benchmark environment.",
  "Cost figures use a static, versioned pricing config (see pricingConfigVersion in the manifest) and go stale silently if a provider changes its prices after this run.",
  "Jev's confidence signal is a provider-reported decision score, not a measured, calibrated probability of correctness — see CLAUDE.md's fairness guardrails and phase4-jev-research.md.",
  "Claude reports no native confidence/probability signal in this integration — its absence in results is a structural fact about the integration, not a missing measurement.",
  "Mock tool execution (src/tools/) simulates docs/GitHub/Jira responses over static fixtures — it does not exercise real production tool integrations.",
  "Route accuracy, action accuracy, and policy accuracy are three independent measurements — none of them, individually or combined, is a full measure of \"agent correctness.\"",
  "Offline threshold-simulation figures (analysisMode: OFFLINE_THRESHOLD_SIMULATION) are reconstructed from independently-collected JEV_ONLY/CLAUDE_ONLY baselines, not from genuine live Hybrid runs — they carry no latency figure, and a Jev technical failure observed in the baseline is not assumed to recur on a real Hybrid call.",
];
