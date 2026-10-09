"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { slugCandidate } from "@/lib/slug";
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
    .select("id")
    .eq("id", user.id)
    .single();

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
  }

  // One transaction: group + admin membership + invite token. Slug conflicts
  // (23505) are retried inside the RPC over these candidates (sequential
  // suffixes first, then random ones so popular names never run out).
  const MAX_SLUG_ATTEMPTS = 30;
  const slugs = Array.from({ length: MAX_SLUG_ATTEMPTS }, (_, i) =>
    slugCandidate(name, i),
  );

  const { data, error } = await supabase
    .rpc("create_group", {
      p_name: name,
      p_year: year,
      p_budget_hint: budgetHint,
      p_note: note,
      p_slugs: slugs,
    })
    .single<{ group_id: string; slug: string; invite_token: string }>();

  if (error || !data) {
    console.error("[createGroup] create_group rpc failed:", error?.message);
    return fail("generic");
  }

  const { group_id: groupId, slug } = data;

  logger.withMetadata({ groupId, name, slug }).info("group.created");

  redirect(`/gruppen/${slug}`);
}
