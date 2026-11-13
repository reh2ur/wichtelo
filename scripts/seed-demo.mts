// Seeds fictional demo users, groups and wishes (staging or local) and prints
// one-click login links. Idempotent: demo data is reset to the same state on
// every run; non-demo data is never touched. Live is not a valid target.
//
// Usage (see docs/testing.md):
//   pnpm seed:demo  <local|staging> [--site <url>]
//   pnpm seed:login <local|staging> <alias> [--site <url>]
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  DEMO_GROUPS,
  DEMO_SLUG_PREFIX,
  DEMO_USERS,
  DEMO_WISHES,
} from "./seed-demo/scenarios.mts";

const env = process.env;

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function resolveTarget(target: string | undefined) {
  const liveRef = env.SUPABASE_PROJECT_REF_LIVE;
  let url: string;
  let key: string | undefined;
  if (target === "staging") {
    const ref = env.SUPABASE_PROJECT_REF_STAGING;
    if (!ref)
      fail("SUPABASE_PROJECT_REF_STAGING not set (supabase/.env.local).");
    url = `https://${ref}.supabase.co`;
    key = env.SUPABASE_SERVICE_ROLE_KEY_STAGING;
    if (!key) {
      fail(
        "SUPABASE_SERVICE_ROLE_KEY_STAGING not set (supabase/.env.local; Supabase dashboard → staging project → API keys).",
      );
    }
  } else if (target === "local") {
    url = env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
    key = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
      fail(`Target "local" needs a localhost Supabase URL, got ${url}.`);
    }
    if (!key) fail("SUPABASE_SERVICE_ROLE_KEY not set (.env.local).");
  } else {
    fail("Target must be `local` or `staging` (live is never seeded).");
  }
  if (liveRef && url.includes(liveRef)) {
    fail("Refusing: resolved URL is the live project.");
  }
  return { url, key: key! };
}

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function siteUrl(target: string): string {
  const site =
    flag("site") ??
    env.SEED_SITE_URL ??
    (target === "local" ? "https://localhost:3000" : undefined);
  if (!site) {
    fail("Pass --site <preview url> (or set SEED_SITE_URL) for staging.");
  }
  return site.replace(/\/$/, "");
}

type Admin = SupabaseClient;

function check<T>(
  res: { data: T; error: { message: string } | null },
  what: string,
): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

/** Like `check`, for selects: also rejects a missing result. */
function need<T>(
  res: { data: T; error: { message: string } | null },
  what: string,
): NonNullable<T> {
  const data = check(res, what);
  if (data === null || data === undefined) throw new Error(`${what}: no data`);
  return data;
}

async function ensureUser(admin: Admin, email: string): Promise<string> {
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (created.data.user) return created.data.user.id;
  const code = created.error?.code;
  if (code !== "email_exists" && code !== "user_already_exists") {
    throw new Error(`createUser ${email}: ${created.error?.message}`);
  }
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const hit = data.users.find((u) => u.email === email);
    if (hit) return hit.id;
    if (data.users.length < 1000) throw new Error(`user ${email} not found`);
  }
}

async function loginLink(admin: Admin, email: string, site: string) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${site}/auth/callback` },
  });
  if (error || !data.properties.hashed_token) {
    throw new Error(`generateLink ${email}: ${error?.message}`);
  }
  // Same shape as the emailed button; valid for the OTP expiry (10 min).
  return `${site}/auth/callback?token_hash=${data.properties.hashed_token}&type=email`;
}

async function seed(admin: Admin) {
  // 1. Users + profiles (upsert).
  const ids = new Map<string, string>();
  for (const u of DEMO_USERS) {
    const id = await ensureUser(admin, u.email);
    ids.set(u.alias, id);
    check(
      await admin.from("profiles").upsert({
        id,
        first_name: u.firstName,
        last_name: u.lastName,
      }),
      `profile ${u.alias}`,
    );
  }

  // 2. Reset demo data: groups by slug prefix (cascades memberships,
  //    assignments, invite tokens, ...), wishes of demo accounts.
  check(
    await admin.from("groups").delete().like("slug", `${DEMO_SLUG_PREFIX}%`),
    "delete demo groups",
  );
  check(
    await admin
      .from("wishes")
      .delete()
      .in("profile_id", [...ids.values()]),
    "delete demo wishes",
  );

  // 3. Groups, memberships, invite tokens, draw.
  const groupIds = new Map<string, string>();
  const year = new Date().getFullYear();
  for (const g of DEMO_GROUPS) {
    const adminId = ids.get(g.members[0])!;
    const group = need(
      await admin
        .from("groups")
        .insert({
          slug: g.slug,
          name: g.name,
          year,
          budget_hint: g.budgetHint,
          note: g.note,
          created_by: adminId,
        })
        .select("id")
        .single(),
      `group ${g.slug}`,
    );
    groupIds.set(g.slug, group.id);

    const members = need(
      await admin
        .from("memberships")
        .insert(
          g.members.map((alias, i) => {
            const u = DEMO_USERS.find((x) => x.alias === alias)!;
            return {
              group_id: group.id,
              profile_id: ids.get(alias)!,
              name_snapshot: `${u.firstName} ${u.lastName}`,
              first_name_snapshot: u.firstName,
              last_name_snapshot: u.lastName,
              role: i === 0 ? "admin" : "participant",
            };
          }),
        )
        .select("id"),
      `memberships ${g.slug}`,
    );

    check(
      await admin.from("invite_tokens").insert({ group_id: group.id }),
      `invite token ${g.slug}`,
    );

    if (g.state === "drawn") {
      // Ring A→B→C→A: derangement, no mutual pair (needs >= 3 members).
      const order = members.map((m) => m.id).sort();
      const pairs = order.map((giver, i) => ({
        giver_id: giver,
        receiver_id: order[(i + 1) % order.length],
      }));
      const result = check(
        await admin.rpc("perform_draw", {
          p_group_id: group.id,
          p_pairs: pairs,
          p_expected_state: "open",
          p_expected_version: 0,
        }),
        `draw ${g.slug}`,
      );
      if (result !== "ok") throw new Error(`draw ${g.slug}: ${result}`);
      // perform_draw leaves a "mails not sent" row → drop, no resend banner.
      check(
        await admin
          .from("draw_mail_failures")
          .delete()
          .eq("group_id", group.id),
        `draw mail state ${g.slug}`,
      );
    }
  }

  // 4. Wishes (after memberships: trigger needs owner ∈ group). Every row
  //    carries the same keys — bulk insert sends null for missing ones.
  const now = new Date().toISOString();
  check(
    await admin.from("wishes").insert(
      DEMO_WISHES.map((x) => ({
        profile_id: ids.get(x.owner)!,
        group_id: x.group ? groupIds.get(x.group)! : null,
        title: x.title,
        url: x.url,
        note: x.note,
        price_estimate: x.priceEstimate,
        status: x.received ? "received" : "open",
        received_at: x.received ? now : null,
      })),
    ),
    "insert wishes",
  );

  return ids;
}

const [command, target, ...rest] = process.argv.slice(2);
if (command !== "seed" && command !== "login") {
  fail(
    "Usage: seed-demo.mts <seed|login> <local|staging> [alias] [--site url]",
  );
}

const { url, key } = resolveTarget(target);
const site = siteUrl(target);
const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

if (command === "seed") {
  await seed(admin);
  console.log(
    `Seeded ${DEMO_USERS.length} users, ${DEMO_GROUPS.length} groups, ${DEMO_WISHES.length} wishes on ${target}.\n`,
  );
  console.log("Login links (valid ~10 min, single use):");
  for (const u of DEMO_USERS) {
    console.log(
      `  ${u.alias.padEnd(6)} ${await loginLink(admin, u.email, site)}`,
    );
  }
} else {
  const alias = rest.find((a) => !a.startsWith("--") && a !== flag("site"));
  const u = DEMO_USERS.find((x) => x.alias === alias);
  if (!u)
    fail(`Alias must be one of: ${DEMO_USERS.map((x) => x.alias).join(", ")}`);
  console.log(await loginLink(admin, u.email, site));
}
