import * as React from "react";

import { cn } from "@/lib/utils";
import { controlClass } from "@/components/ui/input";

/** Native select, same sizing rules as Input. */
function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(controlClass, "h-11 py-1 md:h-9", className)}
      {...props}
    />
  );
}

export { Select };
