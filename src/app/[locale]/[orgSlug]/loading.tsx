import { Skeleton } from "@/components/ui/skeleton";

/** Geometry matches the dense table layout, so nothing jumps when data lands. */
export default function OrgLoading() {
  return (
    <div className="min-h-0 flex-1 p-3" role="status" aria-label="…">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-[84px] rounded-[var(--radius-card)]" />
        ))}
      </div>
      <Skeleton className="mt-3 h-64 rounded-[var(--radius-card)]" />
    </div>
  );
}
