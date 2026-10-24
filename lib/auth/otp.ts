import { z } from "zod";

/**
 * Email OTP shape. MUST match `[auth.email] otp_length` / `otp_expiry` in
 * supabase/config.toml and the "Minuten" copy in supabase/templates/*.html.
 * 8 digits (not 6): GoTrue /verify is reachable directly with the publishable
 * key, bypassing the app's per-email limiter (see docs/security.md).
 */
export const OTP_LENGTH = 8;
export const OTP_EXPIRY_MINUTES = 10;

/** Matches GoTrue `max_frequency = "60s"`: a quicker resend is throttled. */
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

export const otpSchema = z.string().length(OTP_LENGTH).regex(/^\d+$/);
