import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * An empty state names the next action. "No data" tells the user nothing they
 * did not already know; "No roster yet — generate one from a pattern" does.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      {Icon && (
        <div className="mb-3 flex size-9 items-center justify-center rounded-[var(--radius-card)] border border-line bg-surface-inset">
          <Icon className="size-4 text-text-3" aria-hidden />
        </div>
      )}
      <p className="text-md font-medium text-text">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-text-3">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
