import { cn } from "@/lib/utils";

/**
 * Skeletons mirror the geometry of the content they stand in for — same row
 * height, same column widths — so the page does not jump when data lands.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-[var(--radius-chip)] bg-surface-3", className)}
      {...props}
    />
  );
}

export function TableSkeleton({ rows = 10, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div role="status" aria-label="Ачаалж байна" className="divide-y divide-line">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex h-[var(--row-h)] items-center gap-4 px-3">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton
              key={c}
              className="h-3"
              style={{ width: c === 0 ? "18%" : c === columns - 1 ? "8%" : `${10 + ((r + c) % 4) * 4}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
