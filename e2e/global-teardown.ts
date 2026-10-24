import { BASE_URL, RUN_ID, testApiHeaders } from "./helpers";

export default async function globalTeardown() {
  // Scoped to this run's users (+ long-stale leftovers); never other live runs.
  // Failures are reported but don't fail the run — the next teardown's stale
  // sweep retries them.
  try {
    const res = await fetch(`${BASE_URL}/api/test/cleanup`, {
      method: "DELETE",
      headers: testApiHeaders(),
      body: JSON.stringify({ runId: RUN_ID }),
    });
    if (!res.ok) {
      console.warn(
        `::warning::E2E cleanup failed (${res.status}): ${await res.text()}`,
      );
    }
  } catch (error) {
    console.warn(`::warning::E2E cleanup request failed: ${String(error)}`);
  }
}
