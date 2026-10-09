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
  rpcError?: object | null;
  profileInsertError?: object | null;
}) {
  const {
    user = { id: "user-1" },
    profile = { id: "user-1", first_name: "Max", last_name: "Muster" },
    rpcError = null,
    profileInsertError = null,
  } = overrides;

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
    },
    rpc: vi.fn((_fn: string, args: { p_slugs: string[] }) => ({
      single: vi.fn().mockResolvedValue(
        rpcError
          ? { data: null, error: rpcError }
          : {
              data: {
                group_id: "group-1",
                slug: args.p_slugs[0],
                invite_token: "tok",
              },
              error: null,
            },
      ),
    })),
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
    it("returns generic when the create_group RPC fails", async () => {
      vi.mocked(createClient).mockResolvedValue(
        makeSupabase({
          rpcError: { message: "DB error", code: "42000" },
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

    it("passes up to 30 slug candidates for the RPC to retry over", async () => {
      const supabase = makeSupabase({});
      vi.mocked(createClient).mockResolvedValue(
        supabase as unknown as SupabaseClient,
      );

      await expect(
        createGroup({ status: "idle" }, fd({ name: "Familie", year: "2025" })),
      ).rejects.toThrow("REDIRECT:/gruppen/familie");
      const [fn, args] = supabase.rpc.mock.calls[0];
      expect(fn).toBe("create_group");
      expect(args.p_slugs).toHaveLength(30);
      expect(args.p_slugs.slice(0, 3)).toEqual([
        "familie",
        "familie-2",
        "familie-3",
      ]);
      expect(args.p_slugs[29]).toMatch(/^familie-[a-z0-9]{4}$/);
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
