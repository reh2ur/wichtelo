export type GroupState = "open" | "drawn";

/**
 * Open/drawn chip. Shared by group list + group detail. Fill = white/70 so the
 * AA text tokens hold on any gradient stop (lib/contrast.test.ts); the state
 * tint lives in the border + dot only.
 */
export function StateBadge({
  state,
  labels,
}: {
  state: GroupState;
  labels: { open: string; drawn: string };
}) {
  const isOpen = state === "open";
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full border bg-white/70 px-2 py-0.5 text-xs font-medium",
        isOpen
          ? "border-success/30 text-success-text"
          : "border-crimson/30 text-danger-text",
      ].join(" ")}
    >
      <span
        aria-hidden="true"
        className={[
          "h-1.5 w-1.5 rounded-full",
          isOpen ? "bg-success" : "bg-crimson",
        ].join(" ")}
      />
      {isOpen ? labels.open : labels.drawn}
    </span>
  );
}
