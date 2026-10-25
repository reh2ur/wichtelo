import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ResendCtor = vi.hoisted(() => vi.fn());
const info = vi.hoisted(() => vi.fn());

vi.mock("resend", () => ({
  Resend: class {
    constructor(apiKey?: string) {
      ResendCtor(apiKey);
    }
    marker = "real-client";
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: {
    withMetadata: vi.fn(() => ({ info, error: vi.fn(), warn: vi.fn() })),
  },
}));

// The client is chosen at module load, so every case re-imports the module.
async function load(env: {
  NODE_ENV: string;
  VERCEL_ENV?: string;
  RESEND_FROM_EMAIL?: string;
}) {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", env.NODE_ENV);
  vi.stubEnv("VERCEL_ENV", env.VERCEL_ENV ?? "");
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  if (env.RESEND_FROM_EMAIL === undefined) {
    vi.stubEnv("RESEND_FROM_EMAIL", "");
    delete process.env.RESEND_FROM_EMAIL;
  } else {
    vi.stubEnv("RESEND_FROM_EMAIL", env.RESEND_FROM_EMAIL);
  }
  return import("./index");
}

const isDryRun = (client: unknown) =>
  (client as { marker?: string }).marker !== "real-client";

beforeEach(() => {
  ResendCtor.mockClear();
  info.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("lib/email client gate", () => {
  it.each([
    ["development", { NODE_ENV: "development" }],
    ["test", { NODE_ENV: "test" }],
    ["development on Vercel", { NODE_ENV: "development", VERCEL_ENV: "development" }],
    ["Vercel preview build", { NODE_ENV: "production", VERCEL_ENV: "preview" }],
  ])("uses the dry-run client in %s and never builds a real client", async (_l, env) => {
    const { resend } = await load(env);
    expect(isDryRun(resend)).toBe(true);
    expect(ResendCtor).not.toHaveBeenCalled();
  });

  it.each([
    ["Vercel production", { NODE_ENV: "production", VERCEL_ENV: "production" }],
    ["production outside Vercel", { NODE_ENV: "production" }],
  ])("uses the real Resend client with the API key in %s", async (_l, env) => {
    const { resend } = await load(env);
    expect(isDryRun(resend)).toBe(false);
    expect(ResendCtor).toHaveBeenCalledWith("re_test_key");
  });
});

describe("dry-run client", () => {
  it("send logs recipient + subject and reports a fake id, with no error", async () => {
    const { resend } = await load({ NODE_ENV: "test" });
    const res = await resend.emails.send({
      from: "x",
      to: "a@example.com",
      subject: "Hallo",
      html: "<p>x</p>",
    });
    expect(res).toEqual({ data: { id: "dry-run" }, error: null });
    expect(info).toHaveBeenCalledWith("email.dry_run");
  });

  it("batch.send logs one entry per mail and reports no error", async () => {
    const { resend } = await load({ NODE_ENV: "test" });
    const res = await resend.batch.send([
      { from: "x", to: "a@example.com", subject: "1", html: "<p/>" },
      { from: "x", to: "b@example.com", subject: "2", html: "<p/>" },
    ]);
    expect(res.error).toBeNull();
    expect(info).toHaveBeenCalledTimes(2);
  });
});

describe("FROM_EMAIL", () => {
  it("prefixes the display name onto a bare address", async () => {
    const { FROM_EMAIL } = await load({
      NODE_ENV: "test",
      RESEND_FROM_EMAIL: "noreply@wichtelo.de",
    });
    expect(FROM_EMAIL).toBe("Wichtelo <noreply@wichtelo.de>");
  });

  it("keeps a full 'Name <addr>' value untouched", async () => {
    const { FROM_EMAIL } = await load({
      NODE_ENV: "test",
      RESEND_FROM_EMAIL: "Santa <noreply@wichtelo.de>",
    });
    expect(FROM_EMAIL).toBe("Santa <noreply@wichtelo.de>");
  });

  it("falls back to a localhost sender when the env is unset", async () => {
    const { FROM_EMAIL } = await load({ NODE_ENV: "test" });
    expect(FROM_EMAIL).toBe("Wichtelo <wichtelo@localhost>");
  });
});
