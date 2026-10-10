"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { updateTag } from "next/cache";
import { z } from "zod";
import { getSiteUrl } from "@/lib/site-url";
import { groupTag } from "@/lib/cache-tags";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isTestBackdoorEnabled } from "@/lib/test-backdoor";
import { resolveToken } from "@/lib/invite";
import { getGroupAdminEmails } from "@/lib/group-admins";
import { notify } from "@/lib/notification";
import { logger } from "@/lib/logger";
import { isUniqueViolation } from "@/lib/supabase/errors";
import { getClientIp } from "@/lib/request-ip";
import {
  checkRateLimit,
  inviteOtpRequestLimiter,
  inviteOtpRequestIpLimiter,
  inviteOtpVerifyLimiter,
  inviteOtpVerifyIpLimiter,
  joinLeaveLimiter,
} from "@/lib/rate-limit";
import { isAuthRateLimitError } from "@/lib/supabase/auth-errors";

export type RequestInviteOtpState =
  | { status: "idle" }
  | {
      status: "otp_sent";
      email: string;
      devOtp?: string;
    }
  | {
      status: "error";
      error: "invalid_email" | "generic" | "rate_limited";
      email: string;
    };

export type VerifyInviteOtpState =
  | { status: "idle" }
  | {
      status: "error";
      error: "invalid_otp" | "generic" | "rate_limited";
      email: string;
    };

export type AcceptInviteState =
  | { status: "idle" }
  | {
      status: "error";
      error: "generic" | "drawn" | "missing_name" | "rate_limited";
    };

const emailSchema = z.email().max(254);
const otpSchema = z.string().length(6).regex(/^\d+$/);
const nameSchema = z.string().trim().min(1).max(50);
const newProfileNamesSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
});

export async function requestInviteOtp(
  token: string,
  _prevState: RequestInviteOtpState,
  formData: FormData,
): Promise<RequestInviteOtpState> {
  const email = ((formData.get("email") as string) ?? "").trim();

  if (!emailSchema.safeParse(email).success) {
    return { status: "error", error: "invalid_email", email };
  }

  // Per-email limit (normalized) plus looser per-IP backstop. Same
  // rate_limited response either way: no account-existence signal.
  const ip = await getClientIp();
  if (
    !(await checkRateLimit(inviteOtpRequestIpLimiter, ip)) ||
    !(await checkRateLimit(inviteOtpRequestLimiter, email.toLowerCase()))
  ) {
    return { status: "error", error: "rate_limited", email };
  }

  const resolved = await resolveToken(token);
  if (!resolved || resolved.group.state !== "open") {
    // Masked response — no account created, no mail sent, token validity
    // not revealed to the caller.
    return { status: "otp_sent", email };
  }

  const useDevOtp = isTestBackdoorEnabled(await headers());

  if (useDevOtp) {
    const admin = createAdminClient();
    const { data: linkData, error: linkError } =
      await admin.auth.admin.generateLink({
        type: "magiclink",
        email,
      });
    if (linkError) {
      console.error(
        "[requestInviteOtp] generateLink failed:",
        linkError.message,
      );
      return { status: "error", error: "generic", email };
    }
    const devOtp = linkData?.properties?.email_otp ?? undefined;
    return { status: "otp_sent", email, devOtp };
  }

  const siteUrl = await getSiteUrl();
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${siteUrl}/einladung/${token}/magiclink`,
    },
  });
  if (error) {
    logger
      .withMetadata({
        status: error.status,
        code: error.code,
        message: error.message,
      })
      .error("invite.sign_in_otp_failed");
    // Throttled (per-address max_frequency, project email quota, per-IP):
    // tell the user to wait. No existence leak: a new address is throttled
    // the same way as an existing one after its first request.
    if (isAuthRateLimitError(error)) {
      return { status: "error", error: "rate_limited", email };
    }
    return { status: "error", error: "generic", email };
  }
  return { status: "otp_sent", email };
}

export async function verifyInviteOtp(
  token: string,
  _prevState: VerifyInviteOtpState,
  formData: FormData,
): Promise<VerifyInviteOtpState> {
  const email = ((formData.get("email") as string) ?? "").trim();
  const otp = ((formData.get("otp") as string) ?? "").trim();

  if (
    !otpSchema.safeParse(otp).success ||
    !emailSchema.safeParse(email).success
  ) {
    return { status: "error", error: "invalid_otp", email };
  }

  // Per-email limit caps guesses at one code regardless of source IPs;
  // per-IP backstop is looser so a shared Wi-Fi/CGNAT doesn't lock users out.
  const ip = await getClientIp();
  if (
    !(await checkRateLimit(inviteOtpVerifyIpLimiter, ip)) ||
    !(await checkRateLimit(inviteOtpVerifyLimiter, email.toLowerCase()))
  ) {
    return { status: "error", error: "rate_limited", email };
  }

  const resolved = await resolveToken(token);
  if (!resolved || resolved.group.state !== "open") {
    return { status: "error", error: "invalid_otp", email };
  }

  const supabase = await createClient();
  const { error: verifyError } = await supabase.auth.verifyOtp({
    email,
    token: otp,
    type: "email",
  });

  if (verifyError) {
    if (isAuthRateLimitError(verifyError)) {
      return { status: "error", error: "rate_limited", email };
    }
    return { status: "error", error: "invalid_otp", email };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { status: "error", error: "generic", email };
  }

  redirect(`/einladung/${token}`);
}

export async function acceptInvite(
  token: string,
  _prev: AcceptInviteState,
  formData: FormData,
): Promise<AcceptInviteState> {
  const firstName = ((formData.get("firstName") as string) ?? "").trim();
  const lastName = ((formData.get("lastName") as string) ?? "").trim();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { status: "error", error: "generic" };
  }

  if (!(await checkRateLimit(joinLeaveLimiter, user.id))) {
    return { status: "error", error: "rate_limited" };
  }

  const resolved = await resolveToken(token);
  if (!resolved) {
    return { status: "error", error: "generic" };
  }
  if (resolved.group.state === "drawn") {
    return { status: "error", error: "drawn" };
  }

  const { group } = resolved;
  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("id, first_name, last_name")
    .eq("id", user.id)
    .single();

  let nameSnapshot: string;
  let firstNameSnapshot: string;
  let lastNameSnapshot: string;

  if (!profile) {
    // New users must supply both names (trimmed, non-empty). No email
    // fallback: it would expose the local-part to co-members (#185).
    const names = newProfileNamesSchema.safeParse({ firstName, lastName });
    if (!names.success) {
      return { status: "error", error: "missing_name" };
    }
    const { firstName: fn, lastName: ln } = names.data;
    const { error: profileError } = await admin
      .from("profiles")
      .insert({ id: user.id, first_name: fn, last_name: ln });
    // 23505: double submit already created the profile - fine, continue.
    if (profileError && !isUniqueViolation(profileError)) {
      logger
        .withMetadata({ userId: user.id, reason: profileError.message })
        .error("invite.profile_insert_failed");
      return { status: "error", error: "generic" };
    }
    nameSnapshot = `${fn} ${ln}`;
    firstNameSnapshot = fn;
    lastNameSnapshot = ln;
  } else {
    nameSnapshot = profile.last_name
      ? `${profile.first_name} ${profile.last_name}`
      : profile.first_name;
    firstNameSnapshot = profile.first_name;
    lastNameSnapshot = profile.last_name;
  }

  const { data: existingMember } = await admin
    .from("memberships")
    .select("id")
    .eq("group_id", group.id)
    .eq("profile_id", user.id)
    .single();

  if (!existingMember) {
    const { error: memberError } = await admin.from("memberships").insert({
      group_id: group.id,
      profile_id: user.id,
      name_snapshot: nameSnapshot,
      first_name_snapshot: firstNameSnapshot,
      last_name_snapshot: lastNameSnapshot,
      role: "participant",
    });
    // 23505: double-submitted join - the first one succeeded, go to the group.
    if (memberError && isUniqueViolation(memberError)) {
      updateTag(groupTag(group.slug));
      redirect(`/gruppen/${group.slug}`);
    }
    if (memberError) {
      console.error(
        "[acceptInvite] membership insert failed:",
        memberError.message,
      );
      return { status: "error", error: "generic" };
    }
    logger
      .withMetadata({ groupId: group.id, profileId: user.id })
      .info("invite.used");

    const adminEmails = await getGroupAdminEmails(admin, group.id, user.id);
    await notify({
      type: "participant.joined",
      groupName: group.name,
      participantName: nameSnapshot,
      adminEmails,
    });
  }

  updateTag(groupTag(group.slug));
  redirect(`/gruppen/${group.slug}`);
}
