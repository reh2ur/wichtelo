"use client";

import { useEffect, useRef } from "react";

/**
 * Focus management for inline confirm panels. The trigger unmounts when the
 * panel opens, so focus would fall to <body>. Focus the panel title on open,
 * and return focus to the trigger when the panel closes again.
 */
export function useConfirmFocus(open: boolean) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLParagraphElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) titleRef.current?.focus();
    else if (wasOpen.current) triggerRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  return { triggerRef, titleRef };
}

export const CONFIRM_TITLE_CLASS = "text-sm font-medium outline-none";
