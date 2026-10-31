import { describe, it, expect, vi } from "vitest";

const { after } = vi.hoisted(() => ({ after: vi.fn() }));
vi.mock("next/server", () => ({ after }));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn() }));

import { deferNotice } from "./defer";
import { reportError } from "@/lib/report-error";

describe("deferNotice", () => {
  it("schedules via after() without running the task inline", () => {
    const task = vi.fn().mockResolvedValue(undefined);
    deferNotice(task);
    expect(after).toHaveBeenCalledTimes(1);
    expect(task).not.toHaveBeenCalled();
  });

  it("reports (does not throw) when the deferred task fails", async () => {
    after.mockImplementationOnce((fn: () => Promise<void>) => fn());
    deferNotice(() => Promise.reject(new Error("smtp")));
    await Promise.resolve();
    await Promise.resolve();
    expect(reportError).toHaveBeenCalled();
  });

  it("falls back to running immediately outside a request scope", async () => {
    after.mockImplementationOnce(() => {
      throw new Error("outside request scope");
    });
    const task = vi.fn().mockResolvedValue(undefined);
    deferNotice(task);
    await Promise.resolve();
    expect(task).toHaveBeenCalled();
  });
});
