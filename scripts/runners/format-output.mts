import { execSync } from "node:child_process";
import type { CommandResult } from "./run-command.mts";

export function getModifiedFiles(): string[] {
  try {
    return execSync("git diff --name-only", { encoding: "utf8" })
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[[0-9;]*[mGKFHJsu]/g, "")
    .replace(/\x1b\].*?\x07/g, "");
}

export function parseFailureOutput(
  stepName: string,
  result: CommandResult,
): string {
  const clean = stripAnsi(result.combined).trim();
  switch (stepName) {
    case "typecheck":
      return parseTypecheck(clean);
    case "unit":
      return parseVitest(clean);
    case "e2e":
      return parsePlaywright(clean);
    default:
      return firstLines(clean, 15);
  }
}

function parseTypecheck(output: string): string {
  const lines = output.split("\n");
  const errorLines = lines.filter((l) => /error TS\d+:/.test(l));
  if (errorLines.length === 0) return firstLines(output, 15);
  return errorLines
    .slice(0, 10)
    .map((l) => {
      const m = l.match(/^(.+?)\(\d+,\d+\): error (TS\d+: .+)$/);
      if (!m) return l.trim();
      return `File: ${m[1]}\nError: ${m[2]}`;
    })
    .join("\n");
}

function parseVitest(output: string): string {
  const lines = output.split("\n");
  const failIdx = lines.findIndex((l) => /FAIL/.test(l));
  if (failIdx === -1) return firstLines(output, 15);
  return lines.slice(failIdx, failIdx + 20).join("\n");
}

function parsePlaywright(output: string): string {
  const lines = output.split("\n");
  const failIdx = lines.findIndex((l) => /^\s+\d+\)\s/.test(l));
  if (failIdx === -1) return firstLines(output, 15);
  return lines.slice(failIdx, failIdx + 20).join("\n");
}

function firstLines(output: string, n: number): string {
  return output.split("\n").slice(0, n).join("\n");
}
