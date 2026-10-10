"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import { getSiteUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { issueDeletionToken, findSoleAdminGroups } from "@/lib/account";
import { notify } from "@/lib/notification";
import { logger } from "@/lib/logger";
import { groupTag } from "@/lib/cache-tags";
import { checkRateLimit, accountDeletionLimiter } from "@/lib/rate-limit";

const nameSchema = z.string().min(1).max(50);

export type UpdateProfileState =
  | { status: "idle" }
  | { status: "success" }
  | {
      status: "error";
      error: "missing_name" | "too_long" | "not_authenticated" | "generic";
      /** Submitted input, echoed so the form survives validation errors. */
      values?: { firstName: string; lastName: string };
    };

export type RequestDeletionState =
  | { status: "idle" }
  | { status: "sent" }
  | {
      status: "error";
      error: "not_authenticated" | "generic" | "rate_limited" | "email_failed";
    }
  | { status: "error"; error: "sole_admin"; groups: string[] };

export async function updateProfile(
  _prev: UpdateProfileState,
  formData: FormData,
): Promise<UpdateProfileState> {
  const firstName = ((formData.get("firstName") as string) ?? "").trim();
  const lastName = ((formData.get("lastName") as string) ?? "").trim();

  const values = { firstName, lastName };
  if (!firstName || !lastName)
    return { status: "error", error: "missing_name", values };
  if (
    !nameSchema.safeParse(firstName).success ||
    !nameSchema.safeParse(lastName).success
  )
    return { status: "error", error: "too_long", values };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", error: "not_authenticated" };

  // Check the affected rows: users without a profile row (super-admin first
  // login, abandoned invite name step) match 0 rows on update and would
  // otherwise still see "Gespeichert". Not an upsert: authenticated only has
  // UPDATE on first_name/last_name, so ON CONFLICT DO UPDATE touching id is
  // denied.
  const { data: updated, error: updateError } = await supabase
    .from("profiles")
    .update({ first_name: firstName, last_name: lastName })
    .eq("id", user.id)
    .select("id");
  let error = updateError;
  if (!error && (updated ?? []).length === 0) {
    ({ error } = await supabase
      .from("profiles")
      .insert({ id: user.id, first_name: firstName, last_name: lastName }));
  }

  if (error) {
    logger
      .withMetadata({ userId: user.id, reason: error.message })
      .error("profile.update_failed");
    return { status: "error", error: "generic" };
  }

  const admin = createAdminClient();
  const { data: memberships, error: snapshotError } = await admin
    .from("memberships")
    .update({
      name_snapshot: `${firstName} ${lastName}`,
      first_name_snapshot: firstName,
      last_name_snapshot: lastName,
    })
    .eq("profile_id", user.id)
    .select("groups!inner(slug)");

  if (snapshotError) {
    // Profile row already changed; surface the failure so the user retries
    // (the update is idempotent) instead of leaving snapshots silently stale.
    logger
      .withMetadata({ userId: user.id, reason: snapshotError.message })
      .error("profile.snapshot_update_failed");
    return { status: "error", error: "generic" };
  }

  for (const m of (memberships ?? []) as unknown as {
    groups: { slug: string };
  }[]) {
    updateTag(groupTag(m.groups.slug));
  }

  logger.withMetadata({ userId: user.id }).info("profile.updated");
  return { status: "success" };
}

export async function requestAccountDeletion(): Promise<RequestDeletionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", error: "not_authenticated" };

  if (!(await checkRateLimit(accountDeletionLimiter, user.id))) {
    return { status: "error", error: "rate_limited" };
  }

  const soleAdminGroups = await findSoleAdminGroups(user.id);
  if (soleAdminGroups.length > 0) {
    return {
      status: "error",
      error: "sole_admin",
      groups: soleAdminGroups.map((g) => g.name),
    };
  }

  const siteUrl = await getSiteUrl();
  const token = await issueDeletionToken(user.id);
  const confirmUrl = `${siteUrl}/konto/delete/confirm?token=${token}`;

  const result = await notify({
    type: "account.deletion_requested",
    to: user.email!,
    confirmUrl,
  });

  if (result.failed > 0) {
    logger
      .withMetadata({ userId: user.id })
      .error("account.deletion_email_failed");
    return { status: "error", error: "email_failed" };
  }

  logger.withMetadata({ userId: user.id }).info("account.deletion_requested");
  return { status: "sent" };
}
