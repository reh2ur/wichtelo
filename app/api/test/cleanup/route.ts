import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { isTestBackdoorEnabled } from "@/lib/test-backdoor";

export async function DELETE(request: Request) {
  if (!isTestBackdoorEnabled(request.headers)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const admin = createAdminClient();
  const {
    data: { users },
  } = await admin.auth.admin.listUsers({ perPage: 1000 });

  const testUsers = users.filter((u) => u.email?.startsWith("e2e+"));
  let deleted = 0;

  for (const user of testUsers) {
    // Delete groups first — groups.created_by has ON DELETE RESTRICT
    await admin.from("groups").delete().eq("created_by", user.id);
    await admin.auth.admin.deleteUser(user.id);
    deleted++;
  }

  return NextResponse.json({ deleted });
}
