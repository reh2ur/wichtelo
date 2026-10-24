import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/logger", () => {
  const chain = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
  return { logger: { ...chain, withMetadata: vi.fn().mockReturnValue(chain) } };
});

import {
  fetchDrawMailWarning,
  recordDrawMailResult,
  warningForDraw,
} from "./draw-mail-status";

describe("warningForDraw", () => {
  it("returns counts when the row belongs to the current draw", () => {
    expect(warningForDraw({ draw_version: 2, failed: 1, total: 3 }, 2)).toEqual(
      { failed: 1, total: 3 },
    );
  });

  it("ignores a row left over from an earlier draw (re-draw resets)", () => {
    expect(warningForDraw({ draw_version: 1, failed: 1, total: 3 }, 2)).toBe(
      null,
    );
  });

  it("returns null without a row or group version", () => {
    expect(warningForDraw(null, 1)).toBe(null);
    expect(warningForDraw(undefined, 1)).toBe(null);
    expect(warningForDraw({ draw_version: 1, failed: 1, total: 3 }, null)).toBe(
      null,
    );
  });

  it("returns null when nothing failed", () => {
    expect(warningForDraw({ draw_version: 1, failed: 0, total: 3 }, 1)).toBe(
      null,
    );
  });
});

describe("recordDrawMailResult", () => {
  it("calls the RPC with the post-draw version and counts", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    await recordDrawMailResult({ rpc } as never, "g1", 2, 1, 3);
    expect(rpc).toHaveBeenCalledWith("record_draw_mail_result", {
      p_group_id: "g1",
      p_draw_version: 2,
      p_failed: 1,
      p_total: 3,
    });
  });

  it("ignores an empty send (total 0) so it cannot clear a stored warning", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    await recordDrawMailResult({ rpc } as never, "g1", 2, 0, 0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("swallows RPC errors (mails are already sent)", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(
      recordDrawMailResult({ rpc } as never, "g1", 1, 1, 3),
    ).resolves.toBeUndefined();
  });

  it("swallows thrown network errors", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("network"));
    await expect(
      recordDrawMailResult({ rpc } as never, "g1", 1, 1, 3),
    ).resolves.toBeUndefined();
  });
});

describe("fetchDrawMailWarning", () => {
  function client(row: unknown, group: unknown) {
    return {
      from: vi.fn((table: string) => {
        const q: Record<string, unknown> = {};
        q.select = vi.fn(() => q);
        q.eq = vi.fn(() => q);
        q.maybeSingle = vi.fn().mockResolvedValue({
          data: table === "groups" ? group : row,
          error: null,
        });
        return q;
      }),
    } as never;
  }

  it("matches the stored row against the group's current draw_version", async () => {
    const row = { draw_version: 2, failed: 2, total: 5 };
    expect(
      await fetchDrawMailWarning(client(row, { draw_version: 2 }), "g1"),
    ).toEqual({ failed: 2, total: 5 });
    expect(
      await fetchDrawMailWarning(client(row, { draw_version: 3 }), "g1"),
    ).toBe(null);
  });

  it("returns null when RLS hides the row (non-admin)", async () => {
    expect(
      await fetchDrawMailWarning(client(null, { draw_version: 2 }), "g1"),
    ).toBe(null);
  });
});
