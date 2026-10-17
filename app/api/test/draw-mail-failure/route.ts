import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { isTestBackdoorEnabled } from "@/lib/test-backdoor";
import { recordDrawMailResult } from "@/lib/draw-mail-status";

/**
 * E2E only: real provider failures can't be forced, so seed the persisted
 * draw-mail failure (as left behind by a partial send) for the group's
 * current draw.
 */
export async function POST(request: Request) {
  if (!isTestBackdoorEnabled(request.headers)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { slug, failed, total } = (await request.json()) as {
    slug: string;
    failed: number;
    total: number;
  };
  const admin = createAdminClient();
  const { data: group } = await admin
    .from("groups")
    .select("id, draw_version")
    .eq("slug", slug)
    .single();
  if (!group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  await recordDrawMailResult(
    admin,
    group.id as string,
    group.draw_version as number,
    failed,
    total,
  );
  return NextResponse.json({ ok: true });
}
