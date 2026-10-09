export interface VerifyStep {
  name: string;
  command: string;
  modifiesFiles?: boolean;
  tags?: string[];
  description?: string;
}

export const verifySteps: VerifyStep[] = [
  {
    name: "format",
    command: "prettier --write . --log-level error",
    modifiesFiles: true,
  },
  {
    name: "lint",
    command: "eslint --quiet --fix",
    modifiesFiles: true,
  },
  {
    name: "typecheck",
    command: "next typegen && tsc --noEmit",
  },
  {
    name: "unit",
    command: "vitest run --reporter=dot --silent",
  },
  {
    name: "e2e",
    command: "playwright test --reporter=dot",
    tags: ["slow"],
  },
];
