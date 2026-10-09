import { Fragment } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadingRegion } from "@/components/ui/loading-region";

export function AdminListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <LoadingRegion>
      <ul className="border-border bg-card divide-y rounded-lg border">
        {Array.from({ length: rows }).map((_, i) => (
          <li key={i} className="flex items-center justify-between px-4 py-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-20" />
          </li>
        ))}
      </ul>
    </LoadingRegion>
  );
}

export function AdminStatsSkeleton() {
  return (
    <LoadingRegion className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="border-border bg-card rounded-lg border p-4">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="mt-2 h-6 w-10" />
        </div>
      ))}
    </LoadingRegion>
  );
}

export function AdminDetailSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <LoadingRegion className="border-border bg-card grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <Fragment key={i}>
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-3.5 w-28" />
        </Fragment>
      ))}
    </LoadingRegion>
  );
}
