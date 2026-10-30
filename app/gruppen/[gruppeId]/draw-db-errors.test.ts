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

import { triggerDraw, retriggerDraw, resendDrawEmails } from "./actions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notify } from "@/lib/notification";

function fd(slug: string) {
  const f = new FormData();
  f.set("slug", slug);
  return f;
}

type Row = Record<string, unknown>;
type Tables = Partial<Record<string, { data: readonly Row[]; error?: string }>>;

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

const MEMBERS = [
  member("m1", "p1", "admin"),
  member("m2", "p2"),
  member("m3", "p3"),
];
const ASSIGNMENTS = [
  { giver_id: "m1", receiver_id: "m2" },
  { giver_id: "m2", receiver_id: "m3" },
  { giver_id: "m3", receiver_id: "m1" },
];

/** Thenable query builder: awaiting yields the list (or error), `.single()` yields `one`. */
function query(list: readonly Row[], error?: string, one: Row | null = null) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "neq", "not", "order"])
    q[m] = vi.fn(() => q);
  q.single = vi.fn().mockResolvedValue({ data: one, error: null });
  q.maybeSingle = q.single;
  q.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(
      error
        ? { data: null, error: { message: error } }
        : { data: list, error: null },
    ).then(resolve);
  return q;
}

function setup(state: "open" | "drawn", tables: Tables) {
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u-admin" } } }),
    },
  } as never);
  const rpc = vi.fn().mockResolvedValue({ data: "ok", error: null });
  vi.mocked(createAdminClient).mockReturnValue({
    rpc,
    from: vi.fn((table: string) => {
      if (table === "groups")
        return query([], undefined, {
          id: "g1",
          slug: "familie",
          state,
          draw_version: state === "drawn" ? 2 : 0,
          name: "Familie",
          year: 2026,
        });
      const t = tables[table];
      if (table === "memberships")
        return query(t?.data ?? MEMBERS, t?.error, { id: "m1", role: "admin" });
      if (table === "exclusions") return query(t?.data ?? [], t?.error);
      if (table === "assignments")
        return query(t?.data ?? ASSIGNMENTS, t?.error);
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

describe.each([
  ["triggerDraw", triggerDraw, "open"],
  ["retriggerDraw", retriggerDraw, "drawn"],
] as const)("%s DB read errors (#131)", (_name, action, state) => {
  beforeEach(() => vi.clearAllMocks());

  it("does not draw without exclusions when the exclusions read fails", async () => {
    const { rpc } = setup(state, { exclusions: { data: [], error: "boom" } });
    const res = await action({ status: "idle" }, fd("familie"));
    expect(res).toEqual({ status: "error", error: "generic" });
    expect(rpc).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("reports generic, not not_enough_members, when the memberships read fails", async () => {
    const { rpc } = setup(state, { memberships: { data: [], error: "boom" } });
    const res = await action({ status: "idle" }, fd("familie"));
    expect(res).toEqual({ status: "error", error: "generic" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("still draws when all reads succeed", async () => {
    const { rpc } = setup(state, {});
    const res = await action({ status: "idle" }, fd("familie"));
    expect(res).toMatchObject({ status: "success" });
    expect(rpc).toHaveBeenCalledWith("perform_draw", expect.anything());
  });
});

describe.each([
  ["triggerDraw", triggerDraw, "open"],
  ["retriggerDraw", retriggerDraw, "drawn"],
] as const)(
  "%s mail step crash after commit (#140)",
  (_name, action, state) => {
    beforeEach(() => vi.clearAllMocks());

    it("keeps the pending warning when notify throws: nothing is cleared", async () => {
      const { rpc } = setup(state, {});
      vi.mocked(notify).mockRejectedValueOnce(new Error("function timeout"));
      const res = await action({ status: "idle" }, fd("familie"));
      // perform_draw wrote the pending row; no result is recorded, so it stays.
      expect(rpc).toHaveBeenCalledWith("perform_draw", expect.anything());
      expect(rpc).not.toHaveBeenCalledWith(
        "record_draw_mail_result",
        expect.anything(),
      );
      // Admin sees the failure right away instead of an error page.
      expect(res).toEqual({
        status: "success",
        emailsFailed: 3,
        emailsTotal: 3,
      });
    });
  },
);

describe("resendDrawEmails DB read errors (#131)", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["memberships", { memberships: { data: [], error: "boom" } }],
    ["assignments", { assignments: { data: [], error: "boom" } }],
  ] as const)(
    "leaves the stored warning alone when the %s read fails",
    async (_label, tables) => {
      const { rpc } = setup("drawn", tables);
      const res = await resendDrawEmails({ status: "idle" }, fd("familie"));
      expect(res).toEqual({ status: "error", error: "generic" });
      expect(notify).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it("does not clear the warning when the assignment set is empty", async () => {
    const { rpc } = setup("drawn", { assignments: { data: [] } });
    const res = await resendDrawEmails({ status: "idle" }, fd("familie"));
    expect(res).toEqual({ status: "error", error: "generic" });
    expect(notify).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("still resends and records when reads succeed", async () => {
    const { rpc } = setup("drawn", {});
    const res = await resendDrawEmails({ status: "idle" }, fd("familie"));
    expect(res).toEqual({ status: "success", emailsFailed: 0, emailsTotal: 3 });
    expect(rpc).toHaveBeenCalledWith("record_draw_mail_result", {
      p_group_id: "g1",
      p_draw_version: 2,
      p_failed: 0,
      p_total: 3,
    });
  });
});
