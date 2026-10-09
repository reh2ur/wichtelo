import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { isTestBackdoorEnabled } from "@/lib/test-backdoor";

export async function POST(request: Request) {
  if (!isTestBackdoorEnabled(request.headers)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { email } = await request.json();
  const admin = createAdminClient();

  // Ensure user exists — idempotent, ignores "already exists" error.
  await admin.auth.admin.createUser({ email, email_confirm: true });

  // Generate a fresh OTP without sending any email.
  const { data: linkData, error: linkError } =
    await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
  if (linkError || !linkData?.properties?.email_otp) {
    return NextResponse.json(
      { error: linkError?.message ?? "No OTP" },
      { status: 500 },
    );
  }

  // Verify the OTP with a server client wired to write session cookies into the response.
  const response = NextResponse.json({ ok: true });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => [],
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { error: verifyError } = await supabase.auth.verifyOtp({
    email,
    token: linkData.properties.email_otp,
    type: "email",
  });

  if (verifyError) {
    return NextResponse.json({ error: verifyError.message }, { status: 500 });
  }

  return response;
}

// Deletes a single test user's auth.users row while leaving any existing
// session cookie in place — used to simulate a stale session (JWT still
// validly signed, but the referenced user is gone).
export async function DELETE(request: Request) {
  if (!isTestBackdoorEnabled(request.headers)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { email } = await request.json();
  const admin = createAdminClient();

  const {
    data: { users },
  } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const user = users.find((u) => u.email === email);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  await admin.from("groups").delete().eq("created_by", user.id);
  await admin.auth.admin.deleteUser(user.id);

  return NextResponse.json({ ok: true });
}
