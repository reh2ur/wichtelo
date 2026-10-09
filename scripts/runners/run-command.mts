import { spawnSync } from "node:child_process";

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  combined: string;
}

export function runCommand(command: string): CommandResult {
  const result = spawnSync("/bin/sh", ["-c", command], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: result.error.message,
      combined: result.error.message,
    };
  }

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const combined = [stdout, stderr].filter(Boolean).join("\n");

  return {
    exitCode: result.status ?? 1,
    stdout,
    stderr,
    combined,
  };
}
