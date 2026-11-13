"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { wishesTag } from "@/lib/cache-tags";
import { parseWishInput, WISH_LIMITS } from "@/lib/wishes/schema";
import { ARCHIVE_PARAM } from "@/lib/wishes/filter";

export type WishError =
  | "required"
  | "too_long"
  | "invalid_url"
  | "invalid_price"
  | "invalid_group"
  | "limit_reached"
  | "profile_required"
  | "not_found"
  | "generic";

export type WishField = "title" | "url" | "note" | "price" | "group";

interface WishFormValues {
  title: string;
  url: string;
  price: string;
  note: string;
  groupId: string;
}

export type WishFormState =
  | { status: "idle" }
  | {
      status: "error";
      error: WishError;
      field?: WishField;
      /** Limit that was exceeded (`too_long`, `limit_reached`). */
      max?: number;
      /** Submitted input, echoed so the form survives validation errors. */
      values: WishFormValues;
    };

export type WishActionState =
  { status: "idle" } | { status: "error"; error: WishError };

const idSchema = z.uuid();

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

function readValues(formData: FormData): WishFormValues {
  return {
    title: str(formData, "title"),
    url: str(formData, "url"),
    price: str(formData, "price"),
    note: str(formData, "note"),
    groupId: str(formData, "groupId"),
  };
}

const CODE_TO_ERROR = {
  required: "required",
  too_long: "too_long",
  invalid_url: "invalid_url",
  invalid_price: "invalid_price",
  invalid_group: "invalid_group",
} as const satisfies Record<string, WishError>;

/** Maps a PostgREST/Postgres write error to a user-facing error code. */
function mapDbError(error: {
  code?: string;
  message: string;
}): Pick<
  Extract<WishFormState, { status: "error" }>,
  "error" | "field" | "max"
> {
  // 54000 = per-account cap in trigger check_wish_integrity.
  if (error.code === "54000")
    return { error: "limit_reached", max: WISH_LIMITS.perAccount };
  // 23514 = trigger: group is not one of the owner's groups.
  if (error.code === "23514" && error.message.includes("wish group"))
    return { error: "invalid_group", field: "group" };
  if (error.code === "23503") {
    if (error.message.includes("wishes_profile_id_fkey"))
      return { error: "profile_required" };
    if (error.message.includes("wishes_group_id_fkey"))
      return { error: "invalid_group", field: "group" };
  }
  return { error: "generic" };
}

async function requireUserId(): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/anmelden");
  return { supabase, userId: user.id };
}

function validate(formData: FormData) {
  const values = readValues(formData);
  const parsed = parseWishInput({
    title: values.title,
    url: values.url,
    note: values.note,
    price: values.price,
    groupId: values.groupId,
  });
  return { values, parsed };
}

/**
 * Quick-add: title only (everything else optional later). On success the
 * list opens the details step for the new wish (`?edit=<id>`).
 */
export async function addWish(
  _prev: WishFormState,
  formData: FormData,
): Promise<WishFormState> {
  const values: WishFormValues = {
    title: str(formData, "title"),
    url: "",
    price: "",
    note: "",
    groupId: "",
  };
  const parsed = parseWishInput({ title: values.title });
  if (!parsed.ok) {
    return {
      status: "error",
      error: CODE_TO_ERROR[parsed.error.code],
      field: parsed.error.field,
      max: "max" in parsed.error ? parsed.error.max : undefined,
      values,
    };
  }

  const { supabase, userId } = await requireUserId();
  const { data, error } = await supabase
    .from("wishes")
    .insert({ profile_id: userId, title: parsed.value.title })
    .select("id")
    .single();

  if (error || !data) {
    const mapped = error ? mapDbError(error) : { error: "generic" as const };
    if (mapped.error === "generic" || !error) {
      logger
        .withMetadata({ reason: error?.message })
        .error("wish.insert_failed");
    }
    return { status: "error", ...mapped, values };
  }

  updateTag(wishesTag(userId));
  redirect(`/wuensche?edit=${data.id}`);
}

/** Edit form (step two of the add flow, also reachable from the list). */
export async function updateWish(
  _prev: WishFormState,
  formData: FormData,
): Promise<WishFormState> {
  const { values, parsed } = validate(formData);
  const id = str(formData, "id");
  const view = str(formData, "view") === ARCHIVE_PARAM ? ARCHIVE_PARAM : null;

  if (!parsed.ok) {
    return {
      status: "error",
      error: CODE_TO_ERROR[parsed.error.code],
      field: parsed.error.field,
      max: "max" in parsed.error ? parsed.error.max : undefined,
      values,
    };
  }
  if (!idSchema.safeParse(id).success) {
    return { status: "error", error: "not_found", values };
  }

  const { supabase, userId } = await requireUserId();
  const { title, url, note, priceEstimate, groupId } = parsed.value;
  const { data, error } = await supabase
    .from("wishes")
    .update({
      title,
      url,
      note,
      price_estimate: priceEstimate,
      group_id: groupId,
    })
    .eq("id", id)
    .eq("profile_id", userId)
    .select("id");

  if (error) {
    const mapped = mapDbError(error);
    if (mapped.error === "generic") {
      logger
        .withMetadata({ reason: error.message })
        .error("wish.update_failed");
    }
    return { status: "error", ...mapped, values };
  }
  if ((data ?? []).length === 0) {
    return { status: "error", error: "not_found", values };
  }

  updateTag(wishesTag(userId));
  redirect(view ? `/wuensche?status=${view}` : "/wuensche");
}

/** Archive (`to = received`) or reopen (`to = open`) a wish. */
export async function setWishStatus(
  _prev: WishActionState,
  formData: FormData,
): Promise<WishActionState> {
  const id = str(formData, "id");
  const to = str(formData, "to");
  if (!idSchema.safeParse(id).success || (to !== "received" && to !== "open")) {
    return { status: "error", error: "not_found" };
  }

  const { supabase, userId } = await requireUserId();
  const { data, error } = await supabase
    .from("wishes")
    .update({
      status: to,
      received_at: to === "received" ? new Date().toISOString() : null,
    })
    .eq("id", id)
    .eq("profile_id", userId)
    .select("id");

  if (error) {
    logger.withMetadata({ reason: error.message }).error("wish.status_failed");
    return { status: "error", error: "generic" };
  }
  if ((data ?? []).length === 0) {
    return { status: "error", error: "not_found" };
  }

  updateTag(wishesTag(userId));
  return { status: "idle" };
}

export async function deleteWish(
  _prev: WishActionState,
  formData: FormData,
): Promise<WishActionState> {
  const id = str(formData, "id");
  if (!idSchema.safeParse(id).success) {
    return { status: "error", error: "not_found" };
  }

  const { supabase, userId } = await requireUserId();
  const { data, error } = await supabase
    .from("wishes")
    .delete()
    .eq("id", id)
    .eq("profile_id", userId)
    .select("id");

  if (error) {
    logger.withMetadata({ reason: error.message }).error("wish.delete_failed");
    return { status: "error", error: "generic" };
  }
  if ((data ?? []).length === 0) {
    return { status: "error", error: "not_found" };
  }

  updateTag(wishesTag(userId));
  return { status: "idle" };
}
