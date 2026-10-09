import { createServerClient } from "@supabase/ssr";
import { NextResponse, userAgent, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

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
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
