import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isSimulatedResendThrottle,
  isTestBackdoorEnabled,
} from "./test-backdoor";

const LIVE_REF = "liveprojectref";
const PROD_URL = `https://${LIVE_REF}.supabase.co`;
const STAGING_URL = "https://stagingprojectref.supabase.co";

function req(secret?: string) {
  return new Headers(secret ? { "x-e2e-secret": secret } : {});
}

describe("isTestBackdoorEnabled", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env.E2E_TEST_MODE = "1";
    process.env.E2E_TEST_SECRET = "s3cret";
    process.env.NEXT_PUBLIC_SUPABASE_URL = STAGING_URL;
    process.env.SUPABASE_PROJECT_REF_LIVE = LIVE_REF;
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it("allows when flag, non-prod project and matching secret", () => {
    expect(isTestBackdoorEnabled(req("s3cret"))).toBe(true);
  });

  it("denies when flag unset", () => {
    delete process.env.E2E_TEST_MODE;
    expect(isTestBackdoorEnabled(req("s3cret"))).toBe(false);
  });

  it("denies when flag is not exactly 1", () => {
    process.env.E2E_TEST_MODE = "true";
    expect(isTestBackdoorEnabled(req("s3cret"))).toBe(false);
  });

  it("denies on a Vercel Production deploy even without a configured ref", () => {
    delete process.env.SUPABASE_PROJECT_REF_LIVE;
    process.env.VERCEL_ENV = "production";
    expect(isTestBackdoorEnabled(req("s3cret"))).toBe(false);
  });

  it("denies on a production deploy (NODE_ENV=production, no preview)", () => {
    const env = process.env as Record<string, string | undefined>;
    env.NODE_ENV = "production";
    delete env.VERCEL_ENV;
    expect(isTestBackdoorEnabled(req("s3cret"))).toBe(false);
    env.VERCEL_ENV = "preview";
    expect(isTestBackdoorEnabled(req("s3cret"))).toBe(true);
  });

  it("denies for the prod project even with correct secret", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = PROD_URL;
    expect(isTestBackdoorEnabled(req("s3cret"))).toBe(false);
  });

  it("denies on missing or wrong secret", () => {
    expect(isTestBackdoorEnabled(req())).toBe(false);
    expect(isTestBackdoorEnabled(req("wrong!"))).toBe(false);
    expect(isTestBackdoorEnabled(req("s3cret-longer"))).toBe(false);
  });

  it("denies when server secret is unset or empty", () => {
    delete process.env.E2E_TEST_SECRET;
    expect(isTestBackdoorEnabled(req("anything"))).toBe(false);
    process.env.E2E_TEST_SECRET = "";
    expect(isTestBackdoorEnabled(req(""))).toBe(false);
  });
});

describe("isSimulatedResendThrottle", () => {
  function form(fields: Record<string, string>) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  }

  it("only triggers for a resend by a throttled-* address", () => {
    const yes = form({ resend: "1" });
    expect(isSimulatedResendThrottle("throttled-a@example.com", yes)).toBe(
      true,
    );
    expect(isSimulatedResendThrottle("Throttled-A@example.com", yes)).toBe(
      true,
    );
    expect(isSimulatedResendThrottle("a@example.com", yes)).toBe(false);
    expect(isSimulatedResendThrottle("throttled-a@example.com", form({}))).toBe(
      false,
    );
  });
});
