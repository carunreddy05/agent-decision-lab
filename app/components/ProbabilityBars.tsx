import { ROUTES, type Route } from "@/domain/route";
import { ROUTE_COLOR_VAR, ROUTE_LABELS } from "../route-visuals";

interface ProbabilityBarsProps {
  probabilities: Partial<Record<Route, number>>;
}

/**
 * Only renders what the provider actually returned — if a future provider
 * doesn't expose per-route probabilities, callers simply don't render this
 * component rather than it fabricating a distribution.
 */
export function ProbabilityBars({ probabilities }: ProbabilityBarsProps) {
  const entries = ROUTES.map((route) => [route, probabilities[route]] as const).filter(
    (entry): entry is [Route, number] => entry[1] !== undefined,
  );

  if (entries.length === 0) return null;

  return (
    <div className="space-y-2">
      {entries.map(([route, value]) => (
        <div key={route} className="flex items-center gap-3 text-sm">
          <span className="w-28 shrink-0 text-neutral-600 dark:text-neutral-300">
            {ROUTE_LABELS[route]}
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.round(value * 100)}%`, backgroundColor: ROUTE_COLOR_VAR[route] }}
            />
          </div>
          <span className="w-12 shrink-0 text-right font-mono text-neutral-700 tabular-nums dark:text-neutral-200">
            {Math.round(value * 100)}%
          </span>
        </div>
      ))}
    </div>
  );
}
