import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ updateTag: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
  drawTriggerLimiter: {},
  joinLeaveLimiter: {},
}));
vi.mock("@/lib/logger", () => {
  const chain = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
  return { logger: { ...chain, withMetadata: vi.fn().mockReturnValue(chain) } };
});

import { lookupAssignment, type OracleState } from "./actions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

const IDLE: OracleState = { status: "idle" };

function fd(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

type Result = { data: unknown; error?: { message: string } | null };

function chain(result: Result) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) q[m] = vi.fn(() => q);
  const done = vi.fn().mockResolvedValue({ error: null, ...result });
  q.single = done;
  q.maybeSingle = done;
  return q;
}

interface World {
  user?: { id: string } | null;
  group?: Result;
  caller?: Result;
  assignment?: Result;
  receiver?: Result;
  profile?: Result;
}

function setup(world: World) {
  const user = "user" in world ? world.user : { id: "u-admin" };
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
  } as never);

  // memberships is queried twice: caller first, then the receiver.
  const memberships = [
    chain(world.caller ?? { data: { id: "m-admin", role: "admin" } }),
    chain(
      world.receiver ?? {
        data: { name_snapshot: "Snapshot Name", profile_id: "p2" },
      },
    ),
  ];
  const from = vi.fn((table: string) => {
    switch (table) {
      case "groups":
        return chain(world.group ?? { data: { id: "g1", state: "drawn" } });
      case "memberships":
        return memberships.shift() ?? chain({ data: null });
      case "assignments":
        return chain(
          world.assignment ?? { data: { receiver_id: "m-receiver" } },
        );
      case "profiles":
        return chain(
          world.profile ?? { data: { first_name: "Erika", last_name: "Muster" } },
        );
      default:
        throw new Error(`unexpected table ${table}`);
    }
  });
  vi.mocked(createAdminClient).mockReturnValue({ from } as never);
  return { from };
}

const valid = { slug: "familie", membershipId: "m-giver" };

describe("lookupAssignment", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["slug", { membershipId: "m-giver" }],
    ["membershipId", { slug: "familie" }],
    ["both", {}],
  ])("rejects missing %s before any auth or DB work", async (_l, fields) => {
    const res = await lookupAssignment(IDLE, fd(fields));
    expect(res).toEqual({ status: "error", error: "generic" });
    expect(createClient).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("requires a signed-in user and reads no data", async () => {
    setup({ user: null });
    const res = await lookupAssignment(IDLE, fd(valid));
    expect(res).toEqual({ status: "error", error: "not_authenticated" });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("gives an unknown slug the same error as a non-admin (no slug oracle)", async () => {
    setup({ group: { data: null } });
    const unknownSlug = await lookupAssignment(IDLE, fd(valid));

    setup({ caller: { data: { id: "m1", role: "participant" } } });
    const participant = await lookupAssignment(IDLE, fd(valid));

    setup({ caller: { data: null } });
    const outsider = await lookupAssignment(IDLE, fd(valid));

    expect(unknownSlug).toEqual({ status: "error", error: "not_admin" });
    expect(participant).toEqual(unknownSlug);
    expect(outsider).toEqual(unknownSlug);
  });

  it("never reads assignments for a non-admin", async () => {
    const { from } = setup({
      caller: { data: { id: "m1", role: "participant" } },
    });
    await lookupAssignment(IDLE, fd(valid));
    expect(from).not.toHaveBeenCalledWith("assignments");
    expect(logger.withMetadata).not.toHaveBeenCalled();
  });

  it.each(["group", "caller"] as const)(
    "reports a DB error on the %s lookup as generic, not not_admin",
    async (which) => {
      setup({ [which]: { data: null, error: { message: "db down" } } });
      const res = await lookupAssignment(IDLE, fd(valid));
      expect(res).toEqual({ status: "error", error: "generic" });
    },
  );

  it("returns the receiver's profile name to an admin and logs the lookup", async () => {
    setup({});
    const res = await lookupAssignment(IDLE, fd(valid));
    expect(res).toEqual({
      status: "success",
      giverId: "m-giver",
      receiverName: "Erika Muster",
    });
    expect(logger.withMetadata).toHaveBeenCalledWith({
      groupId: "g1",
      giverId: "m-giver",
    });
  });

  it("falls back to the name snapshot for a ghost receiver (deleted account)", async () => {
    const { from } = setup({
      receiver: { data: { name_snapshot: "Max Gelöscht", profile_id: null } },
    });
    const res = await lookupAssignment(IDLE, fd(valid));
    expect(res).toEqual({
      status: "success",
      giverId: "m-giver",
      receiverName: "Max Gelöscht",
    });
    expect(from).not.toHaveBeenCalledWith("profiles");
  });

  it("falls back to the name snapshot when the profile row is gone", async () => {
    setup({ profile: { data: null } });
    const res = await lookupAssignment(IDLE, fd(valid));
    expect(res).toMatchObject({
      status: "success",
      receiverName: "Snapshot Name",
    });
  });

  it("returns not_found when the giver has no assignment", async () => {
    setup({ assignment: { data: null } });
    const res = await lookupAssignment(IDLE, fd(valid));
    expect(res).toEqual({ status: "error", error: "not_found" });
    expect(logger.withMetadata).not.toHaveBeenCalled();
  });

  it("returns not_found when the receiver membership is gone", async () => {
    setup({ receiver: { data: null } });
    const res = await lookupAssignment(IDLE, fd(valid));
    expect(res).toEqual({ status: "error", error: "not_found" });
  });

  it("scopes the assignment lookup to the caller's group", async () => {
    // A membership id from another group must not resolve: the query filters
    // on group_id of the (admin-checked) group, not on the id alone.
    const eq = vi.fn();
    const { from } = setup({});
    const original = from.getMockImplementation()!;
    from.mockImplementation((table: string) => {
      const q = original(table) as Record<string, ReturnType<typeof vi.fn>>;
      if (table === "assignments") {
        const inner = q.eq;
        q.eq = vi.fn((...args: unknown[]) => {
          eq(...args);
          return inner(...args);
        });
      }
      return q;
    });
    await lookupAssignment(IDLE, fd(valid));
    expect(eq).toHaveBeenCalledWith("group_id", "g1");
    expect(eq).toHaveBeenCalledWith("giver_id", "m-giver");
  });
});
