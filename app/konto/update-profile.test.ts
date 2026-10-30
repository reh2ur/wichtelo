import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ updateTag: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/site-url", () => ({
  getSiteUrl: vi.fn().mockResolvedValue("https://wichtelo.test"),
}));
vi.mock("@/lib/account", () => ({
  issueDeletionToken: vi.fn(),
  findSoleAdminGroups: vi.fn(),
}));
vi.mock("@/lib/notification", () => ({ notify: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  accountDeletionLimiter: {},
  checkRateLimit: vi.fn().mockResolvedValue(true),
  refundRateLimit: vi.fn(),
}));
vi.mock("@/lib/logger", () => {
  const chain = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
  return { logger: { ...chain, withMetadata: vi.fn().mockReturnValue(chain) } };
});

import { updateProfile, type UpdateProfileState } from "./actions";
import { updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { groupTag } from "@/lib/cache-tags";

const IDLE: UpdateProfileState = { status: "idle" };

function fd(firstName: string | null, lastName: string | null) {
  const f = new FormData();
  if (firstName !== null) f.set("firstName", firstName);
  if (lastName !== null) f.set("lastName", lastName);
  return f;
}

type Result = { data?: unknown; error?: { message: string } | null };

function setup(opts: {
  user?: { id: string } | null;
  /** profiles.update(...).select("id") result */
  updated?: Result;
  /** profiles.insert(...) result (only reached when update matched 0 rows) */
  inserted?: Result;
  /** memberships snapshot update result */
  snapshots?: Result;
}) {
  const user = "user" in opts ? opts.user : { id: "u1" };
  const profileUpdate = vi.fn();
  const profileInsert = vi.fn();
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    from: vi.fn(() => ({
      update: vi.fn((values: unknown) => {
        profileUpdate(values);
        const q = {
          eq: vi.fn(() => q),
          select: vi.fn(() =>
            Promise.resolve({
              data: [{ id: "u1" }],
              error: null,
              ...opts.updated,
            }),
          ),
        };
        return q;
      }),
      insert: vi.fn((values: unknown) => {
        profileInsert(values);
        return Promise.resolve({ error: null, ...opts.inserted });
      }),
    })),
  } as never);

  const snapshotUpdate = vi.fn();
  vi.mocked(createAdminClient).mockReturnValue({
    from: vi.fn(() => ({
      update: vi.fn((values: unknown) => {
        snapshotUpdate(values);
        const q = {
          eq: vi.fn(() => q),
          select: vi.fn(() =>
            Promise.resolve({ data: [], error: null, ...opts.snapshots }),
          ),
        };
        return q;
      }),
    })),
  } as never);
  return { profileUpdate, profileInsert, snapshotUpdate };
}

describe("updateProfile", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["first name missing", fd(null, "Muster")],
    ["last name missing", fd("Max", null)],
    ["first name blank", fd("   ", "Muster")],
    ["last name blank", fd("Max", "  ")],
  ])("rejects %s before any auth or DB work", async (_l, form) => {
    const res = await updateProfile(IDLE, form);
    expect(res).toMatchObject({ status: "error", error: "missing_name" });
    expect(createClient).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("echoes the trimmed input so the form survives validation errors", async () => {
    const res = await updateProfile(IDLE, fd("  Max ", ""));
    expect(res).toEqual({
      status: "error",
      error: "missing_name",
      values: { firstName: "Max", lastName: "" },
    });
  });

  it.each([
    ["first", fd("x".repeat(51), "Muster")],
    ["last", fd("Max", "x".repeat(51))],
  ])("rejects a %s name over 50 chars", async (_l, form) => {
    const res = await updateProfile(IDLE, form);
    expect(res).toMatchObject({ status: "error", error: "too_long" });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("accepts names of exactly 50 chars", async () => {
    setup({});
    const res = await updateProfile(IDLE, fd("x".repeat(50), "y".repeat(50)));
    expect(res).toEqual({ status: "success" });
  });

  it("requires a signed-in user and writes nothing", async () => {
    const { profileUpdate, snapshotUpdate } = setup({ user: null });
    const res = await updateProfile(IDLE, fd("Max", "Muster"));
    expect(res).toEqual({ status: "error", error: "not_authenticated" });
    expect(profileUpdate).not.toHaveBeenCalled();
    expect(snapshotUpdate).not.toHaveBeenCalled();
  });

  it("updates the profile, syncs membership snapshots and invalidates each group", async () => {
    const { profileUpdate, profileInsert, snapshotUpdate } = setup({
      snapshots: {
        data: [{ groups: { slug: "familie" } }, { groups: { slug: "büro" } }],
      },
    });
    const res = await updateProfile(IDLE, fd(" Max ", " Muster "));
    expect(res).toEqual({ status: "success" });
    expect(profileUpdate).toHaveBeenCalledWith({
      first_name: "Max",
      last_name: "Muster",
    });
    expect(profileInsert).not.toHaveBeenCalled();
    expect(snapshotUpdate).toHaveBeenCalledWith({
      name_snapshot: "Max Muster",
      first_name_snapshot: "Max",
      last_name_snapshot: "Muster",
    });
    expect(updateTag).toHaveBeenCalledTimes(2);
    expect(updateTag).toHaveBeenCalledWith(groupTag("familie"));
    expect(updateTag).toHaveBeenCalledWith(groupTag("büro"));
  });

  it("creates the profile row when the update matched none (no false 'Gespeichert')", async () => {
    const { profileInsert } = setup({ updated: { data: [] } });
    const res = await updateProfile(IDLE, fd("Max", "Muster"));
    expect(res).toEqual({ status: "success" });
    expect(profileInsert).toHaveBeenCalledWith({
      id: "u1",
      first_name: "Max",
      last_name: "Muster",
    });
  });

  it("fails with generic when the insert fallback fails, without touching snapshots", async () => {
    const { snapshotUpdate } = setup({
      updated: { data: [] },
      inserted: { error: { message: "denied" } },
    });
    const res = await updateProfile(IDLE, fd("Max", "Muster"));
    expect(res).toEqual({ status: "error", error: "generic" });
    expect(snapshotUpdate).not.toHaveBeenCalled();
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("fails with generic when the profile update errors, without touching snapshots", async () => {
    const { profileInsert, snapshotUpdate } = setup({
      updated: { data: null, error: { message: "db down" } },
    });
    const res = await updateProfile(IDLE, fd("Max", "Muster"));
    expect(res).toEqual({ status: "error", error: "generic" });
    expect(profileInsert).not.toHaveBeenCalled();
    expect(snapshotUpdate).not.toHaveBeenCalled();
  });

  it("surfaces a failed snapshot sync as generic so the user retries", async () => {
    setup({ snapshots: { data: null, error: { message: "db down" } } });
    const res = await updateProfile(IDLE, fd("Max", "Muster"));
    expect(res).toEqual({ status: "error", error: "generic" });
    expect(updateTag).not.toHaveBeenCalled();
  });
});
