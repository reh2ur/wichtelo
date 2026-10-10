import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { safeNext, NEXT_COOKIE } from "@/lib/safe-next";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const cookieStore = await cookies();
  const next = safeNext(cookieStore.get(NEXT_COOKIE)?.value);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const response = NextResponse.redirect(
        new URL(next ?? "/gruppen", origin),
      );
      response.cookies.delete({ name: NEXT_COOKIE, path: "/auth" });
      return response;
    }
  }

  return NextResponse.redirect(new URL("/anmelden", origin));
}
