"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { triggerDraw, type DrawState } from "./actions";
import { setEmailWarning } from "./email-warning";
import { createIntlContext } from "@/lib/create-intl-context";

const { Provider: DrawProvider, useT: useDrawT } = createIntlContext("draw");

export { DrawProvider };

function errorMessage(
  state: DrawState,
  t: ReturnType<typeof useDrawT>,
): string | null {
  if (state.status !== "error") return null;
  switch (state.error) {
    case "not_admin":
      return t("errors.notAdmin");
    case "group_not_found":
      return t("errors.groupNotFound");
    case "already_drawn":
      return t("errors.alreadyDrawn");
    case "not_enough_members":
      return t("errors.notEnoughMembers");
    case "unsolvable":
      return t("errors.unsolvable");
    case "too_complex":
      return t("errors.tooComplex");
    case "ghost_members":
      return t("errors.ghostMembers");
    case "rate_limited":
      return t("errors.rateLimited");
    default:
      return t("errors.generic");
  }
}

export function DrawButtonClient({ slug }: { slug: string }) {
  const t = useDrawT();
  const [state, action, pending] = useActionState<DrawState, FormData>(
    async (prev, formData) => {
      const next = await triggerDraw(prev, formData);
      // Button unmounts once the group is drawn; hand warning to the page.
      if (next.status === "success" && next.emailsFailed > 0) {
        setEmailWarning(slug, next.emailsFailed, next.emailsTotal);
      }
      return next;
    },
    { status: "idle" },
  );
  const error = errorMessage(state, t);
  const emailWarning =
    state.status === "success" && state.emailsFailed > 0
      ? t("emailFailure", {
          failed: state.emailsFailed,
          total: state.emailsTotal,
        })
      : null;

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="slug" value={slug} />
      <Button type="submit" disabled={pending}>
        {pending ? t("starting") : t("start")}
      </Button>
      {error && <p className="text-destructive text-sm">{error}</p>}
      {emailWarning && (
        <p role="status" className="text-destructive text-sm">
          {emailWarning}
        </p>
      )}
    </form>
  );
}
