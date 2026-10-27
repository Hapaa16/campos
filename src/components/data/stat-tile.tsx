import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StatusTone } from "@/components/ui/status-chip";

/**
 * A single operational figure.
 *
 * The value is the loudest thing on the tile; the label is quiet; the delta is
 * quieter still. Colour appears only when the figure itself carries a state
 * (a shortfall, an overdue count) — a tile that is merely informative is
 * rendered in plain text.
 */
export function StatTile({
  label,
  value,
  unit,
  hint,
  tone,
  icon: Icon,
  footer,
  className,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  hint?: string;
  tone?: StatusTone;
  icon?: LucideIcon;
  footer?: React.ReactNode;
  className?: string;
}) {
  const valueTone =
    tone === "danger"
      ? "text-danger"
      : tone === "warn"
        ? "text-warn"
        : tone === "ok"
          ? "text-ok"
          : "text-text";

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col justify-between rounded-[var(--radius-card)] border border-line bg-surface p-3",
        "shadow-[var(--shadow-raised)]",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-xs font-medium text-text-2">{label}</p>
        {Icon && <Icon className="size-3.5 shrink-0 text-text-3" aria-hidden />}
      </div>

      <p className="mt-2 flex items-baseline gap-1">
        <span className={cn("tnum text-2xl font-semibold tracking-tight", valueTone)}>{value}</span>
        {unit && <span className="text-sm text-text-3">{unit}</span>}
      </p>

      {hint && <p className="mt-0.5 truncate text-2xs text-text-3">{hint}</p>}
      {footer && <div className="mt-2">{footer}</div>}
    </div>
  );
}

/** Horizontal capacity bar. Segments are states, so each carries its own tone. */
export function CapacityBar({
  segments,
  total,
  className,
}: {
  segments: { value: number; tone: StatusTone; label: string }[];
  total: number;
  className?: string;
}) {
  const TONE_BG: Record<StatusTone, string> = {
    ok: "bg-ok",
    warn: "bg-warn",
    danger: "bg-danger",
    plan: "bg-plan",
    neutral: "bg-neutral",
    accent: "bg-accent",
  };

  return (
    <div
      className={cn("flex h-1.5 w-full overflow-hidden rounded-full bg-surface-inset", className)}
      role="img"
      aria-label={segments.map((s) => `${s.label}: ${s.value}`).join(", ")}
    >
      {segments.map((s) =>
        s.value > 0 ? (
          <div
            key={s.label}
            className={TONE_BG[s.tone]}
            style={{ width: `${total > 0 ? (s.value / total) * 100 : 0}%` }}
          />
        ) : null,
      )}
    </div>
  );
}
