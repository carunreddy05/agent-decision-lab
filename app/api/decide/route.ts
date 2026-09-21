import { NextResponse } from "next/server";
import {
  InvalidProviderOutputError,
  ProviderTimeoutError,
  ProviderUnavailableError,
} from "@/domain/errors";
import { DEFAULT_CONFIDENCE_THRESHOLD, runDecision } from "@/pipeline/run-decision";

/**
 * The server boundary for the decision pipeline. This is a plain Next.js
 * Route Handler — the smallest mechanism that keeps provider calls (today:
 * none, just the mock; Phase 4-5: Jev/Claude API keys) entirely server-side.
 * The client never imports the pipeline or a provider directly.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { prompt, confidenceThreshold } = (body ?? {}) as {
    prompt?: unknown;
    confidenceThreshold?: unknown;
  };

  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return NextResponse.json({ error: "`prompt` is required." }, { status: 400 });
  }

  const threshold =
    typeof confidenceThreshold === "number" ? confidenceThreshold : DEFAULT_CONFIDENCE_THRESHOLD;

  try {
    const trace = await runDecision(prompt, { confidenceThreshold: threshold });
    return NextResponse.json(trace);
  } catch (error) {
    if (
      error instanceof InvalidProviderOutputError ||
      error instanceof ProviderTimeoutError ||
      error instanceof ProviderUnavailableError
    ) {
      return NextResponse.json({ error: `Technical failure: ${error.message}` }, { status: 502 });
    }
    return NextResponse.json({ error: "Unexpected server error." }, { status: 500 });
  }
}
