import { createServerClient } from "@supabase/ssr";
import { NextResponse, userAgent, type NextRequest } from "next/server";
import { updateSession, withSessionCookies } from "@/lib/supabase/proxy";
import { inviteTokenExists } from "@/lib/invite";
import { isSuperAdminEmail } from "@/lib/admin/super-admin-email";

const INVITE_TOKEN_RE = /^\/einladung\/([^/]+)$/;

export async function proxy(request: NextRequest) {
  // robots.txt must stay reachable so compliant crawlers see the disallow rule;
  // /api/health must answer uptime monitors (which identify as bots);
  // /api/cron/retention is called by Vercel Cron (bearer-secret auth in the
  // route itself, no session needed).
  const botAllowed = ["/robots.txt", "/api/health", "/api/cron/retention"];
  if (
    !botAllowed.includes(request.nextUrl.pathname) &&
    userAgent(request).isBot
  ) {
    return new NextResponse(null, { status: 403 });
  }

  // Checked here, not in app/einladung/[token]/page.tsx: the root layout's
  // Nav always suspends on the session cookie read, so its Suspense fallback
  // starts streaming the response (fixing the status at 200) before the
  // page's own notFound() for an invalid token ever gets a chance to run.
  const inviteTokenMatch = INVITE_TOKEN_RE.exec(request.nextUrl.pathname);
  if (inviteTokenMatch) {
    // Existence only: the page runs the full resolveToken, so the proxy does
    // not repeat its group/admin joins on every request.
    let exists: boolean | undefined;
    try {
      exists = await inviteTokenExists(inviteTokenMatch[1]);
    } catch {
      // DB error is not "not found": let the page decide (it throws → 500).
      exists = undefined;
    }
    if (exists === false) {
      // Same unmatched-path rewrite as unknown groups: Next's own fully
      // SSR'd 404 (real status, h1, lang, stylesheet). A rewrite to a
      // prerendered page that calls notFound() yields 404 but an empty
      // `__next_error__` HTML shell; a rewrite status option is ignored.
      //
      // updateSession still runs so a rotated refresh token is persisted on
      // this response too, not lost until the next navigation.
      const session = await updateSession(request);
      return withSessionCookies(
        NextResponse.rewrite(new URL("/__not_found__", request.url)),
        session,
      );
    }
  }

  if (request.nextUrl.pathname.startsWith("/admin")) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll: () => {},
        },
      },
    );
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !isSuperAdminEmail(user.email)) {
      return new NextResponse(null, { status: 404 });
    }
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|monitoring(?:/|$)|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
