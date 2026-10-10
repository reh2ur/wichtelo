"use server";

import { redirect } from "next/navigation";
import { resolveToken } from "@/lib/invite";
import { verifyEmailLink } from "@/lib/auth/email-link";

/**
 * POST target of the invite confirm page (emailed sign-in button). Always
 * redirects back to the invite page, with an error flag on failure; the
 * invite page then continues the join flow (names form) for a signed-in user.
 */
export async function confirmInviteLink(token: string, formData: FormData) {
  // Don't burn the emailed token for a dead invite (invalid / already drawn).
  const resolved = await resolveToken(token);
  if (!resolved || resolved.group.state !== "open")
    redirect(`/einladung/${token}`);

  const result = await verifyEmailLink(
    String(formData.get("token_hash") ?? ""),
  );
  if (result === "ok") redirect(`/einladung/${token}`);
  redirect(`/einladung/${token}?error=${result}`);
}
