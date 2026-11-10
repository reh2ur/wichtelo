// Runs a supabase CLI command against the live or staging project.
// Usage: node --env-file-if-exists=supabase/.env.local scripts/supabase-remote.mjs <live|staging> <supabase args...>
// Project refs come from SUPABASE_PROJECT_REF_LIVE / SUPABASE_PROJECT_REF_STAGING
// so no project identifier is committed. For `config` commands the ref is also
// filled into [remotes.<target>] project_id (see supabase-remote-config.mjs) via a
// temp workdir copy; the committed config.toml is never modified.
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveRemoteConfig } from "./supabase-remote-config.mjs";

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

const supabaseDir = resolve("supabase");
const extra = [];
let workdir;

if (args[0] === "config") {
  let resolved;
  try {
    resolved = resolveRemoteConfig(
      readFileSync(join(supabaseDir, "config.toml"), "utf8"),
      target,
      envName,
      process.env,
    );
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  if (resolved.missing.length > 0) {
    console.warn(
      `Warning: unset in env, CLI will not push these: ${resolved.missing.join(", ")}`,
    );
  }

  workdir = mkdtempSync(join(tmpdir(), "supabase-remote-"));
  const tmpSupabase = join(workdir, "supabase");
  mkdirSync(tmpSupabase);
  writeFileSync(join(tmpSupabase, "config.toml"), resolved.toml);
  // Copied, not symlinked: the CLI rejects paths whose real location is outside the
  // workdir. Templates etc. are what relative paths in config.toml point at. Env files
  // stay out of the temp dir (secrets; the CLI gets them via process env).
  for (const name of readdirSync(supabaseDir)) {
    if (name === "config.toml" || name === ".temp" || name.startsWith(".env")) {
      continue;
    }
    cpSync(join(supabaseDir, name), join(tmpSupabase, name), {
      recursive: true,
    });
  }
  extra.push("--workdir", workdir);
}

let status;
try {
  const result = spawnSync(
    "supabase",
    [...args, "--project-ref", ref, ...extra],
    {
      stdio: "inherit",
    },
  );
  if (result.error) console.error(result.error.message);
  status = result.status ?? 1;
} finally {
  if (workdir) rmSync(workdir, { recursive: true, force: true });
}
process.exit(status);
