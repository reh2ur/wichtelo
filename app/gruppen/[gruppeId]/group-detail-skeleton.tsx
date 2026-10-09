import { Skeleton } from "@/components/ui/skeleton";
import { LoadingRegion } from "@/components/ui/loading-region";

export function GroupDetailSkeleton() {
  return (
    <LoadingRegion>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-12" />
        </div>
        <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
      </div>

      <div className="mb-6">
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>

      <div className="mb-6 grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="border-border bg-card rounded-lg border px-4 pt-5 pb-4"
          >
            <Skeleton className="h-3 w-14" />
            <Skeleton className="mt-2 h-6 w-8" />
          </div>
        ))}
      </div>

      <div className="mb-3">
        <Skeleton className="h-3.5 w-28" />
      </div>
      <ul className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <li
            key={i}
            className="border-border bg-card flex items-center gap-3 rounded-lg border px-4 py-3"
          >
            <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
            <Skeleton className="h-4 w-28" />
          </li>
        ))}
      </ul>
    </LoadingRegion>
  );
}
