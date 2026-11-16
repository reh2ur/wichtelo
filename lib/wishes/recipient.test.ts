import { describe, it, expect, vi } from "vitest";
import { hostOf, loadRecipientWishes } from "./index";

function client(result: unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "order"]) q[m] = vi.fn(() => q);
  q.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);
  return { client: { from: vi.fn(() => q) } as never, q };
}

describe("loadRecipientWishes (#209)", () => {
  it("throws on DB error — never an empty list", async () => {
    const { client: c } = client({ data: null, error: { message: "db down" } });
    await expect(loadRecipientWishes(c, "g1", "u1")).rejects.toThrow("db down");
  });

  it("filters to open wishes of the group, excluding the viewer's own", async () => {
    const rows = [
      { id: "w1", title: "A", url: null, note: null, price_estimate: null },
    ];
    const { client: c, q } = client({ data: rows, error: null });
    await expect(loadRecipientWishes(c, "g1", "u1")).resolves.toEqual(rows);
    expect(q.eq).toHaveBeenCalledWith("group_id", "g1");
    expect(q.eq).toHaveBeenCalledWith("status", "open");
    expect(q.neq).toHaveBeenCalledWith("profile_id", "u1");
  });

  it("selects only the fields the giver may see", async () => {
    const { client: c, q } = client({ data: [], error: null });
    await loadRecipientWishes(c, "g1", "u1");
    expect(q.select).toHaveBeenCalledWith(
      "id, title, url, note, price_estimate",
    );
  });
});

describe("hostOf", () => {
  it("strips www and falls back to the raw string", () => {
    expect(hostOf("https://www.example.com/x")).toBe("example.com");
    expect(hostOf("not a url")).toBe("not a url");
  });
});
