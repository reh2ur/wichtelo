import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { isTestBackdoorEnabled } from "@/lib/test-backdoor";

export async function POST(request: Request) {
  if (!isTestBackdoorEnabled(request.headers)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { email } = await request.json();
  const admin = createAdminClient();

  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (error || !data.properties.email_otp) {
    return NextResponse.json(
      { error: error?.message ?? "No OTP" },
      { status: 500 },
    );
  }

  return NextResponse.json({ otp: data.properties.email_otp });
}
