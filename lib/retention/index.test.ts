import { describe, it, expect, vi, beforeEach } from "vitest";

const listAllAuthUsers = vi.fn();
vi.mock("@/lib/admin/auth-users", () => ({
  listAllAuthUsers: (...a: unknown[]) => listAllAuthUsers(...a),
}));
const fetchAllRows = vi.fn();
vi.mock("@/lib/admin/paged", () => ({
  fetchAllRows: (...a: unknown[]) => fetchAllRows(...a),
}));
const deleteAccount = vi.fn();
const findSoleAdminGroups = vi.fn();
vi.mock("@/lib/account", () => ({
  deleteAccount: (...a: unknown[]) => deleteAccount(...a),
  findSoleAdminGroups: (...a: unknown[]) => findSoleAdminGroups(...a),
}));
const notifyAccountDeleted = vi.fn();
vi.mock("@/lib/account/notify", () => ({
  notifyAccountDeleted: (...a: unknown[]) => notifyAccountDeleted(...a),
}));
const notify = vi.fn();
vi.mock("@/lib/notification", () => ({
  notify: (...a: unknown[]) => notify(...a),
}));
const reportError = vi.fn();
vi.mock("@/lib/report-error", () => ({
  reportError: (...a: unknown[]) => reportError(...a),
}));
vi.mock("@/lib/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { logger: { withMetadata: () => l } };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { runRetention, MAX_ACCOUNT_DELETIONS_PER_RUN } from "./index";

const NOW = new Date("2026-10-30T00:00:00Z");
const OLD = "2023-01-01T00:00:00Z";

interface FakeOpts {
  groupDeleteError?: boolean;
  auditError?: boolean;
}

function fakeAdmin(opts: FakeOpts = {}) {
  const groupDelete = vi.fn();
  const auditDelete = vi.fn();
  const updateUserById = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn((table: string) => {
    if (table === "groups") {
      return {
        delete: () => ({
          in: (_c: string, ids: string[]) => ({
            lte: async (_col: string, year: number) => {
              groupDelete(ids, year);
              return opts.groupDeleteError
                ? { error: { message: "boom" }, count: null }
                : { error: null, count: ids.length };
            },
          }),
        }),
      };
    }
    if (table === "admin_audit_log") {
      return {
        delete: () => ({
          lt: async (_c: string, cutoff: string) => {
            auditDelete(cutoff);
            return opts.auditError
              ? { error: { message: "boom" }, count: null }
              : { error: null, count: 3 };
          },
        }),
      };
    }
    // profiles
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { first_name: "Max", last_name: "Muster" },
            error: null,
          }),
        }),
      }),
    };
  });
  const admin = { from, auth: { admin: { updateUserById } } };
  return {
    admin: admin as unknown as Parameters<typeof runRetention>[1],
    groupDelete,
    auditDelete,
    updateUserById,
  };
}

const user = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  email: `${id}@example.com`,
  created_at: OLD,
  last_sign_in_at: OLD,
  app_metadata: {},
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  listAllAuthUsers.mockResolvedValue([]);
  findSoleAdminGroups.mockResolvedValue([]);
  deleteAccount.mockResolvedValue({
    affectedDrawnGroups: [],
    affectedOpenGroups: [],
    affectedSlugs: [],
    nullifiedMembershipCount: 0,
  });
  notify.mockResolvedValue({ sent: 1, failed: 0 });
  fetchAllRows.mockImplementation(async (label: string) =>
    label === "retention groups" ? [{ id: "g1" }, { id: "g2" }] : [],
  );
});

describe("runRetention - groups + audit log", () => {
  it("deletes groups up to the expired year and old audit rows", async () => {
    const { admin, groupDelete, auditDelete } = fakeAdmin();
    const report = await runRetention(NOW, admin);

    expect(groupDelete).toHaveBeenCalledWith(["g1", "g2"], 2025);
    expect(auditDelete).toHaveBeenCalledWith("2025-10-30T00:00:00.000Z");
    expect(report).toMatchObject({
      groupsDeleted: 2,
      auditRowsDeleted: 3,
      failures: [],
    });
  });

  it("a failing group delete is reported, other steps still run", async () => {
    const { admin, auditDelete } = fakeAdmin({ groupDeleteError: true });
    const report = await runRetention(NOW, admin);

    expect(report.failures).toEqual(["groups"]);
    expect(auditDelete).toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith(
      "retention.step_failed",
      expect.anything(),
      { step: "groups" },
    );
  });

  it("a failing group read deletes nothing (fail closed)", async () => {
    fetchAllRows.mockRejectedValue(new Error("read failed"));
    const { admin, groupDelete } = fakeAdmin();
    const report = await runRetention(NOW, admin);

    expect(groupDelete).not.toHaveBeenCalled();
    expect(report.failures).toContain("groups");
  });
});

describe("runRetention - inactive accounts", () => {
  it("warns an inactive account, stamps it only after the mail went out", async () => {
    listAllAuthUsers.mockResolvedValue([user("u1")]);
    const { admin, updateUserById } = fakeAdmin();
    const report = await runRetention(NOW, admin);

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "account.inactivity_warning",
        to: "u1@example.com",
        name: "Max Muster",
        deletionDate: "29. November 2026",
      }),
    );
    expect(updateUserById).toHaveBeenCalledWith("u1", {
      app_metadata: { inactivity_warned_at: NOW.toISOString() },
    });
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(report.accountsWarned).toBe(1);
  });

  it("does not stamp (so never deletes) when the warning mail failed", async () => {
    listAllAuthUsers.mockResolvedValue([user("u1")]);
    notify.mockResolvedValue({ sent: 0, failed: 1 });
    const { admin, updateUserById } = fakeAdmin();
    const report = await runRetention(NOW, admin);

    expect(updateUserById).not.toHaveBeenCalled();
    expect(report.accountsWarned).toBe(0);
    expect(report.failures).toEqual(["account.warn"]);
  });

  it("deletes a warned account after the grace period and notifies", async () => {
    listAllAuthUsers.mockResolvedValue([
      user("u1", {
        app_metadata: { inactivity_warned_at: "2026-09-29T00:00:00Z" },
      }),
    ]);
    const { admin } = fakeAdmin();
    const report = await runRetention(NOW, admin);

    expect(deleteAccount).toHaveBeenCalledWith("u1");
    expect(notifyAccountDeleted).toHaveBeenCalledWith(
      expect.anything(),
      "u1@example.com",
      "Max Muster",
    );
    expect(report.accountsDeleted).toBe(1);
  });

  it("never deletes an unwarned account, and keeps recent joiners", async () => {
    listAllAuthUsers.mockResolvedValue([user("u1"), user("u2")]);
    fetchAllRows.mockImplementation(async (label: string) =>
      label === "retention memberships"
        ? [{ id: "m", profile_id: "u2", joined_at: "2026-05-01T00:00:00Z" }]
        : [],
    );
    const { admin } = fakeAdmin();
    await runRetention(NOW, admin);

    expect(deleteAccount).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1); // only u1 warned
  });

  it("skips the super-admin", async () => {
    vi.stubEnv("SUPER_ADMIN_EMAIL", "u1@example.com");
    listAllAuthUsers.mockResolvedValue([user("u1")]);
    const { admin } = fakeAdmin();
    await runRetention(NOW, admin);
    vi.unstubAllEnvs();

    expect(notify).not.toHaveBeenCalled();
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("skips sole admins of other members' groups", async () => {
    listAllAuthUsers.mockResolvedValue([
      user("u1", {
        app_metadata: { inactivity_warned_at: "2026-09-29T00:00:00Z" },
      }),
    ]);
    findSoleAdminGroups.mockResolvedValue([{ id: "g" }]);
    const { admin } = fakeAdmin();
    const report = await runRetention(NOW, admin);

    expect(deleteAccount).not.toHaveBeenCalled();
    expect(report.failures).toEqual([]);
  });

  it("one failing deletion is reported and does not stop the next user", async () => {
    const warned = { inactivity_warned_at: "2026-09-29T00:00:00Z" };
    listAllAuthUsers.mockResolvedValue([
      user("u1", { app_metadata: warned }),
      user("u2", { app_metadata: warned }),
    ]);
    deleteAccount.mockRejectedValueOnce(new Error("db down"));
    const { admin } = fakeAdmin();
    const report = await runRetention(NOW, admin);

    expect(deleteAccount).toHaveBeenCalledTimes(2);
    expect(report.accountsDeleted).toBe(1);
    expect(report.failures).toEqual(["account.delete"]);
  });

  it("a failing user listing deletes nothing (fail closed)", async () => {
    listAllAuthUsers.mockRejectedValue(new Error("auth api down"));
    const { admin } = fakeAdmin();
    const report = await runRetention(NOW, admin);

    expect(deleteAccount).not.toHaveBeenCalled();
    expect(report.failures).toEqual(["inactive_accounts"]);
  });

  it("caps deletions per run", async () => {
    const warned = { inactivity_warned_at: "2026-09-29T00:00:00Z" };
    listAllAuthUsers.mockResolvedValue(
      Array.from({ length: MAX_ACCOUNT_DELETIONS_PER_RUN + 5 }, (_, i) =>
        user(`u${i}`, { app_metadata: warned }),
      ),
    );
    const { admin } = fakeAdmin();
    await runRetention(NOW, admin);
    expect(deleteAccount).toHaveBeenCalledTimes(MAX_ACCOUNT_DELETIONS_PER_RUN);
  });
});
