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
vi.mock("@/lib/group-admins", () => ({
  resolveGroupContact: vi.fn().mockResolvedValue(null),
  getGroupAdminEmails: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/notification", () => ({
  notify: vi.fn().mockResolvedValue({ sent: 0, failed: 0 }),
}));
vi.mock("@/lib/logger", () => {
  const chain = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
  return { logger: { ...chain, withMetadata: vi.fn().mockReturnValue(chain) } };
});

import { retriggerDraw } from "./actions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notify } from "@/lib/notification";

function fd(slug: string) {
  const f = new FormData();
  f.set("slug", slug);
  return f;
}

type Row = Record<string, unknown>;

function member(id: string, profileId: string | null, role = "participant") {
  return {
    id,
    role,
    profile_id: profileId,
    name_snapshot: `Name ${id}`,
    first_name_snapshot: `First${id}`,
    last_name_snapshot: `Last${id}`,
  };
}

/** Thenable query builder: awaiting it yields `list`, `.single()` yields `one`. */
function query(list: Row[], one: Row | null = null) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "neq", "not", "order"])
    q[m] = vi.fn(() => q);
  q.single = vi.fn().mockResolvedValue({ data: one, error: null });
  q.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: list, error: null }).then(resolve);
  return q;
}

function setup(opts: {
  members: Row[];
  exclusions?: Row[];
  rpcResult?: string;
}) {
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u-admin" } } }),
    },
  } as never);
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: opts.rpcResult ?? "ok", error: null });
  vi.mocked(createAdminClient).mockReturnValue({
    rpc,
    from: vi.fn((table: string) => {
      if (table === "groups")
        return query([], {
          id: "g1",
          slug: "familie",
          state: "drawn",
          draw_version: 3,
          name: "Familie",
          year: 2026,
        });
      if (table === "memberships")
        return query(opts.members, { id: "m1", role: "admin" });
      if (table === "exclusions") return query(opts.exclusions ?? []);
      return query([]);
    }),
    auth: {
      admin: {
        getUserById: vi.fn(async (id: string) => ({
          data: { user: { email: `${id}@example.com` } },
        })),
      },
    },
  } as never);
  return { rpc };
}

describe("retriggerDraw with deleted-account members (#18)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("draws only live members and never sends the ghost a mail or a pairing", async () => {
    const { rpc } = setup({
      members: [
        member("m1", "p1", "admin"),
        member("m2", "p2"),
        member("m3", "p3"),
        member("ghost", null),
      ],
      exclusions: [{ member_a: "ghost", member_b: "m2" }],
    });

    const res = await retriggerDraw({ status: "idle" }, fd("familie"));
    expect(res).toMatchObject({ status: "success" });

    expect(rpc).toHaveBeenCalledTimes(1);
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe("perform_draw");
    expect(args.p_expected_state).toBe("drawn");
    const pairs = args.p_pairs as { giver_id: string; receiver_id: string }[];
    expect(pairs.map((p) => p.giver_id).sort()).toEqual(["m1", "m2", "m3"]);
    expect(pairs.map((p) => p.receiver_id).sort()).toEqual(["m1", "m2", "m3"]);

    const event = vi.mocked(notify).mock.calls[0][0] as {
      type: string;
      assignments: { giverName: string; to: string }[];
    };
    expect(event.type).toBe("draw.redrawn");
    expect(event.assignments).toHaveLength(3);
    expect(event.assignments.map((a) => a.giverName)).not.toContain(
      "Name ghost",
    );
  });

  it("refuses when fewer than 3 live members remain", async () => {
    const { rpc } = setup({
      members: [
        member("m1", "p1", "admin"),
        member("m2", "p2"),
        member("g1", null),
        member("g2", null),
      ],
    });
    const res = await retriggerDraw({ status: "idle" }, fd("familie"));
    expect(res).toEqual({ status: "error", error: "not_enough_members" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces a drifted membership list instead of a generic error", async () => {
    setup({
      members: [
        member("m1", "p1", "admin"),
        member("m2", "p2"),
        member("m3", "p3"),
      ],
      rpcResult: "membership_changed",
    });
    const res = await retriggerDraw({ status: "idle" }, fd("familie"));
    expect(res).toEqual({ status: "error", error: "membership_changed" });
    expect(notify).not.toHaveBeenCalled();
  });
});
