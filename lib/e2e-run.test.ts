import { describe, it, expect } from "vitest";
import {
  STALE_E2E_USER_MS,
  e2eEmailPrefix,
  e2eFreshEmail,
  e2eWorkerEmail,
  isValidRunId,
  resolveRunId,
  selectCleanupUsers,
} from "./e2e-run";

describe("resolveRunId", () => {
  it("uses GITHUB_RUN_ID and attempt in CI", () => {
    expect(
      resolveRunId({ GITHUB_RUN_ID: "123456", GITHUB_RUN_ATTEMPT: "2" }),
    ).toBe("123456a2");
  });

  it("defaults the attempt to 1", () => {
    expect(resolveRunId({ GITHUB_RUN_ID: "99" })).toBe("99a1");
  });

  it("prefers a valid explicit E2E_RUN_ID", () => {
    expect(resolveRunId({ E2E_RUN_ID: "Mine42", GITHUB_RUN_ID: "1" })).toBe(
      "mine42",
    );
  });

  it("ignores an invalid explicit id", () => {
    expect(resolveRunId({ E2E_RUN_ID: "a b/c", GITHUB_RUN_ID: "7" })).toBe(
      "7a1",
    );
  });

  it("falls back to a random id locally", () => {
    expect(resolveRunId({}, () => "deadbeef")).toBe("deadbeef");
    expect(isValidRunId(resolveRunId({}))).toBe(true);
  });

  it("gives different local runs different ids", () => {
    expect(resolveRunId({})).not.toBe(resolveRunId({}));
  });
});

describe("e2e emails", () => {
  it("scopes worker and fresh emails to the run and keeps workers distinct", () => {
    const a = e2eWorkerEmail("run1", 0);
    const b = e2eWorkerEmail("run1", 1);
    const other = e2eWorkerEmail("run2", 0);
    expect(new Set([a, b, other]).size).toBe(3);
    for (const email of [a, b, e2eFreshEmail("run1", "x")]) {
      expect(email.startsWith(e2eEmailPrefix("run1"))).toBe(true);
    }
    expect(other.startsWith(e2eEmailPrefix("run1"))).toBe(false);
  });

  it("does not let one run id prefix another", () => {
    expect(e2eWorkerEmail("123", 0).startsWith(e2eEmailPrefix("12"))).toBe(
      false,
    );
  });
});

describe("selectCleanupUsers", () => {
  const now = Date.parse("2026-10-24T12:00:00Z");
  const fresh = new Date(now - 60_000).toISOString();
  const stale = new Date(now - STALE_E2E_USER_MS - 60_000).toISOString();

  const users = [
    { email: e2eWorkerEmail("mine", 0), created_at: fresh },
    { email: e2eFreshEmail("mine", "a"), created_at: fresh },
    { email: e2eWorkerEmail("theirs", 0), created_at: fresh },
    { email: "e2e+legacy@example.com", created_at: fresh },
    { email: "e2e+old@example.com", created_at: stale },
    { email: e2eWorkerEmail("theirs", 1), created_at: stale },
    { email: "real@example.com", created_at: stale },
    { email: null, created_at: stale },
  ];

  it("deletes own run plus stale e2e users only", () => {
    const picked = selectCleanupUsers(users, { runId: "mine", now }).map(
      (u) => u.email,
    );
    expect(picked).toEqual([
      e2eWorkerEmail("mine", 0),
      e2eFreshEmail("mine", "a"),
      "e2e+old@example.com",
      e2eWorkerEmail("theirs", 1),
    ]);
  });

  it("never touches a concurrent run's fresh users", () => {
    const picked = selectCleanupUsers(users, { runId: "mine", now }).map(
      (u) => u.email,
    );
    expect(picked).not.toContain(e2eWorkerEmail("theirs", 0));
    expect(picked).not.toContain("e2e+legacy@example.com");
  });

  it("without a valid run id only sweeps stale users", () => {
    for (const runId of [undefined, null, "", "bad id"]) {
      const picked = selectCleanupUsers(users, { runId, now }).map(
        (u) => u.email,
      );
      expect(picked).toEqual([
        "e2e+old@example.com",
        e2eWorkerEmail("theirs", 1),
      ]);
    }
  });
});
