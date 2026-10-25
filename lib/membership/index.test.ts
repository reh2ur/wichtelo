import { describe, it, expect, vi } from "vitest";
import { removeMembership } from "./index";

type Admin = Parameters<typeof removeMembership>[0];

function adminWith(response: { data?: unknown; error?: { message: string } }) {
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: null, error: null, ...response });
  return { admin: { rpc } as unknown as Admin, rpc };
}

describe("removeMembership", () => {
  it("calls the RPC with strict defaults (no drawn removal, last admin enforced)", async () => {
    const { admin, rpc } = adminWith({ data: "ok" });
    expect(await removeMembership(admin, "g1", "m1")).toEqual({ result: "ok" });
    expect(rpc).toHaveBeenCalledWith("remove_membership", {
      p_group_id: "g1",
      p_membership_id: "m1",
      p_allow_drawn: false,
      p_enforce_last_admin: true,
    });
  });

  it("forwards allowDrawn / enforceLastAdmin overrides", async () => {
    const { admin, rpc } = adminWith({ data: "ok" });
    await removeMembership(admin, "g1", "m1", {
      allowDrawn: true,
      enforceLastAdmin: false,
    });
    expect(rpc).toHaveBeenCalledWith("remove_membership", {
      p_group_id: "g1",
      p_membership_id: "m1",
      p_allow_drawn: true,
      p_enforce_last_admin: false,
    });
  });

  it.each([
    "ok",
    "group_not_found",
    "member_not_found",
    "already_drawn",
    "last_admin",
  ])("passes the known result %s through", async (result) => {
    const { admin } = adminWith({ data: result });
    expect(await removeMembership(admin, "g1", "m1")).toEqual({ result });
  });

  it("maps a transport/DB error to error with the message as reason", async () => {
    const { admin } = adminWith({ error: { message: "connection reset" } });
    expect(await removeMembership(admin, "g1", "m1")).toEqual({
      result: "error",
      reason: "connection reset",
    });
  });

  it("prefers the error over data when both are present", async () => {
    const { admin } = adminWith({ data: "ok", error: { message: "boom" } });
    expect(await removeMembership(admin, "g1", "m1")).toEqual({
      result: "error",
      reason: "boom",
    });
  });

  it.each([
    ["an unknown string", "banana", "unexpected result: banana"],
    ["null", null, "unexpected result: null"],
    ["a non-string", 42, "unexpected result: 42"],
    ["an object", { result: "ok" }, "unexpected result: [object Object]"],
  ])("maps %s to error instead of trusting it", async (_l, data, reason) => {
    const { admin } = adminWith({ data });
    expect(await removeMembership(admin, "g1", "m1")).toEqual({
      result: "error",
      reason,
    });
  });
});
