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

import { dismissDrawMailWarning, resendDrawEmails } from "./actions";
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

function query(list: Row[], one: Row | null = null, onDelete?: () => unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order"]) q[m] = vi.fn(() => q);
  q.delete = vi.fn(() => {
    onDelete?.();
    return q;
  });
  q.single = vi.fn().mockResolvedValue({ data: one, error: null });
  q.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: list, error: null }).then(resolve);
  return q;
}

function setup(opts: { role?: string | null; drawVersion?: number } = {}) {
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u-admin" } } }),
    },
  } as never);
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
  const deleted = vi.fn();
  const members = [
    member("m1", "p1", "admin"),
    member("m2", "p2"),
    member("m3", "p3"),
  ];
  vi.mocked(createAdminClient).mockReturnValue({
    rpc,
    from: vi.fn((table: string) => {
      if (table === "groups")
        return query([], {
          id: "g1",
          state: "drawn",
          draw_version: opts.drawVersion ?? 2,
          name: "Familie",
          year: 2026,
        });
      if (table === "memberships")
        return query(
          members,
          opts.role === null ? null : { id: "m1", role: opts.role ?? "admin" },
        );
      if (table === "assignments")
        return query([
          { giver_id: "m1", receiver_id: "m2" },
          { giver_id: "m2", receiver_id: "m3" },
          { giver_id: "m3", receiver_id: "m1" },
        ]);
      if (table === "draw_mail_failures") return query([], null, deleted);
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
  return { rpc, deleted };
}

describe("resendDrawEmails persists the outcome (#106)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps the warning with fresh counts while mails still fail", async () => {
    const { rpc } = setup({ drawVersion: 2 });
    vi.mocked(notify).mockResolvedValueOnce({ sent: 2, failed: 1 });
    const res = await resendDrawEmails({ status: "idle" }, fd("familie"));
    expect(res).toEqual({ status: "success", emailsFailed: 1, emailsTotal: 3 });
    expect(rpc).toHaveBeenCalledWith("record_draw_mail_result", {
      p_group_id: "g1",
      p_draw_version: 2,
      p_failed: 1,
      p_total: 3,
    });
  });

  it("clears the warning after a fully successful resend, same idempotency scope", async () => {
    const { rpc } = setup({ drawVersion: 2 });
    const res = await resendDrawEmails({ status: "idle" }, fd("familie"));
    expect(res).toEqual({ status: "success", emailsFailed: 0, emailsTotal: 3 });
    expect(rpc).toHaveBeenCalledWith("record_draw_mail_result", {
      p_group_id: "g1",
      p_draw_version: 2,
      p_failed: 0,
      p_total: 3,
    });
    // Same drawKey as the original send: no duplicate mails for delivered chunks.
    expect(vi.mocked(notify).mock.calls[0][0]).toMatchObject({
      type: "draw.redrawn",
      drawKey: "2",
    });
  });

  it("non-admin cannot resend and nothing is recorded", async () => {
    const { rpc } = setup({ role: "participant" });
    const res = await resendDrawEmails({ status: "idle" }, fd("familie"));
    expect(res).toEqual({ status: "error", error: "not_admin" });
    expect(notify).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("dismissDrawMailWarning (#106)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("admin clears the stored warning", async () => {
    const { deleted } = setup();
    const res = await dismissDrawMailWarning({ status: "idle" }, fd("familie"));
    expect(res).toEqual({ status: "success" });
    expect(deleted).toHaveBeenCalledTimes(1);
  });

  it("participant and non-member get not_admin, nothing deleted", async () => {
    for (const role of ["participant", null]) {
      const { deleted } = setup({ role });
      const res = await dismissDrawMailWarning(
        { status: "idle" },
        fd("familie"),
      );
      expect(res).toEqual({ status: "error", error: "not_admin" });
      expect(deleted).not.toHaveBeenCalled();
    }
  });
});
