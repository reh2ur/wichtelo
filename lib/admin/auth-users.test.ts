import { describe, it, expect, vi } from "vitest";
import { getAuthUsersById, listAllAuthUsers } from "./auth-users";
import { fetchAllRows } from "./paged";

type Admin = Parameters<typeof listAllAuthUsers>[0];

function adminWith(auth: Record<string, unknown>) {
  return { auth: { admin: auth } } as unknown as Admin;
}

const user = (id: string) => ({ id, email: `${id}@example.com` });

describe("listAllAuthUsers", () => {
  it("pages until a short page and returns every user", async () => {
    const full = Array.from({ length: 1000 }, (_, i) => user(`a${i}`));
    const listUsers = vi
      .fn()
      .mockResolvedValueOnce({ data: { users: full }, error: null })
      .mockResolvedValueOnce({ data: { users: [user("last")] }, error: null });
    const users = await listAllAuthUsers(adminWith({ listUsers }));
    expect(users).toHaveLength(1001);
    expect(listUsers).toHaveBeenCalledTimes(2);
  });

  it("does not stop silently after 20 pages", async () => {
    const full = Array.from({ length: 1000 }, (_, i) => user(`a${i}`));
    const listUsers = vi.fn(async ({ page }: { page: number }) => ({
      data: { users: page <= 25 ? full : [] },
      error: null,
    }));
    const users = await listAllAuthUsers(adminWith({ listUsers }));
    expect(users).toHaveLength(25_000);
  });

  it("throws on an API error instead of returning a partial list", async () => {
    const listUsers = vi
      .fn()
      .mockResolvedValueOnce({
        data: { users: Array.from({ length: 1000 }, (_, i) => user(`a${i}`)) },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(listAllAuthUsers(adminWith({ listUsers }))).rejects.toThrow(
      /boom/,
    );
  });
});

describe("getAuthUsersById", () => {
  it("looks each distinct id up once; 404 maps to null", async () => {
    const getUserById = vi.fn(async (id: string) =>
      id === "gone"
        ? { data: { user: null }, error: { status: 404, message: "nf" } }
        : { data: { user: user(id) }, error: null },
    );
    const map = await getAuthUsersById(adminWith({ getUserById }), [
      "a",
      "gone",
      "a",
    ]);
    expect(getUserById).toHaveBeenCalledTimes(2);
    expect(map.get("a")?.email).toBe("a@example.com");
    expect(map.get("gone")).toBeNull();
  });

  it("throws on non-404 errors", async () => {
    const getUserById = vi.fn().mockResolvedValue({
      data: { user: null },
      error: { status: 500, message: "down" },
    });
    await expect(
      getAuthUsersById(adminWith({ getUserById }), ["a"]),
    ).rejects.toThrow(/down/);
  });
});

describe("fetchAllRows", () => {
  it("walks range windows past the 1000-row PostgREST cap", async () => {
    const calls: [number, number][] = [];
    const rows = await fetchAllRows<number>("t", async (from, to) => {
      calls.push([from, to]);
      const n = from === 0 ? 1000 : 3;
      return {
        data: Array.from({ length: n }, (_, i) => from + i),
        error: null,
      };
    });
    expect(rows).toHaveLength(1003);
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("throws on error", async () => {
    await expect(
      fetchAllRows("t", async () => ({
        data: null,
        error: { message: "bad" },
      })),
    ).rejects.toThrow(/bad/);
  });
});
