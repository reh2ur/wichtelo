import * as Sentry from "@sentry/nextjs";
import { logger } from "@/lib/logger";
import { scrubString } from "@/lib/sentry-scrub";
import { serializeError } from "@/lib/serialize-error";

// Handled errors (caught, user sees a generic message or nothing) never reach
// Sentry's automatic capture, which only sees unhandled throws. Use
// reportError at sites an operator must learn about without reading logs:
// failed mail, failed draws, failed deletions, unreachable DB, misconfig.
//
// Sentry gets a minimal, scrubbed payload: event name (tag + fingerprint),
// redacted message, stack, and allow-listed primitive metadata. The log line
// keeps full metadata (stdout only, same as before).

const EMAIL_RE =
  /[^\s@<>"',;:()[\]]+@[^\s@<>"',;:()[\]]+\.[^\s@<>"',;:()[\]]+/g;

// Meta keys never forwarded to Sentry (PII, credentials, user identifiers).
const DENIED_META_KEY_RE = /mail|token|secret|password|userid|name/i;

export function redact(value: string): string {
  return scrubString(value).replace(EMAIL_RE, "[email]");
}

function sentryException(event: string, err: unknown): Error {
  const message = redact(serializeError(err).message);
  const out = new Error(message);
  if (err instanceof Error) {
    out.name = err.name;
    if (err.stack) out.stack = redact(err.stack);
  } else {
    out.name = event;
  }
  return out;
}

function sentryExtra(meta: Record<string, unknown>) {
  const extra: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (DENIED_META_KEY_RE.test(key)) continue;
    if (typeof value === "string") extra[key] = redact(value);
    else if (typeof value === "number" || typeof value === "boolean")
      extra[key] = value;
  }
  return extra;
}

/**
 * Logs `event` at error level (pino/stdout) and reports the underlying error
 * to Sentry, tagged `event` and grouped per event. Never throws.
 */
export function reportError(
  event: string,
  err: unknown,
  meta: Record<string, unknown> = {},
): void {
  const serialized = serializeError(err);
  try {
    logger
      .withMetadata({
        ...meta,
        reason: serialized.message,
        ...(serialized.code !== undefined && { code: serialized.code }),
      })
      .error(event);
  } catch {
    // logging must never break the caller
  }
  try {
    Sentry.captureException(sentryException(event, err), {
      level: "error",
      tags: { event },
      fingerprint: [event],
      extra: sentryExtra({
        ...meta,
        ...(serialized.code !== undefined && { code: serialized.code }),
      }),
    });
  } catch {
    // reporting must never break the caller
  }
}
