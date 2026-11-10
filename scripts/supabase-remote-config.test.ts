import { describe, expect, it } from "vitest";
import { resolveRemoteConfig } from "./supabase-remote-config.mjs";

const toml = `project_id = "wichtelo"

[remotes.live]
project_id = "env(SUPABASE_PROJECT_REF_LIVE)"

[remotes.live.auth]
site_url = "env(LIVE_SITE_URL)" # prod
# additional = "env(COMMENTED_OUT)"

[remotes.staging]
project_id = "env(SUPABASE_PROJECT_REF_STAGING)"

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
    expect(out.toml).toContain(
      'project_id = "env(SUPABASE_PROJECT_REF_STAGING)"',
    );
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
