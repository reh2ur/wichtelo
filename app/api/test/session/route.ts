import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { isTestBackdoorEnabled } from "@/lib/test-backdoor";
import { findUserByEmail } from "@/lib/test-users";

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

  // hashed_token: what the emailed button carries as ?token_hash= (lets E2E
  // drive the confirm page without an inbox).
  return NextResponse.json({
    action_link: data.properties.action_link,
    token_hash: data.properties.hashed_token,
  });
}

export async function DELETE(request: Request) {
  if (!isTestBackdoorEnabled(request.headers)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // groupsOnly: keep the user (and its session), drop just its groups — the
  // shared per-worker E2E user stays under create_group's 5-groups/24 h cap.
  const { email, groupsOnly } = await request.json();
  const admin = createAdminClient();

  const user = await findUserByEmail(admin, email);
  if (!user) return NextResponse.json({ ok: true });

  // Delete groups first (FK to auth.users has no cascade).
  await admin.from("groups").delete().eq("created_by", user.id);
  if (!groupsOnly) await admin.auth.admin.deleteUser(user.id);

  return NextResponse.json({ ok: true });
}
