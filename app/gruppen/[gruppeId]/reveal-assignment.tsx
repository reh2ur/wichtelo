"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/** Revealed name hides itself again after this long (shoulder-surfing). */
const AUTO_HIDE_MS = 15_000;

export function RevealAssignment({
  label,
  name,
  revealLabel,
  hideLabel,
}: {
  label: string;
  name: string;
  revealLabel: string;
  hideLabel: string;
}) {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!revealed) return;
    const id = setTimeout(() => setRevealed(false), AUTO_HIDE_MS);
    return () => clearTimeout(id);
  }, [revealed]);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <p className="text-sm">
        <span className="font-medium">{label}:</span>{" "}
        {revealed && (
          <span className="font-semibold" data-testid="assignment-name">
            {name}
          </span>
        )}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={revealed}
        data-testid="assignment-toggle"
        onClick={() => setRevealed((r) => !r)}
      >
        {revealed ? hideLabel : revealLabel}
      </Button>
    </div>
  );
}
