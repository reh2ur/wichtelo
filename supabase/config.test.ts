import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { OTP_EXPIRY_MINUTES, OTP_LENGTH } from "../lib/auth/otp";

// Config drift guard (#103): `supabase config push` is manual, so nothing
// else notices a hosted-sensitive key being weakened in config.toml. This pins
// the security-relevant keys for the base (local) block and both remotes.
// It cannot see hosted values: after a push, verify in the dashboard
// (docs/go-live.md).

const config = readFileSync(join(__dirname, "config.toml"), "utf8");

/** Active (uncommented) key/value lines of one `[section]`. */
function section(name: string): Record<string, string> {
  const lines = config.split("\n");
  const out: Record<string, string> = {};
  let inside = false;
  let pendingKey: string | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^\[[^\]]+\]$/.test(line)) {
      inside = line === `[${name}]`;
      pendingKey = null;
      continue;
    }
    if (!inside || line.startsWith("#") || line === "") continue;
    if (pendingKey) {
      out[pendingKey] += ` ${line}`;
      if (line.includes("]")) pendingKey = null;
      continue;
    }
    const m = /^(\w+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2];
    if (m[2].startsWith("[") && !m[2].includes("]")) pendingKey = m[1];
  }
  return out;
}

const REMOTES = ["live", "staging"] as const;

describe("supabase/config.toml drift guard", () => {
  it("keeps self-signup off in base [auth] and [auth.email] (#130)", () => {
    expect(section("auth").enable_signup).toBe("false");
    expect(section("auth.email").enable_signup).toBe("false");
  });

  it("requires email confirmation, 60s throttle, OTP shape in base + every remote", () => {
    const blocks = [
      section("auth.email"),
      ...REMOTES.map((r) => section(`remotes.${r}.auth.email`)),
    ];
    for (const b of blocks) {
      expect(b.enable_confirmations).toBe("true");
      expect(b.max_frequency).toBe('"60s"');
      expect(b.otp_length).toBe(String(OTP_LENGTH));
      expect(b.otp_expiry).toBe(String(OTP_EXPIRY_MINUTES * 60));
    }
  });

  it.each(REMOTES)(
    "%s: custom SMTP on, mail quota sized, IP caps raised",
    (r) => {
      expect(section(`remotes.${r}.auth.email.smtp`).enabled).toBe("true");
      const rl = section(`remotes.${r}.auth.rate_limit`);
      expect(Number(rl.email_sent)).toBeGreaterThanOrEqual(100);
      expect(Number(rl.token_verifications)).toBeGreaterThanOrEqual(300);
      expect(Number(rl.sign_in_sign_ups)).toBeGreaterThanOrEqual(300);
    },
  );

  it("remote redirect allow-lists hold only env() refs or localhost, never a wildcard host (#166)", () => {
    for (const r of REMOTES) {
      const urls = section(`remotes.${r}.auth`).additional_redirect_urls;
      expect(urls, `${r} additional_redirect_urls`).toBeDefined();
      const entries = [...urls.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
      expect(entries.length).toBeGreaterThan(0);
      for (const e of entries) {
        const ok =
          /^env\([A-Z_]+\)$/.test(e) ||
          /^http:\/\/localhost:3000\/\*\*$/.test(e);
        expect(ok, `${r}: unexpected redirect entry ${e}`).toBe(true);
      }
    }
    expect(section("remotes.live.auth").additional_redirect_urls).toContain(
      "env(LIVE_REDIRECT_URL)",
    );
  });

  it("no captcha block is active (documented gap, see docs/security.md)", () => {
    // Flip this when Turnstile lands: then pin provider + enabled instead.
    expect(config).not.toMatch(/^\[auth\.captcha\]/m);
  });
});
