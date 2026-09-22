import { NextResponse } from "next/server";
import {
  InvalidProviderOutputError,
  ProviderAuthenticationError,
  ProviderAuthorizationError,
  ProviderBillingError,
  ProviderRateLimitError,
  ProviderRequestError,
  ProviderTimeoutError,
  ProviderUnavailableError,
} from "@/domain/errors";
import { DEFAULT_CONFIDENCE_THRESHOLD, runDecision } from "@/pipeline/run-decision";
import { ClaudeRouterProvider } from "@/providers/claude/claude-router-provider";
import { JevRouterProvider } from "@/providers/jev/jev-router-provider";
import type { RouterProvider } from "@/providers/router-provider";

const PROVIDER_NAMES = ["mock", "jev", "claude"] as const;
type ProviderName = (typeof PROVIDER_NAMES)[number];

function isProviderName(value: unknown): value is ProviderName {
  return typeof value === "string" && (PROVIDER_NAMES as readonly string[]).includes(value);
}

/** `undefined` means "use runDecision's own default" (the mock provider). */
function resolveProvider(name: ProviderName): RouterProvider | undefined {
  if (name === "jev") return new JevRouterProvider();
  if (name === "claude") return new ClaudeRouterProvider();
  return undefined;
}

/**
 * The server boundary for the decision pipeline. This is a plain Next.js
 * Route Handler — the smallest mechanism that keeps provider calls (Jev via
 * Vercel AI Gateway; Claude via the Messages API) entirely server-side. The
 * client never imports the pipeline or a provider directly, and never sees
 * an API key — it only ever sends a `provider` name.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { prompt, confidenceThreshold, provider } = (body ?? {}) as {
    prompt?: unknown;
    confidenceThreshold?: unknown;
    provider?: unknown;
  };

  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return NextResponse.json({ error: "`prompt` is required." }, { status: 400 });
  }

  if (provider !== undefined && !isProviderName(provider)) {
    return NextResponse.json({ error: `\`provider\` must be one of: ${PROVIDER_NAMES.join(", ")}.` }, { status: 400 });
  }

  const threshold =
    typeof confidenceThreshold === "number" ? confidenceThreshold : DEFAULT_CONFIDENCE_THRESHOLD;

  try {
    const trace = await runDecision(prompt, {
      confidenceThreshold: threshold,
      provider: resolveProvider(provider ?? "mock"),
    });
    return NextResponse.json(trace);
  } catch (error) {
    if (
      error instanceof InvalidProviderOutputError ||
      error instanceof ProviderTimeoutError ||
      error instanceof ProviderUnavailableError ||
      error instanceof ProviderAuthenticationError ||
      error instanceof ProviderAuthorizationError ||
      error instanceof ProviderBillingError ||
      error instanceof ProviderRequestError ||
      error instanceof ProviderRateLimitError
    ) {
      return NextResponse.json({ error: `Technical failure: ${error.message}` }, { status: 502 });
    }
    return NextResponse.json({ error: "Unexpected server error." }, { status: 500 });
  }
}
