import { connection, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/retention/cron-auth";
import { runRetention } from "@/lib/retention";

// Cleanup may delete + mail many rows on a backlog day.
export const maxDuration = 300;

// Vercel Cron (vercel.json) → GET with `Authorization: Bearer $CRON_SECRET`.
// Route handler instead of a Server Action: no user session, no form; the
// secret is the only credential. Public in proxy.ts (/api/ is not a page).
export async function GET(request: Request) {
  await connection(); // never prerender at build time

  const headers = { "Cache-Control": "no-store" };
  if (!isAuthorizedCron(request.headers)) {
    return new NextResponse(null, { status: 401, headers });
  }

  const report = await runRetention();
  // Counts only, no personal data. 500 on any failure → cron run shows red.
  return NextResponse.json(report, {
    status: report.failures.length > 0 ? 500 : 200,
    headers,
  });
}
