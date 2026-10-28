import { describe, it, expect, vi, beforeEach } from "vitest";

const createClient = vi.hoisted(() => vi.fn());
const errorLog = vi.hoisted(() => vi.fn());

vi.mock("next/server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("next/server")>();
  return { ...mod, connection: vi.fn().mockResolvedValue(undefined) };
});
vi.mock("@supabase/supabase-js", () => ({ createClient }));
vi.mock("@/lib/logger", () => ({
  logger: { withMetadata: vi.fn(() => ({ error: errorLog })) },
}));

import { GET } from "./route";

function mockDb(result: { error: { message: string } | null }) {
  const limit = vi.fn().mockResolvedValue(result);
  const select = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ select }));
  createClient.mockReturnValue({ from });
  return { from, select, limit };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://db.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "pub-key");
});

describe("GET /api/health", () => {
  it("returns 200 ok, uncached, when the DB answers", async () => {
    const { from, select } = mockDb({ error: null });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(from).toHaveBeenCalledWith("groups");
    expect(select).toHaveBeenCalledWith("id", { head: true });
  });

  it("pings with the public publishable key only, without persisting a session", async () => {
    mockDb({ error: null });
    await GET();
    expect(createClient).toHaveBeenCalledWith("http://db.test", "pub-key", {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  it("returns 503 error, uncached, and logs when the DB is unreachable", async () => {
    mockDb({ error: { message: "connection refused" } });
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "error" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(errorLog).toHaveBeenCalledWith("health.db_unreachable");
  });

  it("does not leak the DB error message in the response body", async () => {
    mockDb({ error: { message: "secret host 10.0.0.5 refused" } });
    const res = await GET();
    expect(JSON.stringify(await res.json())).not.toContain("10.0.0.5");
  });
});
