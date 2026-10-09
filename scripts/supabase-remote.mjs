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

const result = spawnSync("supabase", [...args, "--project-ref", ref], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
