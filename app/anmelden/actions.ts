"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { z } from "zod";
import { getSiteUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isTestBackdoorEnabled } from "@/lib/test-backdoor";
import { safeNext, NEXT_COOKIE } from "@/lib/safe-next";
import { getClientIp } from "@/lib/request-ip";
import {
  checkRateLimit,
  anmeldenOtpRequestLimiter,
  anmeldenOtpRequestIpLimiter,
  anmeldenOtpVerifyLimiter,
} from "@/lib/rate-limit";

type AdminClient = ReturnType<typeof createAdminClient>;

async function userExists(admin: AdminClient, email: string): Promise<boolean> {
  const normalized = email.toLowerCase();
  let page = 1;
  const perPage = 1000;
  for (;;) {
    const {
      data: { users },
    } = await admin.auth.admin.listUsers({ page, perPage });
    if (users.some((u) => u.email?.toLowerCase() === normalized)) {
      return true;
    }
    if (users.length < perPage) return false;
    page += 1;
  }
}

export type RequestOtpState =
  | { status: "idle" }
  | { status: "otp_sent"; email: string; devOtp?: string; devMode?: boolean }
  | {
      status: "error";
      error: "invalid_email" | "generic" | "rate_limited";
      email: string;
    };

export type VerifyOtpState =
  | { status: "idle" }
  | {
      status: "error";
      error: "invalid_otp" | "rate_limited";
      email: string;
    };

const emailSchema = z.email().max(254);
const otpSchema = z.string().length(6).regex(/^\d+$/);

export async function requestOtp(
  _prevState: RequestOtpState,
  formData: FormData,
): Promise<RequestOtpState> {
  const email = ((formData.get("email") as string) ?? "").trim();

  if (!emailSchema.safeParse(email).success) {
    return { status: "error", error: "invalid_email", email };
  }

  // Per-email limit (normalized) plus looser per-IP backstop. Same
  // rate_limited response either way: no account-existence signal.
  const ip = await getClientIp();
  if (
    !(await checkRateLimit(anmeldenOtpRequestIpLimiter, ip)) ||
    !(await checkRateLimit(anmeldenOtpRequestLimiter, email.toLowerCase()))
  ) {
    return { status: "error", error: "rate_limited", email };
  }

  // Magic-link clicks land on /auth/callback, whose URL must match Supabase's
  // redirect allowlist exactly, so the return-to path travels in a cookie
  // instead of a query param. Always (re)set or cleared so a stale one from an
  // earlier attempt never leaks into this login.
  const next = safeNext(formData.get("next"));
  const cookieStore = await cookies();
  if (next) {
    cookieStore.set(NEXT_COOKIE, next, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/auth",
      maxAge: 60 * 60,
    });
  } else {
    cookieStore.delete({ name: NEXT_COOKIE, path: "/auth" });
  }

  const useDevOtp = isTestBackdoorEnabled(await headers());

  if (useDevOtp) {
    // Skip email entirely: use admin API to generate the OTP directly.
    // This avoids hitting Supabase's email rate limit on dev and preview.
    //
    // generateLink() creates the user if it doesn't exist yet, unlike
    // signInWithOtp({ shouldCreateUser: false }) used below in prod — so
    // invite-only enforcement has to be done manually here first.
    const admin = createAdminClient();
    const exists = await userExists(admin, email);
    if (!exists) {
      // Invite-only system: no account for this email. Return the same
      // otp_sent state (including devMode, so the dev banner still shows)
      // as a real account would get, so the response gives no signal about
      // account existence (see issue #104).
      return { status: "otp_sent", email, devMode: true };
    }

    const { data: linkData, error: linkError } =
      await admin.auth.admin.generateLink({
        type: "magiclink",
        email,
      });
    if (linkError) {
      console.error(
        "[requestOtp] generateLink failed:",
        linkError.message,
        linkError.status,
        linkError.code,
      );
      return { status: "error", error: "generic", email };
    }
    const devOtp = linkData?.properties?.email_otp ?? undefined;
    return { status: "otp_sent", email, devOtp, devMode: true };
  }

  const siteUrl = await getSiteUrl();
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // Super admin can create their account on a fresh deployment without
      // needing a pre-existing user.
      shouldCreateUser: email === process.env.SUPER_ADMIN_EMAIL,
      emailRedirectTo: `${siteUrl}/auth/callback`,
    },
  });
  if (error) {
    console.error(
      "[requestOtp] signInWithOtp failed:",
      error.message,
      error.status,
      error.code,
    );
    // "No account for this email" (invite-only, sign-up disabled) is the
    // only case masked as otp_sent, so the response gives no signal about
    // account existence (see issue #104). Every other failure — Supabase's
    // own email-send rate limit, provider outages, unexpected errors — is a
    // genuine send failure and must surface as an error. Masking those too
    // left users staring at a code-entry screen for an email that was never
    // sent, with no indication anything went wrong (see issue #139).
    if (error.code === "otp_disabled") {
      return { status: "otp_sent", email };
    }
    return { status: "error", error: "generic", email };
  }
  return { status: "otp_sent", email };
}

export async function verifyOtp(
  _prevState: VerifyOtpState,
  formData: FormData,
): Promise<VerifyOtpState> {
  const email = ((formData.get("email") as string) ?? "").trim();
  const token = ((formData.get("token") as string) ?? "").trim();

  if (!otpSchema.safeParse(token).success) {
    return { status: "error", error: "invalid_otp", email };
  }

  const ip = await getClientIp();
  if (!(await checkRateLimit(anmeldenOtpVerifyLimiter, ip))) {
    return { status: "error", error: "rate_limited", email };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "email",
  });

  if (error) return { status: "error", error: "invalid_otp", email };

  redirect((safeNext(formData.get("next")) ?? "/gruppen") as Route);
}
