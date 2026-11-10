// Turns the committed supabase/config.toml into one the CLI can push to a
// hosted project. The CLI matches [remotes.<name>] only by a literal
// project_id and does not resolve env() there, so the committed file keeps
// a dummy `project_id` (PLACEHOLDER_REFS) and this fills in the real ref at push
// time. The real ref never lands in git. Placeholders must look like a ref (20
// lowercase letters): the CLI validates the format on every command, `supabase
// start` included, and rejects anything else (e.g. an unresolved `env(...)`).

const SECTION = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/;
const PROJECT_ID = /^(\s*project_id\s*=\s*)"([^"]*)"/;
const ENV_REF = /env\(([A-Za-z0-9_]+)\)/g;
const REF = /^[a-z0-9]+$/;

/** Committed dummy `project_id` per remote block. Not real refs. */
export const PLACEHOLDER_REFS = {
  live: "livelivelivelivelive",
  staging: "stagestagestagestage",
};

/** True for `remotes.<target>` and `remotes.<target>.*` section names. */
function inTargetSection(section, target) {
  return (
    section === `remotes.${target}` || section.startsWith(`remotes.${target}.`)
  );
}

/**
 * @param {string} toml committed config.toml
 * @param {string} target remote block name (`live` | `staging`)
 * @param {string} refVar env var holding the project ref
 * @param {Record<string, string | undefined>} env
 * @returns {{ toml: string, ref: string, missing: string[] }}
 *   `missing` = env() names used by the target's remote block that are unset or empty.
 */
export function resolveRemoteConfig(toml, target, refVar, env) {
  const ref = env[refVar];
  if (!ref)
    throw new Error(`${refVar} is not set (put it in supabase/.env.local).`);
  if (!REF.test(ref)) throw new Error(`${refVar} is not a valid project ref.`);

  let section = "";
  let matched = false;
  const missing = new Set();
  const lines = toml.split("\n").map((line) => {
    const header = SECTION.exec(line);
    if (header) {
      section = header[1].trim();
      return line;
    }
    if (!inTargetSection(section, target)) return line;

    const projectId = PROJECT_ID.exec(line);
    if (section === `remotes.${target}` && projectId) {
      if (projectId[2] !== PLACEHOLDER_REFS[target] && projectId[2] !== ref) {
        throw new Error(
          `[remotes.${target}] project_id must be the placeholder "${PLACEHOLDER_REFS[target]}", found a different value.`,
        );
      }
      matched = true;
      return `${projectId[1]}"${ref}"${line.slice(projectId[0].length)}`;
    }

    // Values only (strip trailing comment) so commented-out env() is ignored.
    for (const [, name] of line.split("#")[0].matchAll(ENV_REF)) {
      if (!env[name]) missing.add(name);
    }
    return line;
  });

  if (!matched) {
    throw new Error(
      `No [remotes.${target}] block with a project_id in config.toml.`,
    );
  }
  return { toml: lines.join("\n"), ref, missing: [...missing] };
}
