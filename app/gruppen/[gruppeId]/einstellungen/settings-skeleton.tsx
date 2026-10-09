import { Skeleton } from "@/components/ui/skeleton";
import { LoadingRegion } from "@/components/ui/loading-region";

export function SettingsSkeleton() {
  return (
    <LoadingRegion className="space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-6 w-40" />
      </div>

      <div className="space-y-4">
        <Skeleton className="h-3.5 w-28" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <Skeleton className="h-3.5 w-32" />
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>

      <div className="space-y-3">
        <Skeleton className="h-3.5 w-36" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="border-border bg-card flex items-center gap-3 rounded-lg border px-4 py-3"
          >
            <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
            <Skeleton className="h-4 w-28" />
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-10 w-40 rounded-lg" />
      </div>
    </LoadingRegion>
  );
}
