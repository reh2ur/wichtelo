import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { isTestBackdoorEnabled } from "@/lib/test-backdoor";
import { selectCleanupUsers } from "@/lib/e2e-run";
import { listAllUsers } from "@/lib/test-users";

// Several PR runs share one staging DB, so this only deletes the calling run's
// users (body `runId`, email prefix `e2e+r<runId>-`) plus `e2e+` users older
// than the stale cutoff (leftovers of crashed runs). Never another live run.
export async function DELETE(request: Request) {
  if (!isTestBackdoorEnabled(request.headers)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const runId: unknown = body?.runId;

  const admin = createAdminClient();
  let users;
  try {
    users = await listAllUsers(admin);
  } catch (error) {
    console.error("E2E cleanup: listing users failed", error);
    return NextResponse.json({ error: "list_failed" }, { status: 500 });
  }

  const testUsers = selectCleanupUsers(users, {
    runId: typeof runId === "string" ? runId : null,
  });
  let deleted = 0;
  let failed = 0;

  for (const user of testUsers) {
    // Delete groups first — groups.created_by has ON DELETE RESTRICT
    const { error: groupError } = await admin
      .from("groups")
      .delete()
      .eq("created_by", user.id);
    const { error: userError } = groupError
      ? { error: groupError }
      : await admin.auth.admin.deleteUser(user.id);
    if (userError) {
      console.error("E2E cleanup: delete failed", userError);
      failed++;
    } else {
      deleted++;
    }
  }

  return NextResponse.json(
    { deleted, failed },
    { status: failed > 0 ? 500 : 200 },
  );
}
