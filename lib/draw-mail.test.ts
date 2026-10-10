import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: {
    withMetadata: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
  },
}));

import {
  buildDrawAssignmentRecipients,
  postDrawVersion,
  resendEventType,
  type MembershipRow,
} from "./draw-mail";

function member(
  id: string,
  profile: string | null,
  first = id,
  last = "X",
): MembershipRow {
  return {
    id,
    role: "participant",
    profile_id: profile,
    name_snapshot: `${first} ${last}`,
    first_name_snapshot: first,
    last_name_snapshot: last,
  };
}

function fakeAdmin(
  emails: Record<string, string | null | "error">,
): Parameters<typeof buildDrawAssignmentRecipients>[0] {
  return {
    from: () => ({
      select: () => ({
        in: async (_c: string, ids: string[]) => ({
          data: ids.map((id) => ({
            id,
            first_name: id.toUpperCase(),
            last_name: "X",
          })),
        }),
      }),
    }),
    auth: {
      admin: {
        getUserById: async (id: string) => {
          const e = emails[id];
          if (e === "error") {
            return { data: { user: null }, error: { message: "boom" } };
          }
          return {
            data: { user: e ? { email: e } : { email: undefined } },
            error: null,
          };
        },
      },
    },
  } as unknown as Parameters<typeof buildDrawAssignmentRecipients>[0];
}

describe("draw mail keys", () => {
  it("resend key (post-draw version) equals original trigger key", () => {
    // trigger reads expected version 0, resend later reads stored version 1.
    expect(String(postDrawVersion(0))).toBe(String(1));
    // re-draw reads 1, resend reads 2.
    expect(String(postDrawVersion(1))).toBe(String(2));
  });

  it("resend uses redrawn template once version exceeds 1", () => {
    expect(resendEventType(1)).toBe("draw.completed");
    expect(resendEventType(2)).toBe("draw.redrawn");
    expect(resendEventType(5)).toBe("draw.redrawn");
  });
});

describe("buildDrawAssignmentRecipients", () => {
  const members = [member("a", "a"), member("b", "b"), member("c", "c")];
  const assignment = new Map([
    ["a", "b"],
    ["b", "c"],
    ["c", "a"],
  ]);

  it("returns every recipient with nothing skipped", async () => {
    const r = await buildDrawAssignmentRecipients(
      fakeAdmin({ a: "a@x", b: "b@x", c: "c@x" }),
      members,
      assignment,
    );
    expect(r.skipped).toBe(0);
    expect(r.recipients.map((x) => x.to)).toEqual(["a@x", "b@x", "c@x"]);
  });

  it("counts a failed user lookup as skipped (failed), not silently dropped", async () => {
    const r = await buildDrawAssignmentRecipients(
      fakeAdmin({ a: "a@x", b: "error", c: null }),
      members,
      assignment,
    );
    expect(r.recipients.map((x) => x.to)).toEqual(["a@x"]);
    expect(r.skipped).toBe(2);
  });

  it("does not count ghost givers (deleted account) as failures", async () => {
    const withGhost = [member("a", "a"), member("b", null), member("c", "c")];
    const r = await buildDrawAssignmentRecipients(
      fakeAdmin({ a: "a@x", c: "c@x" }),
      withGhost,
      assignment,
    );
    expect(r.skipped).toBe(0);
    expect(r.recipients).toHaveLength(2);
  });
});
