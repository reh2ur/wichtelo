#!/usr/bin/env node
import { execSync, spawnSync } from "child_process";

const pr = process.argv[2];
const playwrightArgs = process.argv.slice(3);

if (!pr || !/^\d+$/.test(pr)) {
  console.error("Usage: pnpm e2e:pr <PR_NUMBER> [playwright args...]");
  console.error("Example: pnpm e2e:pr 42 --ui");
  process.exit(1);
}

const repo = execSync("gh repo view --json nameWithOwner -q .nameWithOwner", {
  encoding: "utf8",
}).trim();

const comments = JSON.parse(
  execSync(`gh api "/repos/${repo}/issues/${pr}/comments"`, {
    encoding: "utf8",
  }),
);

const previewUrl = comments
  .filter((c) => c.user.login === "vercel[bot]")
  .flatMap((c) => {
    const match = c.body.match(
      /\[Preview\]\((https:\/\/[^)]+vercel\.app[^)]*)\)/,
    );
    return match ? [match[1]] : [];
  })
  .at(-1);

if (!previewUrl) {
  console.error(
    `No Vercel preview URL found in PR #${pr} comments. Has the deployment finished?`,
  );
  process.exit(1);
}

console.log(`Running E2E tests against: ${previewUrl}`);

const result = spawnSync("pnpm", ["playwright", "test", ...playwrightArgs], {
  env: { ...process.env, PLAYWRIGHT_BASE_URL: previewUrl },
  stdio: "inherit",
});

process.exit(result.status ?? 1);
