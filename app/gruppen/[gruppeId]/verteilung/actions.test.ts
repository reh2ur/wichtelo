import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/group-admin", () => ({ requireGroupAdmin: vi.fn() }));
vi.mock("@/lib/draw", () => ({ loadMemberships: vi.fn() }));
vi.mock("@/lib/member-display-names", () => ({ loadProfilesById: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
  identityRevealLimiter: { name: "reveal" },
}));
vi.mock("@/lib/logger", () => {
  const chain = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
  return { logger: { ...chain, withMetadata: vi.fn().mockReturnValue(chain) } };
});

import { revealMemberName } from "./actions";
import { requireGroupAdmin } from "@/lib/group-admin";
import { loadMemberships } from "@/lib/draw";
import { loadProfilesById } from "@/lib/member-display-names";
import { checkRateLimit } from "@/lib/rate-limit";
import { pseudonymize } from "@/lib/draw/pseudonyms";

const members = [
  { id: "m1", profile_id: "p1", name_snapshot: "Snap One" },
  { id: "m2", profile_id: "p2", name_snapshot: "Snap Two" },
  { id: "m3", profile_id: null, name_snapshot: "Gone Three" },
];

function setup(opts: { state?: "open" | "drawn"; auditError?: string } = {}) {
  const insert = vi.fn().mockResolvedValue({
    error: opts.auditError ? { message: opts.auditError } : null,
  });
  vi.mocked(requireGroupAdmin).mockResolvedValue({
    ok: true,
    user: { id: "u-admin", email: "a@test.local" },
    admin: { from: vi.fn(() => ({ insert })) },
    group: { id: "g1", state: opts.state ?? "drawn", draw_version: 2 },
    membership: { id: "m1", role: "admin", name_snapshot: "x" },
  } as never);
  vi.mocked(loadMemberships).mockResolvedValue(members as never);
  vi.mocked(loadProfilesById).mockResolvedValue(
    new Map([
      ["p1", { id: "p1", first_name: "Anna", last_name: "Alt" }],
      ["p2", { id: "p2", first_name: "Bert", last_name: "Bunt" }],
    ]) as never,
  );
  return { insert };
}

const labelOf = (id: string) =>
  pseudonymize(
    "g1",
    2,
    members.map((m) => m.id),
  ).labelById.get(id)!;

describe("revealMemberName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue(true);
  });

  it("returns the profile name and writes an identity audit row first", async () => {
    const { insert } = setup();
    const res = await revealMemberName("grp", labelOf("m2"));
    expect(res).toEqual({
      status: "success",
      label: labelOf("m2"),
      name: "Bert Bunt",
    });
    expect(insert).toHaveBeenCalledWith({
      group_id: "g1",
      actor_profile_id: "u-admin",
      target_membership_id: "m2",
      kind: "identity",
    });
  });

  it("falls back to the name snapshot for deleted accounts", async () => {
    setup();
    const res = await revealMemberName("grp", labelOf("m3"));
    expect(res).toMatchObject({ status: "success", name: "Gone Three" });
  });

  it("fails closed when the audit row cannot be written", async () => {
    setup({ auditError: "db down" });
    const res = await revealMemberName("grp", labelOf("m2"));
    expect(res).toEqual({ status: "error", error: "generic" });
  });

  it("refuses non-admins without revealing slug existence", async () => {
    vi.mocked(requireGroupAdmin).mockResolvedValue({
      ok: false,
      error: "group_not_found",
    });
    expect(await revealMemberName("nope", "A")).toEqual({
      status: "error",
      error: "not_admin",
    });
  });

  it("respects the rate limit before touching data", async () => {
    setup();
    vi.mocked(checkRateLimit).mockResolvedValue(false);
    const res = await revealMemberName("grp", labelOf("m2"));
    expect(res).toEqual({ status: "error", error: "rate_limited" });
    expect(loadMemberships).not.toHaveBeenCalled();
  });

  it("refuses open groups", async () => {
    const { insert } = setup({ state: "open" });
    const res = await revealMemberName("grp", "A");
    expect(res).toEqual({ status: "error", error: "not_found" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects unknown labels and malformed input", async () => {
    const { insert } = setup();
    expect(await revealMemberName("grp", "Z")).toEqual({
      status: "error",
      error: "not_found",
    });
    expect(await revealMemberName("grp", "not a label")).toEqual({
      status: "error",
      error: "generic",
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("maps load failures to generic", async () => {
    setup();
    vi.mocked(loadMemberships).mockRejectedValue(new Error("boom"));
    expect(await revealMemberName("grp", "A")).toEqual({
      status: "error",
      error: "generic",
    });
  });
});
