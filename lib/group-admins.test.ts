import { describe, it, expect, vi, beforeEach } from "vitest";

const warnMock = vi.fn();
const withMetadataMock = vi.fn().mockReturnValue({ warn: warnMock });

vi.mock("@/lib/logger", () => ({
  logger: { withMetadata: (...args: unknown[]) => withMetadataMock(...args) },
}));

import { resolveGroupContact } from "./group-admins";

interface Profile {
  id: string;
  first_name: string;
  last_name: string;
}

interface Membership {
  profile_id: string | null;
}

function makeAdmin(options: {
  profiles: Profile[];
  emailsByProfileId: Record<string, string | undefined>;
  groupAdmins: Membership[];
}) {
  const { profiles, emailsByProfileId, groupAdmins } = options;

  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "profiles") {
        const builder: { select: () => typeof builder; eq: unknown } = {
          select: () => builder,
          eq: vi.fn().mockImplementation((_col: string, id: string) => ({
            single: () => ({ data: profiles.find((p) => p.id === id) ?? null }),
          })),
        };
        return builder;
      }
      if (table === "memberships") {
        const builder: {
          select: () => typeof builder;
          eq: () => typeof builder;
          neq: unknown;
        } = {
          select: () => builder,
          eq: () => builder,
          neq: vi
            .fn()
            .mockImplementation((_col: string, excludeId: string) => ({
              data: groupAdmins.filter((m) => m.profile_id !== excludeId),
            })),
        };
        return builder;
      }
      throw new Error(`unexpected table: ${table}`);
    }),
    auth: {
      admin: {
        getUserById: vi.fn().mockImplementation((profileId: string) => ({
          data: { user: { email: emailsByProfileId[profileId] ?? null } },
        })),
      },
    },
  };
}

describe("resolveGroupContact", () => {
  beforeEach(() => {
    warnMock.mockReset();
    withMetadataMock.mockReset().mockReturnValue({ warn: warnMock });
  });

  it("resolves the acting admin when they still have a profile and email", async () => {
    const admin = makeAdmin({
      profiles: [{ id: "acting", first_name: "Anna", last_name: "Admin" }],
      emailsByProfileId: { acting: "anna@example.com" },
      groupAdmins: [],
    });

    const result = await resolveGroupContact(
      admin as never,
      "group-1",
      "acting",
    );

    expect(result).toEqual({ name: "Anna Admin", email: "anna@example.com" });
  });

  it("falls back to another admin when the acting admin's account is gone", async () => {
    const admin = makeAdmin({
      profiles: [{ id: "other", first_name: "Bert", last_name: "Berg" }],
      emailsByProfileId: { other: "bert@example.com" },
      groupAdmins: [{ profile_id: "other" }],
    });

    const result = await resolveGroupContact(
      admin as never,
      "group-1",
      "acting",
    );

    expect(result).toEqual({ name: "Bert Berg", email: "bert@example.com" });
  });

  it("returns null and logs a warning when no admin has a resolvable contact", async () => {
    const admin = makeAdmin({
      profiles: [],
      emailsByProfileId: {},
      groupAdmins: [{ profile_id: "other" }],
    });

    const result = await resolveGroupContact(
      admin as never,
      "group-1",
      "acting",
    );

    expect(result).toBeNull();
    expect(withMetadataMock).toHaveBeenCalledWith({ groupId: "group-1" });
    expect(warnMock).toHaveBeenCalledWith("group_contact.unresolved");
  });

  it("skips admins with no profile_id and falls through to null", async () => {
    const admin = makeAdmin({
      profiles: [],
      emailsByProfileId: {},
      groupAdmins: [{ profile_id: null }],
    });

    const result = await resolveGroupContact(
      admin as never,
      "group-1",
      "acting",
    );

    expect(result).toBeNull();
  });
});
