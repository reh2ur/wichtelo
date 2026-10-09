import { z } from "zod";

type Env = Record<string, string | undefined>;

/** Real production deployment (not local dev, tests, or a Vercel preview). */
export function isProductionDeploy(env: Env = process.env): boolean {
  return env.NODE_ENV === "production" && env.VERCEL_ENV !== "preview";
}

const required = (name: string) =>
  z.string({ error: `${name} is required` }).min(1, `${name} is required`);

const baseSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: required("NEXT_PUBLIC_SUPABASE_URL"),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: required(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ),
  SUPABASE_SERVICE_ROLE_KEY: required("SUPABASE_SERVICE_ROLE_KEY"),
  SUPER_ADMIN_EMAIL: z.string().optional(),
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
});

// Only enforced in real production: dev/tests/previews use a dry-run mail
// client and a built-in dev token secret.
const productionSchema = baseSchema.extend({
  RESEND_API_KEY: required("RESEND_API_KEY"),
  RESEND_FROM_EMAIL: required("RESEND_FROM_EMAIL"),
  NEXT_PUBLIC_SITE_URL: z.url({ error: "NEXT_PUBLIC_SITE_URL must be a URL" }),
  // Impressum (§ 5 DDG) — legally required on the live site, so no fallback.
  OPERATOR_NAME: required("OPERATOR_NAME"),
  OPERATOR_ADDRESS_LINE1: required("OPERATOR_ADDRESS_LINE1"),
  OPERATOR_ADDRESS_LINE2: required("OPERATOR_ADDRESS_LINE2"),
  OPERATOR_CONTACT_EMAIL: required("OPERATOR_CONTACT_EMAIL"),
  ACCOUNT_DELETION_SECRET: z
    .string({ error: "ACCOUNT_DELETION_SECRET is required" })
    .min(32, "ACCOUNT_DELETION_SECRET must be at least 32 characters"),
});

/** Returns a list of human-readable problems; empty when env is valid. */
export function envProblems(env: Env = process.env): string[] {
  const schema = isProductionDeploy(env) ? productionSchema : baseSchema;
  const result = schema.safeParse(env);
  if (result.success) return [];
  return result.error.issues.map((i) => i.message);
}

/** Throws with all problems at once so a misconfigured deploy fails at boot. */
export function validateEnv(env: Env = process.env): void {
  const problems = envProblems(env);
  if (problems.length > 0) {
    throw new Error(`Invalid environment:\n- ${problems.join("\n- ")}`);
  }
}
