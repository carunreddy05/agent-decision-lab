import { ROUTES, type Route } from "@/domain/route";

export interface ConfusionMatrix {
  routes: readonly Route[];
  /** matrix[expectedRoute][observedRoute] = count */
  matrix: Record<Route, Record<Route, number>>;
  /** A provider failure for an expected route is never silently mapped onto REJECT — kept as its own column so the denominator stays visible (Phase 7A §13). */
  failureColumn: Record<Route, number>;
}

export interface ConfusionMatrixInput {
  expectedRoute: Route;
  succeeded: boolean;
  observedRoute?: Route;
}

export function buildConfusionMatrix(results: readonly ConfusionMatrixInput[]): ConfusionMatrix {
  const matrix = Object.fromEntries(
    ROUTES.map((expected) => [expected, Object.fromEntries(ROUTES.map((observed) => [observed, 0])) as Record<Route, number>]),
  ) as Record<Route, Record<Route, number>>;
  const failureColumn = Object.fromEntries(ROUTES.map((route) => [route, 0])) as Record<Route, number>;

  for (const result of results) {
    if (!result.succeeded || result.observedRoute === undefined) {
      failureColumn[result.expectedRoute] += 1;
      continue;
    }
    matrix[result.expectedRoute][result.observedRoute] += 1;
  }

  return { routes: ROUTES, matrix, failureColumn };
}

export function confusionMatrixToMarkdown(cm: ConfusionMatrix, title: string): string {
  const header = `| Expected \\ Observed | ${cm.routes.join(" | ")} | FAILURE |`;
  const separator = `|---|${cm.routes.map(() => "---").join("|")}|---|`;
  const rows = cm.routes.map((expected) => {
    const cells = cm.routes.map((observed) => cm.matrix[expected][observed]);
    return `| ${expected} | ${cells.join(" | ")} | ${cm.failureColumn[expected]} |`;
  });
  return [`### ${title}`, "", header, separator, ...rows].join("\n");
}
