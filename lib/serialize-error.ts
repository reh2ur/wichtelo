export type SerializedError = {
  name?: string;
  message: string;
  code?: string | number;
  status?: number;
  digest?: string;
};

function pickString(obj: Record<string, unknown>, key: string) {
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
}

/**
 * Turn any thrown value into a log-safe plain object. `String(err)` yields
 * "[object Object]" for non-Error objects (Supabase / Resend error payloads),
 * so pull out well-known fields instead. Stack is intentionally omitted.
 */
export function serializeError(err: unknown): SerializedError {
  if (typeof err === "string") return { message: err };

  if (typeof err === "object" && err !== null) {
    const o = err as Record<string, unknown>;
    const out: SerializedError = {
      message: pickString(o, "message") ?? safeJson(o),
    };
    const name = pickString(o, "name");
    if (name) out.name = name;
    const code = o.code;
    if (typeof code === "string" || typeof code === "number") out.code = code;
    const status = o.status ?? o.statusCode;
    if (typeof status === "number") out.status = status;
    const digest = pickString(o, "digest");
    if (digest) out.digest = digest;
    return out;
  }

  return { message: String(err) };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "unknown error";
  } catch {
    return "unserializable error";
  }
}
