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
  notify: vi.fn().mockResolvedValue({ sent: 3, failed: 0 }),
}));
vi.mock("@/lib/logger", () => {
  const chain = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
  return { logger: { ...chain, withMetadata: vi.fn().mockReturnValue(chain) } };
});

import { resendDrawEmails } from "./actions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notify } from "@/lib/notification";

function fd(slug: string) {
  const f = new FormData();
  f.set("slug", slug);
  return f;
}

type Row = Record<string, unknown>;

function member(id: string, profileId: string | null, first: string) {
  return {
    id,
    role: id === "m1" ? "admin" : "participant",
    profile_id: profileId,
    name_snapshot: `${first} Meier`,
    first_name_snapshot: first,
    last_name_snapshot: "Meier",
  };
}

function query(list: Row[], ones: (Row | null)[] = [null]) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order"]) q[m] = vi.fn(() => q);
  let i = 0;
  q.single = vi.fn(async () => ({
    data: ones[Math.min(i++, ones.length - 1)],
    error: null,
  }));
  q.maybeSingle = q.single;
  q.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: list, error: null }).then(resolve);
  return q;
}

function setup(
  members: ReturnType<typeof member>[],
  assignments: Row[],
  groupVersions: number[] = [2],
) {
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u-admin" } } }),
    },
  } as never);
  const group = (v: number) => ({
    id: "g1",
    state: "drawn",
    draw_version: v,
    name: "Familie",
    year: 2026,
  });
  const groups = query([], groupVersions.map(group));
  vi.mocked(createAdminClient).mockReturnValue({
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    from: vi.fn((table: string) => {
      if (table === "groups") return groups;
      if (table === "memberships")
        return query(members, [{ id: "m1", role: "admin" }]);
      if (table === "assignments") return query(assignments);
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
}

function sentRecipients() {
  const call = vi.mocked(notify).mock.calls[0][0] as unknown as {
    assignments: { to: string; receiverDisplayName: string }[];
  };
  return call.assignments;
}

describe("resendDrawEmails recipient snapshot (#151)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("numbers identical display names like the original send", async () => {
    setup(
      [
        member("m1", "p1", "Anna"),
        member("m2", "p2", "Anna"),
        member("m3", "p3", "Anna"),
      ],
      [
        { giver_id: "m1", receiver_id: "m2" },
        { giver_id: "m2", receiver_id: "m3" },
        { giver_id: "m3", receiver_id: "m1" },
      ],
    );
    await resendDrawEmails({ status: "idle" }, fd("familie"));
    const byTo = Object.fromEntries(
      sentRecipients().map((r) => [r.to, r.receiverDisplayName]),
    );
    // Order is joined_at,id as in trigger/re-draw: m1 -> (1), m2 -> (2), m3 -> (3).
    expect(byTo).toEqual({
      "p1@example.com": "Anna Meier (2)",
      "p2@example.com": "Anna Meier (3)",
      "p3@example.com": "Anna Meier (1)",
    });
  });

  it("builds recipients from live members only (ghost present)", async () => {
    setup(
      [
        member("m1", "p1", "Anna"),
        member("m2", "p2", "Berta"),
        member("m3", "p3", "Clara"),
        member("m4", null, "Dora"),
      ],
      [
        { giver_id: "m1", receiver_id: "m2" },
        { giver_id: "m2", receiver_id: "m3" },
        { giver_id: "m3", receiver_id: "m1" },
        { giver_id: "m4", receiver_id: "m1" },
      ],
    );
    const res = await resendDrawEmails({ status: "idle" }, fd("familie"));
    expect(res).toEqual({ status: "success", emailsFailed: 0, emailsTotal: 3 });
    expect(sentRecipients().map((r) => r.to)).toEqual([
      "p1@example.com",
      "p2@example.com",
      "p3@example.com",
    ]);
  });

  it("aborts when draw_version changed during the reads", async () => {
    setup(
      [
        member("m1", "p1", "Anna"),
        member("m2", "p2", "Berta"),
        member("m3", "p3", "Clara"),
      ],
      [{ giver_id: "m1", receiver_id: "m2" }],
      [2, 3],
    );
    const res = await resendDrawEmails({ status: "idle" }, fd("familie"));
    expect(res).toEqual({ status: "error", error: "not_drawn" });
    expect(notify).not.toHaveBeenCalled();
  });
});
