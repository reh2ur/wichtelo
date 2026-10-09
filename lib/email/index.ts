import { Resend } from "resend";
import { logger } from "@/lib/logger";

// Required in production (lib/env.ts fails the boot); localhost fallback is
// dev/preview only, where the dry-run client never sends.
const FROM_ADDRESS = process.env.RESEND_FROM_EMAIL ?? "wichtelo@localhost";

// Display name matches `sender_name` in supabase/config.toml so auth mail and
// app mail look the same in inboxes. Env may hold bare address or full
// "Name <addr>" — only prefix name when bare.
export const FROM_EMAIL = FROM_ADDRESS.includes("<")
  ? FROM_ADDRESS
  : `Wichtelo <${FROM_ADDRESS}>`;

// Same non-prod gate used for Supabase OTP emails in app/anmelden/actions.ts
// and app/einladung/[token]/actions.ts — dev + preview (incl. E2E runs
// against both) never hit the real provider, so nothing burns the Resend quota.
const isNonProd =
  process.env.NODE_ENV !== "production" || process.env.VERCEL_ENV === "preview";

interface DryRunPayload {
  to: string | string[];
  subject: string;
}

function createDryRunClient(): Resend {
  const dryRunSend = async (payload: DryRunPayload) => {
    logger
      .withMetadata({ to: payload.to, subject: payload.subject })
      .info("email.dry_run");
    return { data: { id: "dry-run" }, error: null };
  };

  return {
    emails: { send: dryRunSend },
    batch: {
      send: async (payloads: DryRunPayload[]) => {
        await Promise.all(payloads.map(dryRunSend));
        return { data: { data: [] }, error: null };
      },
    },
  } as unknown as Resend;
}

export const resend = isNonProd
  ? createDryRunClient()
  : new Resend(process.env.RESEND_API_KEY);
