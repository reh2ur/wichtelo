import { describe, it, expect } from "vitest";
import { requireGroupAdmin, type GroupAdminDeps } from "@/lib/group-admin";

const group = {
  id: "g1",
  slug: "s",
  name: "G",
  year: 2026,
  state: "open" as const,
  draw_version: 0,
};
const adminClient = {} as GroupAdminDeps["admin"];

function deps(over: Partial<GroupAdminDeps> = {}): Partial<GroupAdminDeps> {
  return {
    getUser: async () => ({ id: "u1", email: "a@b.de" }),
    admin: adminClient,
    findGroup: async () => ({ failed: false, row: group }),
    findMembership: async () => ({
      failed: false,
      row: { id: "m1", role: "admin", name_snapshot: "A" },
    }),
    ...over,
  };
}

describe("requireGroupAdmin", () => {
  it("returns context for an admin", async () => {
    const r = await requireGroupAdmin("s", deps());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.group.id).toBe("g1");
      expect(r.user.id).toBe("u1");
    }
  });

  it("not_authenticated without session", async () => {
    const r = await requireGroupAdmin("s", deps({ getUser: async () => null }));
    expect(r).toEqual({ ok: false, error: "not_authenticated" });
  });

  it("group_not_found for unknown slug", async () => {
    const r = await requireGroupAdmin(
      "s",
      deps({ findGroup: async () => ({ failed: false, row: null }) }),
    );
    expect(r).toEqual({ ok: false, error: "group_not_found" });
  });

  it("generic when group lookup fails", async () => {
    const r = await requireGroupAdmin(
      "s",
      deps({ findGroup: async () => ({ failed: true }) }),
    );
    expect(r).toEqual({ ok: false, error: "generic" });
  });

  it("generic (not not_admin) when membership lookup fails", async () => {
    const r = await requireGroupAdmin(
      "s",
      deps({ findMembership: async () => ({ failed: true }) }),
    );
    expect(r).toEqual({ ok: false, error: "generic" });
  });

  it("not_admin for non-member and for participant", async () => {
    const none = await requireGroupAdmin(
      "s",
      deps({ findMembership: async () => ({ failed: false, row: null }) }),
    );
    expect(none).toEqual({ ok: false, error: "not_admin" });
    const participant = await requireGroupAdmin(
      "s",
      deps({
        findMembership: async () => ({
          failed: false,
          row: { id: "m", role: "participant", name_snapshot: "P" },
        }),
      }),
    );
    expect(participant).toEqual({ ok: false, error: "not_admin" });
  });
});
