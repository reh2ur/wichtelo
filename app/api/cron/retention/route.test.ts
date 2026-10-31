import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => {}),
}));

const runRetention = vi.fn();
vi.mock("@/lib/retention", () => ({
  runRetention: (...a: unknown[]) => runRetention(...a),
}));

import { GET } from "./route";

const req = (auth?: string) =>
  new Request("http://localhost/api/cron/retention", {
    headers: auth ? { authorization: auth } : {},
  });

describe("GET /api/cron/retention", () => {
  beforeEach(() => {
    runRetention.mockReset();
    vi.stubEnv("CRON_SECRET", "c".repeat(24));
  });
  afterEach(() => vi.unstubAllEnvs());

  it("401 without or with a wrong bearer, and never runs the cleanup", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer nope"))).status).toBe(401);
    expect(runRetention).not.toHaveBeenCalled();
  });

  it("401 when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(req("Bearer "))).status).toBe(401);
    expect(runRetention).not.toHaveBeenCalled();
  });

  it("200 with the report on success", async () => {
    const report = {
      groupsDeleted: 2,
      auditRowsDeleted: 0,
      accountsWarned: 1,
      accountsDeleted: 0,
      failures: [],
    };
    runRetention.mockResolvedValue(report);
    const res = await GET(req(`Bearer ${"c".repeat(24)}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(report);
  });

  it("500 when any step failed, so the cron run shows red", async () => {
    runRetention.mockResolvedValue({
      groupsDeleted: 0,
      auditRowsDeleted: 0,
      accountsWarned: 0,
      accountsDeleted: 0,
      failures: ["groups"],
    });
    const res = await GET(req(`Bearer ${"c".repeat(24)}`));
    expect(res.status).toBe(500);
  });
});
