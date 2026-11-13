import Link from "next/link";
import { StateBadge, type GroupState } from "@/components/state-badge";

/**
 * One row of the groups overview (active + past). Name on first line, year
 * (and optional extra line) muted below. Badges stay right, never squeezed.
 */
export function GroupListItem({
  slug,
  name,
  year,
  state,
  stateLabels,
  adminLabel,
  extraLine,
}: {
  slug: string;
  name: string;
  year: number;
  state: GroupState;
  stateLabels: { open: string; drawn: string };
  adminLabel?: string;
  extraLine?: string;
}) {
  return (
    <li>
      <Link
        href={`/gruppen/${slug}`}
        className="border-border bg-card hover:bg-muted/50 flex items-center justify-between gap-3 rounded-lg border px-4 py-3 transition-colors"
      >
        <div className="min-w-0 space-y-0.5">
          <span className="block font-medium break-words">{name}</span>
          <p data-testid="group-year" className="text-muted-foreground text-xs">
            {year}
          </p>
          {extraLine && (
            <p className="text-muted-foreground text-sm">{extraLine}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StateBadge state={state} labels={stateLabels} />
          {adminLabel && (
            <span className="text-muted-foreground text-xs">{adminLabel}</span>
          )}
        </div>
      </Link>
    </li>
  );
}
