# PRD: Secret Santa Web App

## Problem Statement

Organizing a Secret Santa ("Wichteln") gift exchange among friends or family is tedious. Admins have to manually draw names, keep assignments secret, handle conflicts (partners who live together shouldn't give to each other), notify everyone of their assignment, and manage late changes like people dropping out. There is no simple, free, German-language tool that handles this end-to-end while respecting German legal requirements and collecting the minimum amount of personal data.

## Solution

Secret Santa is a German-language web app that lets a group admin create a Gruppe (gift exchange group), invite participants via a shareable link, define exclusion pairs, trigger a fair random draw, and notify every participant of their assignment by email. Participants can log in at any time to see who they are giving to. The whole experience is invite-only, passwordless, mobile-first, and legally compliant for operation in Germany.

## User Stories

### Authentication & Access

1. As a new user, I want to sign up by following a group invite link, so that I don't need to find and register on the site myself.
2. As a new user, I want to enter only my first name, last name, and email address during signup, so that the service collects the minimum personal data necessary.
3. As a returning user, I want to log in using a magic link sent to my email, so that I never need to remember a password.
4. As a returning user, I want the option to enter a one-time passcode sent to my email instead of clicking a magic link, so that I can log in even when my email client doesn't support deep links.
5. As any user, I want to be redirected to my Gruppen overview after logging in, so that I land directly in my personal context.
6. As any user, I want the site to be entirely in German, so that it feels natural to me and the people I invite.

### Gruppe Management

7. As a logged-in user, I want to create a new Gruppe with a name and year, so that I can organize a new gift exchange.
8. As a logged-in user, I want to add an optional budget hint to my Gruppe, so that participants know roughly how much to spend.
9. As a logged-in user, I want to add an optional note to my Gruppe, so that I can share logistical information (e.g. "Bring it to the Christmas party on 20 December").
10. As a Gruppe admin, I want to rename my Gruppe, so that I can correct mistakes or reflect changes in the group composition.
11. As a Gruppe admin, I want to get a shareable invite link for my Gruppe, so that I can send it to participants via WhatsApp, Signal, or any other channel.
12. As a Gruppe admin, I want to remove a participant from my Gruppe before the draw, so that I can correct mistakes or handle cancellations.
13. As a Gruppe admin, I want to promote a participant to admin, so that another trusted person can manage the group.
14. As a Gruppe admin, I want to be prevented from leaving or deleting my admin role if I am the last admin, so that the Gruppe is never left without someone who can manage it.
15. As a Gruppe admin, I want to delete a Gruppe at any point, so that I can cancel the exchange if plans change.
16. As a Gruppe participant, I want to leave a Gruppe voluntarily, so that I can withdraw if I am no longer able to participate.
17. As any user, I want to see all my active Gruppen and a collapsed history of past Gruppen, so that I have a clear overview of my current and previous exchanges.
18. As any user, I want past Gruppen to show who I gave to, so that I can look back at previous years.

### Invite Flow

19. As a new user arriving via an invite link, I want to see a clear explanation of what Secret Santa is and why I am being asked to create an account, so that I understand the context before providing my data.
20. As a new user arriving via an invite link, I want to provide my first name, last name, and email address and immediately receive a magic link, so that joining a Gruppe is a single, fast flow.
21. As an existing user arriving via an invite link, I want to enter my email and receive a magic link that logs me in and joins me to the Gruppe, so that the flow is seamless for returning users.
22. As any user arriving via an invite link after the draw has already happened, I want to see a friendly explanation that joining is no longer possible, so that I understand the situation and know who to contact.

### Draw

23. As a Gruppe admin, I want to trigger the draw when I decide all participants are present, so that I control the timing of the assignment.
24. As a Gruppe admin, I want the system to prevent me from triggering the draw with fewer than 3 participants, so that the exchange is meaningful.
25. As a Gruppe admin, I want to define exclusion pairs (e.g. partners in the same household), so that those pairs are never assigned to each other in either direction.
26. As a Gruppe admin, I want to be clearly informed if my exclusion rules make a valid draw impossible, so that I can remove constraints and try again.
27. As a Gruppe admin, I want to trigger a re-draw at any time after the initial draw, so that I can handle situations like a participant dropping out.
28. As a Gruppe admin, I want the re-draw to overwrite the previous assignment silently, so that there is only ever one active assignment per Gruppe.
29. As a Gruppe admin, I want to look up a specific participant's assignment individually without seeing the full list, so that I can help a participant who has trouble logging in or reading their email without compromising the secrecy of the whole draw.
30. As a Gruppe admin, I want a confirmation step before the individual lookup reveals the assignment, so that I don't accidentally see an assignment.
31. As a participant, I want to see who I am giving to on the Gruppe detail page after the draw, so that I can always look it up without searching my email.
32. As a participant, I want my assigned name to show the recipient's first name and an abbreviated last name, so that I can identify them clearly while their full last name stays private from other participants.

### Notifications

33. As a participant, I want to receive an email when the draw happens telling me who I am giving to, including the Gruppe name, year, and admin contact details, so that I have all relevant information in one place.
34. As a participant, I want the draw email to be clearly branded as Secret Santa, cute, and wintery in style, so that receiving it feels fun and festive.
35. As a participant, I want to receive an email if the draw is reset, including my new assignment, so that I am immediately aware of the change.
36. As a participant, I want to receive an email if the Gruppe is deleted by the admin, so that I know the exchange has been cancelled.
37. As a participant, I want to receive a confirmation email when I leave a Gruppe, so that I have a record of my action.
38. As a participant, I want to receive a confirmation email when I delete my account, so that I have a record of the deletion.
39. As a Gruppe admin, I want to receive an email when a new participant joins my Gruppe before the draw, so that I know who has accepted the invite.
40. As a Gruppe admin, I want to receive an email when a participant leaves my Gruppe after the draw has happened, so that I know manual action may be needed.
41. As a Gruppe admin, I want to receive an email when a participant deletes their account and had an active assignment in my Gruppe, so that I know manual action may be needed.

### Account Management

42. As a user, I want to edit my first name and last name in my account settings, so that I can correct mistakes or update my details.
43. As a user, I want to delete my account easily from my account settings page, so that I can exercise my right to erasure under GDPR.
44. As a user, I want account deletion to require confirmation via a link in a separate email, so that accidental or malicious deletion is prevented.
45. As a user, I want my name to remain visible in existing draw assignments after I delete my account, so that other participants and admins are not left with broken or confusing data (disclosed in the privacy policy).

### Legal & Compliance

46. As a visitor, I want to access an Impressum page at any time, so that I can identify who operates the service (required by German law, DDG §5).
47. As a visitor, I want to access a Datenschutzerklärung (privacy policy) at any time, so that I understand what data is collected and how it is processed.
48. As a visitor, I want the privacy policy to list all data processors (Supabase, Resend, Vercel) and their roles, so that I have full transparency.
49. As a visitor, I want the privacy policy to disclose that my name may remain in draw assignments after account deletion, so that I can make an informed decision.
50. As a visitor, I want the privacy policy to disclose that Gruppe admins can look up individual assignments, so that I understand the scope of admin capabilities.
51. As a visitor, I want the site to use only essential cookies (auth session) with no analytics or tracking cookies, so that no cookie consent banner is required and my privacy is protected by default.

### Design & Experience

52. As any user, I want the site to work well on my phone, so that I can check my assignment while out Christmas shopping.
53. As any user, I want the landing page to have a subtle, CSS-only snow animation, so that it immediately conveys the festive mood.
54. As any user, I want the design to use a warm Christmas palette (deep red, pine green, cream, gold accents) with a rounded, friendly font, so that the experience feels cosy and seasonal.
55. As any user, I want the UI to be clean and uncluttered with no visual distractions, so that I can find what I need quickly.

## Implementation Decisions

### Stack

- **Framework:** Next.js 16 (App Router), React 19, React Compiler enabled, Turbopack as default bundler for dev and build
- **Package manager:** pnpm
- **Database + Auth:** Supabase (PostgreSQL + built-in Auth), EU Frankfurt region. Magic link and OTP flows via Supabase Auth.
- **Email:** Resend (transactional delivery) + React Email (template rendering)
- **i18n:** next-intl, German only, no locale prefix in URLs, server-side only (`getTranslations()` — no `NextIntlClientProvider`)
- **Styling:** Tailwind CSS, shadcn/ui components built on Base UI primitives
- **Font:** Manrope via `next/font/google`
- **Testing:** Vitest (unit + integration against Supabase local stack) + Playwright (E2E)

### Architecture Principles

- Server Components by default. `'use client'` only where unavoidable (Base UI interactive primitives, CSS snow animation).
- All mutations via Server Actions + `useActionState` (React 19). No API route handlers for mutations.
- `use cache` directive on stable data (group shell, participant list). Dynamic content (assignment reveal, participant count) in `<Suspense>` islands.
- `cacheComponents: true` in `next.config.ts` enables both `use cache` and Partial Prerendering automatically.
- All dynamic data access outside `<Suspense>` or `use cache` throws a build-time error — enforced by the framework.

### Routing

All routes use German slugs with no locale prefix:

| Route                               | Purpose                                  |
| ----------------------------------- | ---------------------------------------- |
| `/`                                 | Landing page (snow animation, login CTA) |
| `/anmelden`                         | Magic link request + OTP entry           |
| `/gruppen`                          | Groups overview                          |
| `/gruppen/neu`                      | Create group                             |
| `/gruppen/[gruppeId]`               | Group detail                             |
| `/gruppen/[gruppeId]/einstellungen` | Admin settings                           |
| `/einladung/[token]`                | Invite landing                           |
| `/konto`                            | Account settings + deletion              |
| `/impressum`                        | Impressum                                |
| `/datenschutz`                      | Datenschutzerklärung                     |

### Group IDs

Gruppe slugs are auto-generated from the group name at creation time. Umlaut transliteration: ä→ae, ö→oe, ü→ue, ß→ss. Slug collisions resolved by appending a short numeric suffix. Admins never set slugs manually.

### Data Model

Six core tables in Supabase PostgreSQL. Row Level Security enforced on all tables.

- **profiles** — extends `auth.users`. Stores `first_name`, `last_name`. No additional personal data.
- **groups** — `name`, `year` (integer), `slug` (unique), `budget_hint` (nullable text), `note` (nullable text), `state` (enum: `open` | `drawn`), `created_by`.
- **memberships** — join table between profiles and groups. Stores `role` (enum: `participant` | `admin`) and `name_snapshot` (text, preserved when account is deleted).
- **assignments** — one row per giver/receiver pair per group. Overwritten entirely on re-draw.
- **exclusions** — bidirectional exclusion pairs per group. Canonical ordering (`member_a < member_b`) enforced via check constraint to prevent duplicates.
- **invite_tokens** — one active token per group. Invalidated logically once group state becomes `drawn`.

RLS rules: participants + admins read only own assignment row (admin lookup = audited action, service role); profiles readable by owner only; user JWT writes only profile names + `create_group` RPC.

### Deep Modules

Seven independently testable modules encapsulate all complex logic:

1. **Draw Engine** — pure function: `computeDraw(members, exclusions) → assignment | null`. Produces a valid derangement with no mutual pairs and all exclusion constraints respected. Two-stage: rejection sampling (Fisher-Yates, 200 attempts), then exhaustive randomized backtracking. Returns `null` iff no valid assignment exists (unsolvable constraints).

2. **Slug Generator** — `generateSlug(name, existingSlugs) → string`. Transliterates German characters, lowercases, replaces spaces with hyphens, appends suffix on collision.

3. **Name Abbreviator** — `abbreviateNames(members[]) → DisplayName[]`. Pure function. Returns minimum last-name abbreviation per member such that all display names within the group are unique.

4. **Invite Token** — `createToken(groupId) → token`, `resolveToken(token) → { group, state } | 'expired' | 'drawn'`. Encapsulates token lifecycle and post-draw dead-end detection.

5. **Group State Machine** — `canDraw(group, members, exclusions) → true | ErrorReason`, `transition(group, event) → newState`. All state guards in one place, testable without database.

6. **Notification Dispatcher** — `notify(event: DomainEvent) → void`. Maps domain events (DrawTriggered, ParticipantLeft, AccountDeleted, etc.) to the correct React Email template and Resend dispatch call. Single entry point for all email sending.

7. **Account Deletion Cascade** — `deleteAccount(userId) → AffectedGroups`. Snapshots names in memberships, nullifies profile references, returns the list of admin-notification payloads needed. Deterministic and testable against a local Supabase instance.

### Draw Algorithm Constraints

The draw must satisfy all of the following simultaneously:

- No self-assignment (derangement)
- No mutual pairs: if A→B then B cannot→A
- No exclusion pairs: if (A, B) is excluded, neither A→B nor B→A is permitted
- Minimum 3 participants

If no valid assignment is found within the attempt limit, the draw is blocked and the admin sees a clear error.

### Name Display Logic

Last names are abbreviated to the minimum number of characters required to make every display name within a Gruppe unique. If all first names are unique, last names are not shown at all. Admins always see full names. The signup form shows a note explaining why the last name is collected.

### Account Deletion Behaviour

On confirmation, the user's `auth.users` record and `profiles` record are deleted. All `memberships` rows set `profile_id` to null; `name_snapshot` is preserved. All `assignments` rows referencing those memberships remain intact. Admins of affected Gruppen (where a draw had already happened) receive a notification email. Deletion blocked while user = sole active admin (admin with account) of any Gruppe — German error lists Gruppen; user promotes another member or deletes Gruppe first. Last-admin checks (leave, remove) count only admins with account; members w/o account (deleted) cannot be promoted.

### Legal

- Impressum and Datenschutzerklärung are static pages, linked from every page footer.
- No user-tracking analytics, no non-essential cookies. Cookie consent banner not required.
- Vercel Speed Insights active — performance monitoring only (page loads, Core Web Vitals, IP-based approx. location), no cookies, no user profiles. Not user tracking. Disclosed in Datenschutzerklärung, Art. 6(1)(f) DSGVO basis.
- Datenschutzerklärung lists Supabase (EU), Resend (USA), Vercel (USA), Upstash (USA) as processors; discloses name preservation, admin oracle capability, and EU-US DPF + SCC transfer safeguard for the US-based processors.
- Impressum contains placeholder personal data until launch.

## Testing Decisions

**What makes a good test:** Tests verify observable external behaviour, not internal implementation details. A test should pass regardless of whether the internals are refactored, as long as the contract (inputs → outputs) is unchanged.

**Modules with unit tests (Vitest):**

- **Draw Engine** — all constraint combinations: derangement, mutual pair avoidance, exclusion pairs, minimum participant guard, unsolvable detection. Seeded random for determinism.
- **Slug Generator** — Umlaut transliteration, collision resolution, edge cases (empty name, all special characters).
- **Name Abbreviator** — disambiguation across varying group compositions, single-member groups, all-unique first names, duplicate first names.
- **Group State Machine** — all valid and invalid state transitions, all draw guard conditions.

**Modules with integration tests (Vitest + `supabase start`):**

- **Account Deletion Cascade** — verifies name snapshot preservation, membership nullification, correct admin notification payloads, RLS integrity post-deletion.
- **Invite Token** — token creation, resolution, post-draw dead-end, expiry.
- **Notification Dispatcher** — verifies correct template selected and correct recipients for each domain event (mocked Resend, real domain logic).

**E2E tests (Playwright):**

- Full happy path: receive invite link → sign up → join Gruppe → admin triggers draw → participant views assignment
- Re-draw flow: admin triggers re-draw → participants receive new assignment email
- Account deletion: user initiates → confirms via email link → account gone, name preserved in assignments
- Invite link dead-end: visit invite link after draw → see friendly message
- Admin oracle: admin selects participant → confirms → sees single assignment

**Prior art:** This is a greenfield project. Test structure follows Vitest defaults with co-located test files (`*.test.ts`) for unit tests and a top-level `e2e/` directory for Playwright specs.

## Out of Scope

- **Open registration** — the site is invite-only; strangers cannot sign up without a group invite link
- **Wishlists or gift idea fields per participant** — out of scope to keep the data model simple and personal data minimal
- **Draw scheduling** — admins trigger draws manually; no date-based automation
- **Multi-language support** — German only for the foreseeable future
- **Analytics or usage tracking** — excluded for privacy/compliance; Vercel Speed Insights (performance monitoring only, no cookies/profiles) not covered by this exclusion, see Legal section
- **Gift budget enforcement** — the budget hint is informational text only, not validated or tracked
- **Multiple draws per group per year** — one draw per Gruppe; a new year means a new Gruppe
- **Decline invite** — participants either join or do not; there is no explicit decline flow
- **Cold invite emails** — invites are shareable links only; the service never cold-emails someone who has not initiated contact

## Further Notes

- The app is operated from Germany. All GDPR and TMG obligations apply. The Datenschutzerklärung must be reviewed by the operator before public launch and updated whenever processors change.
- Email deliverability depends on Resend's free tier: 3,000 emails/month AND 100/day, shared with Supabase Auth SMTP (OTP/magic link). Supabase `email_sent` = 100/h. Size for December peak (draw mails burst) or upgrade plan.
- Super-admin back-office exists (`/admin`, `SUPER_ADMIN_EMAIL`, audit log) — see `docs/admin-dashboard.md`.
- Supabase's EU (Frankfurt) region ensures personal data does not leave the EU, simplifying the GDPR transfer assessment.
- The `name_snapshot` field in memberships means the draw history is self-contained and does not break if users delete their accounts — but this must be clearly disclosed in the privacy policy before any data is collected.
- The admin oracle feature (individual assignment lookup) must be disclosed in the Datenschutzerklärung as it constitutes access to personal data by a third party (the admin).
- CSS-only snow animation on the landing page avoids any JavaScript bundle cost and works with server rendering.
- Turbopack is the default bundler in Next.js 16 for both dev and build — no webpack fallback is needed.
