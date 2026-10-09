import { createAdminClient } from "@/lib/supabase/admin";
import { issueDeletionToken } from "@/lib/account";
import { NextResponse } from "next/server";
import { isTestBackdoorEnabled } from "@/lib/test-backdoor";

export async function POST(request: Request) {
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

  const token = await issueDeletionToken(user.id);
  return NextResponse.json({ token });
}
