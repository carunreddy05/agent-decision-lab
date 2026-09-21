/**
 * Phase 3 baseline evaluation — NOT a Jev or Claude benchmark.
 *
 * Runs two Phase-2-era heuristics against the locked v1.0 ground truth,
 * purely to see where today's simple implementations already diverge from
 * it:
 *
 *   1. "Application action-derivation baseline" — deriveAction() given the
 *      case's *ground-truth* route (isolating the action layer from routing
 *      errors, per the layer-separation rule in AGENTS.md).
 *   2. "Mock simulation baseline — excluded from model comparison" —
 *      MockRouterProvider's routing accuracy against expectedRoute.
 *
 * Standalone script (tsx), outside the Next.js app process. Makes no network
 * calls and costs nothing to run.
 */
import path from "node:path";
import { deriveAction } from "@/pipeline/derive-action";
import { MockRouterProvider } from "@/providers/mock/mock-provider";
import { loadDataset } from "@/benchmark/load-dataset";
import { hashDataset } from "@/benchmark/hash";
import type { BenchmarkCase } from "@/benchmark/types";

const DATASET_PATH = path.resolve(import.meta.dirname, "../benchmark/datasets/routing-v1.0.json");

interface ActionMismatch {
  id: string;
  prompt: string;
  expectedAction: string;
  derivedAction: string;
  reason: string;
}

interface RouteMismatch {
  id: string;
  prompt: string;
  expectedRoute: string;
  mockRoute: string;
}

function evaluateActionBaseline(cases: BenchmarkCase[]) {
  const annotated = cases.filter((c) => c.expectedAction !== undefined);
  const mismatches: ActionMismatch[] = [];
  let correct = 0;

  for (const c of annotated) {
    const derived = deriveAction(c.expectedRoute, c.prompt);
    const derivedAction = derived.action ?? "NONE";
    if (derivedAction === c.expectedAction) {
      correct += 1;
    } else {
      mismatches.push({
        id: c.id,
        prompt: c.prompt,
        expectedAction: c.expectedAction as string,
        derivedAction,
        reason: derived.reason,
      });
    }
  }

  return {
    totalAnnotated: annotated.length,
    correct,
    incorrect: mismatches.length,
    accuracy: annotated.length > 0 ? correct / annotated.length : 0,
    mismatches,
  };
}

async function evaluateMockRouterBaseline(cases: BenchmarkCase[]) {
  const provider = new MockRouterProvider();
  const mismatches: RouteMismatch[] = [];
  let correct = 0;

  for (const c of cases) {
    const decision = await provider.decide({ prompt: c.prompt });
    if (decision.route === c.expectedRoute) {
      correct += 1;
    } else {
      mismatches.push({
        id: c.id,
        prompt: c.prompt,
        expectedRoute: c.expectedRoute,
        mockRoute: decision.route,
      });
    }
  }

  return {
    total: cases.length,
    correct,
    incorrect: mismatches.length,
    accuracy: correct / cases.length,
    mismatches,
  };
}

async function main() {
  const dataset = loadDataset(DATASET_PATH);
  console.log(
    `datasetVersion=${dataset.version} datasetHash=${hashDataset(dataset)} cases=${dataset.cases.length}`,
  );
  console.log();

  console.log("=== Application action-derivation baseline (NOT a Jev/Claude benchmark) ===");
  const actionResult = evaluateActionBaseline(dataset.cases);
  console.log(
    `Annotated cases: ${actionResult.totalAnnotated} | correct: ${actionResult.correct} | incorrect: ${actionResult.incorrect} | accuracy: ${(actionResult.accuracy * 100).toFixed(1)}%`,
  );
  for (const m of actionResult.mismatches) {
    console.log(`  [${m.id}] "${m.prompt}"`);
    console.log(`      expected=${m.expectedAction} derived=${m.derivedAction} (${m.reason})`);
  }
  console.log();

  console.log("=== Mock simulation baseline — excluded from model comparison ===");
  const mockResult = await evaluateMockRouterBaseline(dataset.cases);
  console.log(
    `Total cases: ${mockResult.total} | correct: ${mockResult.correct} | incorrect: ${mockResult.incorrect} | accuracy: ${(mockResult.accuracy * 100).toFixed(1)}%`,
  );
  for (const m of mockResult.mismatches) {
    console.log(`  [${m.id}] "${m.prompt}"`);
    console.log(`      expected=${m.expectedRoute} mock=${m.mockRoute}`);
  }
}

main();
