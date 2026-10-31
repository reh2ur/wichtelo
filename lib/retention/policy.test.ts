import { describe, it, expect } from "vitest";
import {
  auditLogCutoff,
  deletionDateAfterWarning,
  inactiveDeleteCutoff,
  inactiveWarnCutoff,
  maxExpiredGroupYear,
  planInactiveAccount,
} from "./policy";

const d = (iso: string) => new Date(iso);

describe("maxExpiredGroupYear", () => {
  it("keeps last year's groups until 1 July (31 Dec + 6 months)", () => {
    expect(maxExpiredGroupYear(d("2027-06-30T23:59:59Z"))).toBe(2025);
    expect(maxExpiredGroupYear(d("2027-07-01T00:00:00Z"))).toBe(2026);
  });

  it("never expires the current year's groups", () => {
    expect(maxExpiredGroupYear(d("2026-12-31T23:59:59Z"))).toBe(2025);
    expect(maxExpiredGroupYear(d("2027-01-01T00:00:00Z"))).toBe(2025);
  });

  it("handles year boundaries", () => {
    expect(maxExpiredGroupYear(d("2026-10-30T00:00:00Z"))).toBe(2025);
    expect(maxExpiredGroupYear(d("2026-07-01T00:00:00Z"))).toBe(2025);
    expect(maxExpiredGroupYear(d("2026-06-30T00:00:00Z"))).toBe(2024);
  });
});

describe("cutoffs", () => {
  it("audit log: 12 months", () => {
    expect(auditLogCutoff(d("2026-10-30T12:00:00Z")).toISOString()).toBe(
      "2025-10-30T12:00:00.000Z",
    );
  });

  it("clamps month-end days (29 Feb)", () => {
    expect(auditLogCutoff(d("2028-02-29T00:00:00Z")).toISOString()).toBe(
      "2027-02-28T00:00:00.000Z",
    );
  });

  it("inactive: delete after 3y, warn 30d earlier", () => {
    const now = d("2026-10-30T00:00:00Z");
    expect(inactiveDeleteCutoff(now).toISOString()).toBe(
      "2023-10-30T00:00:00.000Z",
    );
    expect(inactiveWarnCutoff(now).toISOString()).toBe(
      "2023-11-29T00:00:00.000Z",
    );
  });

  it("deletion date = warning + 30d", () => {
    expect(
      deletionDateAfterWarning(d("2026-01-01T00:00:00Z")).toISOString(),
    ).toBe("2026-01-31T00:00:00.000Z");
  });
});

describe("planInactiveAccount", () => {
  const now = d("2026-10-30T00:00:00Z");
  const old = "2023-01-01T00:00:00Z"; // > 3y ago
  const nearly = "2023-11-15T00:00:00Z"; // inside warn window, < 3y

  it("keeps recently active accounts", () => {
    expect(
      planInactiveAccount(
        { createdAt: old, lastSignInAt: "2026-01-01T00:00:00Z" },
        now,
      ),
    ).toBe("keep");
  });

  it("uses created_at when never signed in", () => {
    expect(
      planInactiveAccount({ createdAt: old, lastSignInAt: null }, now),
    ).toBe("warn");
    expect(
      planInactiveAccount(
        { createdAt: "2026-09-01T00:00:00Z", lastSignInAt: null },
        now,
      ),
    ).toBe("keep");
  });

  it("recent group join counts as activity", () => {
    expect(
      planInactiveAccount(
        {
          createdAt: old,
          lastSignInAt: old,
          lastJoinedAt: "2026-02-01T00:00:00Z",
        },
        now,
      ),
    ).toBe("keep");
  });

  it("warns inside the 30-day window before 3 years", () => {
    expect(
      planInactiveAccount({ createdAt: nearly, lastSignInAt: nearly }, now),
    ).toBe("warn");
  });

  it("never deletes without a warning", () => {
    expect(
      planInactiveAccount({ createdAt: old, lastSignInAt: old }, now),
    ).toBe("warn");
  });

  it("does not delete before the 30-day grace passed", () => {
    expect(
      planInactiveAccount(
        {
          createdAt: old,
          lastSignInAt: old,
          warnedAt: "2026-10-15T00:00:00Z",
        },
        now,
      ),
    ).toBe("keep");
  });

  it("deletes after warning + 30 days when still inactive", () => {
    expect(
      planInactiveAccount(
        {
          createdAt: old,
          lastSignInAt: old,
          warnedAt: "2026-09-30T00:00:00Z",
        },
        now,
      ),
    ).toBe("delete");
  });

  it("does not delete while still inside 3y even if warned long ago", () => {
    expect(
      planInactiveAccount(
        {
          createdAt: nearly,
          lastSignInAt: nearly,
          warnedAt: "2026-10-01T00:00:00Z",
        },
        now,
      ),
    ).toBe("keep");
  });

  it("ignores a stale warning older than the last activity", () => {
    expect(
      planInactiveAccount(
        {
          createdAt: old,
          lastSignInAt: "2023-06-01T00:00:00Z",
          warnedAt: "2023-03-01T00:00:00Z",
        },
        now,
      ),
    ).toBe("warn");
  });

  it("keeps on unparseable dates (fail safe)", () => {
    expect(
      planInactiveAccount({ createdAt: "garbage", lastSignInAt: null }, now),
    ).toBe("keep");
  });
});
