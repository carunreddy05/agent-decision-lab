import type { PolicyResult } from "@/domain/policy";

const STATUS_STYLE: Record<PolicyResult, { color: string; icon: string; label: string }> = {
  ALLOW: { color: "var(--status-good)", icon: "✓", label: "ALLOW" },
  REQUIRE_REVIEW: { color: "var(--status-warning)", icon: "⚠", label: "REQUIRE REVIEW" },
  DENY: { color: "var(--status-critical)", icon: "✕", label: "DENY" },
};

/** Status is never color-alone: an icon and an explicit label always ship together. */
export function PolicyBadge({ result }: { result: PolicyResult }) {
  const style = STATUS_STYLE[result];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold"
      style={{ borderColor: style.color, color: style.color }}
    >
      <span aria-hidden="true">{style.icon}</span>
      {style.label}
    </span>
  );
}
