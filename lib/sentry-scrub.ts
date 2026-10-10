// Shared Sentry privacy scrubber. /einladung/<token> is a bearer credential
// (anyone holding it can join an open group), so it must never leave the app
// in event URLs, transaction names, breadcrumbs or span data. Used by client,
// server and edge Sentry.init via beforeSend / beforeSendTransaction /
// beforeBreadcrumb.

const INVITE_PATH_RE =
  /\/einladung\/(?!ungueltig(?![^/?#\s"'\\])|\[token\])[^/?#\s"'\\]+/g;
const TOKEN_PARAM_RE = /([?&]token=)[^&#\s"'\\]*/gi;

export function scrubString(value: string): string {
  return value
    .replace(INVITE_PATH_RE, "/einladung/[token]")
    .replace(TOKEN_PARAM_RE, "$1[Filtered]");
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function walk(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return scrubString(value);
  if (typeof value !== "object" || value === null) return value;
  if (seen.has(value)) return value;
  if (!Array.isArray(value) && !isPlainObject(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = walk(value[i], seen);
  } else {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) obj[key] = walk(obj[key], seen);
  }
  return value;
}

/** Scrubs every string in an event/transaction/breadcrumb in place. */
export function scrubSentryData<T>(data: T): T {
  return walk(data, new WeakSet()) as T;
}
