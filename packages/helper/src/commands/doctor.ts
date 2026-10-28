import { runDoctor } from "../doctor.js";
import { runCommand } from "../exec.js";
import type { Terminal } from "../terminal.js";

export async function doctorCommand(term: Terminal): Promise<number> {
  process.stdout.write(`${term.banner("squashflow doctor")}\n`);
  const checks = await runDoctor({ run: runCommand });
  for (const check of checks) {
    process.stdout.write(
      `  ${(check.ok ? "ok" : "FAIL").padEnd(5)} ${check.name.padEnd(9)} ${check.detail}\n`,
    );
  }
  const failed = checks.filter((check) => !check.ok).length;
  process.stdout.write(
    failed === 0 ? `${term.squashed("all good")}\n` : `${term.warn(`${failed} check(s) failed`)}\n`,
  );
  return failed === 0 ? 0 : 1;
}
