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
// Real draw module, but computeDraw controllable: TOO_COMPLEX / null cannot be
// provoked reliably with a tiny real member list.
vi.mock("@/lib/draw", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/draw")>();
  return { ...mod, computeDraw: vi.fn(mod.computeDraw) };
});

import { triggerDraw, retriggerDraw } from "./actions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notify } from "@/lib/notification";
import { computeDraw, TOO_COMPLEX } from "@/lib/draw";
import { updateTag } from "next/cache";

function fd(slug: string) {
  const f = new FormData();
  f.set("slug", slug);
  return f;
}

type Row = Record<string, unknown>;

function member(id: string, role = "participant") {
  return {
    id,
    role,
    profile_id: `p-${id}`,
    name_snapshot: `Name ${id}`,
    first_name_snapshot: `First${id}`,
    last_name_snapshot: `Last${id}`,
  };
}

const MEMBERS = [member("m1", "admin"), member("m2"), member("m3")];

/** Thenable query builder: awaiting yields the list, `.single()` yields `one`. */
function query(list: Row[], one: Row | null = null) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "neq", "not", "order"])
    q[m] = vi.fn(() => q);
  q.single = vi.fn().mockResolvedValue({ data: one, error: null });
  q.maybeSingle = q.single;
  q.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: list, error: null }).then(resolve);
  return q;
}

function setup(
  state: "open" | "drawn",
  rpcResponse: { data?: unknown; error?: { message: string } | null } = {
    data: "ok",
  },
) {
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u-admin" } } }),
    },
  } as never);
  const rpc = vi.fn().mockResolvedValue({ error: null, ...rpcResponse });
  vi.mocked(createAdminClient).mockReturnValue({
    rpc,
    from: vi.fn((table: string) => {
      if (table === "groups")
        return query([], {
          id: "g1",
          slug: "familie",
          state,
          draw_version: state === "drawn" ? 2 : 0,
          name: "Familie",
          year: 2026,
        });
      if (table === "memberships")
        return query(MEMBERS, { id: "m1", role: "admin" });
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
] as const)("%s computeDraw outcomes", (_name, action, state) => {
  beforeEach(() => vi.clearAllMocks());

  it("maps TOO_COMPLEX to too_complex, distinct from unsolvable, without touching the DB", async () => {
    const { rpc } = setup(state);
    vi.mocked(computeDraw).mockReturnValueOnce(TOO_COMPLEX);
    const res = await action({ status: "idle" }, fd("familie"));
    expect(res).toEqual({ status: "error", error: "too_complex" });
    expect(rpc).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("maps a null result to unsolvable without touching the DB", async () => {
    const { rpc } = setup(state);
    vi.mocked(computeDraw).mockReturnValueOnce(null);
    const res = await action({ status: "idle" }, fd("familie"));
    expect(res).toEqual({ status: "error", error: "unsolvable" });
    expect(rpc).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("triggerDraw perform_draw result mapping", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["state_changed", "already_drawn"],
    ["ghost_members", "ghost_members"],
    // Join slipped in between read and draw: admin retries, never sends mail.
    ["membership_changed", "membership_changed"],
    ["group_not_found", "generic"],
  ])("maps rpc result %s to %s and sends nothing", async (rpcResult, error) => {
    setup("open", { data: rpcResult });
    const res = await triggerDraw({ status: "idle" }, fd("familie"));
    expect(res).toEqual({ status: "error", error });
    expect(notify).not.toHaveBeenCalled();
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("maps an rpc transport error to generic and sends nothing", async () => {
    setup("open", { data: null, error: { message: "db down" } });
    const res = await triggerDraw({ status: "idle" }, fd("familie"));
    expect(res).toEqual({ status: "error", error: "generic" });
    expect(notify).not.toHaveBeenCalled();
  });

  it("sends the draw mail and invalidates the group tag on ok", async () => {
    setup("open");
    const res = await triggerDraw({ status: "idle" }, fd("familie"));
    expect(res).toEqual({
      status: "success",
      emailsFailed: 0,
      emailsTotal: 3,
    });
    expect(updateTag).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: "draw.completed", groupId: "g1" }),
    );
  });
});

describe("retriggerDraw perform_draw result mapping", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["state_changed", "not_drawn"],
    ["membership_changed", "membership_changed"],
    ["ghost_members", "generic"],
    ["group_not_found", "generic"],
  ])("maps rpc result %s to %s and sends nothing", async (rpcResult, error) => {
    setup("drawn", { data: rpcResult });
    const res = await retriggerDraw({ status: "idle" }, fd("familie"));
    expect(res).toEqual({ status: "error", error });
    expect(notify).not.toHaveBeenCalled();
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("maps an rpc transport error to generic and sends nothing", async () => {
    setup("drawn", { data: null, error: { message: "db down" } });
    const res = await retriggerDraw({ status: "idle" }, fd("familie"));
    expect(res).toEqual({ status: "error", error: "generic" });
    expect(notify).not.toHaveBeenCalled();
  });
});
