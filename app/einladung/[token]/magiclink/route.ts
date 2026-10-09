import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveToken } from "@/lib/invite";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL(`/einladung/${token}`, origin));
  }

  const resolved = await resolveToken(token);
  if (!resolved || resolved.group.state !== "open") {
    return NextResponse.redirect(new URL(`/einladung/${token}`, origin));
  }

  const supabase = await createClient();
  const { error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    console.error(
      "[magiclink] exchangeCodeForSession failed:",
      exchangeError.message,
    );
  }

  return NextResponse.redirect(new URL(`/einladung/${token}`, origin));
}
