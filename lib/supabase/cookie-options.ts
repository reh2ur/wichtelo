import type { CookieOptions } from "@supabase/ssr";

// PKCE code-verifier cookie only needs to survive the window between
// requesting a code and completing the login flow, not the SDK's default
// 400-day session cookie lifetime.
const CODE_VERIFIER_MAX_AGE_SECONDS = 30 * 60;

// No browser Supabase client exists in this app (all auth runs through
// Server Actions / Route Handlers), so no cookie set by this SDK ever needs
// to be readable from client-side JS.
export function hardenCookieOptions(
  name: string,
  options: CookieOptions,
): CookieOptions {
  return {
    ...options,
    secure: true,
    httpOnly: true,
    maxAge: name.endsWith("-code-verifier")
      ? CODE_VERIFIER_MAX_AGE_SECONDS
      : options.maxAge,
  };
}
