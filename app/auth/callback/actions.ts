"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { verifyEmailLink } from "@/lib/auth/email-link";
import { NEXT_COOKIE, safeNext } from "@/lib/safe-next";

/**
 * POST target of the /auth/callback confirm page (emailed sign-in button).
 * Always redirects: success to the validated return-to path (cookie set by
 * requestOtp, else /gruppen), failure to /anmelden with an error flag the
 * sign-in page turns into a German message.
 */
export async function confirmSignInLink(formData: FormData) {
  const result = await verifyEmailLink(
    String(formData.get("token_hash") ?? ""),
  );
  if (result !== "ok") redirect(`/anmelden?error=${result}`);

  const cookieStore = await cookies();
  const next = safeNext(cookieStore.get(NEXT_COOKIE)?.value);
  cookieStore.delete({ name: NEXT_COOKIE, path: "/auth" });
  redirect((next ?? "/gruppen") as Route);
}
