import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ updateTag: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/logger", () => {
  const chain = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
  return { logger: { ...chain, withMetadata: vi.fn().mockReturnValue(chain) } };
});

import { updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { wishesTag } from "@/lib/cache-tags";
import {
  addWish,
  deleteWish,
  setWishStatus,
  updateWish,
  type WishActionState,
  type WishFormState,
} from "./actions";

const IDLE_FORM: WishFormState = { status: "idle" };
const IDLE: WishActionState = { status: "idle" };
const WISH_ID = "6f1b0a3e-9c1c-4d6a-8f55-1d3c2b7a9e10";
const GROUP_ID = "0a1b2c3d-1111-4222-8333-444455556666";

function fd(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

type DbResult = {
  data?: unknown;
  error?: { code?: string; message: string } | null;
};

/** Fake client: records the write payload + every `.eq()` filter. */
function setup(opts: { user?: { id: string } | null; result?: DbResult }) {
  const user = "user" in opts ? opts.user : { id: "u1" };
  const result = { data: [{ id: WISH_ID }], error: null, ...opts.result };
  const calls = {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    eq: [] as [string, unknown][],
  };
  const query = () => {
    const q = {
      eq: (col: string, val: unknown) => {
        calls.eq.push([col, val]);
        return q;
      },
      select: () => {
        const s = Promise.resolve(result) as Promise<DbResult> & {
          single: () => Promise<DbResult>;
        };
        s.single = () =>
          Promise.resolve({
            ...result,
            data: Array.isArray(result.data) ? result.data[0] : result.data,
          });
        return s;
      },
    };
    return q;
  };
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    from: vi.fn(() => ({
      insert: (v: unknown) => {
        calls.insert(v);
        return query();
      },
      update: (v: unknown) => {
        calls.update(v);
        return query();
      },
      delete: () => {
        calls.delete();
        return query();
      },
    })),
  } as never);
  return calls;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("addWish (quick-add)", () => {
  it("rejects an empty title without touching the DB", async () => {
    const calls = setup({});
    const state = await addWish(IDLE_FORM, fd({ title: "  " }));
    expect(state).toMatchObject({
      status: "error",
      error: "required",
      field: "title",
    });
    expect(calls.insert).not.toHaveBeenCalled();
  });

  it("rejects an over-long title", async () => {
    setup({});
    const state = await addWish(IDLE_FORM, fd({ title: "a".repeat(201) }));
    expect(state).toMatchObject({ error: "too_long", max: 200 });
  });

  it("inserts for the session user, expires tag, redirects to details step", async () => {
    const calls = setup({});
    await expect(addWish(IDLE_FORM, fd({ title: " Socken " }))).rejects.toThrow(
      `NEXT_REDIRECT:/wuensche?edit=${WISH_ID}`,
    );
    // profile_id comes from the session, never from form input.
    expect(calls.insert).toHaveBeenCalledWith({
      profile_id: "u1",
      title: "Socken",
    });
    expect(updateTag).toHaveBeenCalledWith(wishesTag("u1"));
  });

  it("ignores a forged profileId field", async () => {
    const calls = setup({});
    await expect(
      addWish(IDLE_FORM, fd({ title: "x", profileId: "victim" })),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(calls.insert).toHaveBeenCalledWith({ profile_id: "u1", title: "x" });
  });

  it("redirects anonymous callers to /anmelden", async () => {
    const calls = setup({ user: null });
    await expect(addWish(IDLE_FORM, fd({ title: "x" }))).rejects.toThrow(
      "NEXT_REDIRECT:/anmelden",
    );
    expect(calls.insert).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: "54000", message: "wish limit reached" }, "limit_reached"],
    [
      { code: "23503", message: 'violates "wishes_profile_id_fkey"' },
      "profile_required",
    ],
    [{ code: "XX000", message: "boom" }, "generic"],
  ])("maps DB error %j to %s", async (error, expected) => {
    setup({ result: { data: null, error } });
    const state = await addWish(IDLE_FORM, fd({ title: "x" }));
    expect(state).toMatchObject({ status: "error", error: expected });
    expect(updateTag).not.toHaveBeenCalled();
  });
});

describe("updateWish", () => {
  const valid = {
    id: WISH_ID,
    title: "Buch",
    url: "example.com/buch",
    price: "24,90",
    note: " Hardcover ",
    groupId: GROUP_ID,
  };

  it("validates input and echoes values", async () => {
    const calls = setup({});
    const state = await updateWish(
      IDLE_FORM,
      fd({ ...valid, url: "javascript:alert(1)" }),
    );
    expect(state).toMatchObject({
      status: "error",
      error: "invalid_url",
      field: "url",
      values: { title: "Buch", price: "24,90" },
    });
    expect(calls.update).not.toHaveBeenCalled();
  });

  it("rejects a bad price", async () => {
    setup({});
    const state = await updateWish(IDLE_FORM, fd({ ...valid, price: "viel" }));
    expect(state).toMatchObject({ error: "invalid_price", field: "price" });
  });

  it("updates normalised fields, scoped to id + owner, then redirects", async () => {
    const calls = setup({});
    await expect(updateWish(IDLE_FORM, fd(valid))).rejects.toThrow(
      "NEXT_REDIRECT:/wuensche",
    );
    expect(calls.update).toHaveBeenCalledWith({
      title: "Buch",
      url: "https://example.com/buch",
      note: "Hardcover",
      price_estimate: 24.9,
      group_id: GROUP_ID,
    });
    expect(calls.eq).toEqual([
      ["id", WISH_ID],
      ["profile_id", "u1"],
    ]);
    expect(updateTag).toHaveBeenCalledWith(wishesTag("u1"));
  });

  it("returns to the archive view when edited from there", async () => {
    setup({});
    await expect(
      updateWish(IDLE_FORM, fd({ ...valid, view: "archiv" })),
    ).rejects.toThrow("NEXT_REDIRECT:/wuensche?status=archiv");
  });

  it("clears optional fields to null", async () => {
    const calls = setup({});
    await expect(
      updateWish(IDLE_FORM, fd({ id: WISH_ID, title: "Nur Titel" })),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(calls.update).toHaveBeenCalledWith({
      title: "Nur Titel",
      url: null,
      note: null,
      price_estimate: null,
      group_id: null,
    });
  });

  it("not_found when no row matched (foreign or deleted wish)", async () => {
    setup({ result: { data: [] } });
    const state = await updateWish(IDLE_FORM, fd(valid));
    expect(state).toMatchObject({ status: "error", error: "not_found" });
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("maps the DB group-membership trigger to invalid_group", async () => {
    setup({
      result: {
        data: null,
        error: {
          code: "23514",
          message: "wish group must be a group of the owner",
        },
      },
    });
    const state = await updateWish(IDLE_FORM, fd(valid));
    expect(state).toMatchObject({ error: "invalid_group", field: "group" });
  });

  it("not_found for a malformed id", async () => {
    const calls = setup({});
    const state = await updateWish(IDLE_FORM, fd({ ...valid, id: "nope" }));
    expect(state).toMatchObject({ error: "not_found" });
    expect(calls.update).not.toHaveBeenCalled();
  });
});

describe("setWishStatus", () => {
  it("archives: status received + received_at set", async () => {
    const calls = setup({});
    const state = await setWishStatus(
      IDLE,
      fd({ id: WISH_ID, to: "received" }),
    );
    expect(state).toEqual({ status: "idle" });
    const payload = calls.update.mock.calls[0][0];
    expect(payload.status).toBe("received");
    expect(new Date(payload.received_at).getTime()).not.toBeNaN();
    expect(calls.eq).toContainEqual(["profile_id", "u1"]);
    expect(updateTag).toHaveBeenCalledWith(wishesTag("u1"));
  });

  it("reopens: status open + received_at cleared", async () => {
    const calls = setup({});
    await setWishStatus(IDLE, fd({ id: WISH_ID, to: "open" }));
    expect(calls.update).toHaveBeenCalledWith({
      status: "open",
      received_at: null,
    });
  });

  it("rejects unknown target status", async () => {
    const calls = setup({});
    const state = await setWishStatus(IDLE, fd({ id: WISH_ID, to: "gone" }));
    expect(state).toEqual({ status: "error", error: "not_found" });
    expect(calls.update).not.toHaveBeenCalled();
  });

  it("not_found when no row matched", async () => {
    setup({ result: { data: [] } });
    const state = await setWishStatus(
      IDLE,
      fd({ id: WISH_ID, to: "received" }),
    );
    expect(state).toEqual({ status: "error", error: "not_found" });
  });

  it("generic on DB error", async () => {
    setup({ result: { data: null, error: { message: "db down" } } });
    const state = await setWishStatus(
      IDLE,
      fd({ id: WISH_ID, to: "received" }),
    );
    expect(state).toEqual({ status: "error", error: "generic" });
  });
});

describe("deleteWish", () => {
  it("deletes scoped to id + owner and expires tag", async () => {
    const calls = setup({});
    const state = await deleteWish(IDLE, fd({ id: WISH_ID }));
    expect(state).toEqual({ status: "idle" });
    expect(calls.delete).toHaveBeenCalled();
    expect(calls.eq).toEqual([
      ["id", WISH_ID],
      ["profile_id", "u1"],
    ]);
    expect(updateTag).toHaveBeenCalledWith(wishesTag("u1"));
  });

  it("not_found when nothing was deleted", async () => {
    setup({ result: { data: [] } });
    expect(await deleteWish(IDLE, fd({ id: WISH_ID }))).toEqual({
      status: "error",
      error: "not_found",
    });
  });

  it("rejects a malformed id", async () => {
    const calls = setup({});
    expect(await deleteWish(IDLE, fd({ id: "x" }))).toEqual({
      status: "error",
      error: "not_found",
    });
    expect(calls.delete).not.toHaveBeenCalled();
  });
});
