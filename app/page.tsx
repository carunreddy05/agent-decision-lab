"use client";

import { useState } from "react";
import type { Trace } from "@/domain/trace";
import { ResultView } from "./components/ResultView";

const EXAMPLE_PROMPTS = [
  "Find the pull request associated with ENG-142.",
  "Summarize ticket ENG-207.",
  "Find documentation about retry handling.",
  "Create a Jira issue for this timeout problem.",
  "Delete the production database.",
  "Check ENG-142 and find the code change that fixed it.",
];

const FUTURE_MODES = [
  { label: "Jev", note: "coming in Phase 4" },
  { label: "Claude", note: "coming in Phase 5" },
  { label: "Hybrid", note: "coming in Phase 6" },
];

const DEFAULT_THRESHOLD = 0.8;

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [loading, setLoading] = useState(false);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runDecision() {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, confidenceThreshold: threshold }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "Something went wrong.");
        setTrace(null);
        return;
      }
      setTrace(body as Trace);
    } catch {
      setError("Could not reach the decision pipeline.");
      setTrace(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-full bg-neutral-50 dark:bg-black">
      <main className="mx-auto max-w-3xl px-6 py-12">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
            Agent Decision Lab
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Exploring the boundary between probabilistic AI decisions and deterministic software
            control.
          </p>
        </header>

        <details className="mb-6 rounded-lg border border-neutral-200 bg-white p-4 text-sm dark:border-neutral-800 dark:bg-neutral-900">
          <summary className="cursor-pointer font-medium text-neutral-700 dark:text-neutral-200">
            How this architecture is meant to work
          </summary>
          <div className="mt-3 space-y-2 text-neutral-500 dark:text-neutral-400">
            <p>
              <strong className="text-neutral-700 dark:text-neutral-300">Jev decides.</strong>{" "}
              <strong className="text-neutral-700 dark:text-neutral-300">
                Claude helps when Jev isn&apos;t sure.
              </strong>{" "}
              <strong className="text-neutral-700 dark:text-neutral-300">
                Software stays in control.
              </strong>{" "}
              This is the architecture being tested — Jev and Claude aren&apos;t wired up yet, so
              every run below uses a deterministic mock router.
            </p>
            <p>
              <strong className="text-neutral-700 dark:text-neutral-300">Decision:</strong> a
              model recommends what should happen.
            </p>
            <p>
              <strong className="text-neutral-700 dark:text-neutral-300">Escalation:</strong> an
              uncertain decision may be sent to a more capable model.
            </p>
            <p>
              <strong className="text-neutral-700 dark:text-neutral-300">Policy:</strong>{" "}
              application rules decide whether the proposed action is allowed — never the model.
            </p>
            <p>
              <strong className="text-neutral-700 dark:text-neutral-300">Execution:</strong> only
              an approved tool operation actually runs.
            </p>
          </div>
        </details>

        <div className="mb-6 flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-neutral-300 bg-white px-3 py-1 text-xs font-semibold text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">
            Mock Router — Simulation
          </span>
          {FUTURE_MODES.map((mode) => (
            <span
              key={mode.label}
              className="rounded-full border border-dashed border-neutral-300 px-3 py-1 text-xs text-neutral-400 dark:border-neutral-700 dark:text-neutral-600"
              title={mode.note}
            >
              {mode.label} — {mode.note}
            </span>
          ))}
        </div>

        <div className="space-y-4 rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Describe a request, e.g. “Find the pull request associated with ENG-142.”"
            rows={3}
            className="w-full resize-none rounded-md border border-neutral-300 bg-white p-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
          />

          <div className="flex flex-wrap gap-2">
            {EXAMPLE_PROMPTS.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setPrompt(example)}
                className="rounded-full border border-neutral-200 px-3 py-1 text-xs text-neutral-600 hover:border-neutral-400 hover:text-neutral-900 dark:border-neutral-800 dark:text-neutral-400 dark:hover:border-neutral-600 dark:hover:text-neutral-100"
              >
                {example}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 text-sm">
            <label htmlFor="threshold" className="text-neutral-500 dark:text-neutral-400">
              Escalation threshold
            </label>
            <input
              id="threshold"
              type="range"
              min={0.5}
              max={0.99}
              step={0.01}
              value={threshold}
              onChange={(event) => setThreshold(Number(event.target.value))}
              className="flex-1"
            />
            <span className="w-12 text-right font-mono text-neutral-700 tabular-nums dark:text-neutral-200">
              {Math.round(threshold * 100)}%
            </span>
          </div>
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            This threshold controls escalation behavior. It does not control authorization —
            policy decisions never change with it.
          </p>

          <button
            type="button"
            onClick={runDecision}
            disabled={loading || !prompt.trim()}
            className="w-full rounded-md bg-neutral-900 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {loading ? "Running…" : "Run Decision"}
          </button>
        </div>

        {error && (
          <div className="mt-6 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        {trace && (
          <div className="mt-6">
            <ResultView trace={trace} />
          </div>
        )}
      </main>
    </div>
  );
}
