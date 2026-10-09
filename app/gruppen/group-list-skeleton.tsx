import { Skeleton } from "@/components/ui/skeleton";
import { LoadingRegion } from "@/components/ui/loading-region";

export function GroupListSkeleton() {
  return (
    <LoadingRegion>
      <div className="mb-3">
        <Skeleton className="h-3.5 w-28" />
      </div>
      <ul className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <li
            key={i}
            className="border-border bg-card flex items-center justify-between rounded-lg border px-4 py-3"
          >
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </li>
        ))}
      </ul>
    </LoadingRegion>
  );
}
