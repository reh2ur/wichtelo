"use server";

import { redirect } from "next/navigation";
import { verifyEmailLink } from "@/lib/auth/email-link";

/**
 * POST target of the /auth/callback confirm page (emailed sign-in button).
 * Always redirects: success to /gruppen, failure to /anmelden with an error
 * flag the sign-in page turns into a German message.
 */
export async function confirmSignInLink(formData: FormData) {
  const result = await verifyEmailLink(
    String(formData.get("token_hash") ?? ""),
  );
  if (result === "ok") redirect("/gruppen");
  redirect(`/anmelden?error=${result}`);
}
