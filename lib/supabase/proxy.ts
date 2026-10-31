import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isGuestOnlyRoute, isProtectedRoute } from "@/lib/route-access";
import { hardenCookieOptions } from "@/lib/supabase/cookie-options";
import { safeNext } from "@/lib/safe-next";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient, User } from "@supabase/supabase-js";

const GROUP_DETAIL_RE = /^\/gruppen\/([^/]+)$/;
const GROUP_SETTINGS_RE = /^\/gruppen\/([^/]+)\/einstellungen$/;

export function isBanned(user: Pick<User, "banned_until">): boolean {
  if (!user.banned_until) return false;
  const until = Date.parse(user.banned_until);
  return Number.isFinite(until) && until > Date.now();
}

// Fast-path claims check (local JWT decode) plus authoritative getUser()
// (DB round-trip) — catches stale sessions where the auth.users row is gone
// (e.g. after a DB reset or account deletion) even though the JWT is still
// validly signed and unexpired. Skips the network call entirely when there's
// no local JWT at all.
async function getVerifiedUser(
  supabase: SupabaseClient,
  hasClaims: boolean,
): Promise<User | null> {
  if (!hasClaims) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // GoTrue should already reject banned users on GET /user; belt and braces so
  // a still-valid access token (jwt_expiry 3600) never passes for a banned
  // account if that behaviour ever changes (#166).
  if (user && isBanned(user)) return null;
  return user;
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(
              name,
              value,
              hardenCookieOptions(name, options),
            ),
          );
        },
      },
    },
  );

  // IMPORTANT: do not run code between createServerClient and getClaims().
  // This call refreshes the session cookie.
  const { data: claimsData } = await supabase.auth.getClaims();

  const pathname = request.nextUrl.pathname;

  if (isGuestOnlyRoute(pathname)) {
    const user = await getVerifiedUser(supabase, !!claimsData?.claims);
    if (user) {
      // Already signed in (e.g. second tab): honor a valid return-to target.
      const next = safeNext(request.nextUrl.searchParams.get("next"));
      const url = request.nextUrl.clone();
      url.search = "";
      url.hash = "";
      if (next) {
        const target = new URL(next, request.url);
        url.pathname = target.pathname;
        url.search = target.search;
      } else {
        url.pathname = "/gruppen";
      }
      return withSessionCookies(NextResponse.redirect(url), supabaseResponse);
    }
  }

  if (isProtectedRoute(pathname)) {
    const user = await getVerifiedUser(supabase, !!claimsData?.claims);
    if (!user) {
      return withSessionCookies(redirectToLogin(request), supabaseResponse);
    }

    // Existence/membership check runs here, not in the page: the root
    // layout's Nav always suspends on the session cookie read, so its
    // Suspense fallback starts streaming the response (fixing the status at
    // 200) before a page-level notFound() for an unknown slug or non-member
    // ever gets a chance to run. Rewriting to a path with no matching route
    // lets Next's own (already-correct) 404 handling take over.
    const slug =
      GROUP_DETAIL_RE.exec(pathname)?.[1] ??
      GROUP_SETTINGS_RE.exec(pathname)?.[1];
    if (slug && slug !== "neu") {
      const notFoundRewrite = () =>
        withSessionCookies(
          NextResponse.rewrite(new URL("/__not_found__", request.url)),
          supabaseResponse,
        );
      // A DB error is NOT "not found": on error let the request through and
      // leave the verdict to the page (which throws → error.tsx), instead of
      // 404-ing real members during a transient outage.
      try {
        const admin = createAdminClient();
        // One round trip: the group inner-joined to the caller's own
        // membership. Unknown slug and non-member both yield no row.
        const { data: found, error: lookupError } = await admin
          .from("groups")
          .select("id, memberships!inner(id, role)")
          .eq("slug", slug)
          .eq("memberships.profile_id", user.id)
          .maybeSingle();
        if (lookupError) return supabaseResponse;
        const membership = (
          found as { memberships: { id: string; role: string }[] } | null
        )?.memberships?.[0];
        // Detail needs membership; settings needs admin membership. Non-admin
        // members and non-members get the same 404 as an unknown slug, so the
        // response never reveals whether a slug exists.
        if (!membership) return notFoundRewrite();
        if (GROUP_SETTINGS_RE.test(pathname) && membership.role !== "admin") {
          return notFoundRewrite();
        }
      } catch {
        return supabaseResponse;
      }
    }
  }

  return supabaseResponse;
}

function redirectToLogin(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone();
  const next = safeNext(request.nextUrl.pathname + request.nextUrl.search);
  url.pathname = "/anmelden";
  url.search = "";
  if (next && next !== "/gruppen") url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

// Redirect/rewrite responses are fresh objects: copy the cookies Supabase set
// on supabaseResponse (e.g. a rotated refresh token) or they are lost.
export function withSessionCookies(
  response: NextResponse,
  from: NextResponse,
): NextResponse {
  from.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
  return response;
}
