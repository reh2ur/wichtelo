"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Result block that replaces a control which just unmounted (e.g. a focused
 * Confirm button). `role="status"` announces it; focus moves onto it on mount
 * so keyboard users don't fall back to <body>. Remount (change `key`) to
 * re-announce a repeated result.
 */
export function FocusStatus({
  children,
  className,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div
      ref={ref}
      role="status"
      tabIndex={-1}
      className={cn("outline-none", className)}
      {...rest}
    >
      {children}
    </div>
  );
}
