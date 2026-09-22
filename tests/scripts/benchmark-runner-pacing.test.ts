import { afterEach, describe, expect, it, vi } from "vitest";
import { runPaced, sleep } from "../../scripts/benchmark-runner";
import { runJevOnlyCase, type CaseRunnerContext } from "@/benchmark/case-runner";
import type { RoutingDecision } from "@/domain/route";
import type { RouterProvider } from "@/providers/router-provider";
import type { BenchmarkCase } from "@/benchmark/types";

/**
 * Deterministic pacing tests (Phase 8C-B §8/§9) — fake timers throughout,
 * no real-time waiting. `runPaced` is exported from `scripts/benchmark-runner.ts`
 * behind an ESM entry-point guard (`process.argv[1] === fileURLToPath(import.meta.url)`)
 * specifically so it can be imported here without triggering the script's
 * `main()` side effects (argv parsing, process.exitCode, etc.).
 */

function makeCase(id: string): BenchmarkCase {
  return { id, prompt: `prompt for ${id}`, expectedRoute: "DOCS", difficulty: "CLEAR", category: "cat" };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("runPaced", () => {
  it("starts the first case immediately, without any initial delay", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const run = vi.fn(async (c: BenchmarkCase) => {
      calls.push(c.id);
      return c.id;
    });

    const promise = runPaced([makeCase("A")], 2000, run);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(["A"]);

    const results = await promise;
    expect(results).toEqual(["A"]);
  });

  it("waits exactly pacingMs between cases, calling them in order", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const run = vi.fn(async (c: BenchmarkCase) => {
      calls.push(c.id);
      return c.id;
    });

    const promise = runPaced([makeCase("A"), makeCase("B"), makeCase("C")], 2000, run);

    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(["A"]);

    await vi.advanceTimersByTimeAsync(1999);
    expect(calls).toEqual(["A"]); // not yet — one ms short of pacingMs

    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual(["A", "B"]); // exactly at pacingMs

    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toEqual(["A", "B", "C"]);

    const results = await promise;
    expect(results).toEqual(["A", "B", "C"]);
  });

  it("adds no delay when pacingMs is 0 (real timers — should resolve near-instantly)", async () => {
    const run = vi.fn(async (c: BenchmarkCase) => c.id);
    const cases = [makeCase("A"), makeCase("B"), makeCase("C")];

    const start = Date.now();
    const results = await runPaced(cases, 0, run);

    expect(Date.now() - start).toBeLessThan(100);
    expect(results).toEqual(["A", "B", "C"]);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("calls the provider exactly once per case — no retries introduced", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async (c: BenchmarkCase) => c.id);
    const promise = runPaced([makeCase("A"), makeCase("B")], 500, run);
    await vi.advanceTimersByTimeAsync(1000);
    await promise;
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("a resolved provider-failure result does not alter the fixed pacing", async () => {
    // Mirrors case-runner.ts's real contract: a provider failure resolves
    // with a failed result object, it never rejects — so this is the
    // realistic shape of "a case fails" from runPaced's point of view.
    vi.useFakeTimers();
    const calls: string[] = [];
    const run = vi.fn(async (c: BenchmarkCase) => {
      calls.push(c.id);
      return c.id === "A" ? { succeeded: false, errorCategory: "ProviderRateLimitError" } : { succeeded: true };
    });

    const promise = runPaced([makeCase("A"), makeCase("B")], 1000, run);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(["A"]);

    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toEqual(["A"]); // the failure did not shorten the wait

    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual(["A", "B"]); // the failure did not lengthen it either

    const results = await promise;
    expect(results).toEqual([
      { succeeded: false, errorCategory: "ProviderRateLimitError" },
      { succeeded: true },
    ]);
  });

  it("preserves case order", async () => {
    const run = vi.fn(async (c: BenchmarkCase) => c.id);
    await runPaced([makeCase("A"), makeCase("B"), makeCase("C")], 0, run);
    expect(run.mock.calls.map((args) => args[0].id)).toEqual(["A", "B", "C"]);
  });

  it("never alters prompt content — each case reaches `run` unmodified", async () => {
    const cases = [makeCase("A"), makeCase("B")];
    const run = vi.fn(async (c: BenchmarkCase) => c.id);
    await runPaced(cases, 0, run);

    expect(run.mock.calls[0][0]).toBe(cases[0]);
    expect(run.mock.calls[1][0]).toBe(cases[1]);
    expect(run.mock.calls[1][0].prompt).toBe("prompt for B");
  });
});

describe("provider latencyMs excludes pacing (Phase 8C-B §9)", () => {
  class StubProvider implements RouterProvider {
    readonly name = "jev";
    decide(): Promise<RoutingDecision> {
      // Simulates a real provider's own measured call time — fixed at
      // 300ms regardless of anything happening in the outer runner loop.
      return Promise.resolve({
        route: "DOCS",
        provider: "jev",
        model: "typesafe-ai/jev",
        confidence: 0.9,
        latencyMs: 300,
      });
    }
  }

  const CTX: CaseRunnerContext = {
    benchmarkRunId: "test-run",
    gitCommit: "deadbeef",
    datasetVersion: "1.0",
    datasetHash: "hash123",
    routingSpecVersion: "routing-spec-v1",
  };

  it("a case's recorded latencyMs never includes the pacing delay that preceded it", async () => {
    vi.useFakeTimers();
    const provider = new StubProvider();
    const cases = [makeCase("A"), makeCase("B")];

    const promise = runPaced(cases, 5000, (c) => runJevOnlyCase(c, provider, CTX));
    await vi.advanceTimersByTimeAsync(0); // case A runs immediately
    await vi.advanceTimersByTimeAsync(5000); // the 5s pacing wait before case B

    const results = await promise;
    // Case B waited 5000ms of *pacing* before it started, but its own
    // provider-reported latencyMs must still read exactly 300 — not
    // 5300 — because pacing lives entirely outside case-runner.ts's
    // measurement, which only ever copies decision.latencyMs through.
    expect(results[0].latencyMs).toBe(300);
    expect(results[1].latencyMs).toBe(300);
    expect(results[1].latencyMs).not.toBe(300 + 5000);
  });
});

describe("sleep", () => {
  it("resolves after approximately the given delay", async () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    sleep(500).then(spy);

    await vi.advanceTimersByTimeAsync(499);
    expect(spy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
