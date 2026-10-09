import { verifySteps } from "./verify-config.mts";
import { runCommand } from "./runners/run-command.mts";
import {
  getModifiedFiles,
  parseFailureOutput,
} from "./runners/format-output.mts";

for (const step of verifySteps) {
  const filesBefore = step.modifiesFiles ? getModifiedFiles() : [];

  const result = runCommand(step.command);

  const filesAfter = step.modifiesFiles ? getModifiedFiles() : [];
  const changed = filesAfter.filter((f) => !filesBefore.includes(f));

  if (result.exitCode === 0) {
    console.log(`✓ ${step.name}`);
    if (changed.length > 0) {
      console.log("  Formatted:");
      for (const f of changed) console.log(`  - ${f}`);
    }
  } else {
    console.log(`✗ ${step.name}`);
    console.log();
    console.log(`  [${step.name.toUpperCase()}_FAILURE]`);
    const body = parseFailureOutput(step.name, result);
    if (body) {
      for (const line of body.split("\n")) console.log(`  ${line}`);
    }
    process.exit(1);
  }
}
