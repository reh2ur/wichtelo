// Runs a supabase CLI command against the live or staging project.
// Usage: node --env-file-if-exists=supabase/.env.local scripts/supabase-remote.mjs <live|staging> <supabase args...>
// Project refs come from SUPABASE_PROJECT_REF_LIVE / SUPABASE_PROJECT_REF_STAGING
// so no project identifier is committed.
import { spawnSync } from "node:child_process";

const [target, ...args] = process.argv.slice(2);
const envName = {
  live: "SUPABASE_PROJECT_REF_LIVE",
  staging: "SUPABASE_PROJECT_REF_STAGING",
}[target];

if (!envName || args.length === 0) {
  console.error("Usage: supabase-remote.mjs <live|staging> <supabase args...>");
  process.exit(1);
}

const ref = process.env[envName];
if (!ref) {
  console.error(`${envName} is not set (put it in supabase/.env.local).`);
  process.exit(1);
}

// Guard `config push`: the redirect allow-list feeds the email button
// ({{ .RedirectTo }}), so a wildcard host would allow open redirects (#166).
if (args.includes("config")) {
  const varName = {
    live: "LIVE_REDIRECT_URL",
    staging: "STAGING_PREVIEW_REDIRECT_URL",
  }[target];
  const value = process.env[varName];
  const host = value?.match(/^https:\/\/([^/]+)\/\*\*$/)?.[1];
  const hostOk =
    host &&
    (target === "live"
      ? !host.includes("*")
      : host.endsWith("-projects.vercel.app") && !host.startsWith("*"));
  if (!hostOk) {
    console.error(
      `${varName} must look like https://<host>/** ` +
        (target === "live"
          ? "with an exact host (no wildcard)."
          : "with host <project>-*-<team>-projects.vercel.app."),
    );
    process.exit(1);
  }
}

const result = spawnSync("supabase", [...args, "--project-ref", ref], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
