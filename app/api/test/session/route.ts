import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { isTestBackdoorEnabled } from "@/lib/test-backdoor";

export async function POST(request: Request) {
  if (!isTestBackdoorEnabled(request.headers)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { email, redirectTo } = await request.json();
  const admin = createAdminClient();

  // createUser is idempotent — ignore the error if the user already exists.
  await admin.auth.admin.createUser({ email, email_confirm: true });

  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo },
  });

  if (error || !data.properties.action_link) {
    return NextResponse.json(
      { error: error?.message ?? "No link" },
      { status: 500 },
    );
  }

  return NextResponse.json({ action_link: data.properties.action_link });
}

export async function DELETE(request: Request) {
  if (!isTestBackdoorEnabled(request.headers)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { email } = await request.json();
  const admin = createAdminClient();

  const {
    data: { users },
  } = await admin.auth.admin.listUsers();
  const user = users.find((u) => u.email === email);
  if (!user) return NextResponse.json({ ok: true });

  // Delete groups first (FK to auth.users has no cascade).
  await admin.from("groups").delete().eq("created_by", user.id);
  await admin.auth.admin.deleteUser(user.id);

  return NextResponse.json({ ok: true });
}
