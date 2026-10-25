import { connection, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/report-error";

// Uptime-monitor endpoint: cheap DB ping with the public publishable key
// (no secrets, RLS applies). Returns no data from the DB.
export async function GET() {
  await connection(); // never prerender at build time

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { error } = await supabase
    .from("groups")
    .select("id", { head: true })
    .limit(1);

  const headers = { "Cache-Control": "no-store" };
  if (error) {
    reportError("health.db_unreachable", error);
    return NextResponse.json({ status: "error" }, { status: 503, headers });
  }
  return NextResponse.json({ status: "ok" }, { headers });
}
