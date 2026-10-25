import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Form/action error line. `role="alert"` so assistive tech announces it when it
 * appears. Pair with `errorFieldProps(id, active)` on the input it belongs to.
 * Renders nothing for an empty message, so callers can pass `error` directly.
 */
export function FormError({
  id,
  children,
  className,
}: {
  id?: string;
  children?: ReactNode;
  className?: string;
}) {
  if (!children) return null;
  return (
    <p
      id={id}
      role="alert"
      className={cn("text-danger-text text-sm", className)}
    >
      {children}
    </p>
  );
}

/** aria props wiring an input to its `FormError` id while the error shows. */
export function errorFieldProps(errorId: string, active: boolean) {
  return active
    ? ({ "aria-invalid": true, "aria-describedby": errorId } as const)
    : {};
}
