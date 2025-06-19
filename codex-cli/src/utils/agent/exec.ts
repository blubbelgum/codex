import type { AppConfig } from "../config.js";
import type { ExecInput, ExecResult } from "./sandbox/interface.js";
import type { SpawnOptions } from "child_process";
import type { ParseEntry } from "shell-quote";

import { SandboxType } from "./sandbox/interface.js";
import { execWithLandlock } from "./sandbox/landlock.js";
import { execWithSeatbelt } from "./sandbox/macos-seatbelt.js";
import { rawExec } from "./sandbox/raw-exec.js";
import { formatCommandForDisplay } from "../../format-command.js";
import os from "os";
import { parse } from "shell-quote";

const DEFAULT_TIMEOUT_MS = 30000;

function requiresShell(cmd: Array<string>): boolean {
  // If the command is a single string that contains shell operators,
  // it needs to be run with shell: true
  if (cmd.length === 1 && cmd[0] !== undefined) {
    const tokens = parse(cmd[0]) as Array<ParseEntry>;
    return tokens.some((token) => typeof token === "object" && "op" in token);
  }

  // If the command is split into multiple arguments, we don't need shell: true
  // even if one of the arguments is a shell operator like '|'
  return false;
}

/**
 * Execute a command with the specified sandbox type.
 *
 * This function is coded defensively and should not throw. Any internal errors
 * should be mapped to a non-zero exit code and the error message should be in
 * stderr.
 */
export async function exec(
  execInput: ExecInput,
  sandboxType: SandboxType,
  config: AppConfig,
  abortSignal?: AbortSignal,
): Promise<ExecResult> {
  const opts: SpawnOptions = {
    timeout: execInput.timeoutInMillis || DEFAULT_TIMEOUT_MS,
    ...(requiresShell(execInput.cmd) ? { shell: true } : {}),
    ...(execInput.workdir ? { cwd: execInput.workdir } : {}),
  };

  switch (sandboxType) {
    case SandboxType.NONE: {
      // SandboxType.NONE uses the raw exec implementation.
      return rawExec(execInput.cmd, opts, config, abortSignal);
    }
    case SandboxType.MACOS_SEATBELT: {
      // SandboxType.MACOS_SEATBELT uses the macOS Seatbelt sandbox.
      const writableRoots = [
        process.cwd(),
        os.tmpdir(),
        ...(execInput.additionalWritableRoots || []),
      ] as const;
      return execWithSeatbelt(execInput.cmd, opts, writableRoots, config, abortSignal);
    }
    case SandboxType.LINUX_LANDLOCK: {
      return execWithLandlock(
        execInput.cmd,
        opts,
        execInput.additionalWritableRoots || [],
        config,
        abortSignal,
      );
    }
  }
}

export function getBaseCmd(cmd: Array<string>): string {
  const formattedCommand = formatCommandForDisplay(cmd);
  return formattedCommand.split(" ")[0] || cmd[0] || "<unknown>";
}
