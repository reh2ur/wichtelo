import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PLACEHOLDER_REFS,
  resolveRemoteConfig,
} from "./supabase-remote-config.mjs";

const toml = `project_id = "wichtelo"

[remotes.live]
project_id = "livelivelivelivelive"

[remotes.live.auth]
site_url = "env(LIVE_SITE_URL)" # prod
# additional = "env(COMMENTED_OUT)"

[remotes.staging]
project_id = "stagestagestagestage"

[remotes.staging.auth]
site_url = "env(STAGING_ONLY)"
`;

const env = {
  SUPABASE_PROJECT_REF_LIVE: "abcdefghijklmnopqrst",
  LIVE_SITE_URL: "https://example.test",
};

describe("resolveRemoteConfig", () => {
  it("injects the ref into the target block only", () => {
    const out = resolveRemoteConfig(
      toml,
      "live",
      "SUPABASE_PROJECT_REF_LIVE",
      env,
    );
    expect(out.toml).toContain(
      '[remotes.live]\nproject_id = "abcdefghijklmnopqrst"',
    );
    expect(out.toml).toContain('project_id = "stagestagestagestage"');
    expect(out.toml).toContain('project_id = "wichtelo"');
    expect(out.missing).toEqual([]);
  });

  it("reports unset env() of the target block, ignoring comments and other targets", () => {
    const out = resolveRemoteConfig(toml, "live", "SUPABASE_PROJECT_REF_LIVE", {
      SUPABASE_PROJECT_REF_LIVE: env.SUPABASE_PROJECT_REF_LIVE,
    });
    expect(out.missing).toEqual(["LIVE_SITE_URL"]);
  });

  it("throws when the ref var is unset or malformed", () => {
    expect(() =>
      resolveRemoteConfig(toml, "live", "SUPABASE_PROJECT_REF_LIVE", {}),
    ).toThrow(/not set/);
    expect(() =>
      resolveRemoteConfig(toml, "live", "SUPABASE_PROJECT_REF_LIVE", {
        SUPABASE_PROJECT_REF_LIVE: 'x"\n[evil]',
      }),
    ).toThrow(/valid project ref/);
  });

  it("throws when block missing or project_id is a different literal", () => {
    expect(() =>
      resolveRemoteConfig(
        "[auth]\nenable_signup = false\n",
        "live",
        "SUPABASE_PROJECT_REF_LIVE",
        env,
      ),
    ).toThrow(/No \[remotes.live\]/);
    expect(() =>
      resolveRemoteConfig(
        '[remotes.live]\nproject_id = "someotherref"\n',
        "live",
        "SUPABASE_PROJECT_REF_LIVE",
        env,
      ),
    ).toThrow(/must be/);
  });
});

describe("committed supabase/config.toml", () => {
  const committed = readFileSync("supabase/config.toml", "utf8");

  // The CLI rejects a non-ref project_id on every command (`supabase start` in CI
  // included), so the committed value must be ref-shaped, and the script must be
  // able to resolve it.
  it.each(["live", "staging"] as const)(
    "[remotes.%s] holds the ref-shaped placeholder",
    (target) => {
      expect(PLACEHOLDER_REFS[target]).toMatch(/^[a-z]{20}$/);
      const out = resolveRemoteConfig(committed, target, "REF", {
        REF: "abcdefghijklmnopqrst",
      });
      expect(committed).toContain(
        `[remotes.${target}]\nproject_id = "${PLACEHOLDER_REFS[target]}"`,
      );
      expect(out.ref).toBe("abcdefghijklmnopqrst");
    },
  );
});
