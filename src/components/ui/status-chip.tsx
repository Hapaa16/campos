import { cn } from "@/lib/utils";

/**
 * The single place status colour is allowed to enter the UI.
 *
 * Every chip pairs its colour with a text label, so the state is never
 * conveyed by hue alone — that is what makes it readable to a colour-blind
 * user and in a greyscale print of the manifest.
 */
export type StatusTone = "ok" | "warn" | "danger" | "plan" | "neutral" | "accent";

const TONE_CLASS: Record<StatusTone, string> = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  plan: "bg-plan-soft text-plan",
  neutral: "bg-neutral-soft text-text-2",
  accent: "bg-accent-soft text-accent",
};

const DOT_CLASS: Record<StatusTone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
  plan: "bg-plan",
  neutral: "bg-neutral",
  accent: "bg-accent",
};

export function StatusChip({
  tone = "neutral",
  children,
  dot = true,
  className,
}: {
  tone?: StatusTone;
  children: React.ReactNode;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[var(--radius-chip)] px-1.5 py-0.5 text-xs font-medium leading-none",
        TONE_CLASS[tone],
        className,
      )}
    >
      {dot && <span className={cn("size-1.5 rounded-full", DOT_CLASS[tone])} aria-hidden />}
      {children}
    </span>
  );
}
