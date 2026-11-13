"use client";

import { useEffect, useState } from "react";
import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react/ssr";
import { Button } from "@/components/ui/button";

/** Revealed name hides itself again after this long (shoulder-surfing). */
const AUTO_HIDE_MS = 15_000;

/** Fixed mask length so the masked string does not hint at the name's length. */
const MASK = "••••••••";

export function RevealAssignment({
  label,
  name,
  hiddenLabel,
  revealLabel,
  hideLabel,
}: {
  label: string;
  name: string;
  hiddenLabel: string;
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
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {label}
        </p>
        <p className="mt-1 text-xl font-bold break-words">
          {revealed ? (
            <span data-testid="assignment-name">{name}</span>
          ) : (
            <>
              <span
                aria-hidden="true"
                className="text-navy-soft tracking-[0.2em]"
                data-testid="assignment-masked"
              >
                {MASK}
              </span>
              <span className="sr-only">{hiddenLabel}</span>
            </>
          )}
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={revealed}
        data-testid="assignment-toggle"
        onClick={() => setRevealed((r) => !r)}
      >
        {revealed ? (
          <EyeSlashIcon size={16} aria-hidden="true" />
        ) : (
          <EyeIcon size={16} aria-hidden="true" />
        )}
        {revealed ? hideLabel : revealLabel}
      </Button>
    </div>
  );
}
