import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn().mockImplementation((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

const adminGroupDelete = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      delete: vi.fn(() => ({
        eq: adminGroupDelete.mockResolvedValue({ error: null }),
      })),
    })),
  })),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    withMetadata: vi.fn().mockReturnValue({ info: vi.fn() }),
  },
}));

import { createGroup } from "./actions";
import { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

function fd(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

function makeSupabase(overrides: {
  user?: object | null;
  profile?: object | null;
  groupInsertError?: object | null;
  membershipInsertError?: object | null;
  profileInsertError?: object | null;
}) {
  const {
    user = { id: "user-1" },
    profile = { id: "user-1", first_name: "Max", last_name: "Muster" },
    groupInsertError = null,
    membershipInsertError = null,
    profileInsertError = null,
  } = overrides;

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "profiles") {
        if (profileInsertError !== null && profile === null) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null }),
            insert: vi.fn().mockResolvedValue({ error: profileInsertError }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: profile }),
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      if (table === "groups") {
        return {
          insert: vi.fn().mockResolvedValue({ error: groupInsertError }),
        };
      }
      if (table === "memberships") {
        return {
          insert: vi.fn().mockResolvedValue({ error: membershipInsertError }),
        };
      }
    }),
  };
}

describe("createGroup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  describe("input validation", () => {
    it("returns missing_name for empty name", async () => {
      expect(
        await createGroup({ status: "idle" }, fd({ name: "", year: "2025" })),
      ).toEqual(
        expect.objectContaining({ status: "error", error: "missing_name" }),
      );
    });

    it("returns missing_name for whitespace-only name", async () => {
      expect(
        await createGroup(
          { status: "idle" },
          fd({ name: "   ", year: "2025" }),
        ),
      ).toEqual(
        expect.objectContaining({ status: "error", error: "missing_name" }),
      );
    });

    it("returns missing_year for empty year", async () => {
      expect(
        await createGroup({ status: "idle" }, fd({ name: "Test", year: "" })),
      ).toEqual(
        expect.objectContaining({ status: "error", error: "missing_year" }),
      );
    });

    it("returns missing_year for non-numeric year", async () => {
      expect(
        await createGroup(
          { status: "idle" },
          fd({ name: "Test", year: "abc" }),
        ),
      ).toEqual(
        expect.objectContaining({ status: "error", error: "missing_year" }),
      );
    });
  });

  describe("over-length input (#186)", () => {
    it("returns too_long (not missing_name) for a 101-char name and echoes values", async () => {
      const result = await createGroup(
        { status: "idle" },
        fd({
          name: "x".repeat(101),
          year: "2025",
          budgetHint: "20 Euro",
          firstName: "Max",
          lastName: "Muster",
        }),
      );
      expect(result).toEqual({
        status: "error",
        error: "too_long",
        max: 100,
        values: {
          name: "x".repeat(101),
          year: "2025",
          budgetHint: "20 Euro",
          note: "",
          firstName: "Max",
          lastName: "Muster",
        },
      });
    });

    it("returns too_long for over-length budget hint", async () => {
      const result = await createGroup(
        { status: "idle" },
        fd({ name: "Test", year: "2025", budgetHint: "x".repeat(201) }),
      );
      expect(result).toMatchObject({ error: "too_long", max: 200 });
    });

    it("returns too_long for over-length first name", async () => {
      const result = await createGroup(
        { status: "idle" },
        fd({ name: "Test", year: "2025", firstName: "x".repeat(51) }),
      );
      expect(result).toMatchObject({ error: "too_long", max: 50 });
    });
  });

  describe("auth boundary", () => {
    it("redirects to /anmelden when no user session", async () => {
      vi.mocked(createClient).mockResolvedValue(
        makeSupabase({ user: null }) as unknown as SupabaseClient,
      );

      await expect(
        createGroup(
          { status: "idle" },
          fd({ name: "Test Group", year: "2025" }),
        ),
      ).rejects.toThrow("REDIRECT:/anmelden");
    });
  });

  describe("profile handling", () => {
    it("returns profile_required when user has no profile and no name fields supplied", async () => {
      vi.mocked(createClient).mockResolvedValue(
        makeSupabase({ profile: null }) as unknown as SupabaseClient,
      );

      const result = await createGroup(
        { status: "idle" },
        fd({ name: "Test Group", year: "2025" }),
      );
      expect(result).toEqual(
        expect.objectContaining({ status: "error", error: "profile_required" }),
      );
    });

    it("returns generic when profile insert fails", async () => {
      vi.mocked(createClient).mockResolvedValue(
        makeSupabase({
          profile: null,
          profileInsertError: { message: "DB error", code: "42000" },
        }) as unknown as SupabaseClient,
      );

      const result = await createGroup(
        { status: "idle" },
        fd({
          name: "Test Group",
          year: "2025",
          firstName: "Max",
          lastName: "Muster",
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({ status: "error", error: "generic" }),
      );
    });
  });

  describe("group creation", () => {
    it("returns generic when group insert fails", async () => {
      vi.mocked(createClient).mockResolvedValue(
        makeSupabase({
          groupInsertError: { message: "DB error", code: "42000" },
        }) as unknown as SupabaseClient,
      );

      const result = await createGroup(
        { status: "idle" },
        fd({ name: "Test Group", year: "2025" }),
      );
      expect(result).toEqual(
        expect.objectContaining({ status: "error", error: "generic" }),
      );
    });

    it("deletes the orphan group when the admin membership insert fails", async () => {
      vi.mocked(createClient).mockResolvedValue(
        makeSupabase({
          membershipInsertError: { message: "DB error", code: "42000" },
        }) as unknown as SupabaseClient,
      );

      await createGroup(
        { status: "idle" },
        fd({ name: "Test Group", year: "2025" }),
      );
      expect(adminGroupDelete).toHaveBeenCalledWith("id", expect.any(String));
    });

    it("keeps finding a free slug beyond the old 20-suffix cap", async () => {
      const taken = vi.fn();
      const base = makeSupabase({}) as unknown as {
        from: (t: string) => unknown;
      };
      let calls = 0;
      const supabase = {
        ...base,
        from: vi.fn((table: string) => {
          if (table === "groups") {
            return {
              insert: vi.fn((row: { slug: string }) => {
                calls++;
                taken(row.slug);
                // 25 collisions, then free
                return Promise.resolve({
                  error: calls <= 25 ? { code: "23505", message: "dup" } : null,
                });
              }),
            };
          }
          return base.from(table);
        }),
      };
      vi.mocked(createClient).mockResolvedValue(
        supabase as unknown as SupabaseClient,
      );

      await expect(
        createGroup({ status: "idle" }, fd({ name: "Familie", year: "2025" })),
      ).rejects.toThrow(/REDIRECT:\/gruppen\/familie-[a-z0-9]{4}$/);
      expect(calls).toBe(26);
    });

    it("returns generic when membership insert fails", async () => {
      vi.mocked(createClient).mockResolvedValue(
        makeSupabase({
          membershipInsertError: { message: "DB error", code: "42000" },
        }) as unknown as SupabaseClient,
      );

      const result = await createGroup(
        { status: "idle" },
        fd({ name: "Test Group", year: "2025" }),
      );
      expect(result).toEqual(
        expect.objectContaining({ status: "error", error: "generic" }),
      );
    });

    it("redirects to group slug page on success with existing profile", async () => {
      vi.mocked(createClient).mockResolvedValue(
        makeSupabase({}) as unknown as SupabaseClient,
      );

      await expect(
        createGroup(
          { status: "idle" },
          fd({ name: "Test Group", year: "2025" }),
        ),
      ).rejects.toThrow("REDIRECT:/gruppen/test-group");
    });

    it("redirects to group slug page on success when creating profile inline", async () => {
      // profile=null triggers inline profile creation path
      vi.mocked(createClient).mockResolvedValue(
        makeSupabase({ profile: null }) as unknown as SupabaseClient,
      );

      await expect(
        createGroup(
          { status: "idle" },
          fd({
            name: "Test Group",
            year: "2025",
            firstName: "Max",
            lastName: "Muster",
          }),
        ),
      ).rejects.toThrow("REDIRECT:/gruppen/test-group");
    });
  });
});
