import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isGuestOnlyRoute, isProtectedRoute } from "@/lib/route-access";
import { hardenCookieOptions } from "@/lib/supabase/cookie-options";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient, User } from "@supabase/supabase-js";

const GROUP_DETAIL_RE = /^\/gruppen\/([^/]+)$/;
const GROUP_SETTINGS_RE = /^\/gruppen\/([^/]+)\/einstellungen$/;

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
      const url = request.nextUrl.clone();
      url.pathname = "/gruppen";
      return NextResponse.redirect(url);
    }
  }

  if (isProtectedRoute(pathname)) {
    const user = await getVerifiedUser(supabase, !!claimsData?.claims);
    if (!user) {
      return redirectToLogin(request);
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
      const admin = createAdminClient();
      const { data: group } = await admin
        .from("groups")
        .select("id")
        .eq("slug", slug)
        .single();
      if (!group) {
        return NextResponse.rewrite(new URL("/__not_found__", request.url));
      }
      if (GROUP_DETAIL_RE.test(pathname)) {
        const { data: membership } = await admin
          .from("memberships")
          .select("id")
          .eq("group_id", group.id)
          .eq("profile_id", user.id)
          .maybeSingle();
        if (!membership) {
          return NextResponse.rewrite(new URL("/__not_found__", request.url));
        }
      }
    }
  }

  return supabaseResponse;
}

function redirectToLogin(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/anmelden";
  return NextResponse.redirect(url);
}
