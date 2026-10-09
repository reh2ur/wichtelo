"use server";

import { randomUUID } from "crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { slugCandidate } from "@/lib/slug";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { checkRateLimit, groupCreateLimiter } from "@/lib/rate-limit";

export type CreateGroupValues = {
  name: string;
  year: string;
  budgetHint: string;
  note: string;
  firstName: string;
  lastName: string;
};

export type CreateGroupState =
  | { status: "idle" }
  | {
      status: "error";
      error:
        | "missing_name"
        | "missing_year"
        | "profile_required"
        | "too_long"
        | "generic"
        | "rate_limited";
      /** Limit that was exceeded (only with `too_long`). */
      max?: number;
      /** Submitted input, echoed so the form survives validation errors. */
      values: CreateGroupValues;
    };

const nameSchema = z.string().min(1).max(100);
const yearSchema = z.number().int().min(2000).max(2100);
const budgetHintSchema = z.string().max(200);
const noteSchema = z.string().max(1000);
const personNameSchema = z.string().max(50);

export async function createGroup(
  _prev: CreateGroupState,
  formData: FormData,
): Promise<CreateGroupState> {
  const name = ((formData.get("name") as string) ?? "").trim();
  const yearStr = (formData.get("year") as string) ?? "";
  const budgetHint =
    ((formData.get("budgetHint") as string) ?? "").trim() || null;
  const note = ((formData.get("note") as string) ?? "").trim() || null;
  const firstName = ((formData.get("firstName") as string) ?? "").trim();
  const lastName = ((formData.get("lastName") as string) ?? "").trim();

  const values: CreateGroupValues = {
    name,
    year: yearStr,
    budgetHint: budgetHint ?? "",
    note: note ?? "",
    firstName,
    lastName,
  };
  const fail = (
    error: Extract<CreateGroupState, { status: "error" }>["error"],
    max?: number,
  ): CreateGroupState => ({ status: "error", error, max, values });

  if (!name) return fail("missing_name");
  if (!nameSchema.safeParse(name).success) return fail("too_long", 100);

  const year = parseInt(yearStr, 10);
  if (!year || isNaN(year) || !yearSchema.safeParse(year).success)
    return fail("missing_year");

  if (budgetHint && !budgetHintSchema.safeParse(budgetHint).success)
    return fail("too_long", 200);
  if (note && !noteSchema.safeParse(note).success)
    return fail("too_long", 1000);
  if (
    !personNameSchema.safeParse(firstName).success ||
    !personNameSchema.safeParse(lastName).success
  )
    return fail("too_long", 50);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/anmelden");

  if (!(await checkRateLimit(groupCreateLimiter, user.id))) {
    return fail("rate_limited");
  }

  // Ensure a profile exists — create one on first group creation if needed.
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, first_name, last_name")
    .eq("id", user.id)
    .single();

  let nameSnapshot: string;
  let firstNameSnapshot: string;
  let lastNameSnapshot: string;

  if (!profile) {
    if (!firstName || !lastName) {
      return fail("profile_required");
    }
    const { error: profileError } = await supabase
      .from("profiles")
      .insert({ id: user.id, first_name: firstName, last_name: lastName });
    if (profileError) {
      console.error(
        "[createGroup] profile insert failed:",
        profileError.message,
      );
      return fail("generic");
    }
    nameSnapshot = `${firstName} ${lastName}`;
    firstNameSnapshot = firstName;
    lastNameSnapshot = lastName;
  } else {
    nameSnapshot = `${profile.first_name} ${profile.last_name}`;
    firstNameSnapshot = profile.first_name;
    lastNameSnapshot = profile.last_name;
  }

  // Pre-generate UUID so we never need SELECT-after-INSERT.
  // (SELECT policy is is_member(id) which is false until membership exists — causes
  //  PostgREST to reject INSERT...RETURNING as an RLS violation.)
  const groupId = randomUUID();
  const MAX_SLUG_ATTEMPTS = 30;
  let slugAttempt = 0;
  let slug = slugCandidate(name, slugAttempt);

  while (true) {
    const { error } = await supabase.from("groups").insert({
      id: groupId,
      name,
      year,
      state: "open",
      budget_hint: budgetHint,
      note,
      created_by: user.id,
      slug,
    });

    if (!error) break;

    // Unique constraint violation on slug — try next candidate (sequential
    // suffixes first, then random ones so popular names never run out).
    if (error.code === "23505" && slugAttempt + 1 < MAX_SLUG_ATTEMPTS) {
      slug = slugCandidate(name, ++slugAttempt);
      continue;
    }

    console.error("[createGroup] group insert failed:", error.message);
    return fail("generic");
  }

  const { error: membershipError } = await supabase.from("memberships").insert({
    group_id: groupId,
    profile_id: user.id,
    name_snapshot: nameSnapshot,
    first_name_snapshot: firstNameSnapshot,
    last_name_snapshot: lastNameSnapshot,
    role: "admin",
  });

  if (membershipError) {
    console.error(
      "[createGroup] membership insert failed:",
      membershipError.message,
    );
    // No admin membership -> the group would be an orphan holding the slug.
    // Roll back with the service role (the creator has no rights without a
    // membership).
    const { error: cleanupError } = await createAdminClient()
      .from("groups")
      .delete()
      .eq("id", groupId);
    if (cleanupError) {
      logger
        .withMetadata({ groupId, reason: cleanupError.message })
        .error("group.orphan_cleanup_failed");
    }
    return fail("generic");
  }

  logger.withMetadata({ groupId, name, slug }).info("group.created");

  redirect(`/gruppen/${slug}`);
}
