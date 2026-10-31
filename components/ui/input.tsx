import * as React from "react";

import { cn } from "@/lib/utils";

/** 16px under md (iOS Safari zooms on focus below 16px), 44px touch target under md. */
const controlClass =
  "flex w-full rounded-lg border border-input bg-background px-3 text-base shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm";

function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      className={cn(controlClass, "h-11 py-1 md:h-9", className)}
      {...props}
    />
  );
}

export { Input, controlClass };
