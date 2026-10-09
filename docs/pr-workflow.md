# PR and issue workflow

## Pre-PR checklist

Run all, fix failures before opening/updating PR:

```bash
pnpm typecheck      # must pass with zero errors
pnpm format         # auto-fixes formatting (prettier --write .)
pnpm lint           # must pass with zero errors (warnings OK)
pnpm test           # all unit + integration tests must pass
```

Then E2E — pick one:

```bash
pnpm e2e:dev        # run against local dev server (https://localhost:3000)
pnpm e2e:pr <NUM>   # run against deployed Vercel preview for PR number NUM
```

No PR if any fail.

## GitHub issue workflow

1. **Check for unstaged changes first.** If any exist, ask user what to do before proceeding.
2. **Create branch** named after issue (e.g., `feat/issue-42-short-description` or `fix/issue-42-short-description`).
3. **Implement work.** After each to-do checkbox completed and pushed, update checkbox on issue via `gh issue edit` or comment.
4. **Run pre-PR checklist** (above), fix all failures before opening PR.
5. **Open PR** with `Closes #<issue-number>` (or `Fixes #<issue-number>`) in body so issue auto-closes on merge.
6. **Keep issue checkboxes current.** Tick off as items implemented and pushed.
7. **Check Vercel preview.** PR gets preview deployment check; none appear → check Vercel project git connection.
