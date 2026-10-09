import { describe, it, expect } from "vitest";
import { envProblems, validateEnv, isProductionDeploy } from "./env";

const base = {
  NEXT_PUBLIC_SUPABASE_URL: "http://x",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "k",
  SUPABASE_SERVICE_ROLE_KEY: "s",
};

const prod = {
  ...base,
  NODE_ENV: "production",
  RESEND_API_KEY: "re_x",
  RESEND_FROM_EMAIL: "a@b.de",
  NEXT_PUBLIC_SITE_URL: "https://wichtelo.example",
  ACCOUNT_DELETION_SECRET: "x".repeat(32),
  OPERATOR_NAME: "Erika Mustermann",
  OPERATOR_ADDRESS_LINE1: "Musterstr. 1",
  OPERATOR_ADDRESS_LINE2: "12345 Musterstadt",
  OPERATOR_CONTACT_EMAIL: "kontakt@example.com",
};

describe("env validation", () => {
  it("accepts minimal dev env", () => {
    expect(envProblems({ ...base, NODE_ENV: "development" })).toEqual([]);
  });

  it("reports missing Supabase vars in any env", () => {
    const problems = envProblems({ NODE_ENV: "development" });
    expect(problems).toHaveLength(3);
  });

  it("does not require mail/secret in preview", () => {
    expect(
      envProblems({ ...base, NODE_ENV: "production", VERCEL_ENV: "preview" }),
    ).toEqual([]);
  });

  it("accepts complete production env", () => {
    expect(isProductionDeploy(prod)).toBe(true);
    expect(envProblems(prod)).toEqual([]);
  });

  it("requires mail vars and a strong deletion secret in production", () => {
    const problems = envProblems({
      ...base,
      NODE_ENV: "production",
      ACCOUNT_DELETION_SECRET: "short",
    });
    expect(problems).toEqual(
      expect.arrayContaining([
        "RESEND_API_KEY is required",
        "RESEND_FROM_EMAIL is required",
        "NEXT_PUBLIC_SITE_URL must be a URL",
        "ACCOUNT_DELETION_SECRET must be at least 32 characters",
      ]),
    );
  });

  it("requires Impressum operator fields in production", () => {
    const problems = envProblems({
      ...prod,
      OPERATOR_NAME: "",
      OPERATOR_ADDRESS_LINE1: undefined,
      OPERATOR_ADDRESS_LINE2: undefined,
      OPERATOR_CONTACT_EMAIL: undefined,
    });
    expect(problems).toEqual(
      expect.arrayContaining([
        "OPERATOR_NAME is required",
        "OPERATOR_ADDRESS_LINE1 is required",
        "OPERATOR_ADDRESS_LINE2 is required",
        "OPERATOR_CONTACT_EMAIL is required",
      ]),
    );
  });

  it("validateEnv throws listing all problems", () => {
    expect(() => validateEnv({ NODE_ENV: "production" })).toThrow(
      /Invalid environment[\s\S]*ACCOUNT_DELETION_SECRET/,
    );
  });
});
