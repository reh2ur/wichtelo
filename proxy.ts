import { createServerClient } from "@supabase/ssr";
import { NextResponse, userAgent, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { resolveToken } from "@/lib/invite";

const INVITE_TOKEN_RE = /^\/einladung\/([^/]+)$/;

export async function proxy(request: NextRequest) {
  // robots.txt must stay reachable so compliant crawlers see the disallow rule;
  // /api/health must answer uptime monitors (which identify as bots).
  const botAllowed = ["/robots.txt", "/api/health"];
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
    let resolved: Awaited<ReturnType<typeof resolveToken>> | undefined;
    try {
      resolved = await resolveToken(inviteTokenMatch[1]);
    } catch {
      // DB error is not "not found": let the page decide (it throws → 500).
      resolved = undefined;
    }
    if (resolved === null) {
      // Same unmatched-path rewrite as unknown groups: Next's own fully
      // SSR'd 404 (real status, h1, lang, stylesheet). A rewrite to a
      // prerendered page that calls notFound() yields 404 but an empty
      // `__next_error__` HTML shell; a rewrite status option is ignored.
      return NextResponse.rewrite(new URL("/__not_found__", request.url));
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
    if (!user || user.email !== process.env.SUPER_ADMIN_EMAIL) {
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
