"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

export function ConfirmSubmitButton({
  label,
  pendingLabel,
}: {
  label: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}
